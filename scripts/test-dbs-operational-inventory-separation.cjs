const fs = require("node:fs");
const assert = require("node:assert/strict");

const functions = fs.readFileSync("src/lib/dbs-control.functions.ts", "utf8");
const operationsPage = fs.readFileSync("src/components/DbsOperationalInventoryPage.tsx", "utf8");
const inventoryRoute = fs.readFileSync("src/routes/_authenticated/dbs-inventory.tsx", "utf8");
const controlRoute = fs.readFileSync("src/routes/_authenticated/dbs-control.tsx", "utf8");
const legacyUx = fs.readFileSync("public/dbs-control-ux.js", "utf8");

function block(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `Missing source block: ${startMarker}`);
  return source.slice(start, end);
}

const operationalDto = block(
  functions,
  "export const getDbsOperationalInventoryOverview",
  "export const getDbsPhase2InventoryOverview",
);
assert.match(operationalDto, /requireDbsInventoryAdmin\(context\)/);
assert.match(operationalDto, /select\("id,sku,name,description,stock_quantity,reserved_quantity,status"\)/);
assert.doesNotMatch(operationalDto, /cost_cents|sale_cents|unit_cost_cents|purchase|supplier|accounts_payable/i);
assert.match(operationalDto, /availableQuantity/);
assert.match(operationalDto, /operationalBalances/);

const financeGuard = block(functions, "async function requireDbsInventoryFinanceAdmin", "function requireInventoryId");
assert.match(financeGuard, /user\.role_key !== "SUPER_ADMIN"/);
const financeOverview = block(functions, "export const getDbsPhase2InventoryOverview", "export const createDbsSupplier");
assert.match(financeOverview, /requireDbsInventoryFinanceAdmin\(context\)/);
const partWrite = block(functions, "export const createDbsPartCatalog", "export const updateDbsPartCatalog");
assert.match(partWrite, /requireDbsInventoryFinanceAdmin\(context\)/);
const partUpdate = block(functions, "export const updateDbsPartCatalog", "export const updateDbsInventoryMasterData");
assert.match(partUpdate, /requireDbsInventoryFinanceAdmin\(context\)/);

assert.match(operationsPage, /getDbsOperationalInventoryOverview/);
assert.match(operationsPage, /Peças & Estoque/);
assert.match(operationsPage, /Estoque central/);
assert.match(operationsPage, /Estoque operacional/);
assert.doesNotMatch(operationsPage, /cost_cents|sale_cents|unit_cost_cents|catalogPartCost|catalogPartSale/i);

const routeGuard = block(inventoryRoute, "function DbsInventoryRoute()", "function money(");
assert.match(routeGuard, /role === "SUPER_ADMIN"/);
assert.match(routeGuard, /DbsInventoryPage/);
assert.match(routeGuard, /DbsOperationalInventoryPage/);
assert.match(routeGuard, /ADMIN_OPERACIONAL/);

assert.match(controlRoute, /import \{ DbsOperationalInventoryPage \}/);
assert.match(controlRoute, /<DbsOperationalInventoryPage embedded/);
assert.doesNotMatch(controlRoute, /<DbsInventoryPage/);
assert.match(controlRoute, /section === "purchases"[\s\S]*?navigate\(\{ to: "\/treasury" \}\)/);

const quickPart = block(legacyUx, "function quickPart()", "function addInlineButtons()");
assert.match(quickPart, /DBS_CONTROL_OPEN_INVENTORY_DRAWER/);
assert.doesNotMatch(quickPart, /qp-custo|qp-venda|st\.pecas\.push/);
assert.match(legacyUx, /Solicitar cadastro ao Financeiro/);
assert.doesNotMatch(legacyUx, /Cadastrar peça agora/);

console.log("DBS operational inventory separation: safe DTO, server-side finance guard, operational UI, finance navigation and legacy quick-create removal verified.");
