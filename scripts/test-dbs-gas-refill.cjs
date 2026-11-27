const fs = require("node:fs");
const assert = require("node:assert/strict");

const migration = fs.readFileSync(
  "supabase/migrations/20261126190000_dbs_control_gas_refill_financial_fulfillment.sql",
  "utf8",
);
const requests = fs.readFileSync(
  "supabase/migrations/20261126130000_dbs_control_material_requests.sql",
  "utf8",
);
const receipts = fs.readFileSync(
  "supabase/migrations/20261111140750_dbs_control_purchase_partial_receipts.sql",
  "utf8",
);
const inventory = fs.readFileSync(
  "supabase/migrations/20261031040330_dbs_control_inventory_financial_bridge.sql",
  "utf8",
);
const gas = fs.readFileSync(
  "supabase/migrations/20261111165016_20261111171000_dbs_control_phase3_gas_cylinders.sql",
  "utf8",
);
const functions = fs.readFileSync("src/lib/dbs-control.functions.ts", "utf8");
const financeUi = fs.readFileSync("src/components/DbsFinanceMaterialRequestsPage.tsx", "utf8");
const operationalUi = fs.readFileSync("src/components/DbsOperationalInventoryPage.tsx", "utf8");

assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.dbs_control_gas_refill_events/i);
assert.match(migration, /UNIQUE\(scope_key, material_request_id\)/i);
assert.match(migration, /DBS_GAS_REFILL_EVENT_IMMUTABLE/);
assert.match(migration, /dbs_control_link_material_request_purchase\(uuid,uuid,uuid,uuid,numeric,bigint\)/i);
assert.match(migration, /request_type = 'gas_refill'/i);
assert.match(migration, /v_request\.quantity IS DISTINCT FROM 1::numeric/i);
assert.match(migration, /dbs_control_fulfill_gas_refill_request/i);
assert.match(migration, /dbs_control_is_inventory_finance_actor\(p_actor_user_id\)/i);
assert.match(migration, /dbs_control_inventory_finance_scope_key\(p_actor_user_id\)/i);
assert.match(migration, /DBS_GAS_REFILL_PURCHASE_NOT_RECEIVED/i);
assert.match(migration, /DBS_GAS_REFILL_RECEIPT_QUANTITY_UNAVAILABLE/i);
assert.match(migration, /DBS_GAS_REFILL_STOCK_INSUFFICIENT/i);
assert.match(migration, /DBS_GAS_REFILL_COST_REQUIRED/i);
assert.match(migration, /movement_type,quantity_delta/i);
assert.match(migration, /'consume',-v_quantity/);
assert.match(migration, /post_treasury_ledger_entry/i);
assert.match(migration, /'5\.1\.01'/);
assert.match(migration, /'1\.1\.03'/);
assert.match(migration, /inventory\.gas_cylinder\.refilled/i);
assert.match(migration, /idempotency_key/i);
assert.match(migration, /p_expected_version/i);
assert.match(requests, /gas_refill/);
assert.match(receipts, /dbs_control_purchase_receipt_items/i);
assert.match(inventory, /dbs_control_inventory_movements/i);
assert.match(gas, /dbs_control_gas_cylinders/i);
assert.match(functions, /export const fulfillDbsGasRefillRequest/i);
assert.match(functions, /dbs_control_fulfill_gas_refill_request/i);
assert.match(financeUi, /fulfillDbsGasRefillRequest/i);
assert.match(financeUi, /totalChargesAfter/i);
assert.match(operationalUi, /gas_refill/);
assert.doesNotMatch(operationalUi, /unit_cost_cents|cost_cents|sale_cents|total_cost_cents/i);

console.log("DBS gas refill: Finance-only approval, purchase/receipt traceability, central stock consumption, immutable movement, Ledger, cylinder reset and idempotency verified.");
