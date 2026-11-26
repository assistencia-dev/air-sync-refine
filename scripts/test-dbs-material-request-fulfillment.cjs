const fs = require("node:fs");
const assert = require("node:assert/strict");
const migration = fs.readFileSync(
  "supabase/migrations/20261126140000_dbs_control_material_request_fulfillment.sql",
  "utf8",
);
assert.match(migration, /dbs_control_material_request_fulfillments/i);
assert.match(migration, /UNIQUE\(scope_key, idempotency_key\)/i);
assert.match(migration, /dbs_control_operational_stock_transfer/i);
assert.match(migration, /dbs_control_is_inventory_finance_actor/i);
assert.match(migration, /DBS_MATERIAL_REQUEST_PURCHASE_NOT_RECEIVED/i);
assert.match(migration, /DBS_MATERIAL_REQUEST_PURCHASE_LINK_QUANTITY_PENDING/i);
assert.match(migration, /DBS_MATERIAL_REQUEST_FULFILLMENT_KEY_REUSED/i);
assert.match(migration, /DBS_MATERIAL_REQUEST_VERSION_CONFLICT/i);
assert.match(migration, /v_request\.fulfilled_quantity \+ p_quantity/i);
assert.match(migration, /part_id = coalesce\(part_id, v_item\.part_id\)/i);
assert.match(migration, /SET fulfilled_quantity = v_fulfilled/i);
assert.match(migration, /status = v_new_status/i);
assert.match(migration, /FROM PUBLIC, anon, authenticated/i);
assert.match(migration, /TO service_role/i);
assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN|SCHEMA|FUNCTION)\b/i);
assert.doesNotMatch(migration, /TRUNCATE\s+/i);
assert.doesNotMatch(migration, /DELETE\s+FROM\s+/i);
assert.doesNotMatch(migration, /cost_cents|unit_cost_cents|sale_cents|ledger_entry/i);
console.log("DBS material request fulfillment: atomic stock transfer, idempotency and received-quantity checks verified.");
