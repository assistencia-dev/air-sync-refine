const fs = require("node:fs");
const assert = require("node:assert/strict");

const migration = fs.readFileSync(
  "supabase/migrations/20261126110000_dbs_part_warranties_and_customer_coverage.sql",
  "utf8",
);

assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.dbs_control_supplier_warranties/i);
assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.dbs_control_customer_warranties/i);
assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.dbs_control_warranty_claims/i);
assert.match(migration, /REFERENCES public\.dbs_control_purchase_receipt_items\(id\) ON DELETE RESTRICT/i);
assert.match(migration, /REFERENCES public\.dbs_control_work_orders\(id\) ON DELETE RESTRICT/i);
assert.match(migration, /REFERENCES public\.dbs_control_work_order_parts\(id\) ON DELETE RESTRICT/i);
assert.match(migration, /REFERENCES public\.dbs_control_parts\(id\) ON DELETE RESTRICT/i);
assert.match(migration, /start_anchor IN \('invoice_date','receipt_date','installation_date','manual_date'\)/i);
assert.match(migration, /expires_on >= starts_on/i);
assert.match(migration, /claim_type = 'supplier'.*supplier_warranty_id IS NOT NULL/s);
assert.match(migration, /claim_type = 'customer'.*customer_warranty_id IS NOT NULL/s);
assert.match(migration, /status IN \('opened','under_review','approved','rejected','replaced','credited','closed'\)/i);
assert.match(migration, /ENABLE ROW LEVEL SECURITY/i);
assert.match(migration, /FROM PUBLIC, anon, authenticated/i);
assert.match(migration, /TO service_role/i);
assert.match(migration, /Garantia de fornecedor\/fabricante/i);
assert.match(migration, /nenhum prazo padrão é presumido/i);

assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN|SCHEMA|FUNCTION)\b/i);
assert.doesNotMatch(migration, /TRUNCATE\s+/i);
assert.doesNotMatch(migration, /DELETE\s+FROM\s+/i);
assert.doesNotMatch(migration, /UPDATE\s+public\.dbs_control_/i);
assert.doesNotMatch(migration, /INSERT\s+INTO\s+public\.dbs_control_(inventory_movements|inventory_outbox|work_order_history)/i);
assert.doesNotMatch(migration, /cost_cents|unit_cost|sale_cents|ledger_entry/i);

const createTables = [...migration.matchAll(/CREATE TABLE IF NOT EXISTS public\.(dbs_control_[a-z_]+)/gi)]
  .map((match) => match[1]);
assert.deepEqual(createTables, [
  "dbs_control_supplier_warranties",
  "dbs_control_customer_warranties",
  "dbs_control_warranty_claims",
]);

for (const table of createTables) {
  assert.match(migration, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`, "i"));
}

console.log("DBS warranties phase 1: additive warranty tables, OS/receipt traceability, claim lifecycle and service-role-only access verified.");
