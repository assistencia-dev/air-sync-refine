'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const helper = fs.readFileSync('public/dbs-control-route-planner.js', 'utf8');
const html = fs.readFileSync('public/dbs-control.html', 'utf8');
const window = {};
vm.runInNewContext(helper, { window, URLSearchParams, Date, Math, String, Array, Object, Map, Set }, {
  filename: 'public/dbs-control-route-planner.js'
});

const planner = window.DbsControlRoutePlanner;
assert.ok(planner, 'O planejador deve ser exposto para o DBS Control.');
assert.equal(
  planner.addressFrom({ address_json: { logradouro: 'Rua das Flores', numero: '25', bairro: 'Centro', cidade: 'Niterói', uf: 'RJ' } }),
  'Rua das Flores, 25, Centro, Niterói, RJ',
  'Endereços estruturados devem ser montados sem converter objetos em [object Object].'
);

const clients = [
  { id: 'c1', nome: 'Cliente A', endereco: 'Avenida Brasil, 100, Rio de Janeiro, RJ' },
  { id: 'c2', nome: 'Cliente B', endereco: 'Rua do Mercado, 10, Rio de Janeiro, RJ' },
  { id: 'c3', nome: 'Cliente sem endereço', endereco: '' }
];
const sites = [
  { id: 's1', clienteId: 'c1', nome: 'Filial Centro', endereco: 'Rua das Flores, 25, Niterói, RJ' },
  { id: 's2', clienteId: 'c2', nome: 'Unidade Norte', endereco: 'Rua do Porto, 80, São Gonçalo, RJ' }
];
const orders = [
  { id: 'os-1', protocolo: 'OS-001', clienteId: 'c1', siteId: 's1', status: 'Em Atendimento' },
  { id: 'os-2', protocolo: 'OS-002', clienteId: 'c1', siteId: 's1', status: 'Aguardando peça' },
  { id: 'os-3', protocolo: 'OS-003', clienteId: 'c2', siteId: 's2', status: 'Aberta' },
  { id: 'os-4', protocolo: 'OS-004', clienteId: 'c2', status: 'Aberta' },
  { id: 'os-5', protocolo: 'OS-005', clienteId: 'c3', localAtendimento: 'Sala técnica', status: 'Aberta' },
  { id: 'os-6', protocolo: 'OS-006', clienteId: 'c1', siteId: 's1', status: 'Concluída' },
  { id: 'os-7', protocolo: 'OS-007', clienteId: 'c1', siteId: 's1', status: 'Cancelada' },
  { id: 'os-8', protocolo: 'OS-008', clienteId: 'c1', siteId: 's1', status: 'Concluída com pendência' }
];

const plan = planner.buildStops(orders, clients, sites);
assert.equal(plan.stops.length, 3, 'OS no mesmo endereço devem compartilhar uma parada; ordens sem endereço válido ficam fora.');
assert.equal(plan.stops[0].orders.length, 2, 'As OS do mesmo local devem aparecer juntas na parada.');
assert.equal(plan.includedOrderCount, 4, 'A contagem deve considerar apenas OS abertas com endereço.');
assert.equal(plan.missingAddressCount, 1, 'Local de atendimento como setor não pode ser confundido com endereço postal.');
assert.equal(plan.ignoredTerminalCount, 3, 'OS concluídas e canceladas não devem entrar na rota.');
assert.equal(plan.stops[0].address, 'Rua das Flores, 25, Niterói, RJ', 'O local específico deve prevalecer sobre o endereço geral do cliente.');

const fallback = planner.buildStops([
  { id: 'os-client', clienteId: 'c2', status: 'Aberta' }
], clients, []);
assert.equal(fallback.stops[0].address, clients[1].endereco, 'Sem endereço específico, deve usar o endereço cadastrado no cliente.');

const routeStops = [
  { address: 'Rua 1, 10, Rio de Janeiro, RJ' },
  { address: 'Rua 2, 20, Rio de Janeiro, RJ' },
  { address: 'Rua 3, 30, Rio de Janeiro, RJ' },
  { address: 'Rua 4, 40, Rio de Janeiro, RJ' },
  { address: 'Rua 5, 50, Niterói, RJ' }
];
const legs = planner.buildRouteLegs(routeStops);
assert.equal(legs.length, 2, 'Mais de quatro paradas devem ser divididas em etapas móveis compatíveis.');
const firstUrl = new URL(legs[0].url);
assert.equal(firstUrl.searchParams.get('api'), '1');
assert.equal(firstUrl.searchParams.get('destination'), routeStops[3].address);
assert.equal(firstUrl.searchParams.get('waypoints').split('|').length, 3);
assert.equal(firstUrl.searchParams.get('origin'), null, 'A primeira etapa deve permitir que o Maps use a localização atual do aparelho.');
const secondUrl = new URL(legs[1].url);
assert.equal(secondUrl.searchParams.get('origin'), routeStops[3].address, 'A etapa seguinte deve começar no último endereço da etapa anterior.');
assert.equal(secondUrl.searchParams.get('destination'), routeStops[4].address);
assert.equal(secondUrl.searchParams.get('travelmode'), 'driving');

