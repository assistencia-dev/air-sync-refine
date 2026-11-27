const fs = require("node:fs");
const assert = require("node:assert/strict");
const migration = fs.readFileSync(
  "supabase/migrations/20261126130000_dbs_control_material_requests.sql",
  "utf8",
);

for (const table of [
  "dbs_control_material_requests",
  "dbs_control_material_request_purchase_links",
]) {
  assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`, "i"));
  assert.match(migration, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`, "i"));
}
assert.match(migration, /REFERENCES public\.dbs_control_parts\(id\) ON DELETE RESTRICT/i);
assert.match(migration, /REFERENCES public\.dbs_control_work_orders\(id\) ON DELETE RESTRICT/i);
assert.match(migration, /gas_cylinder_id uuid REFERENCES public\.dbs_control_gas_cylinders\(id\) ON DELETE RESTRICT/i);
assert.match(migration, /request_type <> 'gas_refill' OR gas_cylinder_id IS NOT NULL/i);
assert.match(migration, /REFERENCES public\.dbs_control_purchases\(id\) ON DELETE RESTRICT/i);
assert.match(migration, /REFERENCES public\.dbs_control_purchase_items\(id\) ON DELETE RESTRICT/i);
assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS dbs_control_material_requests_idempotency_uidx[\s\S]*ON public\.dbs_control_material_requests\(scope_key, idempotency_key\)/i);
assert.match(migration, /version bigint NOT NULL DEFAULT 1/i);
assert.match(migration, /DBS_MATERIAL_REQUEST_VERSION_CONFLICT/i);
assert.match(migration, /DBS_MATERIAL_REQUEST_SKU_MISMATCH/i);
assert.match(migration, /DBS_MATERIAL_REQUEST_LINK_EXCEEDS_REQUEST/i);
assert.match(migration, /DBS_MATERIAL_REQUEST_LINK_EXCEEDS_PURCHASE_ITEM/i);
assert.match(migration, /DBS_MATERIAL_REQUEST_FULFILLMENT_REQUIRES_STOCK_MOVEMENT/i);
assert.match(migration, /dbs_control_is_inventory_finance_actor/i);
assert.match(migration, /FROM PUBLIC, anon, authenticated/i);
assert.match(migration, /TO service_role/i);
assert.doesNotMatch(migration, /cost_cents|unit_cost_cents|sale_cents|ledger_entry/i);
assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN|SCHEMA|FUNCTION)\b/i);
assert.doesNotMatch(migration, /TRUNCATE\s+/i);
assert.doesNotMatch(migration, /DELETE\s+FROM\s+/i);

console.log("DBS material requests: idempotency, role separation, versioning and purchase de-para verified.");
