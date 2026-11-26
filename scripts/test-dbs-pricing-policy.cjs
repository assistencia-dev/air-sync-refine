const fs = require("node:fs");
const assert = require("node:assert/strict");

const migration = fs.readFileSync(
  "supabase/migrations/20261126180000_dbs_inventory_pricing_policy.sql",
  "utf8",
);
const functions = fs.readFileSync("src/lib/dbs-control.functions.ts", "utf8");
const inventoryUi = fs.readFileSync("src/routes/_authenticated/dbs-inventory.tsx", "utf8");
const bridgeTest = fs.readFileSync("scripts/test-inventory-financial-bridge.cjs", "utf8");

assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.dbs_control_inventory_pricing_policies/i);
assert.match(migration, /scope_key text NOT NULL UNIQUE CHECK \(scope_key = 'dbs-control:global'\)/i);
assert.match(migration, /pricing_method IN \('markup','gross_margin'\)/i);
assert.match(migration, /rate_bps integer NOT NULL/i);
assert.match(migration, /CHECK \(pricing_method <> 'gross_margin' OR rate_bps < 10000\)/i);
assert.match(migration, /p_expected_version bigint/i);
assert.match(migration, /DBS_INVENTORY_PRICING_POLICY_VERSION_CONFLICT/i);
assert.match(migration, /DBS_INVENTORY_PRICING_POLICY_PRICE_OVERFLOW/i);
assert.match(migration, /pg_advisory_xact_lock/i);
assert.match(migration, /UPDATE public\.dbs_control_parts/i);
assert.match(migration, /sale_cents = CASE/i);
assert.match(migration, /WHEN v_method='markup'/i);
assert.match(migration, /ELSE round\(cost_cents::numeric \* 10000::numeric \/ \(10000 - p_rate_bps\)::numeric\)/i);
assert.match(migration, /SET search_path = public, pg_temp/i);
assert.match(migration, /REVOKE ALL ON FUNCTION public\.dbs_control_save_inventory_pricing_policy/i);
assert.match(migration, /TO service_role/i);
assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN|SCHEMA|FUNCTION)\b/i);
assert.doesNotMatch(migration, /TRUNCATE\s+/i);
assert.doesNotMatch(migration, /DELETE\s+FROM\s+/i);
assert.doesNotMatch(migration, /INSERT\s+INTO public\.treasury_ledger/i);
assert.doesNotMatch(migration, /dbs_control_inventory_movements/i);

assert.match(functions, /calculateDbsPartSaleCents/i);
assert.match(functions, /export const saveDbsInventoryPricingPolicy/i);
assert.match(functions, /pricingPolicy/);
assert.match(functions, /sale_cents: saleCents/);
assert.doesNotMatch(functions.slice(functions.indexOf("export const createDbsPartCatalog"), functions.indexOf("export const updateDbsPartCatalog")), /saleCents: number/);
assert.doesNotMatch(functions.slice(functions.indexOf("export const updateDbsPartCatalog"), functions.indexOf("type DbsInventoryMasterUpdateInput")), /saleCents: number/);
assert.match(inventoryUi, /Política de preço de revenda/i);
assert.match(inventoryUi, /markup/);
assert.match(inventoryUi, /gross_margin/);
assert.doesNotMatch(inventoryUi, /Preço de venda \(R\$\)[\s\S]{0,300}onChange=\{e=>setCatalogPartSale/i);
assert.match(inventoryUi, /preço de revenda calculado/i);
assert.match(bridgeTest, /createDbsPartCatalog/);
console.log("DBS pricing policy: explicit markup/gross-margin configuration, optimistic version, atomic catalog repricing, and server-derived sale price verified.");