const scheduled = planner.buildStops([
  { id: 'late', clienteId: 'c1', status: 'Aberta', endereco: 'Rua A, 1', scheduledAt: '2026-11-24T15:00:00-03:00' },
  { id: 'early', clienteId: 'c1', status: 'Aberta', endereco: 'Rua B, 2', scheduledAt: '2026-11-24T09:00:00-03:00' }
], clients, []);
assert.equal(scheduled.sortedBySchedule, true, 'Só deve ordenar quando todas as paradas têm horário válido.');
assert.equal(scheduled.stops[0].orders[0].id, 'early', 'Horários agendados válidos devem ordenar as paradas.');

const partialSchedule = planner.buildStops([
  { id: 'timed', status: 'Aberta', endereco: 'Rua A, 1', scheduledAt: '2026-11-24T09:00:00-03:00' },
  { id: 'untimed', status: 'Aberta', endereco: 'Rua B, 2' }
], [], []);
assert.equal(partialSchedule.sortedBySchedule, false, 'Não deve ordenar parcialmente se alguma parada não tiver horário.');
assert.equal(partialSchedule.stops[0].orders[0].id, 'timed', 'A ordem original deve ser preservada quando faltarem horários.');

assert.match(html, /dbs-control-route-planner\.js\?v=20261125-1/, 'O planejador deve entrar com cache busting próprio.');
assert.match(html, /abrirRotaAtividadesDia\(\)/, 'A agenda administrativa deve oferecer o atalho de rota.');
assert.match(html, /id="day-filter-tecnico"/, 'A seleção de técnico permanece disponível na conferência diária.');
console.log('DBS CONTROL route planner: endereços, deduplicação, estados, etapas móveis e sequência segura verificados.');

const parentRoute = fs.readFileSync('src/routes/_authenticated/dbs-control.tsx', 'utf8');
const pmocHelper = fs.readFileSync('public/dbs-control-pmoc-route.js', 'utf8');
const pmocWindow = {};
vm.runInNewContext(pmocHelper, { window: pmocWindow, Math, String, Array, Object, Map, Set }, {
  filename: 'public/dbs-control-pmoc-route.js'
});
const pmoc = pmocWindow.DbsPmocRoutePlanner;
assert.ok(pmoc, 'O planejador PMOC deve ser exposto no DBS Control.');
assert.equal(pmoc.addressFrom({ address_json: { logradouro: 'Rua A', numero: '10', bairro: 'Centro', cidade: 'Niterói', uf: 'RJ' } }), 'Rua A, 10, Centro, Niterói, RJ');

const pmocAudit = pmoc.buildCandidates(
  [
    { id: 'site-done', clienteId: 'client-a', nome: 'Loja já atendida', endereco: 'Rua A, 10, Rio de Janeiro, RJ', status: 'ativo' },
    { id: 'site-pending', clienteId: 'client-b', nome: 'Loja pendente', endereco: 'Rua B, 20, Niterói, RJ', status: 'ativo' },
    { id: 'site-ambiguous', clienteId: 'client-c', nome: 'Loja com histórico sem vínculo', endereco: 'Rua C, 30, São Gonçalo, RJ', status: 'ativo' },
    { id: 'site-no-address', clienteId: 'client-d', nome: 'Loja sem endereço', endereco: '', status: 'ativo' },
    { id: 'site-inactive', clienteId: 'client-e', nome: 'Loja inativa', endereco: 'Rua E, 50, Rio de Janeiro, RJ', status: 'inativo' }
  ],
  [
    { id: 'client-a', nome: 'Cliente A' }, { id: 'client-b', nome: 'Cliente B' },
    { id: 'client-c', nome: 'Cliente C' }, { id: 'client-d', nome: 'Cliente D' },
    { id: 'client-e', nome: 'Cliente E' }, { id: 'client-f', nome: 'Cliente sem loja' }
  ],
  [
    { id: 'done', clienteId: 'client-a', siteId: 'site-done', tipo: 'preventiva', status: 'concluída', data: '2026-11-04' },
    { id: 'legacy', clienteId: 'client-c', tipo: 'PMOC', status: 'aberta', data: '2026-11-03' }
  ],
  '2026-11'
);
assert.deepEqual(Array.from(pmocAudit.candidates, row => row.id), ['site-pending'], 'Só loja ativa sem OS PMOC na competência deve entrar como pendente.');
assert.ok(pmocAudit.review.some(row => row.id === 'site-ambiguous'), 'OS PMOC sem loja vinculada deve exigir conciliação manual.');
assert.ok(pmocAudit.review.some(row => row.id === 'site-no-address'), 'Loja sem endereço não deve entrar na rota.');
assert.ok(pmocAudit.review.some(row => row.id === 'client-f'), 'Cliente sem loja vinculada deve aparecer na auditoria.');
assert.equal(pmocAudit.candidates[0].status, 'pendente');

