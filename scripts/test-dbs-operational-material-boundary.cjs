const fs = require("node:fs");
const assert = require("node:assert/strict");

const ux = fs.readFileSync("public/dbs-control-ux.js", "utf8");
const html = fs.readFileSync("public/dbs-control.html", "utf8");
const route = fs.readFileSync("src/routes/_authenticated/dbs-control.tsx", "utf8");
const operational = fs.readFileSync("src/components/DbsOperationalInventoryPage.tsx", "utf8");
const functions = fs.readFileSync("src/lib/dbs-control.functions.ts", "utf8");

const quickStart = ux.indexOf("function quickPart()");
const quickEnd = ux.indexOf("function addInlineButtons", quickStart);
assert.ok(quickStart >= 0 && quickEnd > quickStart, "OS part quick action must exist");
const quickPart = ux.slice(quickStart, quickEnd);
assert.match(quickPart, /DBS_CONTROL_OPEN_INVENTORY_DRAWER/);
assert.match(quickPart, /drawer:"request"/);
assert.doesNotMatch(quickPart, /qp-custo|qp-venda|qp-qtd|st\.pecas\.push|persist\(/i);
assert.match(ux, /\+ Solicitar cadastro ao Financeiro/);
assert.doesNotMatch(ux, /\+ Cadastrar peça agora/);
assert.doesNotMatch(ux, /function quickPart\(\)[\s\S]*?\+ Cadastrar peça/);

assert.match(html, /Solicitar materiais/);
assert.match(html, /section:\s*materialsSection/);
const legacySwitch = html.slice(
  html.indexOf("const materialsSection = employeeTab"),
  html.indexOf("const materialsSection = employeeTab") + 1400,
);
assert.match(legacySwitch, /child\.hidden = true/);
assert.match(legacySwitch, /DBS_CONTROL_OPEN_INVENTORY_MODULE/);
assert.match(route, /msg\.drawer === "request"/);
assert.match(route, /initialRequestType: drawer === "request" \? "new_part" : undefined/);
assert.match(route, /requestToken: \(current\[section\]\?\.requestToken \?\? 0\) \+ 1/);
assert.match(route, /initialRequestType=\{inventoryPortals\.purchases\.initialRequestType\}/);

assert.match(operational, /initialRequestType\?: RequestType/);
assert.match(operational, /requestToken\?: number/);
assert.match(operational, /setSection\("request"\)/);
assert.match(operational, /setRequestType\(initialRequestType\)/);
assert.doesNotMatch(operational, /cost_cents|unit_cost_cents|sale_cents|costCents|saleCents/i);

const overviewStart = functions.indexOf("export const getDbsOperationalInventoryOverview");
const overviewEnd = functions.indexOf("export const ", overviewStart + 1);
assert.ok(overviewStart >= 0 && overviewEnd > overviewStart);
const safeOverview = functions.slice(overviewStart, overviewEnd);
assert.match(safeOverview, /select\("id,sku,name,description,stock_quantity,reserved_quantity,status,version"\)/);
assert.doesNotMatch(safeOverview, /cost_cents|unit_cost_cents|sale_cents/i);

const portalMount = route.slice(route.indexOf("function mountDbsMaterialsPortal"), route.indexOf("function DbsControlMapsLaunchDialog"));
assert.match(portalMount, /child\.hidden = true/);
assert.match(portalMount, /data-dbs-materials-react-root/);

console.log("DBS operational/finance boundary: no local piece-with-cost creation, legacy costs hidden before portal, operational DTO contains only item and quantity, OS button opens a finance new-part request.");
