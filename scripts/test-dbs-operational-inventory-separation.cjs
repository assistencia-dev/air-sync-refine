const fs = require("node:fs");
const assert = require("node:assert/strict");

const functions = fs.readFileSync("src/lib/dbs-control.functions.ts", "utf8");
const operationsPage = fs.readFileSync("src/components/DbsOperationalInventoryPage.tsx", "utf8");
const inventoryRoute = fs.readFileSync("src/routes/_authenticated/dbs-inventory.tsx", "utf8");
const controlRoute = fs.readFileSync("src/routes/_authenticated/dbs-control.tsx", "utf8");
const legacyUx = fs.readFileSync("public/dbs-control-ux.js", "utf8");
const treasuryFunctions = fs.readFileSync("src/lib/treasury.functions.ts", "utf8");
const treasuryRoute = fs.readFileSync("src/routes/_authenticated/treasury.tsx", "utf8");
const financeAccess = fs.readFileSync("src/lib/treasury-viewer.functions.ts", "utf8");
const financeAccessPage = fs.readFileSync("src/routes/_authenticated/financeiro-acesso.tsx", "utf8");
const roleTypes = fs.readFileSync("src/integrations/supabase/types.ts", "utf8");
const roleMigration = fs.readFileSync("supabase/migrations/20261126110000_add_finance_operator_role.sql", "utf8");
const permissionMigration = fs.readFileSync("supabase/migrations/20261126111000_finance_operator_inventory_permissions.sql", "utf8");
const requestMigration = fs.readFileSync("supabase/migrations/20261126120000_dbs_control_inventory_requests.sql", "utf8");
const pricingMigration = fs.readFileSync("supabase/migrations/20261126130000_dbs_control_part_pricing_policy.sql", "utf8");
const warrantyMigration = fs.readFileSync("supabase/migrations/20261126140000_dbs_control_warranty_management.sql", "utf8");
const receiptWarrantyMigration = fs.readFileSync("supabase/migrations/20261126141000_dbs_control_receipt_warranty_serials.sql", "utf8");

function block(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `Missing source block: ${startMarker}`);
  return source.slice(start, end);
}

const operationalDto = block(
  functions,
  "export const getDbsOperationalInventoryOverview",
  "export const getDbsPhase2InventoryOverview",
);
assert.match(operationalDto, /requireDbsInventoryAdmin\(context\)/);
assert.match(operationalDto, /select\("id,sku,name,description,stock_quantity,reserved_quantity,status"\)/);
assert.doesNotMatch(operationalDto, /cost_cents|sale_cents|unit_cost_cents|purchase|supplier|accounts_payable/i);
assert.match(operationalDto, /activeOperationalStockIds/);
assert.match(operationalDto, /activeOperationalStockIds\.has/);
assert.match(operationalDto, /availableQuantity/);
assert.match(operationalDto, /operationalBalances/);
assert.match(operationalDto, /dbs_control_operational_reservations/);
assert.match(operationalDto, /dbs_control_work_orders/);
assert.match(operationalDto, /created_by_user_id/);
assert.match(operationalDto, /costCenters:/);
assert.match(operationalDto, /workOrders:/);
assert.match(operationalDto, /operationalReservations:/);

const financeGuard = block(functions, "async function requireDbsInventoryFinanceAdmin", "function requireInventoryId");
assert.match(financeGuard, /"SUPER_ADMIN"/);
assert.match(financeGuard, /"FINANCEIRO_OPERADOR"/);
assert.doesNotMatch(financeGuard, /ADMIN_OPERACIONAL|GESTOR_CONTA|GESTOR_REGIONAL/);

const genericControlGuard = block(functions, "async function requireDbsControlUser", "type CollaboratorBaseScope");
assert.doesNotMatch(genericControlGuard, /FINANCEIRO_OPERADOR/);