const optimized = pmoc.optimize([
  { id: 'far', lat: 0, lng: 2 }, { id: 'near', lat: 0, lng: 1 }, { id: 'middle', lat: 0, lng: 1.5 }
], { lat: 0, lng: 0 });
assert.deepEqual(Array.from(optimized.stops, row => row.id), ['near', 'middle', 'far'], 'A rota deve aproximar a próxima loja a partir da origem/última parada.');
assert.equal(optimized.stops[0].sequence, 1);
assert.ok(optimized.distanceEstimateKm > 0);
const centralStart = pmoc.optimize([
  { id: 'edge-a', lat: 0, lng: 0 }, { id: 'center', lat: 0, lng: 1 }, { id: 'edge-b', lat: 0, lng: 2 }
], null);
assert.equal(centralStart.stops[0].id, 'center', 'Sem GPS, deve iniciar pela loja mais central e depois aproximar as demais.');
const cancelledAudit = pmoc.buildCandidates(
  [{ id: 'cancelled-site', clienteId: 'cancelled-client', nome: 'Loja com OS cancelada', endereco: 'Rua C, 30, Niterói, RJ', status: 'ativo' }],
  [{ id: 'cancelled-client', nome: 'Cliente' }],
  [{ id: 'cancelled-order', clienteId: 'cancelled-client', siteId: 'cancelled-site', tipo: 'preventiva', status: 'cancelada', data: '24/11/2026' }],
  '2026-11'
);
assert.equal(cancelledAudit.candidates.length, 0, 'OS cancelada não deve ser reaberta automaticamente com a mesma chave de emissão.');
assert.ok(cancelledAudit.review.length > 0, 'OS cancelada exige revisão manual.');
const plannerFunctionIndex = html.indexOf('function analisarRotaPMOC');
const plannerScriptStart = html.lastIndexOf('<script>', plannerFunctionIndex);
const plannerScriptEnd = html.indexOf('</script>', plannerScriptStart);
assert.ok(plannerFunctionIndex >= 0 && plannerScriptStart >= 0 && plannerScriptEnd > plannerScriptStart, 'O script do planejador PMOC deve estar presente no HTML.');
new vm.Script(html.slice(plannerScriptStart + '<script>'.length, plannerScriptEnd), { filename: 'dbs-control-pmoc-inline.js' });

