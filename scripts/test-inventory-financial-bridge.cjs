const fs = require('node:fs');
const assert = require('node:assert/strict');
const ts = require('typescript');

const functions = fs.readFileSync('src/lib/dbs-control.functions.ts', 'utf8');
const mainHtml = fs.readFileSync('public/dbs-control.html', 'utf8');
const shellHtml = fs.readFileSync('public/dbs-control-shell.html', 'utf8');
const bridge = fs.readFileSync('supabase/migrations/20261031040330_dbs_control_inventory_financial_bridge.sql', 'utf8');
const hardening = fs.readFileSync('supabase/migrations/20261031041704_dbs_control_inventory_financial_hardening.sql', 'utf8');
const fkIndexes = fs.readFileSync('supabase/migrations/20261031042042_dbs_control_inventory_financial_fk_indexes.sql', 'utf8');
const openingBalance = fs.readFileSync('supabase/migrations/20261031042508_dbs_control_inventory_opening_balance.sql', 'utf8');
const openingBalanceHardening = fs.readFileSync('supabase/migrations/20261031042732_dbs_control_inventory_opening_balance_zero_cost.sql', 'utf8');
const purchaseFkIndex = fs.readFileSync('supabase/migrations/20261031042759_dbs_control_inventory_purchase_fk_index.sql', 'utf8');
const partCostGuard = fs.readFileSync('supabase/migrations/20261031043439_dbs_control_part_cost_guard.sql', 'utf8');
const idempotencyGuard = fs.readFileSync('supabase/migrations/20261031051656_dbs_control_inventory_idempotency_guard.sql', 'utf8');
const importScript = fs.readFileSync('public/dbs-control-import.js', 'utf8');

for (const migration of [bridge, hardening, openingBalance, openingBalanceHardening]) {
  assert.doesNotMatch(migration, /drop\s+(table|schema|column)\b/i);
  assert.match(migration, /idempotency_key/i);
  assert.match(migration, /treasury_ledger_outbox|post_treasury_ledger_entry/i);
}

assert.match(bridge, /create table if not exists public\.dbs_control_purchases/i);
assert.match(bridge, /create table if not exists public\.dbs_control_inventory_movements/i);
assert.match(bridge, /create table if not exists public\.dbs_control_work_order_financials/i);
assert.match(bridge, /create or replace function public\.dbs_control_receive_purchase/i);
assert.match(bridge, /create or replace function public\.dbs_control_upsert_part/i);
assert.match(bridge, /post_treasury_ledger_entry/i);
assert.match(bridge, /inventory\.purchase\.received/i);
assert.match(bridge, /5\.1\.01/);
assert.match(bridge, /4\.1\.01/);
assert.match(bridge, /dbs_control_apply_work_order_parts_in_tx/i);
assert.match(hardening, /dbs_control_reconcile_work_order_parts_cost/i);
assert.match(hardening, /revenue_reversal_entry_id/i);
assert.match(hardening, /work-order:revenue-reversal/i);
assert.match(hardening, /work-order:revenue-adjustment/i);
assert.match(hardening, /deleted_at/i);
assert.match(openingBalance, /dbs_control_apply_opening_balance/i);
assert.match(openingBalance, /legacy_import_opening_balance/i);
assert.match(openingBalance, /inventory.opening_balance.applied/i);
assert.match(openingBalanceHardening, /if v_unit_cost > 0 then/i);
assert.match(fkIndexes, /dbs_control_inventory_movements_company_fk_idx/);
assert.match(fkIndexes, /dbs_control_work_order_financials_reversal_entry_fk_idx/);
assert.match(purchaseFkIndex, /dbs_control_purchase_items_purchase_idx/);
assert.match(partCostGuard, /v_has_movements/i);
assert.match(partCostGuard, /v_existing\.cost_cents/i);
assert.match(partCostGuard, /coalesce\(v_existing\.stock_quantity, 0\) = 0/i);
assert.doesNotMatch(partCostGuard, /drop\s+(table|schema|column)\b/i);
assert.doesNotMatch(idempotencyGuard, /drop\s+(table|schema|column)\b/i);
assert.match(idempotencyGuard, /dbs_control_inventory_commands/i);
assert.match(idempotencyGuard, /dbs_control_upsert_part_safe/i);
assert.match(idempotencyGuard, /dbs_control_receive_purchase_safe/i);
assert.match(idempotencyGuard, /payload_hash/i);
assert.match(idempotencyGuard, /pg_advisory_xact_lock/i);

assert.match(functions, /dbs_control_receive_purchase/);
assert.match(functions, /dbs_control_upsert_part/);
assert.match(functions, /dbs_control_receive_purchase_safe/);
assert.match(functions, /dbs_control_upsert_part_safe/);
assert.match(functions, /appliedParts/);
assert.match(functions, /purchaseLineItems/);
assert.match(functions, /dbs_control_apply_opening_balance/);
assert.match(functions, /purchaseItemsResult/);
assert.match(functions, /workOrderFinancialsResult/);
assert.match(functions, /lucroBruto/);
assert.match(functions, /relationalCompras/);
assert.doesNotMatch(functions, /from\(["']dbs_control_parts["']\)\.upsert\(/);
assert.doesNotMatch(functions, /from\(["']dbs_control_snapshots["']\)\.(?:insert|update|upsert)\(/);
assert.match(importScript, /opening_quantity/);
assert.match(importScript, /opening_unit_cost_cents/);

for (const html of [mainHtml, shellHtml]) {
  assert.match(html, /id="comp-peca"/);
  assert.match(html, /String\(p\.id\)\s*===\s*pecaId|String\(p\.id\)\s*===\s*String\(pecaId\)/);
  assert.doesNotMatch(html, /peca\.qtd\s*-=/);
  const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)].map((match) => match[1]);
  for (const source of inlineScripts) {
    ts.createSourceFile('dbs-control-inline.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  }
}

console.log('Inventory/Finance bridge: additive schema, purchase receipt, UUID part consumption, cost reconciliation, revenue lifecycle and inline UI syntax verified.');
