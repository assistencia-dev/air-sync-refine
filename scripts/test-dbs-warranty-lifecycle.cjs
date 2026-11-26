const fs = require("node:fs");
const assert = require("node:assert/strict");

const warrantySchema = fs.readFileSync("supabase/migrations/20261126110000_dbs_part_warranties_and_customer_coverage.sql", "utf8");
const financeRole = fs.readFileSync("supabase/migrations/20261126120000_dbs_finance_operator_role.sql", "utf8");
const claimHistory = fs.readFileSync("supabase/migrations/20261126170000_dbs_warranty_claim_history.sql", "utf8");
const warrantyFunctions = fs.readFileSync("src/lib/dbs-warranty.functions.ts", "utf8");
const warrantyUi = fs.readFileSync("src/components/DbsWarrantyManagementPage.tsx", "utf8");
const treasury = fs.readFileSync("src/routes/_authenticated/treasury.tsx", "utf8");
const operationalUi = fs.readFileSync("src/components/DbsOperationalInventoryPage.tsx", "utf8");
const inventoryFunctions = fs.readFileSync("src/lib/dbs-control.functions.ts", "utf8");
const backup = fs.readFileSync("scripts/backup-supabase.mjs", "utf8");

for (const table of [
  "dbs_control_supplier_warranties",
  "dbs_control_customer_warranties",
  "dbs_control_warranty_claims",
]) {
  assert.match(warrantySchema, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`, "i"));
  assert.match(warrantySchema, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`, "i"));
}
assert.match(warrantySchema, /source_receipt_item_id uuid REFERENCES public\.dbs_control_purchase_receipt_items\(id\) ON DELETE RESTRICT/i);
assert.match(warrantySchema, /work_order_id uuid NOT NULL REFERENCES public\.dbs_control_work_orders\(id\) ON DELETE RESTRICT/i);
assert.match(warrantySchema, /work_order_part_id uuid REFERENCES public\.dbs_control_work_order_parts\(id\) ON DELETE RESTRICT/i);
assert.match(warrantySchema, /start_anchor IN \('invoice_date','receipt_date','installation_date','manual_date'\)/i);
assert.match(warrantySchema, /expires_on >= starts_on/i);
assert.match(warrantySchema, /FROM PUBLIC, anon, authenticated/i);
assert.doesNotMatch(warrantySchema, /DROP\s+(TABLE|COLUMN|SCHEMA|FUNCTION)\b/i);
assert.doesNotMatch(warrantySchema, /TRUNCATE\s+/i);
assert.doesNotMatch(warrantySchema, /DELETE\s+FROM\s+/i);

assert.match(claimHistory, /dbs_control_warranty_claim_history/i);
assert.match(claimHistory, /version bigint NOT NULL DEFAULT 1/i);
assert.match(claimHistory, /dbs_control_open_warranty_claim/i);
assert.match(claimHistory, /dbs_control_update_warranty_claim/i);
assert.match(claimHistory, /p_expected_version/i);
assert.match(claimHistory, /idempotency_key/i);
assert.match(claimHistory, /v_from_status := v_claim\.status/i);
assert.match(claimHistory, /v_supplier\.id,NULL/i, "Supplier claim must not mistake receipt item ID for OS ID.");
assert.match(claimHistory, /DBS_WARRANTY_CLAIM_VERSION_CONFLICT/i);
assert.match(claimHistory, /REVOKE ALL ON FUNCTION public\.dbs_control_open_warranty_claim/i);
assert.match(claimHistory, /REVOKE ALL ON FUNCTION public\.dbs_control_update_warranty_claim/i);
assert.match(financeRole, /dbs_control_is_inventory_finance_actor/i);

assert.match(warrantyFunctions, /export const getDbsWarrantyOverview/i);
assert.match(warrantyFunctions, /export const createDbsSupplierWarranty/i);
assert.match(warrantyFunctions, /export const createDbsCustomerWarranty/i);
assert.match(warrantyFunctions, /export const openDbsWarrantyClaim/i);
assert.match(warrantyFunctions, /export const updateDbsWarrantyClaim/i);
assert.match(warrantyFunctions, /dbs_control_purchase_receipt_items/i);
assert.match(warrantyFunctions, /effectiveStartsOn = receivedAt\.slice\(0, 10\)/i);
assert.match(warrantyFunctions, /effectiveStartsOn = invoiceDate/i);
assert.match(warrantyFunctions, /addWarrantyMonths/i);
assert.match(warrantyFunctions, /workOrderPartId: optionalId\(input\.workOrderPartId/i);
assert.match(warrantyFunctions, /Selecione a peça instalada a partir dos itens registrados na OS/i);
assert.doesNotMatch(warrantyFunctions, /cost_cents|unit_cost_cents|sale_cents/i);

assert.match(warrantyUi, /Garantias de fornecedor cadastradas/i);
assert.match(warrantyUi, /Coberturas DBS vinculadas à OS/i);
assert.match(warrantyUi, /Chamados de garantia/i);
assert.match(warrantyUi, /workOrderPartId/i);
assert.match(warrantyUi, /durationMonths/i);
assert.match(treasury, /DbsWarrantyManagementPage/i);
assert.match(treasury, /financeWorkspace === "warranties"/i);

assert.match(operationalUi, /getDbsWarrantyOverview/i);
assert.match(operationalUi, /section === "warranties"/i);
assert.match(operationalUi, /Garantias/i);
assert.match(operationalUi, /supplierWarranties.map/i);
assert.match(operationalUi, /customerWarranties.map/i);
assert.doesNotMatch(operationalUi, /cost_cents|unit_cost_cents|sale_cents|costCents|saleCents/i);
const operationalOverviewStart = inventoryFunctions.indexOf("export const getDbsOperationalInventoryOverview");
const operationalOverviewEnd = inventoryFunctions.indexOf("export const ", operationalOverviewStart + 1);
const operationalOverview = inventoryFunctions.slice(operationalOverviewStart, operationalOverviewEnd);
assert.match(operationalOverview, /select\("id,sku,name,description,stock_quantity,reserved_quantity,status,version"\)/i);
assert.doesNotMatch(operationalOverview, /cost_cents|unit_cost_cents|sale_cents/i);

for (const table of [
  "dbs_control_material_requests",
  "dbs_control_material_request_purchase_links",
  "dbs_control_material_request_fulfillments",
  "dbs_control_supplier_warranties",
  "dbs_control_customer_warranties",
  "dbs_control_warranty_claims",
  "dbs_control_warranty_claim_history",
]) {
  assert.match(backup, new RegExp(`"${table}"`), `Backup must cover ${table}.`);
}
assert.match(backup, /tables.length !== 92/);
console.log("DBS warranties: supplier receipt traceability, customer OS item coverage, claim history, Finance workspace, operational read-only consultation and backup coverage verified.");
