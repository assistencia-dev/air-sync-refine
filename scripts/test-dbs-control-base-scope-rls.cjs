const fs = require("node:fs");
const assert = require("node:assert/strict");

const migration = fs.readFileSync(
  "supabase/migrations/20261115042021_dbs_control_collaborator_base_scope_rls_hardening.sql",
  "utf8",
);

assert.match(migration, /create or replace function private\.dbs_my_can_access_client/i);
assert.match(migration, /create or replace function private\.dbs_my_can_access_work_order/i);
assert.match(migration, /security definer/i);
assert.match(migration, /private\.dbs_my_employee_ids\(\)/i);
assert.match(migration, /b\.company_id = u\.company_id/i);
assert.match(migration, /lower\(coalesce\(b\.status, ''\)\) = 'ativo'/i);
assert.match(migration, /bc\.client_id = p_client_id/i);
assert.match(migration, /e\.dbs_control_base_id is null/i);
assert.match(migration, /grant execute on function private\.dbs_my_can_access_client/i);
assert.match(migration, /grant execute on function private\.dbs_my_can_access_work_order/i);

for (const table of [
  "dbs_control_work_orders",
  "dbs_control_clients",
  "dbs_control_sites",
  "dbs_control_equipment",
  "dbs_control_service_catalog",
  "dbs_control_work_order_attachments",
  "dbs_control_work_order_equipment",
  "dbs_control_work_order_events",
  "dbs_control_parts",
  "dbs_control_work_order_parts",
  "dbs_control_work_order_services",
]) {
  assert.match(migration, new RegExp("on public\\." + table, "i"), table + " policy must be hardened");
}

assert.match(migration, /uploaded_by_user_id = public\.current_app_user_id\(\)/i);
assert.match(migration, /actor_user_id = public\.current_app_user_id\(\)/i);
assert.match(migration, /e\.ponto_access_enabled = true/i);
assert.match(migration, /e\.dbs_control_access_enabled = true/i);
assert.match(migration, /e\.is_active = true/i);
assert.doesNotMatch(migration, /\b(insert|update|delete)\s+into\s+public\./i);
assert.doesNotMatch(migration, /\b(drop|truncate)\s+(table|schema|column)\b/i);

console.log("DBS Control collaborator base-scope RLS: company, active base, client mapping, OS relations and Ponto write guards verified.");
