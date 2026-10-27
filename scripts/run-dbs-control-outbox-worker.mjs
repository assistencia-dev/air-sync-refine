const supabaseUrl = String(process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "");

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios para consumir a outbox.");
}

const response = await fetch(`${supabaseUrl}/functions/v1/dbs-control-outbox-worker`, {
  method: "POST",
  headers: {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({ limit: 200 }),
  signal: AbortSignal.timeout(60_000),
});

const text = await response.text();
let payload;
try {
  payload = JSON.parse(text);
} catch {
  throw new Error(`Worker retornou resposta inválida (${response.status}).`);
}

const healthResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/dbs_control_sync_health`, {
  method: "POST",
  headers: {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    "content-type": "application/json",
  },
  body: "{}",
  signal: AbortSignal.timeout(30_000),
});
const healthText = await healthResponse.text();
if (!healthResponse.ok) throw new Error(`Não foi possível ler a saúde da outbox (${healthResponse.status}).`);
let healthRaw;
try { healthRaw = JSON.parse(healthText); } catch { throw new Error("Saúde da outbox retornou JSON inválido."); }
const health = (Array.isArray(healthRaw) ? healthRaw[0] : healthRaw)?.dbs_control_sync_health
  ?? (Array.isArray(healthRaw) ? healthRaw[0] : healthRaw)
  ?? {};
const pending = Number(health.pending ?? 0);
const processing = Number(health.processing ?? 0);
const deadLetter = Number(health.dead_letter ?? health.deadLetter ?? 0);
const oldestPendingAgeSeconds = Number(health.oldest_pending_age_seconds ?? health.oldestPendingAgeSeconds ?? 0);
const backlogAlert = pending > 10 || oldestPendingAgeSeconds > 900 || deadLetter > 0;

console.log(JSON.stringify({
  status: response.status,
  workerId: payload.workerId ?? null,
  claimed: payload.claimed ?? 0,
  published: payload.published ?? 0,
  failed: payload.failed ?? 0,
  retries: payload.retries ?? 0,
  durationMs: payload.durationMs ?? null,
  health: { pending, processing, deadLetter, oldestPendingAgeSeconds },
  backlogAlert,
}));

if (!response.ok || Number(payload.failed ?? 0) > 0 || backlogAlert) {
  process.exitCode = 2;
}