assert.match(html, /dbs-control-pmoc-route\.js\?v=20261124-1/, 'O planejador PMOC deve entrar com cache busting.');
assert.match(html, /id="pmoc-route-map"/, 'A interface deve exibir o mapa dentro do DBS.');
assert.match(html, /onclick="analisarRotaPMOC\(\)"/, 'A análise da rota deve ser acionada pelo usuário.');
assert.match(html, /onclick="aprovarRotaPMOC\(\)"/, 'A emissão só pode ocorrer no botão de aprovação.');
assert.match(html, /removerLojaRotaPMOC/, 'A rota deve permitir remover lojas individualmente.');
assert.match(html, /adicionarLojaRotaPMOC/, 'A rota deve permitir adicionar lojas individualmente.');
assert.match(html, /DBS_CONTROL_CREATE_ROUTE_ORDERS/, 'A aprovação deve passar pelo shell autenticado.');
assert.match(parentRoute, /msg\.type === "DBS_CONTROL_CREATE_ROUTE_ORDERS"/, 'O shell autenticado deve receber o pedido de emissão.');
assert.match(parentRoute, /applyDbsControlDelta\(/, 'A emissão deve usar o fluxo relacional oficial de OS.');
assert.match(parentRoute, /uuidPattern\.test\(siteId\)/, 'A emissão deve exigir IDs relacionais canônicos de loja/cliente.');
console.log('DBS CONTROL PMOC route planner: conciliação por loja/competência, auditoria de ambiguidades, otimização, mapa e aprovação relacional verificados.');


assert.match(html, /class="dbs-route-open"[^>]*data-dbs-maps-url=/, 'O botão de etapa deve enviar o endereço ao shell autenticado.');
assert.match(html, /class='employee-map-link'[^>]*data-dbs-maps-url=/, 'O cartão do colaborador deve usar o mesmo acionador seguro.');
assert.match(html, /function solicitarAberturaMaps\(/, 'A navegação externa deve usar o acionador compartilhado.');
assert.match(html, /type: 'DBS_CONTROL_OPEN_MAPS'/, 'O iframe deve solicitar abertura ao shell autenticado.');
assert.doesNotMatch(html, /class="dbs-route-open"[^>]*target="_top"/, 'Não usar top navigation direta dentro do iframe.');
assert.doesNotMatch(html, /class="dbs-route-open"[^>]*target="_blank"/, 'Não abrir o Maps diretamente a partir do iframe legado.');
assert.match(parentRoute, /msg\.type === "DBS_CONTROL_OPEN_MAPS"/, 'O shell autenticado deve receber pedidos de abertura do Maps.');
assert.match(parentRoute, /allowedHosts = new Set\(\["www\.google\.com", "maps\.google\.com"\]\)/, 'O shell só deve abrir Google Maps HTTPS autorizado.');
assert.match(parentRoute, /function DbsControlMapsLaunchDialog/, 'O shell deve apresentar uma confirmação visível de abertura.');
assert.match(parentRoute, /window\.top !== window\.self/, 'O shell deve detectar prévias incorporadas e oferecer cópia do link.');
assert.match(parentRoute, /window\.location\.assign\(url\)/, 'Quando aberto diretamente, o Maps deve navegar na aba principal.');
console.log('DBS CONTROL Maps launcher: ponte iframe-shell, validação de domínio, abertura top-level e fallback copiável verificados.');

// O novo despacho começa pelo técnico e pelos locais, não depende de OS existentes.
const dispatchScript = fs.readFileSync('public/dbs-control-technician-route.js', 'utf8');
new vm.Script(dispatchScript, { filename: 'public/dbs-control-technician-route.js' });
const pontoFunctions = fs.readFileSync('src/lib/ponto.functions.ts', 'utf8');
assert.match(html, /dbs-control-route-planner\.js\?v=20261125-1/, 'O algoritmo atualizado deve ter cache busting.');
assert.match(html, /dbs-control-technician-route\.js\?v=20261125-1/, 'O novo despacho deve ser carregado depois do shell legado.');
assert.match(dispatchScript, /window\.abrirRotaAtividadesDia = openPlanner/, 'O botão antigo deve abrir o novo fluxo independente de OS.');
assert.doesNotMatch(dispatchScript, /data-dbs-route-order-id/, 'O novo fluxo não pode depender de OS visíveis na agenda.');
assert.match(dispatchScript, /DBS_CONTROL_GET_TECHNICIAN_LOCATION/, 'O novo fluxo deve consultar a última posição do técnico no RH.');
assert.match(dispatchScript, /state\.location\.is_live/, 'A interface deve distinguir GPS recente de última posição conhecida.');
assert.match(dispatchScript, /buildSiteCandidates/, 'A rota deve nascer do cadastro de lojas e locais.');
assert.match(dispatchScript, /optimizeStops/, 'A sequência deve ser sugerida por proximidade geográfica.');
assert.match(dispatchScript, /data-action="create"/, 'A criação das OS deve ficar numa ação final explícita.');
assert.match(dispatchScript, /employeeId: employeeId/, 'As OS devem receber o vínculo do colaborador selecionado.');
assert.match(dispatchScript, /causaSolicitacao: cause/, 'A descrição do problema deve ser preservada na OS.');

assert.ok((dispatchScript.match(/serviceType: ''/g) || []).length >= 2, 'Toda parada deve começar sem tipo pré-selecionado, exigindo classificação explícita.');
assert.match(dispatchScript, /Selecione o tipo de atendimento/, 'A interface deve orientar a classificação individual da parada.');
assert.match(dispatchScript, /Rota planejada para '\s*\+\s*routeDate/, 'A data e a ordem da parada devem acompanhar a OS criada.');
assert.match(dispatchScript, /Photon[/]OpenStreetMap/, 'A interface deve informar a consulta externa de geocodificação.');
assert.match(dispatchScript, /não considera trânsito/, 'A interface deve explicar que a sugestão inicial usa proximidade e não trânsito.');
assert.match(dispatchScript, /state\.selected\.length >= 50/, 'A interface deve impedir seleção acima de 50 locais por lote.');
assert.match(dispatchScript, /Motivo . problema \(obrigatório\)/, 'A corretiva deve exibir justificativa obrigatória.');
assert.match(dispatchScript, /corretiv\|emergencial/, 'A justificativa da corretiva/emergência deve ser obrigatória.');
assert.match(dispatchScript, /window\.parent\.postMessage\(\{[\s\S]*DBS_CONTROL_CREATE_DISPATCH_ROUTE_ORDERS/, 'A emissão em lote deve usar a ponte autenticada do shell.');

const siteAudit = planner.buildSiteCandidates(
  [
    { id: 'site-1', clienteId: 'c1', nome: 'Loja Centro', endereco: 'Rua A, 10, Rio de Janeiro, RJ', lat: 0, lng: 1, status: 'ativo' },
    { id: 'site-2', clienteId: 'c2', nome: 'Loja Norte', endereco: 'Rua B, 20, Niterói, RJ', lat: 0, lng: 2, status: 'ativo' },
    { id: 'site-inactive', clienteId: 'c2', nome: 'Loja Inativa', endereco: 'Rua C, 30, Niterói, RJ', status: 'inativo' }
  ],
  [
    { id: 'c1', nome: 'Cliente 1' },
    { id: 'c2', nome: 'Cliente 2' },
    { id: 'c3', nome: 'Cliente sem loja', endereco: 'Rua D, 40, Niterói, RJ', lat: 0, lng: 0.5 }
  ]
);
assert.deepEqual(
  Array.from(siteAudit.candidates, item => item.id),
  ['site-1', 'site-2', 'client:c3'],
  'O planejador deve usar locais ativos e permitir cliente sem unidade própria com endereço.'
);
const proximityRoute = planner.optimizeStops(siteAudit.candidates, { lat: 0, lng: 0 });
assert.deepEqual(
  Array.from(proximityRoute.stops, item => item.id),
  ['client:c3', 'site-1', 'site-2'],
  'O técnico deve ser o ponto de partida da sequência por proximidade.'
);
const gpsLegs = planner.buildRouteLegs(proximityRoute.stops, { lat: 0, lng: 0 });
assert.equal(new URL(gpsLegs[0].url).searchParams.get('origin'), '0,0', 'O primeiro trajeto do Maps deve sair da última posição do técnico.');

assert.match(pontoFunctions, /export const listRhFleetTechnicianLocations = createServerFn/, 'A leitura da localização deve ocorrer numa função de servidor.');
assert.match(pontoFunctions, /export const verifyRhDbsControlTechnician = createServerFn/, 'A atribuição deve validar o vínculo RH sem depender das tabelas GPS.');
assert.match(pontoFunctions, /location_unavailable_reason:/, 'A ausência da migração Fleet deve virar aviso, não bloquear a rota por endereço.');
assert.match(parentRoute, /verifyRhDbsControlTechnician\(\{ data: \{ employee_id: technicianEmployeeId \} \}\)/, 'A criação de OS deve validar o técnico independentemente do GPS.');
assert.match(pontoFunctions, /await requireRh\(context\)/, 'A leitura da localização deve ser restrita ao RH.');
assert.match(pontoFunctions, /employee_found:/, 'O servidor deve confirmar o vínculo ativo do técnico, mesmo sem sessão GPS.');
assert.match(parentRoute, /msg\.type === "DBS_CONTROL_GET_TECHNICIAN_LOCATION"/, 'O shell deve receber consulta de localização.');
assert.match(parentRoute, /msg\.type === "DBS_CONTROL_CREATE_DISPATCH_ROUTE_ORDERS"/, 'O shell deve receber a aprovação de criação em lote.');
assert.match(parentRoute, /assignedId !== technicianEmployeeId/, 'Toda OS do lote deve ser atribuída ao técnico selecionado.');
assert.match(parentRoute, /technicianCheck\.employee_found/, 'O servidor deve rejeitar técnico sem vínculo ativo no RH.');
assert.match(parentRoute, /Nenhuma OS foi criada/, 'A detecção de duplicidade deve bloquear o lote antes de gravar.');

console.log('DBS CONTROL technician-first route: GPS do técnico, locais sem OS prévia, proximidade, edição e OS em lote atribuídas verificados.');
