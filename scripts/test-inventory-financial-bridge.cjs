const fs = require('node:fs');
const assert = require('node:assert/strict');
const ts = require('typescript');
const vm = require('node:vm');

const functions = fs.readFileSync('src/lib/dbs-control.functions.ts', 'utf8');
const inventoryValidationSource = fs.readFileSync('src/lib/dbs-inventory.validation.ts', 'utf8');
const mainHtml = fs.readFileSync('public/dbs-control.html', 'utf8');
const controlUx = fs.readFileSync('public/dbs-control-ux.js', 'utf8');
const shellHtml = fs.readFileSync('public/dbs-control-shell.html', 'utf8');
const bridge = fs.readFileSync('supabase/migrations/20261031040330_dbs_control_inventory_financial_bridge.sql', 'utf8');
const hardening = fs.readFileSync('supabase/migrations/20261031041704_dbs_control_inventory_financial_hardening.sql', 'utf8');
const fkIndexes = fs.readFileSync('supabase/migrations/20261031042042_dbs_control_inventory_financial_fk_indexes.sql', 'utf8');
const openingBalance = fs.readFileSync('supabase/migrations/20261031042508_dbs_control_inventory_opening_balance.sql', 'utf8');
const openingBalanceHardening = fs.readFileSync('supabase/migrations/20261031042732_dbs_control_inventory_opening_balance_zero_cost.sql', 'utf8');
const purchaseFkIndex = fs.readFileSync('supabase/migrations/20261031042759_dbs_control_inventory_purchase_fk_index.sql', 'utf8');
const partCostGuard = fs.readFileSync('supabase/migrations/20261031043439_dbs_control_part_cost_guard.sql', 'utf8');
const idempotencyGuard = fs.readFileSync('supabase/migrations/20261031051656_dbs_control_inventory_idempotency_guard.sql', 'utf8');
const phase2 = fs.readFileSync('supabase/migrations/20261104135123_20261103180000_dbs_phase2_sales_reservations.sql', 'utf8');
const settlement = fs.readFileSync('supabase/migrations/20261105125017_dbs_control_purchase_settlement_and_financial_overview.sql', 'utf8');
const settlementIndexes = fs.readFileSync('supabase/migrations/20261105125435_dbs_control_purchase_payment_fk_indexes.sql', 'utf8');
const purchaseLifecycle = fs.readFileSync('supabase/migrations/20261105125808_dbs_control_purchase_register_and_receipt_lifecycle.sql', 'utf8');
const purchaseReceiptFix = fs.readFileSync('supabase/migrations/20261105125833_fix_dbs_control_purchase_receipt_status_lock.sql', 'utf8');
const purchaseOutboxFix = fs.readFileSync('supabase/migrations/20261105130217_fix_dbs_purchase_outbox_aggregate_fk.sql', 'utf8');
const purchaseApproval = fs.readFileSync('supabase/migrations/20261111134918_dbs_control_purchase_mandatory_approval.sql', 'utf8');
const frontendIntegrations = fs.readFileSync('supabase/migrations/20261112125903_dbs_control_frontend_inventory_cost_center_integrations.sql', 'utf8');
const operationalStocksMigration = fs.readFileSync('supabase/migrations/20261116190000_dbs_control_operational_stocks.sql', 'utf8');
const operationalConsumptionMigration = fs.readFileSync('supabase/migrations/20261116193000_dbs_control_operational_stock_os_consumption.sql', 'utf8');
const multipleOperationalStocksMigration = fs.readFileSync('supabase/migrations/20261116200000_dbs_control_multiple_operational_stocks_per_center.sql', 'utf8');
const atomicOperationalConsumptionMigration = fs.readFileSync('supabase/migrations/20261116203000_dbs_control_atomic_operational_reservation_consumption.sql', 'utf8');
const ambiguousReservationWrapperFixMigration = fs.readFileSync('supabase/migrations/20261117001500_fix_dbs_control_reservation_wrapper_ambiguous_work_order_id.sql', 'utf8');

const treasuryFunctions = fs.readFileSync('src/lib/treasury.functions.ts', 'utf8');
const treasuryPage = fs.readFileSync('src/routes/_authenticated/treasury.tsx', 'utf8');
const treasuryHtml = fs.readFileSync('public/treasury.html', 'utf8');
const inventoryValueFix = fs.readFileSync('supabase/migrations/20261105130610_fix_dbs_inventory_value_includes_inactive_stock.sql', 'utf8');
const workOrderScopeFix = fs.readFileSync('supabase/migrations/20261105131450_fix_dbs_work_order_consumption_scope_company_reference.sql', 'utf8');
const scopeSkuMigration = fs.readFileSync('supabase/migrations/20261105135208_dbs_inventory_scope_sku_and_financial_reconciliation.sql', 'utf8');
const integrationSql = fs.readFileSync('scripts/test-inventory-financial-bridge.integration.sql', 'utf8');
const ledgerRpc = fs.readFileSync('supabase/migrations/20261027155816_treasury_ledger_command_rpc.sql', 'utf8');
const phase2Ui = fs.readFileSync('src/routes/_authenticated/dbs-inventory.tsx', 'utf8');
const controlRoute = fs.readFileSync('src/routes/_authenticated/dbs-control.tsx', 'utf8');
const importScript = fs.readFileSync('public/dbs-control-import.js', 'utf8');
const quoteBuilder = fs.readFileSync('public/dbs-control-orcamentos-flex.js', 'utf8');
assert.match(phase2Ui, /createDbsPurchase/);
assert.match(phase2Ui, /export function DbsInventoryPage/);
assert.ok(phase2Ui.includes('{moduleSection === "parts" ? "Peças & Estoque" : "Compras"}'));
assert.ok(phase2Ui.includes("initialQuoteId?: string"));
assert.match(phase2Ui, /moduleSection === "parts"/);
assert.match(phase2Ui, /moduleSection === "purchases"/);
assert.match(phase2Ui, /embedded\?: boolean/);

