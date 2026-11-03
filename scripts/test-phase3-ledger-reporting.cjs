const fs = require("node:fs");
const assert = require("node:assert/strict");

const migration = fs.readFileSync(
  "supabase/migrations/20261103200000_dbs_phase3_ledger_reporting_views.sql",
  "utf8",
);

for (const view of [
  "treasury_vw_dre_competence_by_account",
  "treasury_vw_dre_competence",
  "treasury_vw_cash_flow_monthly_by_account",
  "treasury_vw_cash_flow_monthly",
]) {
  assert.match(migration, new RegExp("create or replace view public\\." + view, "i"));
}
assert.equal((migration.match(/with \\(security_invoker = true\\)/gi) || []).length, 4);
assert.match(migration, /from public\\.treasury_ledger_entries/i);
assert.match(migration, /join public\\.treasury_ledger_lines/i);
assert.match(migration, /join public\\.treasury_accounts/i);
assert.match(migration, /where e\\.status='posted'/i);
assert.match(migration, /e\\.competence_date/i);
assert.match(migration, /a\\.account_type='revenue'/i);
assert.match(migration, /a\\.account_type='expense'/i);
assert.match(migration, /coalesce\\(e\\.document_date,e\\.competence_date\\)/i);
assert.match(migration, /a\\.code='1\\.1\\.01'/i);
assert.match(migration, /opening_balance_cents/i);
assert.match(migration, /closing_balance_cents/i);
assert.match(migration, /rows between unbounded preceding and current row/i);
assert.match(migration, /grant select on public\\.treasury_vw_dre_competence_by_account/i);
assert.doesNotMatch(migration, /dbs_control_|dbs_purchase_|dbs_control_work_orders/i);
assert.doesNotMatch(migration, /\\b(drop|truncate)\\s+(table|view|schema|column)\\b/i);
assert.doesNotMatch(migration, /\\b(insert|update|delete)\\s+into?\\s+public\\./i);

console.log("Phase 3 Ledger reporting: DRE by competence, cash flow by document date, security_invoker and read-only source invariants verified.");
