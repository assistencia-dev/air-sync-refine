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
const phase2 = fs.readFileSync('supabase/migrations/20261103180000_dbs_phase2_sales_reservations.sql', 'utf8');
const settlement = fs.readFileSync('supabase/migrations/20261105125017_dbs_control_purchase_settlement_and_financial_overview.sql', 'utf8');
const settlementIndexes = fs.readFileSync('supabase/migrations/20261105125435_dbs_control_purchase_payment_fk_indexes.sql', 'utf8');
const purchaseLifecycle = fs.readFileSync('supabase/migrations/20261105125808_dbs_control_purchase_register_and_receipt_lifecycle.sql', 'utf8');
const purchaseReceiptFix = fs.readFileSync('supabase/migrations/20261105125833_fix_dbs_control_purchase_receipt_status_lock.sql', 'utf8');
const integrationSql = fs.readFileSync('scripts/test-inventory-financial-bridge.integration.sql', 'utf8');
const ledgerRpc = fs.readFileSync('supabase/migrations/20261027155816_treasury_ledger_command_rpc.sql', 'utf8');
const phase2Ui = fs.readFileSync('src/routes/_authenticated/dbs-inventory.tsx', 'utf8');
const controlRoute = fs.readFileSync('src/routes/_authenticated/dbs-control.tsx', 'utf8');
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
assert.match(functions, /normalizedServiceStatus/);
assert.match(functions, /status: serviceStatus/);
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


assert.match(phase2, /create table if not exists public\.dbs_control_work_order_reservations/i);
assert.match(phase2, /create table if not exists public\.dbs_control_reservation_consumptions/i);
assert.match(phase2, /create table if not exists public\.dbs_control_sales/i);
assert.match(phase2, /create table if not exists public\.dbs_control_sale_items/i);
assert.match(phase2, /create table if not exists public\.dbs_control_sale_settlements/i);
assert.ok(phase2.includes("reserved_quantity=reserved_quantity+v_qty"));
assert.match(phase2, /stock_quantity-v_part\.reserved_quantity<v_part\.requested_qty/i);
assert.match(phase2, /dbs_control_reserve_work_order_parts/i);
assert.match(phase2, /dbs_control_release_work_order_reservation/i);
assert.match(phase2, /dbs_control_consume_work_order_reservations/i);
assert.match(phase2, /dbs_control_create_part_sale/i);
assert.match(phase2, /dbs_control_settle_part_sale/i);
assert.match(phase2, /pg_advisory_xact_lock/i);
assert.match(phase2, /for update/i);
assert.match(phase2, /unique\(scope_key,idempotency_key\)/i);
assert.match(phase2, /post_treasury_ledger_entry/i);
assert.match(phase2, /'1\.1\.02'/);
assert.match(phase2, /'4\.1\.02'/);
assert.match(phase2, /'5\.1\.01'/);
assert.match(phase2, /'1\.1\.03'/);
assert.match(phase2, /'1\.1\.01'/);
assert.match(phase2, /dbs_control_inventory_outbox/i);
assert.match(phase2, /after insert on public\.dbs_control_inventory_movements/i);
assert.doesNotMatch(phase2, /drop\s+(table|schema|column|function)\b/i);
assert.doesNotMatch(phase2, /truncate\s/i);
assert.doesNotMatch(phase2, /delete\s+from\s+public\.dbs_control_(?:parts|work_orders|inventory_movements|treasury)/i);
assert.doesNotMatch(phase2, /dbs_control_outbox|dbs_control_snapshots/i);
assert.match(phase2, /grant execute on function public\.dbs_control_create_part_sale\(jsonb\) to service_role/i);
assert.match(phase2, /grant execute on function public\.dbs_control_reserve_work_order_parts\(jsonb\) to service_role/i);