assert.match(phase2Ui, /Enviar pedido para aprovação financeira/);
assert.match(phase2Ui, /getDbsQuotePurchaseItems/);
assert.match(phase2Ui, /receiveDbsPurchaseItems/);

assert.match(phase2Ui, /Abrir Financeiro \/ DBS Treasury/);
assert.match(phase2Ui, /decideDbsPurchaseApprovalFromTreasury/);
assert.match(phase2Ui, /Fila de aprovação financeira de compras/);
assert.match(phase2Ui, /dbs-operations-page/);
assert.match(phase2Ui, /dbs-op-tabs/);
assert.match(phase2Ui, /SheetContent/);
assert.match(phase2Ui, /activeDrawer === "new-part"/);
assert.match(phase2Ui, /activeDrawer==="new-purchase"/);
assert.match(phase2Ui, /activeDrawer==="reservation"/);
assert.match(phase2Ui, /catalogSearch/);
assert.match(phase2Ui, /visibleParts/);
assert.match(phase2Ui, /settingsView\s*={2,3}\s*"suppliers"/);
assert.match(phase2Ui, /settingsView\s*={2,3}\s*"cost-centers"/);
assert.match(phase2Ui, /settingsView\s*={2,3}\s*"units"/);
assert.match(phase2Ui, /settingsView\s*={2,3}\s*"conversions"/);
assert.match(phase2Ui, /SKUs com saldo central/);
assert.match(phase2Ui, /Custódia legada de veículos/);
assert.match(phase2Ui, /Pedidos em aberto/);
assert.match(phase2Ui, /Recebimento físico/);
assert.match(phase2Ui, /purchasesAwaitingReceipt/);
assert.match(controlUx, /DBS_CONTROL_OPEN_INVENTORY_DRAWER/);
assert.match(controlUx, /dbs-materials-clean-ui/);
assert.match(controlRoute, /DBS_CONTROL_OPEN_INVENTORY_DRAWER/);
assert.match(phase2Ui, /purchasesOpen\.map/);
assert.match(phase2Ui, /dbs-operations-drawer/);
assert.match(phase2Ui, /Fornecedor \/ pedido/);
assert.match(phase2Ui, /Custo médio/);
assert.match(phase2Ui, /Transferir/);
assert.match(controlRoute, /20261116-employee-daily-agenda-1/);
assert.match(mainHtml, /dbs-control-ux\.js\?v=20261114-erp-clean-ui-2/);



assert.match(phase2Ui, /partsView === "catalog"/);
assert.match(phase2Ui, /partsView === "stock"/);
assert.match(phase2Ui, /partsView === "reservations"/);
assert.match(phase2Ui, /partsView === "settings"/);

assert.match(phase2Ui, /purchasesView === "new"/);
assert.match(phase2Ui, /purchaseSetupIncomplete/);
assert.match(phase2Ui, /Cadastros necessários para compras/);
assert.match(phase2Ui, /Abrir Cadastros Básicos/);
assert.match(phase2Ui, /activePartsMissingMasterData/);
assert.match(phase2Ui, /purchasesView === "approval"/);
assert.match(phase2Ui, /purchasesView === "orders"/);
assert.match(phase2Ui, /purchasesAwaitingReceipt/);
assert.match(phase2Ui, /onSubmit={saveCatalogPart}/);
assert.match(phase2Ui, /onSubmit={transferStockToTechnician}/);
assert.match(phase2Ui, /onSubmit={reserveParts}/);
assert.match(phase2Ui, /onSubmit={submitPurchase}/);
assert.match(phase2Ui, /receiveDbsPurchaseItems/);
assert.match(phase2Ui, /catalogPartSku/);
assert.match(phase2Ui, /catalogPartSupplierId/);

