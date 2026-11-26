const fs = require("node:fs");
const assert = require("node:assert/strict");

const migration = fs.readFileSync(
  "supabase/migrations/20261126150000_dbs_material_request_finance_scope.sql",
  "utf8",
);
const requests = fs.readFileSync(
  "supabase/migrations/20261126130000_dbs_control_material_requests.sql",
  "utf8",
);
const fulfillment = fs.readFileSync(
  "supabase/migrations/20261126140000_dbs_control_material_request_fulfillment.sql",
  "utf8",
);
const functions = fs.readFileSync("src/lib/dbs-control.functions.ts", "utf8");

for (const signature of [
  "dbs_control_decide_material_request(uuid,uuid,text,text,bigint)",
  "dbs_control_link_material_request_purchase(uuid,uuid,uuid,uuid,numeric,bigint)",
  "dbs_control_fulfill_material_request(uuid,uuid,numeric,uuid,text,bigint)",
  "dbs_control_operational_stock_transfer(uuid,uuid,numeric,uuid,uuid,text,text)",
]) {
  assert.ok(migration.includes(signature), "scope patch must cover " + signature);
}
assert.equal((migration.match(/dbs_control_inventory_finance_scope_key\(p_actor_user_id\)/g) || []).length, 4);
assert.match(migration, /DBS_MATERIAL_REQUEST_FINANCE_SCOPE_INVALID/);
assert.match(migration, /DBS_OPERATIONAL_STOCK_FINANCE_SCOPE_INVALID/);
assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN|SCHEMA|FUNCTION)\b/i);
assert.doesNotMatch(migration, /TRUNCATE\s+/i);
assert.doesNotMatch(migration, /DELETE\s+FROM\s+/i);

assert.match(requests, /dbs_control_is_inventory_finance_actor/);
assert.match(fulfillment, /dbs_control_is_inventory_finance_actor/);
assert.match(fulfillment, /dbs_control_operational_stock_transfer/);
assert.match(functions, /export const getDbsFinanceMaterialRequests/);
const start = functions.indexOf("export const getDbsFinanceMaterialRequests");
const end = functions.indexOf("export const ", start + 1);
const handler = functions.slice(start, end < 0 ? functions.length : end);
assert.match(handler, /getDbsInventoryFinanceScope\(user\)/,
  "The finance queue must read from the linked owner's canonical inventory scope.");

console.log("DBS material request finance scope: linked owner scope is enforced by queue, approval, purchase links, fulfillment and operational stock transfer.");
