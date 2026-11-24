const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const helperSource = fs.readFileSync("public/dbs-control-pmoc-route.js", "utf8");
const html = fs.readFileSync("public/dbs-control.html", "utf8");
const shell = fs.readFileSync("src/routes/_authenticated/dbs-control.tsx", "utf8");
const scope = {};
vm.runInNewContext(helperSource, { window: scope, Math, String, Array, Object, Map, Set });
const planner = scope.DbsPmocRoutePlanner;
assert.ok(planner, "O planejador de rotas deve estar disponível.");

const sites = [{ id: "site-1", clienteId: "client-1", nome: "Loja Centro", endereco: "Rua A, 10, Rio de Janeiro, RJ", status: "ativo" }];
const clients = [{ id: "client-1", nome: "Cliente A" }];
const orders = [
  { id: "pmoc-done", clienteId: "client-1", siteId: "site-1", tipo: "PMOC Preventiva · Mensal", status: "concluída", data: "2026-11-04" },
];
const pmoc = planner.buildCandidates(sites, clients, orders, "2026-11", "PMOC Preventiva · Mensal");
assert.equal(pmoc.candidates.length, 0, "PMOC concluído não pode ser duplicado na competência.");
const corrective = planner.buildCandidates(sites, clients, orders, "2026-11", "Manutenção Corretiva");
assert.equal(corrective.candidates.length, 1, "Histórico PMOC não pode bloquear uma corretiva.");
assert.equal(corrective.candidates[0].clientId, "client-1");
const correctiveOpen = planner.buildCandidates(sites, clients, [
  ...orders,
  { id: "corrective-open", clienteId: "client-1", siteId: "site-1", tipo: "Manutenção Corretiva", status: "em andamento", data: "2026-11-10" },
], "2026-11", "Manutenção Corretiva");
assert.equal(correctiveOpen.candidates.length, 0, "Corretiva já em andamento não pode ser duplicada.");
const visit = planner.buildCandidates(sites, clients, [], "2026-11", "Visita Técnica");
assert.equal(visit.candidates.length, 1, "Visita técnica deve ser planejável sem OS PMOC prévia.");

assert.match(html, /id="pmoc-route-service-type"/, "A interface deve permitir escolher o tipo de atendimento.");
assert.match(html, /Manutenção Corretiva/, "A interface deve oferecer manutenção corretiva.");
assert.match(html, /Visita Técnica/, "A interface deve oferecer visita técnica.");
assert.match(html, /id="pmoc-route-cause"/, "A interface deve coletar a causa da solicitação.");
assert.match(html, /function redefinirAnaliseRotaPMOC\(/, "Mudar o tipo deve invalidar a análise anterior.");
assert.match(html, /type: 'DBS_CONTROL_CREATE_ROUTE_ORDERS'/, "A aprovação deve usar o fluxo autenticado de criação de OS.");
assert.match(shell, /DBS_CONTROL_CREATE_ROUTE_ORDERS/, "O shell autenticado deve receber a aprovação.");
assert.match(shell, /cause\.length < 5 \|\| cause\.length > 500/, "O servidor deve validar a causa.");
assert.match(shell, /allowedTypes\.has\(serviceType\)/, "O servidor deve validar a lista de tipos permitidos.");
assert.match(shell, /employeeModeRef\.current/, "Colaboradores não podem emitir rotas administrativas.");
console.log("DBS CONTROL route service types: PMOC, corretiva, visita técnica, causa obrigatória e prevenção de duplicidade verificados.");