assert.doesNotMatch(phase2Ui, /<details open=\{!suppliers\.length/);



assert.doesNotMatch(treasuryPage, /Compromissos de compras aprovadas/, "The old oversized commitments banner must stay removed.");
assert.match(treasuryPage, /treasury-content-frame/);
assert.doesNotMatch(phase2Ui, /settleDbsPurchase|settleDbsPartSale|createDbsPartSale/);
assert.match(treasuryPage, /DBS_TREASURY_DECIDE_PURCHASE_APPROVAL/);
assert.match(treasuryPage, /decideDbsPurchaseApprovalFromTreasury/);
assert.match(treasuryPage, /pendingPurchaseApprovals/);
assert.match(treasuryHtml, /id="mod-aprovacoes"/);
assert.match(treasuryHtml, /Aprovação de compras/);
assert.match(treasuryHtml, /purchase-approval-menu-count/);
assert.match(treasuryHtml, /postTreasuryPurchaseApproval/);
assert.match(treasuryHtml, /submitPurchaseApprovalRejection/);
assert.match(treasuryHtml, /DBS_TREASURY_PURCHASE_APPROVAL_RESULT/);
assert.doesNotMatch(phase2Ui, /gross_margin_pct|paid_cents|payment_status|settlementAmounts/);
assert.match(functions, /export const createDbsPurchase/);
assert.match(functions, /dbs_control_register_purchase/);
assert.match(quoteBuilder, /data-purchase=/);
assert.match(quoteBuilder, /sendQuotePartsToPurchase/);
assert.match(quoteBuilder, /window\.abrirModuloMateriais\("purchases"/);
assert.doesNotMatch(quoteBuilder, /\/dbs-inventory|window\.open|dbs-smart-purchases-nav/);
assert.match(mainHtml, /dbs-control-orcamentos-flex\.js\?v=20261111-relational-quotes-1/);



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

assert.match(functions, /dbs_control_receive_registered_purchase/);
assert.match(functions, /export const decideDbsPurchaseApproval/);
assert.match(functions, /dbs_control_decide_purchase_approval/);
assert.match(purchaseApproval, /approval_status text not null default 'pending'/i);
assert.ok(purchaseApproval.includes("CREATE TABLE IF NOT EXISTS public.dbs_control_purchase_approval_history"));
assert.ok(purchaseApproval.includes("CREATE OR REPLACE FUNCTION public.dbs_control_decide_purchase_approval"));
assert.match(purchaseApproval, /DBS_PURCHASE_APPROVAL_REQUIRED/);
assert.ok(purchaseApproval.includes("v_purchase.approval_status IS DISTINCT FROM ''approved''"));
assert.ok(purchaseApproval.includes("CREATE OR REPLACE FUNCTION public.dbs_control_receive_purchase"));
assert.match(purchaseApproval, /registre a compra, aprove financeiramente/i);
assert.match(functions, /dbs_control_upsert_part/);
assert.match(functions, /export const receiveDbsPurchase/);
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

assert.match(shellHtml, /id="comp-peca"/);
for (const html of [mainHtml, shellHtml]) {
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
assert.doesNotMatch(phase2Ui, /Vendas avulsas|Vendas recentes|Registrar venda|settleDbsPartSale|createDbsPartSale/);

assert.match(phase2Ui, /reserveDbsOperationalStockForWorkOrder/);
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
assert.match(purchaseOutboxFix, /dbs_control_inventory_outbox/i);
assert.match(purchaseOutboxFix, /Purchase registration outbox block was not found/i);
assert.match(inventoryValueFix, /dbs_control_inventory_financial_overview/i);
assert.match(inventoryValueFix, /Expected active-only stock valuation filter/i);
assert.match(workOrderScopeFix, /coalesce\(u\.company_id,v_scope\.company_id\)=v_scope\.company_id/i);
assert.match(integrationSql, /TEST_OS_CONSUMPTION/i);
assert.match(integrationSql, /TEST_OS_COST/i);
assert.match(integrationSql, /TEST_OS_IDEMPOTENCY/i);
assert.match(integrationSql, /TEST_DRAFT_MOVEMENT/i);
assert.match(integrationSql, /dbs_control_register_purchase/);
assert.match(integrationSql, /dbs_control_receive_registered_purchase/);
assert.match(functions, /dbs_control_register_purchase/);
assert.match(functions, /dbs_control_receive_registered_purchase/);
assert.match(functions, /export const receiveDbsPurchase/);
assert.match(phase2Ui, /receiveDbsPurchase/);
assert.doesNotMatch(mainHtml, /id="comp-fornecedor"/);
assert.doesNotMatch(mainHtml, /id="comp-status"/);
assert.doesNotMatch(mainHtml, /O cadastro antigo por texto livre foi substituído/);
assert.match(settlementIndexes, /dbs_control_purchase_payments_created_by_fk_idx/i);
assert.match(settlementIndexes, /dbs_control_purchase_payments_ledger_entry_fk_idx/i);
assert.match(integrationSql, /begin;[\s\S]*rollback;/i);
assert.match(integrationSql, /insert into public\.dbs_control_suppliers/i);
assert.match(integrationSql, /insert into public\.dbs_control_measure_units/i);
assert.match(integrationSql, /insert into public\.dbs_control_cost_centers/i);
assert.match(integrationSql, /'supplier_id', v_supplier/i);
assert.match(integrationSql, /'cost_center_id', v_cost_center/i);
assert.match(integrationSql, /measure_unit_id = v_measure_unit/i);
assert.match(integrationSql, /set cost_center_id = v_cost_center/i);
assert.match(integrationSql, /dbs_control_register_purchase/i);
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
const inventoryOverviewStart = functions.indexOf("export const getDbsPhase2InventoryOverview");
const inventoryOverviewEnd = functions.indexOf("export const createDbsSupplier", inventoryOverviewStart);
const inventoryOverview = inventoryOverviewStart >= 0 && inventoryOverviewEnd > inventoryOverviewStart
  ? functions.slice(inventoryOverviewStart, inventoryOverviewEnd)
  : "";
assert.ok(inventoryOverview.length > 0);
assert.doesNotMatch(inventoryOverview, /from\("dbs_control_sale_settlements"\)|from\("dbs_control_sales"\)/);
assert.match(inventoryOverview, /select\("work_order_id,parts_cost_cents,status,updated_at"\)/);
assert.doesNotMatch(inventoryOverview, /revenue_cents|paid_cents|payment_status/);

assert.match(functions, /payment_status: "unpaid"/);
assert.match(functions, /paid_cents/);
assert.match(phase2Ui, /Pedidos aguardando recebimento/);
assert.match(phase2Ui, /Custos de materiais por OS/);
assert.match(functions, /workOrderFinancials: workOrderFinancials\.data/);
assert.match(functions, /dbs_control_work_order_financials/);
assert.match(phase2Ui, /Abrir Financeiro \/ DBS Treasury/);
assert.doesNotMatch(phase2Ui, /settleDbsPurchase|gross_margin_pct/);

assert.match(mainHtml, /id="peca-status"/);
assert.match(mainHtml, /status: document\.getElementById\('peca-status'\)/);
assert.match(mainHtml, /window\.abrirFinanceiroEstoque/);
assert.doesNotMatch(mainHtml, /status: document\.getElementById\('comp-status'\)\.value === 'received'/);
assert.match(mainHtml, /abrirFinanceiroEstoque/);
assert.match(controlRoute, /DBS_CONTROL_OPEN_INVENTORY_FINANCE/);
assert.match(controlRoute, /DBS_CONTROL_OPEN_INVENTORY_MODULE/);
assert.match(controlRoute, /mountDbsMaterialsPortal/);
assert.match(controlRoute, /createPortal/);
assert.match(controlRoute, /data-dbs-materials-react-root/);
assert.match(controlRoute, /initialSection="parts"/);
assert.match(controlRoute, /initialSection="purchases"/);
assert.match(controlRoute, /msg\.section === "purchases"/);
assert.match(controlRoute, /DBS_CONTROL_BACK_TO_ADMIN_MENU/);
assert.match(mainHtml, /dbs-admin-session-back/);
assert.match(mainHtml, /function voltarMenuPrincipalAdmin/);
assert.match(mainHtml, /DBS_CONTROL_BACK_TO_ADMIN_MENU/);
assert.match(controlUx, /window\.switchTab\(id,item\)/);
assert.doesNotMatch(controlUx, /DBS_CONTROL_OPEN_INVENTORY_FINANCE/);
assert.match(mainHtml, /dbs-control-ux\.js\?v=20261114-erp-clean-ui-2/);
assert.match(controlRoute, /inventoryPortals\.purchases\.quoteId/);
assert.match(controlRoute, /initialSection="parts"/);
assert.match(controlRoute, /initialSection="purchases"/);
assert.match(controlRoute, /inventoryPortals\.purchases\.quoteId/);
assert.match(mainHtml, /DBS_CONTROL_OPEN_INVENTORY_MODULE/);
assert.match(mainHtml, /window\.abrirModuloMateriais/);
assert.match(mainHtml, /function switchTab\(tabId, element, quoteId\)/);
assert.match(mainHtml, /employeeTab === 'tab-pecas'/);
assert.match(mainHtml, /employeeTab === 'tab-compras'/);
assert.match(integrationSql, /integration_test_status/);

assert.match(functions, /export const settleDbsPartSale/);
assert.match(functions, /async function resolveDbsPurchasePartIds/);
assert.match(functions, /A compra não foi integrada: a peça/);
assert.match(functions, /part_sku: partSku/);
assert.match(functions, /id: String\(row\.legacy_key \|\| row\.id\)/);
assert.match(functions, /purchase_id: String\(row\.id\)/);

assert.doesNotMatch(mainHtml, /part_sku: selectedPart && selectedPart\.sku/);
assert.doesNotMatch(mainHtml, /document\.getElementById\('comp-status'\)\.value === 'received'/);

assert.match(functions, /requireDbsInventoryAdmin/);


assert.match(functions, /export const reconcileDbsWorkOrderFinancials/);
assert.match(functions, /dbs_control_reconcile_work_order_financials/);
assert.match(scopeSkuMigration, /dbs_control_parts_sku_normalized_uidx/i);
assert.match(scopeSkuMigration, /dbs_control_normalize_part_sku/i);
assert.match(scopeSkuMigration, /admin_count = 1/i);
assert.match(scopeSkuMigration, /dbs_control_reconcile_work_order_financials/i);
assert.match(scopeSkuMigration, /completed_without_source_value/i);
assert.match(integrationSql, /TEST_PURCHASE_TOTAL: esperado 35801/i);
assert.match(integrationSql, /v_part2/i);
assert.match(integrationSql, /TEST_OS_REVENUE/i);
assert.match(integrationSql, /gross_margin_pct/);
assert.match(integrationSql, /rollback;/i);


// Relational frontend integration: mandatory supplier/unit selectors, exact unit
// conversion, relational quote IDs, cost centers and weighed gas usage.
assert.match(frontendIntegrations, /create table if not exists public\.dbs_control_cost_centers/i);
assert.match(frontendIntegrations, /supplier_id uuid/);
assert.match(frontendIntegrations, /measure_unit_id uuid/);
assert.match(frontendIntegrations, /cost_center_id uuid/);
assert.match(frontendIntegrations, /dbs_control_fill_cost_center/);
assert.match(frontendIntegrations, /dbs_control_register_gas_usage_weighted/);
assert.match(frontendIntegrations, /DBS_GAS_WEIGHT_IDEMPOTENCY_CONFLICT/);
assert.match(frontendIntegrations, /v_line_total := round\(v_purchase_qty\*v_purchase_unit_cost\)::bigint/i);
assert.doesNotMatch(frontendIntegrations, /drop\s+(table|schema|column)\b/i);
assert.match(phase2Ui, /createDbsSupplier/);
assert.match(phase2Ui, /createDbsMeasureUnit/);
assert.match(phase2Ui, /createDbsUnitConversion/);
assert.equal(
  phase2Ui.split('aria-label="Buscar peças"').length - 1,
  1,
  "Peças & Estoque must render one catalog search/filter surface, not duplicate the catalog card.",
);
const runActionHandler = phase2Ui.slice(phase2Ui.indexOf("async function runAction"), phase2Ui.indexOf("async function decidePurchaseApproval"));
assert.match(runActionHandler, /await overview\.refetch\(\)/, "Successful inventory actions must refresh the relational selectors and lists.");
const addSupplierHandler = phase2Ui.slice(phase2Ui.indexOf("async function addSupplier"), phase2Ui.indexOf("async function addMeasureUnit"));
const addMeasureUnitHandler = phase2Ui.slice(phase2Ui.indexOf("async function addMeasureUnit"), phase2Ui.indexOf("async function addUnitConversion"));
assert.match(addSupplierHandler, /runAction\(/, "Supplier creation must use the shared refresh/error-handling path.");
assert.match(addMeasureUnitHandler, /runAction\(/, "Unit creation must use the shared refresh/error-handling path.");
for (const [start, end] of [
  ["async function submitPurchase", "function updatePurchaseLine"],
  ["async function saveCatalogPart", "async function addCostCenter"],
  ["async function addCostCenter", "async function transferStockToTechnician"],
  ["async function transferStockToTechnician", "async function addSupplier"],
  ["async function addUnitConversion", "async function linkOrderCostCenter"],
  ["async function assignWeightedGasCylinder", "async function initializeExistingCylinderWeights"],
]) {
  const handler = phase2Ui.slice(phase2Ui.indexOf(start), phase2Ui.indexOf(end));
  assert.ok(handler.length > 0, `Expected handler boundary: ${start}`);
  assert.doesNotMatch(handler, /overview\\.refetch\\(\\)/, `${start} must rely on runAction's single shared refresh.`);
}
assert.match(phase2Ui, /supplierId/);
assert.match(phase2Ui, /costCenterId/);
assert.match(phase2Ui, /purchaseUnitId/);
assert.doesNotMatch(phase2Ui, /supplierName/);
assert.doesNotMatch(phase2Ui, /line\.sku/);
assert.match(phase2Ui, /getDbsQuotePurchaseItems/);
assert.match(phase2Ui, /dbs_control_assign_gas_cylinder_weighted/);
assert.match(phase2Ui, /dbs_control_initialize_existing_gas_cylinder_weights/);
assert.match(mainHtml, /id="peca-fornecedor"/);
assert.match(mainHtml, /id="peca-unidade"/);
assert.match(mainHtml, /require_master_data: true/);
assert.match(mainHtml, /DBS_CONTROL_REQUEST_CATALOG_MASTER_DATA/);
assert.match(controlRoute, /DBS_CONTROL_REQUEST_CATALOG_MASTER_DATA/);
assert.match(controlRoute, /dbs_control_register_gas_usage_weighted/);
assert.match(controlRoute, /grossWeightBeforeKg/);
assert.match(quoteBuilder, /id="oq-cost-center"/);
assert.match(quoteBuilder, /quote\.relationalQuoteId \|\| quote\.id/);
assert.match(quoteBuilder, /oq-product-supplier/);
assert.match(quoteBuilder, /oq-product-unit/);
assert.doesNotMatch(quoteBuilder, /purchase_items/);
assert.doesNotMatch(quoteBuilder, /sku: String\(catalogItem\.sku/);
assert.match(treasuryFunctions, /saveTreasuryCostCenter/);
assert.match(treasuryFunctions, /from\("dbs_control_cost_centers"\)/);
assert.match(treasuryPage, /DBS_TREASURY_SAVE_COST_CENTER/);
assert.match(fs.readFileSync("public/dbs-control-os-viewer.js", "utf8"), /grossWeightAfterKg/);
assert.match(fs.readFileSync("public/treasury.html", "utf8"), /postTreasuryCostCenter/);

console.log('Inventory/Finance bridge: additive schema, purchase receipt, UUID part consumption, cost reconciliation, revenue lifecycle, phase 2 RPC contracts and inline UI syntax verified.');

// Migration D: conferência física parcial por item, idempotente e aprovada.
const partialReceipts = fs.readFileSync("supabase/migrations/20261111140750_dbs_control_purchase_partial_receipts.sql", "utf8");
assert.match(partialReceipts, /dbs_control_purchase_receipts/i);
assert.match(partialReceipts, /dbs_control_purchase_receipt_items/i);
assert.match(partialReceipts, /quantity_received/i);
assert.match(partialReceipts, /approval_status IS DISTINCT FROM 'approved'/i);
assert.match(partialReceipts, /dbs_control_receive_purchase_items/i);
assert.match(partialReceipts, /movement_type, quantity_delta/i);
assert.match(partialReceipts, /purchase-receipt:/i);
assert.match(partialReceipts, /1\.1\.03/i);
assert.match(partialReceipts, /1\.1\.04/i);
assert.match(functions, /dbs_control_receive_purchase_items/);
assert.match(phase2Ui, /receiveDbsPurchaseItems/);
assert.match(phase2Ui, /quantity_received/);

const immutableInventory = fs.readFileSync("supabase/migrations/20261111141203_dbs_control_inventory_immutable_and_treasury_commitments.sql", "utf8");
assert.match(immutableInventory, /BEFORE UPDATE OR DELETE ON public\.dbs_control_inventory_movements/i);
assert.match(immutableInventory, /BEFORE TRUNCATE ON public\.dbs_control_inventory_movements/i);
assert.match(immutableInventory, /DBS_INVENTORY_MOVEMENT_IMMUTABLE/);
assert.match(immutableInventory, /reversal_of_movement_id/);
assert.match(immutableInventory, /dbs_control_reverse_inventory_movement/);
assert.match(immutableInventory, /DBS_INVENTORY_MOVEMENT_ALREADY_REVERSED/);
assert.match(immutableInventory, /DBS_INVENTORY_REVERSAL_NEGATIVE_STOCK/);
assert.match(immutableInventory, /post_treasury_ledger_entry/);
assert.match(immutableInventory, /CREATE OR REPLACE VIEW public\.dbs_treasury_purchase_commitments/i);
assert.match(immutableInventory, /p\.approval_status='approved'/i);
const commitmentsView = immutableInventory.slice(immutableInventory.indexOf("CREATE OR REPLACE VIEW public.dbs_treasury_purchase_commitments"));
assert.doesNotMatch(commitmentsView, /post_treasury_ledger_entry|insert\s+into/i);
assert.match(treasuryFunctions, /dbs_treasury_purchase_commitments/);
assert.doesNotMatch(treasuryPage, /Compromissos de compras aprovadas/, "The Financeiro route must not render the oversized commitments banner above the Treasury workspace.");
assert.match(treasuryPage, /DBS_TREASURY_DECIDE_PURCHASE_APPROVAL/);
assert.match(treasuryPage, /decideDbsPurchaseApprovalFromTreasury/);
assert.match(treasuryPage, /pendingPurchaseApprovals/);
assert.match(treasuryPage, /treasury-content-frame/);
assert.match(treasuryHtml, /id="mod-aprovacoes"/);
assert.match(treasuryHtml, /Aprovação de compras/);
assert.match(treasuryHtml, /purchase-approval-menu-count/);
assert.match(treasuryHtml, /renderPurchaseApprovals\(\)/);
assert.match(treasuryHtml, /postTreasuryPurchaseApproval/);
assert.match(treasuryHtml, /submitPurchaseApprovalRejection/);
assert.match(treasuryHtml, /DBS_TREASURY_DECIDE_PURCHASE_APPROVAL/);
assert.match(treasuryHtml, /DBS_TREASURY_PURCHASE_APPROVAL_RESULT/);
assert.match(phase2Ui, /reverseDbsInventoryMovement/);
assert.match(phase2Ui, /Histórico imutável de movimentações/);

// Supplier tax identifiers must pass Brazilian check digits; purchase dates must exist.
assert.match(functions, /normalizeBrazilianTaxId\(input\?\.cnpj\)/);
assert.match(functions, /isValidIsoCalendarDate\(purchaseDate\)/);
const validationSandbox = { exports: {} };
vm.runInNewContext(ts.transpileModule(inventoryValidationSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, validationSandbox);
const { normalizeBrazilianTaxId, isValidIsoCalendarDate } = validationSandbox.exports;
assert.equal(normalizeBrazilianTaxId("529.982.247-25"), "52998224725");
assert.equal(normalizeBrazilianTaxId("11.222.333/0001-81"), "11222333000181");
assert.equal(normalizeBrazilianTaxId(""), null);
assert.throws(() => normalizeBrazilianTaxId("FORNECEDOR ABC"), /apenas números/);
assert.throws(() => normalizeBrazilianTaxId("529.982.247-24"), /CPF válido/);
assert.throws(() => normalizeBrazilianTaxId("11.222.333/0001-82"), /CNPJ válido/);
assert.throws(() => normalizeBrazilianTaxId("000.000.000-00"), /CPF\/CNPJ válido/);
assert.throws(() => normalizeBrazilianTaxId("123456"), /CPF.*CNPJ/);
assert.equal(isValidIsoCalendarDate("2026-11-12"), true);
assert.equal(isValidIsoCalendarDate("2024-02-29"), true);
assert.equal(isValidIsoCalendarDate("2023-02-29"), false);
assert.equal(isValidIsoCalendarDate("2026-02-31"), false);
assert.equal(isValidIsoCalendarDate("2026-11-31"), false);
assert.equal(isValidIsoCalendarDate("2026-11-00"), false);
assert.equal(isValidIsoCalendarDate("2026-11-1"), false);
// Inventory and purchases are independent screens inside their own
// DBS CONTROL tabs; neither menu redirects away from the operational shell.
assert.match(mainHtml, /employeeTab === 'tab-compras'/);
assert.match(mainHtml, /employeeTab === 'tab-pecas'/);
assert.match(mainHtml, /type: 'DBS_CONTROL_OPEN_INVENTORY_MODULE'/);
assert.doesNotMatch(mainHtml, /DBS_CONTROL_NAVIGATE_INVENTORY/);
assert.doesNotMatch(mainHtml, /window\.parent\.location\.assign/);
assert.doesNotMatch(controlRoute, /DBS_CONTROL_NAVIGATE_INVENTORY/);
assert.match(controlRoute, /inventoryPortals\.parts && createPortal/);
assert.match(controlRoute, /inventoryPortals\.purchases && createPortal/);
assert.match(controlRoute, /initialSection="parts"/);
assert.match(controlRoute, /initialSection="purchases"/);
assert.match(controlRoute, /data-dbs-materials-react-root/);
assert.match(controlRoute, /20261116-employee-daily-agenda-1/);

// Operational stocks are independent balances; only the transaction RPC can transfer stock.
assert.match(operationalStocksMigration, /CREATE TABLE IF NOT EXISTS public\.dbs_control_operational_stocks/i);
assert.match(operationalStocksMigration, /dbs_control_operational_stock_balances/i);
assert.match(operationalStocksMigration, /dbs_control_operational_stock_movements/i);
assert.match(operationalStocksMigration, /TRANSFERENCIA_CENTRAL_OPERACIONAL/);
assert.match(operationalStocksMigration, /TRANSFERENCIA_OPERACIONAL_CENTRAL/);
assert.match(operationalStocksMigration, /TRANSFERENCIA_ENTRE_OPERACIONAIS/);
assert.match(operationalStocksMigration, /DBS_OPERATIONAL_STOCK_INSUFFICIENT/);
assert.match(operationalStocksMigration, /dbs_control_operational_stock_reserve/);
assert.match(operationalConsumptionMigration, /movement_type.*'SAIDA_OS'/s);
assert.match(operationalConsumptionMigration, /dbs_control_mirror_central_receipt_to_operational_history/);
assert.match(multipleOperationalStocksMigration, /DROP CONSTRAINT IF EXISTS dbs_control_operational_stocks_scope_key_cost_center_id_key/);
assert.doesNotMatch(multipleOperationalStocksMigration, /DROP FUNCTION/);
assert.ok(multipleOperationalStocksMigration.includes("v_os.cost_center_id IS DISTINCT FROM p_cost_center_id"));
assert.match(multipleOperationalStocksMigration, /DBS_OPERATIONAL_STOCK_SELECTION_REQUIRED/);
assert.match(multipleOperationalStocksMigration, /Compatibility overload: old callers remain safe/);
assert.ok(multipleOperationalStocksMigration.includes("CREATE OR REPLACE FUNCTION public.dbs_control_operational_stock_reserve("));
assert.match(multipleOperationalStocksMigration, /Global lock order shared with transfer: part -> operational stock -> balance/);
assert.match(multipleOperationalStocksMigration, /dbs-os-reservations:/);
assert.match(atomicOperationalConsumptionMigration, /dbs_control_consume_all_work_order_reservations/);
assert.match(atomicOperationalConsumptionMigration, /dbs_control_operational_stock_consume_work_order/);
assert.doesNotMatch([operationalStocksMigration,operationalConsumptionMigration,multipleOperationalStocksMigration,atomicOperationalConsumptionMigration].join("\\n"), /SECURITY DEFINER SET search_path=public/i);
for (const migration of [operationalStocksMigration,operationalConsumptionMigration,multipleOperationalStocksMigration,atomicOperationalConsumptionMigration]) {
  assert.equal((migration.match(/\\$\\$/g)||[]).length % 2, 0, "Every PL/pgSQL dollar-quoted body must have a closing delimiter.");
  assert.doesNotMatch(migration, /AS \\$(?!\\$)/, "A function body must not use a single-dollar delimiter.");
}
assert.ok(operationalConsumptionMigration.includes("REVOKE ALL ON FUNCTION public.dbs_control_mirror_central_receipt_to_operational_history() FROM PUBLIC,anon,authenticated"));
assert.ok(atomicOperationalConsumptionMigration.includes("REVOKE ALL ON FUNCTION public.dbs_control_operational_stock_consume_work_order"));
assert.match(atomicOperationalConsumptionMigration, /rh_employee_access/);
assert.match(atomicOperationalConsumptionMigration, /assigned_employee_id=coalesce\(ea\.employee_id,re\.id\)/);
assert.match(atomicOperationalConsumptionMigration, /DBS_OPERATIONAL_CONSUMPTION_FORBIDDEN/);
assert.match(atomicOperationalConsumptionMigration, /dbs_control_apply_work_order_delta_with_reservations/);
assert.match(ambiguousReservationWrapperFixMigration, /legacy_reservation\.work_order_id=v_order_id[\s\S]*legacy_reservation\.status='reserved'/i, "A checagem de reservas legadas deve qualificar todas as colunas que colidem com RETURNS TABLE.");
assert.match(ambiguousReservationWrapperFixMigration, /operational_reservation\.work_order_id=v_order_id[\s\S]*operational_reservation\.status='reserved'/i, "A checagem de reservas operacionais deve qualificar todas as colunas que colidem com RETURNS TABLE.");
assert.match(ambiguousReservationWrapperFixMigration, /legacy_part_reservation\.work_order_id=v_order_id[\s\S]*legacy_part_reservation\.status='reserved'/i, "O cálculo das reservas legadas deve usar alias explícito.");
assert.match(ambiguousReservationWrapperFixMigration, /operational_part_reservation\.work_order_id=v_order_id[\s\S]*operational_part_reservation\.status='reserved'/i, "O cálculo das reservas operacionais deve usar alias explícito.");
assert.doesNotMatch(ambiguousReservationWrapperFixMigration, /WHERE\s+work_order_id\s*=\s*v_order_id|WHERE\s+status\s*=\s*'reserved'/i, "A função não pode deixar referências ambíguas no wrapper com OUT parameter work_order_id/status.");
assert.match(atomicOperationalConsumptionMigration, /v_has_operational_reservations/);
assert.ok(atomicOperationalConsumptionMigration.includes("IF v_has_reservations OR v_has_operational_reservations THEN"));
assert.match(atomicOperationalConsumptionMigration, /dbs-os-reservations:/);
assert.match(atomicOperationalConsumptionMigration, /FOR UPDATE/);
assert.match(atomicOperationalConsumptionMigration, /CREATE TABLE IF NOT EXISTS public\.dbs_control_operational_reservation_consumptions/i);
assert.match(atomicOperationalConsumptionMigration, /dbs_control_work_order_parts/i);
assert.match(atomicOperationalConsumptionMigration, /work_order_operational_parts_cogs/i);
assert.match(atomicOperationalConsumptionMigration, /'5\.1\.01'/);
assert.match(atomicOperationalConsumptionMigration, /'1\.1\.03'/);
assert.match(atomicOperationalConsumptionMigration, /parts_cost_cents=dbs_control_work_order_financials\.parts_cost_cents\+excluded\.parts_cost_cents/i);
assert.match(atomicOperationalConsumptionMigration, /operational_reservation_consumptions/);
assert.ok(!atomicOperationalConsumptionMigration.includes("UNIQUE(work_order_id)"));
assert.ok(atomicOperationalConsumptionMigration.includes("AND idempotency_key=v_key"));
assert.match(atomicOperationalConsumptionMigration, /UNION ALL[\s\S]*dbs_control_operational_reservations/i);
assert.match(functions, /dbs_control_consume_all_work_order_reservations/);
assert.doesNotMatch(functions, /const operational = await .*dbs_control_operational_stock_consume_work_order/);
assert.match(functions, /createDbsOperationalStock/);
assert.match(functions, /setDbsOperationalStockStatus/);
assert.match(functions, /transferDbsOperationalStock/);
assert.match(functions, /reserveDbsOperationalStockForWorkOrder/);
assert.match(functions, /releaseDbsOperationalStockReservation/);
assert.match(atomicOperationalConsumptionMigration, /dbs_control_operational_stock_consume_work_order/);
assert.match(phase2Ui, /Estoques Operacionais por Centro de Custo/);
assert.match(phase2Ui, /reserveDbsOperationalStockForWorkOrder/);
assert.match(phase2Ui, /Aplicar filtros e carregar OS/);
assert.match(phase2Ui, /reservationPurpose/);
assert.match(phase2Ui, /Ativo \/ Equipamento/);
assert.match(phase2Ui, /Saldo no estoque operacional/);
assert.match(phase2Ui, /purchaseMeasureUnitId/);
assert.match(functions, /purchase_measure_unit_id/);
assert.match(functions, /purchase_quantity,quantity_received/);
assert.match(phase2Ui, /quantityReceived: Number\(purchaseReceiptQuantities\[item.id\]\) \* Number\(item.conversion_factor \|\| 1\)/);
assert.match(phase2Ui, /remainingPurchase/);
assert.match(phase2Ui, /purchase_measure_unit_id \|\| part\?\.measure_unit_id/);
assert.match(phase2Ui, /Regra configurada:/);
assert.match(phase2Ui, /Estoque Central/);
assert.match(phase2Ui, /Estoque Operacional/);
assert.ok(phase2Ui.includes('inventoryRecordActions("part",part,part.name||part.sku||"Peça")'));
assert.ok(phase2Ui.includes('inventoryRecordActions("supplier",supplier,supplier.name)'));
assert.ok(phase2Ui.includes('inventoryRecordActions("cost_center",center,center.name)'));
assert.ok(phase2Ui.includes('inventoryRecordActions("measure_unit",unit,unit.name)'));
assert.ok(phase2Ui.includes('inventoryRecordActions("unit_conversion",conversion,label)'));
assert.match(functions, /operationalBalance = await admin\.from\("dbs_control_operational_stock_balances"\)/);
assert.match(functions, /purchase_measure_unit_id.*unidades de compra de peças/);
assert.match(functions, /dbs_control_operational_stock_movements.*histórico operacional/);
assert.match(functions, /dbs_control_operational_stocks/);

console.log("inventory financial bridge, operational stock isolation, OS reservation purpose and unit conversion checks passed");
