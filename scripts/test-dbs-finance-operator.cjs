const fs = require("node:fs");
const assert = require("node:assert/strict");

const migration = fs.readFileSync(
  "supabase/migrations/20261126120000_dbs_finance_operator_role.sql",
  "utf8",
);
const dbs = fs.readFileSync("src/lib/dbs-control.functions.ts", "utf8");
const treasury = fs.readFileSync("src/lib/treasury.functions.ts", "utf8");
const login = fs.readFileSync("src/routes/login.tsx", "utf8");
const treasuryRoute = fs.readFileSync("src/routes/_authenticated/treasury.tsx", "utf8");
const accessRoute = fs.readFileSync("src/routes/_authenticated/financeiro-acesso.tsx", "utf8");
const viewer = fs.readFileSync("src/lib/treasury-viewer.functions.ts", "utf8");
const types = fs.readFileSync("src/integrations/supabase/types.ts", "utf8");

assert.match(migration, /ALTER TYPE public\.role_key ADD VALUE IF NOT EXISTS 'FINANCEIRO_OPERADOR'/i);
assert.match(migration, /dbs_control_is_inventory_finance_actor/i);
assert.match(migration, /treasury_viewer_access/i);
assert.match(migration, /owner\.role_key::text = 'SUPER_ADMIN'/i);
assert.match(migration, /owner\.company_id IS NOT DISTINCT FROM finance_user\.company_id/i);
assert.match(migration, /dbs_control_register_purchase\(jsonb\)/i);
assert.match(migration, /dbs_control_register_purchase_with_quote\(jsonb\)/i);
assert.match(migration, /dbs_control_receive_purchase_items\(uuid,uuid,text,jsonb\)/i);
assert.match(migration, /dbs_control_settle_purchase\(uuid,uuid,bigint,text,text\)/i);
assert.match(migration, /dbs_control_inventory_financial_overview\(uuid\)/i);
assert.match(migration, /v_actor_role NOT IN \('SUPER_ADMIN','FINANCEIRO_OPERADOR'\)/i);
assert.match(migration, /FINANCEIRO_LEITURA','FINANCEIRO_OPERADOR/i);
assert.match(migration, /REVOKE ALL ON FUNCTION public\.dbs_control_is_inventory_finance_actor\(uuid\)/i);
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.dbs_control_is_inventory_finance_actor\(uuid\)\s+TO service_role/i);
assert.doesNotMatch(migration, /dbs_control_is_admin_actor\(p_actor_user_id\).*FINANCEIRO_OPERADOR/i);
assert.doesNotMatch(migration, /GRANT (INSERT|UPDATE|DELETE|ALL).*treasury_ledger/i);
assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN|SCHEMA|FUNCTION)\b/i);
assert.doesNotMatch(migration, /TRUNCATE\s+/i);
assert.doesNotMatch(migration, /DELETE\s+FROM\s+/i);

assert.match(dbs, /requireDbsInventoryFinanceAdmin/);
assert.match(dbs, /user\.role_key === "FINANCEIRO_OPERADOR"/);
assert.match(dbs, /treasury_viewer_access/);
for (const functionName of [
  "getDbsPhase2InventoryOverview", "createDbsSupplier", "createDbsCostCenter",
  "createDbsPartCatalog", "updateDbsPartCatalog", "createDbsPurchase",
  "receiveDbsPurchaseItems", "decideDbsPurchaseApproval", "settleDbsPurchase",
  "getDbsInventoryFinancialOverview",
]) {
  const start = dbs.indexOf("export const " + functionName);
  const next = dbs.indexOf("export const ", start + 1);
  assert.notEqual(start, -1, functionName + " must remain available");
  assert.match(dbs.slice(start, next < 0 ? dbs.length : next), /requireDbsInventoryFinanceAdmin/,
    functionName + " must use finance authorization");
}
assert.match(treasury, /"FINANCEIRO_OPERADOR"/);
assert.match(treasury, /role_key === "FINANCEIRO_OPERADOR"/);
assert.match(login, /FINANCEIRO_OPERADOR[\s\S]{0,160}\/financeiro/);
assert.match(treasuryRoute, /"FINANCEIRO_OPERADOR"/);
assert.match(treasuryRoute, /profile\?\.role_key === "FINANCEIRO_OPERADOR"/);
assert.match(accessRoute, /FINANCEIRO_OPERADOR/);
assert.match(viewer, /role_key:\s*"FINANCEIRO_LEITURA"\s*\|\s*"FINANCEIRO_OPERADOR"/);
assert.match(viewer, /role_key: data\.role_key/);
assert.match(types, /\| "FINANCEIRO_OPERADOR"/);

const roleOnly = treasury.slice(
  treasury.indexOf("async function requireTreasuryAdmin"),
  treasury.indexOf("function asObject"),
);
assert.match(roleOnly, /if \(user\.role_key !== "SUPER_ADMIN"\)/,
  "Manual Ledger entries remain restricted to SUPER_ADMIN.");

const readonlyPath = viewer.slice(
  viewer.indexOf("export const getTreasuryViewerData"),
);
assert.match(readonlyPath, /user\.role_key !== "FINANCEIRO_LEITURA"/);
assert.doesNotMatch(readonlyPath, /FINANCEIRO_OPERADOR/,
  "The new finance operator must not gain access to the readonly viewer page.");

console.log("DBS finance operator: distinct role, linked owner scope, finance-only RPC authorization, Treasury routing and read-only separation verified.");
