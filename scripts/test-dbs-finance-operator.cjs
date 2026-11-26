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
assert.match(migration, /dbs_control_inventory_finance_scope_key/);
assert.match(migration, /dbs_control_is_inventory_finance_actor/);
assert.match(migration, /dbs_control_register_purchase\(jsonb\)/);
assert.match(migration, /dbs_control_register_purchase_with_quote\(jsonb\)/);
assert.match(migration, /dbs_control_receive_purchase_items\(uuid,uuid,text,jsonb\)/);
assert.match(migration, /dbs_control_settle_purchase\(uuid,uuid,bigint,text,text\)/);
assert.match(migration, /dbs_control_inventory_financial_overview\(uuid\)/);
assert.match(migration, /dbs_control_decide_purchase_approval\(uuid,uuid,text,text,bigint\)/);
assert.match(migration, /v_purchase\.scope_key IS DISTINCT FROM public\.dbs_control_inventory_finance_scope_key/i);
assert.match(migration, /FINANCEIRO_LEITURA/);
assert.match(migration, /FINANCEIRO_OPERADOR/);
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.dbs_control_inventory_finance_scope_key\(uuid\)\s+TO service_role/i);
assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN|SCHEMA|FUNCTION)\b/i);
assert.doesNotMatch(migration, /TRUNCATE\s+/i);
assert.doesNotMatch(migration, /DELETE\s+FROM\s+/i);

assert.match(dbs, /requireDbsInventoryFinanceAdmin/);
assert.match(dbs, /inventoryScopeOwnerId/);
assert.match(dbs, /export const createDbsMaterialRequest/);
assert.match(dbs, /export const getDbsFinanceMaterialRequests/);
assert.match(dbs, /export const fulfillDbsMaterialRequest/);
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

assert.match(treasury, /FINANCEIRO_OPERADOR/);
assert.match(treasury, /resolveTreasuryScopeOwner/);
assert.match(login, /FINANCEIRO_OPERADOR[\s\S]{0,160}\/financeiro/);
assert.match(treasuryRoute, /FINANCEIRO_OPERADOR/);
assert.match(treasuryRoute, /canApprovePurchasesRef\.current = profile\?\.role_key === "SUPER_ADMIN" \|\| profile\?\.role_key === "FINANCEIRO_OPERADOR"/);
assert.match(accessRoute, /FINANCEIRO_OPERADOR/);
assert.match(accessRoute, /Perfil de acesso/);
assert.match(viewer, /FINANCEIRO_LEITURA/);
assert.match(viewer, /FINANCEIRO_OPERADOR/);
assert.match(types, /\| "FINANCEIRO_OPERADOR"/);

const adminGuard = treasury.slice(
  treasury.indexOf("async function requireTreasuryAdmin"),
  treasury.indexOf("function asObject"),
);
assert.match(adminGuard, /if \(user\.role_key !== "SUPER_ADMIN"\)/,
  "Lançamento manual no Ledger continua restrito ao SUPER_ADMIN.");

const readonlyPath = viewer.slice(viewer.indexOf("export const getTreasuryViewerData"));
assert.match(readonlyPath, /user\.role_key !== "FINANCEIRO_LEITURA"/);
assert.doesNotMatch(readonlyPath, /FINANCEIRO_OPERADOR/,
  "O operador financeiro não recebe acesso ao painel somente leitura.");

console.log("DBS finance operator: role, linked scope, server functions, purchase RPC authorization and readonly separation verified.");
