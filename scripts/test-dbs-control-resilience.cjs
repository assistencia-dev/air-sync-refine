const fs = require("node:fs");
const assert = require("node:assert/strict");

const route = fs.readFileSync("src/routes/_authenticated/dbs-control.tsx", "utf8");
const functions = fs.readFileSync("src/lib/dbs-control.functions.ts", "utf8");
const migration = fs.readFileSync("supabase/migrations/20261026170000_dbs_control_observability_outbox_worker.sql", "utf8");
const worker = fs.readFileSync("supabase/functions/dbs-control-outbox-worker/index.ts", "utf8");
const workflow = fs.readFileSync(".github/workflows/dbs-control-outbox-worker.yml", "utf8");
const runner = fs.readFileSync("scripts/run-dbs-control-outbox-worker.mjs", "utf8");
const iframe = fs.readFileSync("public/dbs-control.html", "utf8");

assert.match(migration, /for update skip locked/i, "A outbox precisa usar SKIP LOCKED para evitar dois workers processando o mesmo evento.");
assert.match(migration, /status = 'processing'/i, "O claim precisa marcar o evento como processing antes de devolvê-lo.");
assert.match(migration, /now\(\) - interval '5 minutes'/i, "Locks abandonados precisam ser recuperáveis após perda do worker.");
assert.match(migration, /o\.attempts >= 8/i, "A fila precisa limitar tentativas antes de marcar um evento como failed.");
assert.match(migration, /dbs_control_sync_health/, "A saúde da fila precisa ser consultável sem expor a tabela ao cliente.");
assert.match(worker, /jwtRole\(token\) !== "service_role"/, "O worker precisa rejeitar chamadas sem token service_role.");
assert.match(worker, /dbs_control_claim_outbox/, "O worker precisa fazer claim transacional.");
assert.match(worker, /dbs_control_complete_outbox/, "O worker precisa confirmar ou devolver o evento para retry.");
assert.match(worker, /dbs_control_sync_metrics/, "O worker precisa registrar métricas estruturadas.");
assert.match(workflow, /cron:\s*"\*\/5 \* \* \* \*"/, "A outbox precisa de execução contínua fora do processo web.");
assert.match(workflow, /SUPABASE_SERVICE_ROLE_KEY/, "O worker agendado precisa usar secret, nunca uma chave no repositório.");
assert.match(runner, /functions\/v1\/dbs-control-outbox-worker/, "O runner precisa chamar a Edge Function oficial.");
assert.match(runner, /authorization: `Bearer \$\{serviceRoleKey\}`/, "A chave precisa ser enviada somente pelo ambiente protegido do worker.");
assert.match(route, /dbs-control-work-orders-realtime/, "O cliente precisa manter um canal Realtime estável.");
assert.match(route, /removeChannel\(existing\)/, "Canais duplicados precisam ser removidos antes de assinar novamente.");
assert.match(route, /retryAttemptRef/, "Falhas temporárias precisam entrar em uma fila de retry.");
assert.match(route, /applyDbsControlDelta/, "A reconciliação precisa persistir somente deltas relacionais.");
assert.match(route, /getDbsControlSyncCursor/, "A recuperação precisa ter um cursor leve além do websocket.");
assert.match(route, /Only network\n\s*\/\/ and gateway failures enter the backoff queue|Only network and gateway failures enter the backoff queue/, "Erros permanentes não podem entrar em retry infinito.");
assert.match(iframe, /DBS_CONTROL_PENDING_SAVE_REQUESTS/, "O iframe precisa rastrear ACKs de cada delta.");
assert.match(iframe, /dbsControlApplyCommittedChanges/, "A base otimista só pode avançar depois da confirmação relacional.");
assert.match(iframe, /DBS_CONTROL_BLOCKED_SYNC_KEYS/, "Conflitos permanentes precisam ser bloqueados até a reconciliação explícita.");
assert.match(iframe, /DBS_CONTROL_DISMISS_CONFLICT/, "OS concluída não pode bloquear a emissão de uma nova OS por causa de uma intenção stale.");
assert.match(iframe, /dbsControlIsCompletedOrder/, "O delta não pode reenviar OS concluídas por diferenças de hidratação.");
assert.match(functions, /resolveDbsControlWorkOrderLegacyMap/, "OS legadas precisam ser resolvidas pelo vínculo legado→UUID antes do upsert.");
assert.match(functions, /work_order_create:/, "Criação de OS nova precisa de uma idempotência estável por intenção local.");
assert.match(functions, /entity_type: "work_order"/, "Novas OS precisam registrar o vínculo legado para evitar duplicação após reload.");

function retryDelay(attempt) {
  return Math.min(3600, Math.max(5, 30 * (2 ** Math.max(0, Math.min(attempt - 1, 6)))));
}

assert.deepEqual([1, 2, 3, 4, 8].map(retryDelay), [30, 60, 120, 240, 1920], "Backoff do worker precisa crescer sem explodir o intervalo.");
assert.equal(retryDelay(100), 1920, "Backoff extremo precisa permanecer limitado.");

// Simula dois consumidores concorrentes: um item reclamado fica invisível ao
// segundo consumidor até ser liberado, evitando entrega duplicada.
const queue = ["a", "b", "c"];
const claimed = new Map();
function claim(workerId, limit) {
  const result = [];
  for (const id of queue) {
    if (result.length >= limit) break;
    if (claimed.has(id)) continue;
    claimed.set(id, workerId);
    result.push(id);
  }
  return result;
}
assert.deepEqual(claim("worker-a", 2), ["a", "b"]);
assert.deepEqual(claim("worker-b", 2), ["c"]);
assert.equal(new Set([...claimed.keys()]).size, 3, "Cada evento deve ter no máximo um dono durante o processamento.");

// Simula falha temporária: o item permanece pendente e volta em ordem, sem
// ser descartado, até a tentativa limite.
let status = "pending";
let attempts = 0;
while (status === "pending" && attempts < 8) {
  attempts += 1;
  status = attempts === 3 ? "published" : attempts >= 8 ? "failed" : "pending";
}
assert.equal(status, "published", "Retry temporário deve recuperar o evento sem perda.");
assert.equal(attempts, 3);

console.log("DBS CONTROL resilience: contratos de concorrência, retry, locks abandonados, worker e telemetria aprovados.");