const financeOverview = block(functions, "export const getDbsPhase2InventoryOverview", "export const createDbsSupplier");
assert.match(financeOverview, /requireDbsInventoryFinanceAdmin\(context\)/);
const partWrite = block(functions, "export const createDbsPartCatalog", "export const updateDbsPartCatalog");
assert.match(partWrite, /requireDbsInventoryFinanceAdmin\(context\)/);
const partUpdate = block(functions, "export const updateDbsPartCatalog", "export const updateDbsInventoryMasterData");
assert.match(partUpdate, /requireDbsInventoryFinanceAdmin\(context\)/);
const reconcile = block(functions, "export const reconcileDbsWorkOrderFinancials", "export const getDbsInventoryFinancialOverview");
assert.match(reconcile, /requireDbsInventoryAdmin\(context\)/);

assert.match(operationsPage, /getDbsOperationalInventoryOverview/);
assert.match(operationsPage, /Peças & Estoque/);
assert.match(operationsPage, /Estoque central/);
assert.match(operationsPage, /Estoque operacional/);
assert.match(operationsPage, /reserveDbsOperationalStockForWorkOrder/);
assert.match(operationsPage, /transferDbsOperationalStock/);
assert.match(operationsPage, /createDbsOperationalStock/);
assert.match(operationsPage, /releaseDbsOperationalStockReservation/);
assert.match(operationsPage, /Usar peça em uma OS/);
assert.match(operationsPage, /Transferir estoque/);
assert.doesNotMatch(operationsPage, /cost_cents|sale_cents|unit_cost_cents|catalogPartCost|catalogPartSale/i);

const routeGuard = block(inventoryRoute, "function DbsInventoryRoute()", "function money(");
assert.match(routeGuard, /role === "SUPER_ADMIN"/);
assert.match(routeGuard, /role === "FINANCEIRO_OPERADOR"/);
assert.match(routeGuard, /financialOnly/);
assert.match(routeGuard, /DbsInventoryPage/);
assert.match(routeGuard, /DbsOperationalInventoryPage/);
assert.match(routeGuard, /ADMIN_OPERACIONAL/);
assert.match(inventoryRoute, /!financialOnly/);

assert.match(controlRoute, /import \{ DbsOperationalInventoryPage \}/);
assert.match(controlRoute, /<DbsOperationalInventoryPage embedded/);
assert.doesNotMatch(controlRoute, /<DbsInventoryPage/);
assert.match(controlRoute, /section === "purchases"[\s\S]*?navigate\(\{ to: "\/treasury" \}\)/);

const quickPart = block(legacyUx, "function quickPart()", "function addInlineButtons()");
assert.match(quickPart, /DBS_CONTROL_OPEN_INVENTORY_DRAWER/);
assert.doesNotMatch(quickPart, /qp-custo|qp-venda|st\.pecas\.push/);
assert.match(legacyUx, /Solicitar cadastro ao Financeiro/);
assert.doesNotMatch(legacyUx, /Cadastrar peça agora/);

const treasuryReader = block(treasuryFunctions, "async function requireTreasuryReader", "async function resolveTreasuryScopeOwner");
assert.match(treasuryReader, /FINANCEIRO_OPERADOR/);
const treasuryManualAdmin = block(treasuryFunctions, "async function requireTreasuryAdmin", "async function requirePurchaseApprovalActor");
assert.match(treasuryManualAdmin, /user\.role_key !== "SUPER_ADMIN"/);
assert.doesNotMatch(treasuryManualAdmin, /FINANCEIRO_OPERADOR/);
const purchaseApprovalActor = block(treasuryFunctions, "async function requirePurchaseApprovalActor", "function asObject");
assert.match(purchaseApprovalActor, /FINANCEIRO_OPERADOR/);
assert.match(purchaseApprovalActor, /FINANCEIRO_LEITURA/);
assert.match(treasuryRoute, /FINANCEIRO_OPERADOR/);
assert.match(treasuryRoute, /profile\?\.role_key === "FINANCEIRO_OPERADOR"/);