assert.match(phase2, /dbs_control_apply_work_order_delta_with_reservations/i);
assert.match(phase2, /jsonb_array_elements\(coalesce\(p_payload->'parts'/i);
assert.match(phase2, /coalesce\(r\.reserved_qty,0\)/i);
assert.match(phase2, /work_order_part_id/i);
assert.match(phase2, /quantity=quantity\+v_r\.quantity/i);
assert.match(phase2, /v_work_order_part/i);

assert.match(phase2, /jsonb_set\(v_payload,'\{parts\}'/i);
assert.match(phase2, /dbs_control_consume_work_order_reservations\(/i);
assert.match(phase2, /atendimento com pendência/i);
assert.match(functions, /dbs_control_apply_work_order_delta_with_reservations/);
assert.match(phase2Ui, /Vendas avulsas/);
assert.match(phase2Ui, /Reservas de OS/);
assert.match(phase2Ui, /createDbsPartSale/);
assert.match(phase2Ui, /reserveDbsWorkOrderParts/);
assert.match(ledgerRpc, /insert into public\.treasury_accounts/i);
assert.match(ledgerRpc, /on conflict \(scope_key, code\) do update/i);
assert.match(phase2, /'4\.1\.02'/);

assert.match(functions, /export const reserveDbsWorkOrderParts/);
assert.match(functions, /export const releaseDbsWorkOrderReservation/);
assert.match(functions, /export const consumeDbsWorkOrderReservations/);
assert.match(functions, /export const createDbsPartSale/);
assert.match(purchaseLifecycle, /create or replace function public\.dbs_control_register_purchase/i);
assert.match(purchaseLifecycle, /create or replace function public\.dbs_control_receive_registered_purchase/i);
assert.match(purchaseLifecycle, /'draft'/);
assert.match(purchaseLifecycle, /'1\.1\.04'/);
assert.match(purchaseLifecycle, /'1\.1\.03'/);
assert.match(purchaseReceiptFix, /into v_stock,v_old_cost,v_part_status/i);
assert.match(purchaseReceiptFix, /v_total<=0 or v_total<>v_purchase\.total_cents/i);
assert.match(functions, /dbs_control_register_purchase/);
assert.match(functions, /dbs_control_receive_registered_purchase/);
assert.match(functions, /export const receiveDbsPurchase/);
assert.match(phase2Ui, /receiveDbsPurchase/);
assert.match(mainHtml, /id="comp-status"/);
assert.match(mainHtml, /value="received"/);
assert.match(settlementIndexes, /dbs_control_purchase_payments_created_by_fk_idx/i);
assert.match(settlementIndexes, /dbs_control_purchase_payments_ledger_entry_fk_idx/i);
assert.match(integrationSql, /begin;[\s\S]*rollback;/i);
assert.match(integrationSql, /dbs_control_receive_purchase_safe/i);
assert.match(integrationSql, /dbs_control_settle_purchase/i);
assert.match(integrationSql, /TEST_MOVEMENT_IDEMPOTENCY/i);
assert.match(settlement, /create table if not exists public\.dbs_control_purchase_payments/i);
assert.match(settlement, /create or replace function public\.dbs_control_settle_purchase/i);
assert.match(settlement, /create or replace function public\.dbs_control_inventory_financial_overview/i);
assert.match(settlement, /pg_advisory_xact_lock/i);
assert.match(settlement, /payload_hash/i);
assert.match(settlement, /'2\.1\.01'/);
assert.match(settlement, /'1\.1\.01'/);
assert.match(settlement, /revoke all on function public\.dbs_control_settle_purchase/i);
assert.match(settlement, /grant execute on function public\.dbs_control_settle_purchase.*to service_role/i);
assert.match(functions, /export const settleDbsPurchase/);
assert.match(functions, /export const getDbsInventoryFinancialOverview/);
assert.match(functions, /payment_status: 'unpaid'/);
assert.match(functions, /paid_cents/);
assert.match(phase2Ui, /Compras e contas a pagar/);
assert.match(phase2Ui, /settleDbsPurchase/);
assert.match(phase2Ui, /gross_margin_pct/);
assert.match(mainHtml, /id="peca-status"/);
assert.match(mainHtml, /status: document\.getElementById\('peca-status'\)/);
assert.match(mainHtml, /status: 'Recebido'/);
assert.match(mainHtml, /abrirFinanceiroEstoque/);
assert.match(controlRoute, /DBS_CONTROL_OPEN_INVENTORY_FINANCE/);
assert.match(integrationSql, /integration_test_status/);

assert.match(functions, /export const settleDbsPartSale/);
assert.match(functions, /requireDbsInventoryAdmin/);


console.log('Inventory/Finance bridge: additive schema, purchase receipt, UUID part consumption, cost reconciliation, revenue lifecycle, phase 2 RPC contracts and inline UI syntax verified.');
