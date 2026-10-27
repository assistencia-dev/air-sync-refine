const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  throw new Error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.");
}

const baseUrl = url.replace(/\/$/, "");
const response = await fetch(`${baseUrl}/rest/v1/rpc/treasury_ledger_health`, {
  headers: {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
  },
});
const body = await response.text();
if (!response.ok) {
  throw new Error(`treasury_ledger_health falhou (${response.status}): ${body}`);
}

const parsed = body ? JSON.parse(body) : null;
const health = Array.isArray(parsed) ? parsed[0] : parsed;
if (!health || typeof health !== "object") {
  throw new Error("treasury_ledger_health retornou um formato inválido.");
}

const numeric = (key) => Number(health[key] ?? 0);
const blockers = [
  ["failed", numeric("failed")],
  ["dead_letter", numeric("dead_letter")],
  ["pending_over_sla", numeric("pending_over_sla")],
  ["pending_critical", numeric("pending_critical")],
  ["retries_over_3", numeric("retries_over_3")],
].filter(([, value]) => value > 0);

console.log(JSON.stringify({
  ok: blockers.length === 0,
  source: "treasury_ledger_health",
  ...health,
  blockers: Object.fromEntries(blockers),
}, null, 2));

if (blockers.length) process.exitCode = 1;