assert.match(financeAccess, /access_type\?: "read_only" \| "operator"/);
assert.match(financeAccess, /FINANCEIRO_OPERADOR/);
assert.match(financeAccess, /roleKey = data.access_type === "operator" \? "FINANCEIRO_OPERADOR" : "FINANCEIRO_LEITURA"/);
assert.match(financeAccess, /treasury_viewer_access/);
assert.match(financeAccessPage, /Financeiro · operador/);
assert.match(financeAccessPage, /Financeiro · somente consulta/);
assert.match(roleTypes, /"FINANCEIRO_OPERADOR"/);
assert.match(roleMigration, /ADD VALUE IF NOT EXISTS 'FINANCEIRO_OPERADOR'/);
assert.match(permissionMigration, /dbs_control_is_finance_actor/);
assert.match(permissionMigration, /dbs_control_operational_stock_transfer/);
assert.doesNotMatch(permissionMigration, /CREATE OR REPLACE FUNCTION public\.dbs_control_is_admin_actor/);
assert.match(permissionMigration, /FINANCEIRO_OPERADOR/);
assert.match(permissionMigration, /dbs_control_decide_purchase_approval/);
assert.match(permissionMigration, /v_actor_role.*NOT.*IN/s);
assert.match(permissionMigration, /'SUPER_ADMIN',''FINANCEIRO_OPERADOR''|FINANCEIRO_OPERADOR/);
assert.doesNotMatch(permissionMigration, /FINANCEIRO_LEITURA.*dbs_control_is_finance_actor/);

const requestTables = ["dbs_control_inventory_requests","dbs_control_inventory_request_items","dbs_control_inventory_request_history"];
for (const table of requestTables) assert.match(requestMigration, new RegExp("CREATE TABLE IF NOT EXISTS public\\\\."+table));
assert.match(requestMigration, /quantity_ordered/);
assert.match(requestMigration, /quantity_ready_for_dispatch/);
assert.match(requestMigration, /quantity_fulfilled/);
assert.match(requestMigration, /FOR UPDATE/);
assert.match(requestMigration, /dbs_control_register_purchase_with_request/);
assert.match(requestMigration, /dbs_control_operational_stock_transfer/);
assert.match(requestMigration, /source_inventory_request_item_id/);

assert.match(pricingMigration, /policy_type IN \\('markup','gross_margin'\\)/);
assert.match(pricingMigration, /DBS_PART_PRICING_POLICY_NOT_CONFIGURED/);
assert.match(pricingMigration, /dbs_control_calculate_part_sale_cents/);
assert.match(pricingMigration, /rate_basis_points/);
assert.match(pricingMigration, /dbs_control_apply_part_pricing_policy/);
assert.match(functions, /export const saveDbsPartPricingPolicy/);
assert.match(functions, /export const getDbsPartPricingPolicy/);
assert.doesNotMatch(inventoryRoute, /catalogPartSale|setCatalogPartSale/);
assert.match(inventoryRoute, /Preço de revenda calculado/);

assert.match(warrantyMigration, /dbs_control_supplier_warranties/);
assert.match(warrantyMigration, /dbs_control_customer_warranties/);
assert.match(warrantyMigration, /dbs_control_gas_cylinder_warranties/);
assert.match(warrantyMigration, /dbs_control_warranty_claims/);
assert.match(warrantyMigration, /dbs_control_create_supplier_warranty_on_receipt/);
assert.match(warrantyMigration, /dbs_control_create_customer_warranty_on_consumption/);
assert.match(warrantyMigration, /dbs_control_update_warranty_claim/);
assert.match(warrantyMigration, /replacement_of/);
assert.match(receiptWarrantyMigration, /serial_number/);
assert.match(receiptWarrantyMigration, /lot_number/);
assert.match(receiptWarrantyMigration, /DBS_PURCHASE_RECEIPT_SERIAL_REQUIRES_UNIT_QUANTITY/);
assert.match(functions, /export const getDbsOperationalWarrantyRecords/);
assert.match(functions, /export const saveDbsPartWarrantyDefaults/);
assert.match(functions, /export const createDbsWarrantyClaim/);
assert.match(functions, /export const createDbsGasCylinderWarranty/);
assert.match(functions, /export const updateDbsWarrantyClaim/);
assert.match(operationsPage, /Consulta de garantias/);
assert.match(operationsPage, /Abrir reclamação/);
assert.match(inventoryRoute, /purchasesView === "warranties"/);
assert.match(inventoryRoute, /Salvar tratativa/);

console.log("DBS operational inventory, Finance Operator, de-para requests, configurable prices and supplier/customer warranties contract checks passed.");
