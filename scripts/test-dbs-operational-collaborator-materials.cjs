const fs = require("node:fs");
const assert = require("node:assert/strict");

const functions = fs.readFileSync("src/lib/dbs-control.functions.ts", "utf8");
const operational = fs.readFileSync("src/components/DbsOperationalInventoryPage.tsx", "utf8");

const actorStart = functions.indexOf("async function resolveDbsOperationalMaterialActor");
const actorEnd = functions.indexOf("function requireInventoryId", actorStart);
assert.ok(actorStart >= 0 && actorEnd > actorStart, "Operational actor resolver must exist");
const actorResolver = functions.slice(actorStart, actorEnd);
assert.match(actorResolver, /user\.role_key === "COLABORADOR"/);
assert.match(actorResolver, /getCollaboratorEmployee\(user\.id\)/);
assert.match(actorResolver, /getCollaboratorBaseScope\(employee\)/);
assert.match(actorResolver, /resolveDbsControlScope\(user, collaboratorBase\)/);
assert.match(actorResolver, /baseActive/);
assert.match(actorResolver, /DBS_INVENTORY_ADMIN_ROLES/);

const overviewStart = functions.indexOf("export const getDbsOperationalInventoryOverview");
const overviewEnd = functions.indexOf("export const createDbsMaterialRequest", overviewStart);
assert.ok(overviewStart >= 0 && overviewEnd > overviewStart);
const overview = functions.slice(overviewStart, overviewEnd);
assert.match(overview, /resolveDbsOperationalMaterialActor\(context\)/);
assert.match(overview, /assigned_employee_id", employee\.id/);
assert.match(overview, /select\("id,request_type,part_id,work_order_id,gas_cylinder_id,destination_stock_id,employee_id,vehicle_label,description,quantity,unit_label,reason,need_by_date,status,decision_note,fulfilled_quantity,requested_by,version,created_at,updated_at"\)/);
assert.match(overview, /visibleRequests = visibleRequests\.filter\(\(request: any\) =>[\s\S]*requested_by[\s\S]*user\.id/);
assert.match(overview, /employee_id", employee\.id/);
assert.match(overview, /canChooseDestination: !isCollaborator/);
assert.match(overview, /canReserveStock: !isCollaborator/,
  "Collaborators can request materials but must not receive admin-only stock reservation controls.");
assert.doesNotMatch(overview, /cost_cents|unit_cost_cents|sale_cents/i);

const requestStart = functions.indexOf("export const createDbsMaterialRequest");
const requestEnd = functions.indexOf("export const getDbsFinanceMaterialRequests", requestStart);
assert.ok(requestStart >= 0 && requestEnd > requestStart);
const requestHandler = functions.slice(requestStart, requestEnd);
assert.match(requestHandler, /resolveDbsOperationalMaterialActor\(context\)/);
assert.match(requestHandler, /A OS selecionada não está atribuída a este colaborador/);
assert.match(requestHandler, /cliente vinculado à base ativa do colaborador/);
assert.match(requestHandler, /O colaborador só pode solicitar material em seu próprio nome/);
assert.match(requestHandler, /O colaborador não pode escolher outro estoque de destino/);
assert.match(requestHandler, /botija selecionada não está atribuída a este colaborador/);
assert.match(requestHandler, /requested_by: user\.id/);

assert.match(operational, /canChooseDestination = overview\.data\?\.canChooseDestination === true/);
assert.match(operational, /canReserveStock = overview\.data\?\.canReserveStock === true/);
assert.match(operational, /\{canReserveStock && \([\s\S]*?reservePart\.mutate\(\)/,
  "Admin-only reservation form must not render for collaborators.");
assert.match(operational, /requestType !== "gas_refill" && canChooseDestination/);
assert.match(operational, /Quantidade<input readOnly value="1"/);
assert.doesNotMatch(operational, /cost_cents|unit_cost_cents|sale_cents|total_cost_cents/i);

console.log("DBS operational collaborator boundary: RH link, base/client scope, own OS/cylinder requests and no financial data verified.");
