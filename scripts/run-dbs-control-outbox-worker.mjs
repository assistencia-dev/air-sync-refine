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

console.log(JSON.stringify({
  status: response.status,
  workerId: payload.workerId ?? null,
  claimed: payload.claimed ?? 0,
  published: payload.published ?? 0,
  failed: payload.failed ?? 0,
  retries: payload.retries ?? 0,
  durationMs: payload.durationMs ?? null,
}));

if (!response.ok || Number(payload.failed ?? 0) > 0) {
  process.exitCode = 2;
}
