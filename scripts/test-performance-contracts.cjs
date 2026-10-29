const fs = require("node:fs");
const assert = require("node:assert/strict");

const functions = fs.readFileSync("src/lib/dbs-control.functions.ts", "utf8");
const shell = fs.readFileSync("public/dbs-control-shell.html", "utf8");
const indexes = [
  "supabase/migrations/20261027130000_enterprise_hardening.sql",
  "supabase/migrations/20261027130001_enterprise_indexes_and_status_catalog.sql",
  "supabase/migrations/20261027160001_rls_scope_lookup_indexes.sql",
  "supabase/migrations/20261026161000_dbs_control_sync_indexes.sql",
  "supabase/migrations/20261026180000_dbs_control_bases_issue_scope.sql",
  "supabase/migrations/20261027162456_dbs_control_cursor_indexes.sql",
  "supabase/migrations/20261027162717_treasury_ledger_fk_indexes.sql",
].map((file) => fs.readFileSync(file, "utf8")).join("\n");

assert.match(functions, /\.limit\(pageSize\)/, "Listagens operacionais precisam de limite server-side.");
assert.match(functions, /\.gt\("id", cursor\)/, "Listagens operacionais precisam de cursor keyset.");
assert.match(functions, /rpc\("dbs_control_dashboard_summary_scoped"/, "Dashboard precisa usar o contrato relacional com escopo.");
assert.match(shell, /source !== 'canonical_relational_db'/, "Dashboard não pode aceitar KPIs locais como fallback online.");
assert.match(shell, /aggregate\.recent_orders/, "Painel do colaborador precisa receber a lista resumida do servidor.");
assert.match(shell, /renderizarDashboardRecentOrders/, "Dashboard administrativo precisa usar a lista recente do contrato relacional.");
assert.match(shell, /orders_unassigned/, "Fila operacional precisa usar o contador canônico de OS sem técnico.");
assert.match(shell, /orders_execution_pending/, "Fila operacional precisa usar o contador canônico de pendência.");
assert.match(indexes, /idx_hardening_work_orders_active_id/, "Índice de cursor ativo ausente.");
assert.match(indexes, /idx_hardening_work_orders_assignee_id/, "Índice de cursor por colaborador ausente.");
assert.match(indexes, /treasury_entries_company_fk_idx/, "Índice de FK do ledger ausente.");
for (const column of ["company_id", "assigned_employee_id", "client_id", "site_id", "status", "deleted_at", "version", "updated_at", "base_id"]) {
  assert.match(indexes, new RegExp(column), `Índice/contrato ausente para ${column}.`);
}

console.log(JSON.stringify({
  test: "performance-contracts",
  pagination: "cursor/keyset",
  dashboard: "server-side aggregate RPC",
  indexed_filters: 9,
}, null, 2));
