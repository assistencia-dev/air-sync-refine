const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const adminFunctions = fs.readFileSync(path.join(root, "src/lib/admin.functions.ts"), "utf8");
const rhFunctions = fs.readFileSync(path.join(root, "src/lib/rh.functions.ts"), "utf8");
const registry = fs.readFileSync(path.join(root, "src/components/RhEmployeeRegistry.tsx"), "utf8");
const adminPanel = fs.readFileSync(path.join(root, "src/routes/_authenticated/admin.tsx"), "utf8");

function requirePattern(source, pattern, message) {
  assert.match(source, pattern, message);
}

// Static contract checks: the destructive action must be explicit, SUPER_ADMIN
// only, fail-closed, and must preserve the historical rows.
requirePattern(adminFunctions, /confirmation !== "EXCLUIR PERMANENTEMENTE"/, "A exclusão de acesso precisa de confirmação explícita.");
requirePattern(adminFunctions, /me\.role_key !== "SUPER_ADMIN"/, "Somente SUPER_ADMIN pode remover acesso definitivamente.");
requirePattern(adminFunctions, /if \(me\.id === data\.user_id\)/, "A conta do próprio administrador deve ser protegida.");
requirePattern(adminFunctions, /\.update\(\{ status: "bloqueado" \}\)\.eq\("id", target\.id\)/, "O perfil precisa ser bloqueado antes da remoção do login.");
requirePattern(adminFunctions, /ponto_access_enabled: false, dbs_control_access_enabled: false, ponto_portal_user_id: null/, "O vínculo Ponto/DBS CONTROL precisa ser revogado.");
requirePattern(adminFunctions, /\.update\(\{ access_enabled: false \}\)[\s\S]*?\.eq\("user_id", target\.id\)/, "Todos os vínculos RH do login precisam ser revogados.");
requirePattern(adminFunctions, /preserved_history: true/, "A remoção precisa preservar o histórico operacional.");
requirePattern(rhFunctions, /confirmation !== "EXCLUIR CADASTRO"/, "A exclusão pelo Cadastro RH precisa de confirmação explícita.");
requirePattern(rhFunctions, /auth\.admin\.deleteUser\(linkedUser\.auth_id\)/, "A exclusão do cadastro RH deve remover o login de colaborador vinculado.");
requirePattern(rhFunctions, /\.update\(\{ access_enabled: false \}\)[\s\S]*?\.eq\("employee_id", employee\.id\)/, "A exclusão do cadastro RH deve revogar o vínculo dedicado.");
requirePattern(registry, /Digite EXCLUIR CADASTRO para confirmar/, "A interface deve exigir confirmação textual.");
requirePattern(registry, /Excluir definitivamente o cadastro de/, "A ação destrutiva precisa ser identificável por acessibilidade.");
requirePattern(adminPanel, /Digite EXCLUIR PERMANENTEMENTE para confirmar/, "A exclusão de acesso precisa exibir a confirmação correta.");
requirePattern(adminPanel, /deleteText !== "EXCLUIR PERMANENTEMENTE"/, "A exclusão de acesso precisa bloquear confirmação incompleta.");

// Large-scale, non-destructive model test. It exercises the same invariants
// expected from the server operation without touching the real Supabase data.
const collaboratorCount = 25_000;
const ordersPerCollaborator = 4;
const users = [];
const employees = [];
const accesses = [];
const historicalOrders = [];

for (let i = 0; i < collaboratorCount; i += 1) {
  const userId = `user-${i}`;
  const employeeId = `employee-${i}`;
  users.push({ id: userId, role_key: "COLABORADOR", status: "ativo", auth_id: `auth-${i}` });
  employees.push({ id: employeeId, ponto_portal_user_id: userId, ponto_access_enabled: true, dbs_control_access_enabled: true });
  // Duplicate legacy access rows are intentional: deletion must revoke all of them.
  accesses.push({ id: `access-${i}-a`, employee_id: employeeId, user_id: userId, access_enabled: true });
  accesses.push({ id: `access-${i}-b`, employee_id: employeeId, user_id: userId, access_enabled: true });
  for (let order = 0; order < ordersPerCollaborator; order += 1) {
    historicalOrders.push({ id: `os-${i}-${order}`, employee_id: employeeId, status: order === 0 ? "Concluída" : "Em Atendimento" });
  }
}

const historicalBefore = JSON.stringify(historicalOrders);
const deletedAuthIds = new Set();

function removeCollaborator(userId, actingUserId = "super-admin") {
  const user = users.find((row) => row.id === userId);
  assert.ok(user, "o usuário alvo precisa existir");
  if (userId === actingUserId) throw new Error("não é permitido remover a própria conta");
  assert.equal(user.role_key, "COLABORADOR", "o cenário de escala deve operar somente sobre colaboradores");
  user.status = "bloqueado";
  const linked = employees.filter((row) => row.ponto_portal_user_id === userId);
  for (const employee of linked) {
    employee.ponto_access_enabled = false;
    employee.dbs_control_access_enabled = false;
    employee.ponto_portal_user_id = null;
    for (const access of accesses) {
      if (access.employee_id === employee.id || access.user_id === userId) access.access_enabled = false;
    }
  }
  if (user.auth_id) deletedAuthIds.add(user.auth_id);
  user.auth_id = null;
  return linked.length;
}

let linkedCount = 0;
for (const user of users) linkedCount += removeCollaborator(user.id);
assert.equal(linkedCount, collaboratorCount, "todos os colaboradores precisam ter um vínculo RH revogado");
assert.equal(users.filter((row) => row.status === "bloqueado").length, collaboratorCount);
assert.equal(employees.filter((row) => row.ponto_access_enabled || row.dbs_control_access_enabled || row.ponto_portal_user_id).length, 0);
assert.equal(accesses.filter((row) => row.access_enabled).length, 0);
assert.equal(deletedAuthIds.size, collaboratorCount);
assert.equal(JSON.stringify(historicalOrders), historicalBefore, "OS históricas não podem ser apagadas ou alteradas");

// Retry/idempotency pass: repeating a removal must not duplicate or resurrect access.
for (const user of users) removeCollaborator(user.id);
assert.equal(users.filter((row) => row.status !== "bloqueado").length, 0);
assert.equal(accesses.filter((row) => row.access_enabled).length, 0);
assert.equal(deletedAuthIds.size, collaboratorCount);
assert.equal(JSON.stringify(historicalOrders), historicalBefore);

assert.throws(() => removeCollaborator("user-0", "user-0"), /própria conta/);
console.log(`RH collaborator scale: ${collaboratorCount.toLocaleString("pt-BR")} collaborators, ${(collaboratorCount * ordersPerCollaborator).toLocaleString("pt-BR")} historical OS references, duplicate access rows and idempotent retry passed.`);
