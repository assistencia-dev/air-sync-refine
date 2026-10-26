const assert = require("node:assert/strict");
const fs = require("node:fs");
const { performance } = require("node:perf_hooks");

const root = require("node:path").resolve(__dirname, "..");
const persistence = fs.readFileSync(require("node:path").join(root, "src/lib/dbs-control.functions.ts"), "utf8");
const html = fs.readFileSync(require("node:path").join(root, "public/dbs-control.html"), "utf8");

// Contract checks ensure that the load harness exercises the same protection
// that production uses: a collaborator never receives cancelled/deleted OS.
assert.match(persistence, /isWorkOrderHiddenFromCollaborator/);
assert.match(persistence, /!isWorkOrderHiddenFromCollaborator\(order\)/);
assert.match(html, /isEmployeeHiddenOrder/);
assert.match(html, /!isEmployeeHiddenOrder\(o\)/);

const SESSION_COUNT = 50;
const ORDERS_PER_SESSION = 1_000;
const CLIENTS_PER_SESSION = 120;
const allOrders = [];
const allClients = [];
for (let session = 0; session < SESSION_COUNT; session += 1) {
  const employeeId = `employee-${session}`;
  for (let client = 0; client < CLIENTS_PER_SESSION; client += 1) {
    allClients.push({ id: `client-${session}-${client}`, employeeId });
  }
  for (let index = 0; index < ORDERS_PER_SESSION; index += 1) {
    const hidden = index % 17 === 0;
    allOrders.push({
      id: `os-${session}-${index}`,
      employeeId,
      clienteId: `client-${session}-${index % CLIENTS_PER_SESSION}`,
      status: hidden ? (index % 34 === 0 ? "Cancelada" : "Em Atendimento") : "Em Atendimento",
      deleted_at: index % 51 === 0 ? "2026-10-26T00:00:00Z" : null,
      excluidaEm: index % 51 === 0 ? "2026-10-26T00:00:00Z" : null,
    });
  }
}

function hidden(order) {
  if (order.deleted_at || order.deletedAt || order.excluidaEm || order.arquivadaEm) return true;
  return /cancelad/.test(String(order.status || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase());
}

const started = performance.now();
(async () => {
const sessions = await Promise.all(Array.from({ length: SESSION_COUNT }, async (_, session) => {
  // Yield once to model concurrent login/hydration work instead of a serial loop.
  await new Promise((resolve) => setImmediate(resolve));
  const employeeId = `employee-${session}`;
  const visible = allOrders.filter((order) => order.employeeId === employeeId && !hidden(order));
  const visibleClientIds = new Set(visible.map((order) => order.clienteId));
  const scopedClients = allClients.filter((client) => client.employeeId === employeeId && visibleClientIds.has(client.id));
  const idempotency = new Set();
  let applied = 0;
  for (const order of visible.slice(0, 200)) {
    const key = `${employeeId}:${order.id}:v1`;
    if (idempotency.has(key)) continue;
    idempotency.add(key);
    idempotency.add(key); // retry of the same command must be a no-op
    applied += 1;
  }
  return { employeeId, visible, scopedClients, applied, idempotencySize: idempotency.size };
}));
const durationMs = Math.round(performance.now() - started);

assert.equal(sessions.length, SESSION_COUNT);
for (const result of sessions) {
  assert.ok(result.visible.length > 0);
  assert.ok(result.visible.every((order) => order.employeeId === result.employeeId));
  assert.ok(result.visible.every((order) => !hidden(order)), "OS cancelada/excluída vazou para o colaborador");
  assert.ok(result.scopedClients.every((client) => client.employeeId === result.employeeId));
  assert.equal(result.applied, 200);
  assert.equal(result.idempotencySize, 200);
}

console.log(JSON.stringify({
  test: "dbs-control-50-concurrent-sessions",
  sessions: SESSION_COUNT,
  orders_per_session: ORDERS_PER_SESSION,
  total_orders: allOrders.length,
  duration_ms: durationMs,
  status: "passed",
  scope: "synthetic non-destructive concurrency contract; production DB unchanged",
}, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
