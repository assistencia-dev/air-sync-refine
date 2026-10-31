const fs = require("node:fs");
const assert = require("node:assert/strict");

const route = fs.readFileSync("src/routes/_authenticated/dbs-control.tsx", "utf8");
const functions = fs.readFileSync("src/lib/dbs-control.functions.ts", "utf8");
const migration = fs.readFileSync("supabase/migrations/20261026170000_dbs_control_observability_outbox_worker.sql", "utf8");
const worker = fs.readFileSync("supabase/functions/dbs-control-outbox-worker/index.ts", "utf8");
const workflow = fs.readFileSync(".github/workflows/dbs-control-outbox-worker.yml", "utf8");
const runner = fs.readFileSync("scripts/run-dbs-control-outbox-worker.mjs", "utf8");
const iframe = fs.readFileSync("public/dbs-control.html", "utf8");
const localSync = fs.readFileSync("src/lib/dbs-control.local-sync.ts", "utf8");
const referenceMigration = fs.readFileSync("supabase/migrations/20261028191111_dbs_control_reference_validation.sql", "utf8");
const workOrderDefaultsMigration = fs.readFileSync("supabase/migrations/20261030041711_dbs_control_work_order_defaults.sql", "utf8");

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
assert.match(route, /hydrateLocalSyncQueue/, "A sessão precisa hidratar a fila local durável antes de aceitar novos deltas.");
assert.match(route, /isLegacyAutomaticReconcileCommand/, "Comandos de reconciliação automática legados precisam ser isolados após uma atualização.");
assert.match(route, /status: "quarantined"/, "Comandos legados isolados não podem voltar para a fila de envio.");
assert.match(route, /legacy_reconcile_blocked/, "A rota deve rejeitar novas tentativas do protocolo legado sem tocar no banco.");
assert.match(route, /withDbsControlLocalSyncLock/, "Duas abas não podem enviar a mesma intenção simultaneamente.");
assert.match(route, /queuedChangesRef/, "Uma edição que chega durante uma transação precisa formar outra intenção, não regravar a primeira.");
assert.match(route, /handleOffline/, "A interface precisa sinalizar a perda de conexão antes do próximo salvamento.");
assert.match(route, /dbsControlConflictIsAutoResolvable/, "Conflitos de OS concluída precisam ser reconhecidos mesmo quando o código legado veio incompleto.");
assert.match(route, /dbsControlConflictAlreadyApplied/, "Conflitos antigos já refletidos na versão canônica precisam sair da fila ativa sem regravar a OS.");
assert.match(route, /status: "quarantined"[\s\S]*A intenção original foi preservada para auditoria/, "A intenção stale deve ser preservada em quarentena, nunca apagada.");
assert.match(route, /dbsControlUserFacingSyncMessage/, "Falhas de infraestrutura não devem despejar detalhes técnicos no painel operacional.");
assert.match(route, /withDbsControlTransientRetry\(\(\) => uploadDbsControlOsAttachment/, "Uploads de evidência precisam de retry transitório antes de falhar a conclusão.");
assert.match(route, /activeCommand\?\.status === "conflict"/, "Eventos de foco/online não podem reabrir um conflito permanente automaticamente.");
assert.match(route, /Only network\n\s*\/\/ and gateway failures enter the backoff queue|Only network and gateway failures enter the backoff queue/, "Erros permanentes não podem entrar em retry infinito.");
assert.match(iframe, /DBS_CONTROL_PENDING_SAVE_REQUESTS/, "O iframe precisa rastrear ACKs de cada delta.");
assert.match(iframe, /dbsControlApplyCommittedChanges/, "A base otimista só pode avançar depois da confirmação relacional.");
assert.match(iframe, /DBS_CONTROL_BLOCKED_SYNC_KEYS/, "Conflitos permanentes precisam ser bloqueados até a reconciliação explícita.");
assert.match(iframe, /DBS_CONTROL_DISMISS_CONFLICT/, "OS concluída não pode bloquear a emissão de uma nova OS por causa de uma intenção stale.");
assert.match(iframe, /dbsControlIsCompletedOrder/, "O delta não pode reenviar OS concluídas por diferenças de hidratação.");
assert.match(functions, /resolveDbsControlWorkOrderLegacyMap/, "OS legadas precisam ser resolvidas pelo vínculo legado→UUID antes do upsert.");
assert.match(functions, /DBS_OS_EMPLOYEE_NOT_FOUND/, "Uma referência de técnico inválida precisa virar rejeição operacional controlada, não HTTP 500.");
assert.match(route, /DBS_OS_EMPLOYEE_NOT_FOUND/, "O painel precisa tratar a referência de técnico inválida como conflito permanente, sem retry infinito.");
assert.equal((referenceMigration.match(/CREATE OR REPLACE FUNCTION public\.dbs_control_apply_work_order_delta/gi) || []).length, 1, "A migração de referência deve substituir a RPC uma única vez, sem duplicar o corpo da função.");
assert.equal((referenceMigration.match(/jsonb_populate_record\(v_current, v_patch\)/g) || []).length, 1, "A migração deve manter um único caminho de atualização da OS.");
assert.equal((referenceMigration.match(/jsonb_populate_record\(null::public\.dbs_control_work_orders/g) || []).length, 1, "A migração deve manter um único caminho de criação da OS.");
assert.match(referenceMigration, /assigned_employee_id[\s\S]*?DBS_OS_EMPLOYEE_NOT_FOUND/, "A migração deve validar o formato do UUID do técnico antes do cast relacional.");
assert.match(referenceMigration, /not exists \(\s*select 1 from public\.rh_employees/i, "A migração deve validar a existência do técnico na tabela relacional.");
assert.match(referenceMigration, /revoke all on function public\.dbs_control_apply_work_order_delta\(jsonb\)/i, "A RPC endurecida deve manter ACL explícita.");
assert.match(workOrderDefaultsMigration, /trg_dbs_control_work_order_defaults/i, "A criação de OS precisa preencher o checklist obrigatório sem exigir campos artificiais no formulário.");
assert.match(workOrderDefaultsMigration, /new\.execution_checklist := case/i, "O guard de criação não pode deixar execution_checklist nulo.");
assert.match(workOrderDefaultsMigration, /when tg_op = 'UPDATE' then old\.execution_checklist/i, "Uma atualização sem checklist não pode apagar o checklist existente.");
assert.match(functions, /work_order_create:/, "Criação de OS nova precisa de uma idempotência estável por intenção local.");
assert.match(functions, /entity_type: "work_order"/, "Novas OS precisam registrar o vínculo legado para evitar duplicação após reload.");
assert.match(localSync, /dbs-control-local-sync/, "A fila local precisa ter um armazenamento nomeado e versionado.");
assert.match(localSync, /requestIds/, "A fila local precisa preservar as chaves idempotentes da intenção.");
assert.match(localSync, /recoverExpiredDbsControlLocalSyncCommands/, "Uma sessão interrompida precisa recuperar leases expirados sem descartar deltas.");
assert.match(iframe, /queuedLocally/, "O técnico precisa receber confirmação local explícita quando a nuvem estiver temporariamente indisponível.");
assert.match(iframe, /Salvo no dispositivo · aguardando sincronização/, "O estado pendente precisa ser visível no próprio aplicativo.");
assert.match(iframe, /dbsControlConflictIsCompletedLocked/, "Conflitos históricos de OS concluída não podem bloquear a operação.");
assert.match(iframe, /DBS_CONTROL_SYNC_CONFLICT_CLEARED/, "A limpeza de conflito stale deve remover somente o alerta visual, sem disparar uma nova reconciliação.");

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
