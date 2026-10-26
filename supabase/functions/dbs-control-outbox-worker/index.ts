import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.8";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const MAX_BATCH = 200;
const MAX_ATTEMPTS = 8;

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function bearerToken(request: Request) {
  const value = request.headers.get("authorization") ?? "";
  return value.replace(/^Bearer\s+/i, "").trim();
}

function jwtRole(token: string) {
  try {
    const segment = token.split(".")[1];
    if (!segment) return null;
    const normalized = segment.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(segment.length / 4) * 4, "=");
    const payload = JSON.parse(atob(normalized));
    return typeof payload?.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

function retryDelaySeconds(attempts: number) {
  return Math.min(3600, Math.max(5, 30 * (2 ** Math.max(0, Math.min(attempts - 1, 6)))));
}

async function validateCanonicalAggregate(row: Record<string, unknown>) {
  if (String(row.aggregate_type ?? "") !== "work_order" || !row.aggregate_id) {
    // Entity records are durable state changes without a work-order FK. Their
    // payload is already committed atomically; the worker only acknowledges
    // the event and keeps the audit trail observable.
    return { ok: true as const };
  }

  const { data, error } = await supabase
    .from("dbs_control_work_orders")
    .select("id,version")
    .eq("id", String(row.aggregate_id))
    .maybeSingle();
  if (error) return { ok: false as const, error: `canonical_read:${error.message}` };
  if (!data) return { ok: false as const, error: "aggregate_missing" };
  if (Number(data.version) < Number(row.aggregate_version ?? 0)) {
    return { ok: false as const, error: "aggregate_version_behind" };
  }
  return { ok: true as const };
}

Deno.serve(async (request) => {
  if (request.method !== "GET" && request.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  const token = bearerToken(request);
  if (jwtRole(token) !== "service_role") {
    return json({ ok: false, error: "service_role_required" }, 403);
  }

  let requestedLimit = 50;
  if (request.method === "POST") {
    try {
      const payload = await request.json();
      requestedLimit = Number(payload?.limit ?? requestedLimit);
    } catch {
      // Empty POST is valid and uses the safe default batch size.
    }
  }
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(MAX_BATCH, Math.trunc(requestedLimit))) : 50;
  const workerId = `edge-outbox:${crypto.randomUUID()}`;
  const startedAt = Date.now();

  const { data: claimed, error: claimError } = await supabase.rpc("dbs_control_claim_outbox", {
    p_worker_id: workerId,
    p_limit: limit,
  });
  if (claimError) {
    console.error(JSON.stringify({ event: "outbox_claim_failed", workerId, error: claimError.message }));
    return json({ ok: false, error: "claim_failed", message: claimError.message }, 500);
  }

  const rows = Array.isArray(claimed) ? claimed as Record<string, unknown>[] : [];
  let successCount = 0;
  let failureCount = 0;
  let retryCount = 0;
  const failures: Array<{ id: string; error: string }> = [];

  for (const row of rows) {
    const check = await validateCanonicalAggregate(row);
    const completed = await supabase.rpc("dbs_control_complete_outbox", {
      p_outbox_id: String(row.id),
      p_worker_id: workerId,
      p_success: check.ok,
      p_error: check.ok ? null : check.error,
      p_retry_seconds: retryDelaySeconds(Number(row.attempts ?? 1)),
    });

    if (completed.error || completed.data !== true) {
      failureCount += 1;
      retryCount += 1;
      const error = completed.error?.message ?? "outbox_ack_not_applied";
      failures.push({ id: String(row.id), error });
      console.error(JSON.stringify({ event: "outbox_ack_failed", workerId, outboxId: row.id, error }));
    } else if (check.ok) {
      successCount += 1;
    } else {
      failureCount += 1;
      retryCount += Number(row.attempts ?? 1) < MAX_ATTEMPTS ? 1 : 0;
      failures.push({ id: String(row.id), error: check.error ?? "canonical_validation_failed" });
      console.error(JSON.stringify({ event: "outbox_validation_failed", workerId, outboxId: row.id, error: check.error }));
    }
  }

  const durationMs = Date.now() - startedAt;
  const metricStatus = failureCount === 0 ? "ok" : successCount > 0 ? "warning" : "error";
  const { error: metricError } = await supabase.from("dbs_control_sync_metrics").insert({
    worker_id: workerId,
    metric_name: "outbox_worker",
    status: metricStatus,
    duration_ms: durationMs,
    claimed_count: rows.length,
    success_count: successCount,
    failure_count: failureCount,
    retry_count: retryCount,
    details: { limit, failures: failures.slice(0, 20) },
  });
  if (metricError) console.error(JSON.stringify({ event: "outbox_metric_failed", workerId, error: metricError.message }));

  return json({
    ok: failureCount === 0,
    workerId,
    claimed: rows.length,
    published: successCount,
    failed: failureCount,
    retries: retryCount,
    durationMs,
    failures: failures.slice(0, 20),
  }, failureCount === 0 ? 200 : 207);
});
