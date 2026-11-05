const supabaseUrl = String(process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "");

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Secrets obrigatórios ausentes: configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY em Settings > Secrets and variables > Actions.");
}

const expectedOrigin = "https://gdglototcrehvhkvcqsq.supabase.co";
let parsedUrl;
try { parsedUrl = new URL(supabaseUrl); } catch { throw new Error("SUPABASE_URL inválida."); }
if (parsedUrl.origin !== expectedOrigin) {
  throw new Error(`SUPABASE_URL aponta para projeto diferente do Supabase oficial: esperado ${expectedOrigin}.`);
}

async function fetchWithRetry(url, init, label, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(45_000) });
      if (response.ok || (response.status < 500 && response.status !== 429)) return response;
      lastError = new Error(`${label}: HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
  }
  throw new Error(`${label} falhou após ${attempts} tentativas: ${lastError?.message ?? "erro desconhecido"}`);
}

const headers = {
  apikey: serviceRoleKey,
  authorization: `Bearer ${serviceRoleKey}`,
  "content-type": "application/json",
};

const response = await fetchWithRetry(
  `${expectedOrigin}/functions/v1/dbs-control-outbox-worker`,
  { method: "POST", headers, body: JSON.stringify({ limit: 200 }) },
  "Execução do worker",
);
const responseText = await response.text();
let payload;
try { payload = JSON.parse(responseText); } catch {
  throw new Error(`Worker retornou resposta inválida (HTTP ${response.status}).`);
}

const healthResponse = await fetchWithRetry(
  `${expectedOrigin}/rest/v1/rpc/dbs_control_sync_health`,
  { method: "POST", headers, body: "{}" },
  "Leitura da saúde da outbox",
);
const healthText = await healthResponse.text();
let healthRaw;
try { healthRaw = JSON.parse(healthText); } catch { throw new Error("Saúde da outbox retornou JSON inválido."); }
const health = (Array.isArray(healthRaw) ? healthRaw[0] : healthRaw)?.dbs_control_sync_health
  ?? (Array.isArray(healthRaw) ? healthRaw[0] : healthRaw)
  ?? {};
const pending = Number(health.pending ?? 0);
const processing = Number(health.processing ?? 0);
const deadLetter = Number(health.dead_letter ?? health.deadLetter ?? 0);
const oldestPendingAgeSeconds = Number(health.oldest_pending_age_seconds ?? health.oldestPendingAgeSeconds ?? 0);
const pendingOverSla = Number(health.pending_over_sla ?? health.pendingOverSla ?? 0);
const pendingCritical = Number(health.pending_critical ?? health.pendingCritical ?? 0);
const retriesOver3 = Number(health.retries_over_3 ?? health.retriesOver3 ?? 0);
const backlogAlert = pending > 10 || oldestPendingAgeSeconds > 900 || pendingOverSla > 10 || pendingCritical > 0 || retriesOver3 > 0 || deadLetter > 0;

console.log(JSON.stringify({
  status: response.status,
  workerId: payload.workerId ?? null,
  claimed: payload.claimed ?? 0,
  published: payload.published ?? 0,
  failed: payload.failed ?? 0,
  retries: payload.retries ?? 0,
  durationMs: payload.durationMs ?? null,
  health: { pending, processing, deadLetter, oldestPendingAgeSeconds, pendingOverSla, pendingCritical, retriesOver3 },
  backlogAlert,
}));

if (!response.ok || payload.ok !== true || Number(payload.failed ?? 0) > 0 || backlogAlert) {
  process.exitCode = 2;
}
