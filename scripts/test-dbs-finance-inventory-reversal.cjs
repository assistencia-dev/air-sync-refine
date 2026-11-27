const fs = require("node:fs");
const assert = require("node:assert/strict");

const migration = fs.readFileSync(
  "supabase/migrations/20261126160000_dbs_finance_inventory_reversal.sql",
  "utf8",
);
const source = fs.readFileSync(
  "supabase/migrations/20261111141203_dbs_control_inventory_immutable_and_treasury_commitments.sql",
  "utf8",
);
const functions = fs.readFileSync("src/lib/dbs-control.functions.ts", "utf8");
assert.match(source, /CREATE OR REPLACE FUNCTION public\.dbs_control_reverse_inventory_movement/i);
assert.match(migration, /dbs_control_reverse_inventory_movement\(uuid,uuid,text,text\)/i);
assert.match(migration, /dbs_control_is_inventory_finance_actor\(p_actor_user_id\)/i);
assert.match(migration, /v_original\.scope_key IS DISTINCT FROM public\.dbs_control_inventory_finance_scope_key\(p_actor_user_id\)/i);
assert.match(migration, /DBS_INVENTORY_REVERSAL_SCOPE_MISMATCH/);
assert.match(functions, /export const reverseDbsInventoryMovement[\s\S]*?requireDbsInventoryFinanceAdmin\(context\)/);
assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN|SCHEMA|FUNCTION)\b/i);
assert.doesNotMatch(migration, /TRUNCATE\s+/i);
assert.doesNotMatch(migration, /DELETE\s+FROM\s+/i);
console.log("DBS finance inventory reversal: linked owner scope and compensating immutable ledger reversal remain enforced.");
