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
assert.equal(firstUrl.searchParams.get('waypoints').split('|').length, 2, 'Sem GPS do técnico, a primeira parada deve ser a origem para não usar a posição do administrador.');
assert.equal(firstUrl.searchParams.get('origin'), routeStops[0].address, 'Sem GPS recente do técnico, a primeira parada da sugestão deve ser a origem explícita.');
const secondUrl = new URL(legs[1].url);
assert.equal(secondUrl.searchParams.get('origin'), routeStops[3].address, 'A etapa seguinte deve começar no último endereço da etapa anterior.');
assert.equal(secondUrl.searchParams.get('destination'), routeStops[4].address);
assert.equal(secondUrl.searchParams.get('travelmode'), 'driving');
const singleStopWithoutGps = planner.buildRouteLegs([{ address: 'Rua Única, 55, Niterói, RJ' }]);
assert.equal(new URL(singleStopWithoutGps[0].url).pathname, '/maps/search/', 'Um único local sem GPS do técnico deve abrir a localização, nunca iniciar a navegação a partir do administrador.');
assert.equal(new URL(singleStopWithoutGps[0].url).searchParams.get('query'), 'Rua Única, 55, Niterói, RJ');


const siteMetrics = planner.enrichSiteCandidates(
  [{ id: 's1', siteId: 's1', clientId: 'c1', lat: -22.9, lng: -43.2 }],
  [
    { id: 'open', siteId: 's1', clienteId: 'c1', status: 'Aberta' },
    { id: 'progress', siteId: 's1', clienteId: 'c1', status: 'Em Atendimento' },
    { id: 'late', siteId: 's1', clienteId: 'c1', status: 'Aberta', sla: '2026-11-24T10:00:00-03:00' },
    { id: 'urgent', siteId: 's1', clienteId: 'c1', status: 'Aberta', tipo: 'Manutenção Corretiva', prioridade: 'alta' },
    { id: 'done', siteId: 's1', clienteId: 'c1', status: 'Concluída' },
    { id: 'cancelled', siteId: 's1', clienteId: 'c1', status: 'Cancelada' }
  ],
  [{ id: 'eq1', siteId: 's1', clienteId: 'c1', status: 'ativo' }],
  Date.parse('2026-11-25T15:00:00Z')
);
assert.equal(siteMetrics[0].openOrders, 3, 'Indicador de OS abertas deve excluir concluídas e canceladas e separar atendimento em andamento.');
assert.equal(siteMetrics[0].inProgressOrders, 1, 'Indicador de OS em atendimento deve usar o status real da OS.');
assert.equal(siteMetrics[0].overdueOrders, 1, 'OS só deve ser marcada vencida quando o SLA cadastrado expirou.');
assert.equal(siteMetrics[0].emergencyOrders, 1, 'Atendimentos emergenciais devem aparecer como indicador separado.');
assert.equal(siteMetrics[0].equipmentCount, 1, 'O mapa deve mostrar equipamentos vinculados ao local.');
const newlyGeocodedSite = planner.enrichSiteCandidates(
  [{ id: 'new-site', siteId: 'new-site', clientId: 'new-client', lat: -22.9, lng: -43.2, mapCoordinatesSource: 'address_geocoded' }],
  [],
  [],
  Date.parse('2026-11-25T15:00:00Z')
);
assert.equal(newlyGeocodedSite[0].mapCoordinatesSource, 'address_geocoded', 'Coordenadas da primeira geocodificação precisam continuar identificadas para serem persistidas.');

const siteSummary = planner.summarizeSiteMetrics(siteMetrics);
assert.equal(siteSummary.locations, 1);
assert.equal(siteSummary.mappedLocations, 1);
assert.equal(siteSummary.openOrders, 3);
assert.equal(siteSummary.equipment, 1);

const ambiguousClientMetrics = planner.enrichSiteCandidates(
  [
    { id: 's1', siteId: 's1', clientId: 'shared-client', lat: 0, lng: 1 },
    { id: 's2', siteId: 's2', clientId: 'shared-client', lat: 0, lng: 2 }
  ],
  [
    { id: 'site-order', siteId: 's1', clienteId: 'shared-client', status: 'Aberta' },
    { id: 'client-order', clienteId: 'shared-client', status: 'Aberta' }
  ],
  [
    { id: 'site-equipment', siteId: 's2', clienteId: 'shared-client', status: 'ativo' },
    { id: 'client-equipment', clienteId: 'shared-client', status: 'ativo' }
  ],
  Date.parse('2026-11-25T15:00:00Z')
);
assert.equal(ambiguousClientMetrics[0].openOrders, 1, 'OS ligada a uma loja deve contar somente naquela loja.');
assert.equal(ambiguousClientMetrics[1].openOrders, 0, 'OS que só informa o cliente não pode ser replicada em todas as lojas.');
assert.equal(ambiguousClientMetrics.unallocated.orders, 1, 'OS sem local em cliente com várias lojas deve aparecer como não alocada.');
assert.equal(ambiguousClientMetrics.unallocated.equipment, 1, 'Equipamento sem local em cliente com várias lojas deve aparecer como não alocado.');
const ambiguousSummary = planner.summarizeSiteMetrics(ambiguousClientMetrics);
assert.equal(ambiguousSummary.ordersWithoutSpecificSite, 1);
assert.equal(ambiguousSummary.equipmentWithoutSpecificSite, 1);
const hiddenSiblingSiteMetrics = planner.enrichSiteCandidates(
  [{ id: 'only-geocoded-site', siteId: 's1', clientId: 'multi-site-client', clientSiteCount: 2, lat: 0, lng: 1 }],
  [{ id: 'legacy-client-order', clienteId: 'multi-site-client', status: 'Aberta' }],
  [],
  Date.parse('2026-11-25T15:00:00Z')
);
assert.equal(hiddenSiblingSiteMetrics[0].openOrders, 0, 'Endereço de outra loja incompleto não autoriza atribuir OS do cliente à única loja geocodificada.');
assert.equal(hiddenSiblingSiteMetrics.unallocated.orders, 1, 'OS de cliente com mais de uma unidade deve continuar sem local até conciliação.');

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

assert.match(html, /dbs-control-route-planner\.js\?v=20261125-2/, 'O planejador atualizado deve entrar com cache busting próprio.');
assert.match(html, /abrirRotaAtividadesDia\(\)/, 'A agenda administrativa deve oferecer o atalho de rota.');
assert.match(html, /id="day-filter-tecnico"/, 'A seleção de técnico permanece disponível na conferência diária.');
console.log('DBS CONTROL route planner: endereços, deduplicação, estados, etapas móveis e sequência segura verificados.');

const parentRoute = fs.readFileSync('src/routes/_authenticated/dbs-control.tsx', 'utf8');
const technicianRoute = fs.readFileSync('public/dbs-control-technician-route.js', 'utf8');
const dbsControlFunctions = fs.readFileSync('src/lib/dbs-control.functions.ts', 'utf8');
const pontoFunctionsSource = fs.readFileSync('src/lib/ponto.functions.ts', 'utf8');
const mapMigration = fs.readFileSync('supabase/migrations/20261125143000_dbs_control_site_map_coordinates.sql', 'utf8');
assert.match(mapMigration, /add column if not exists map_latitude/);
assert.match(mapMigration, /add column if not exists map_longitude/);
assert.match(mapMigration, /between -90 and 90/);
assert.match(mapMigration, /between -180 and 180/);
assert.match(mapMigration, /dbs_control_reset_site_map_coordinates_on_address_change/);
assert.match(mapMigration, /before update of address_json on public\.dbs_control_sites/);

assert.ok(mapMigration.includes("map_latitude is not null") && mapMigration.includes("map_longitude is not null"), 'Latitude e longitude precisam ser gravadas juntas.');
assert.ok(dbsControlFunctions.includes(".replace(/[" + String.fromCharCode(92) + "u0300-" + String.fromCharCode(92) + "u036f]/g, " + String.fromCharCode(34) + String.fromCharCode(34) + ")"), 'A validação de endereço deve normalizar acentos corretamente.');
assert.ok(dbsControlFunctions.includes(".replace(/" + String.fromCharCode(92) + "s+/g, " + String.fromCharCode(34) + " " + String.fromCharCode(34) + ")"), 'A validação de endereço deve normalizar espaços corretamente.');


assert.match(technicianRoute, /typeof ERP_STATE !== 'undefined'/, 'O planejador deve ler o estado lexical do iframe, não depender de window.ERP_STATE.');
assert.match(technicianRoute, /DBS_CONTROL_LIST_ACTIVE_TECHNICIANS/, 'A lista do seletor deve vir dos colaboradores ativos do RH.');
assert.match(parentRoute, /listRhPontoEmployees\(\)/, 'O bridge administrativo deve consultar o RH para a lista ativa de técnicos.');
assert.match(dbsControlFunctions, /row\.address_json\.texto/, 'A hidratação deve aproveitar o campo texto dos endereços reais dos locais.');
assert.match(pontoFunctionsSource, /readLatestPontoGpsLocation/, 'Sem a tabela do FLEET, o sistema deve tentar a última coordenada válida do ponto.');
assert.match(pontoFunctionsSource, /location_source: "ponto"/, 'A coordenada do ponto deve ser marcada como última posição, nunca como rastreamento ao vivo.');
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
assert.match(html, /dbs-control-route-planner\.js\?v=20261125-2/, 'O algoritmo atualizado deve ter cache busting.');
assert.match(html, /dbs-control-technician-route\.js\?v=20261125-5/, 'O mapa e o despacho atualizados devem ser carregados depois do shell legado.');
assert.match(dispatchScript, /window\.abrirRotaAtividadesDia = openPlanner/, 'O botão antigo deve abrir o novo fluxo independente de OS.');
assert.doesNotMatch(dispatchScript, /data-dbs-route-order-id/, 'O novo fluxo não pode depender de OS visíveis na agenda.');
assert.match(dispatchScript, /DBS_CONTROL_GET_TECHNICIAN_LOCATION/, 'O novo fluxo deve consultar a última posição do técnico no RH.');
assert.match(dispatchScript, /state\.location\.is_live/, 'A interface deve distinguir GPS recente de última posição conhecida.');
assert.match(dispatchScript, /buildSiteCandidates/, 'A rota deve nascer do cadastro de lojas e locais.');
assert.match(dispatchScript, /enrichSiteCandidates/, 'Os locais devem receber indicadores calculados pelas OS e equipamentos reais.');
assert.match(dispatchScript, /summarizeSiteMetrics/, 'O painel do mapa deve exibir indicadores agregados da operação.');
assert.match(dispatchScript, /enrichSiteCandidates\(\s*candidates,/, 'Os indicadores devem considerar todos os locais com endereço, inclusive os que aguardam geocodificação.');
assert.match(dispatchScript, /state\.siteMetrics = planner\(\)\.summarizeSiteMetrics\(measured\)/, 'O resumo operacional não pode descartar locais ainda sem coordenadas.');
assert.match(dispatchScript, /Cadastros a revisar/, 'O mapa deve expor registros de endereço que exigem conferência.');

assert.match(dispatchScript, /DBS_CONTROL_SAVE_SITE_MAP_COORDINATES/, 'Coordenadas geocodificadas devem ser cacheadas no cadastro relacional do local.');
assert.match(dispatchScript, /state\.selected = state\.candidates\.slice\(0, Math\.min\(5/, 'A rota deve apresentar uma sugestão inicial editável sem abrir OS automaticamente.');
assert.match(dispatchScript, /Pinos verdes: sem OS pendente/, 'A legenda do mapa deve diferenciar locais por situação operacional real.');
assert.match(dispatchScript, /Sem GPS recente: a rota não usa a posição do administrador como origem/, 'Sem GPS do técnico, o planejador não pode presumir a localização do administrador.');
assert.match(dispatchScript, /DBS_CONTROL_SAVE_SITE_MAP_COORDINATES/, 'O shell deve persistir coordenadas de endereço com validação administrativa.');
assert.match(parentRoute, /msg\.type === "DBS_CONTROL_SAVE_SITE_MAP_COORDINATES"/, 'A ponte autenticada deve persistir coordenadas geocodificadas.');
assert.match(dbsControlFunctions, /export const saveDbsControlSiteMapCoordinates = createServerFn/, 'O salvamento das coordenadas deve ocorrer exclusivamente no servidor.');
assert.match(dbsControlFunctions, /normalizeAddress\(addressFromJson\(row\.address_json\)\)/, 'A coordenada só pode ser salva se o endereço não mudou desde a geocodificação.');
assert.match(dbsControlFunctions, /const mapSelect = "id,client_id,name,address_json,map_latitude,map_longitude,map_geocoded_at,map_geocode_provider,map_geocode_status/, 'A hidratação deve ler o cache de coordenadas relacional quando as colunas estiverem disponíveis.');
assert.match(dbsControlFunctions, /const baseSelect = "id,client_id,name,address_json,contact_name/, 'A hidratação deve manter compatibilidade com bancos anteriores à migração aditiva.');
assert.match(dbsControlFunctions, /return missingCoordinatesSchema \? querySites\(baseSelect\) : withMapCoordinates/, 'A ausência das colunas novas não pode interromper a leitura operacional do DBS CONTROL.');
assert.match(dbsControlFunctions, /Nenhuma coordenada foi gravada/, 'O sistema deve informar claramente quando o cache de mapa ainda não existe no banco.');

assert.match(dispatchScript, /optimizeStops/, 'A sequência deve ser sugerida por proximidade geográfica.');
assert.match(dispatchScript, /data-action="create"/, 'A criação das OS deve ficar numa ação final explícita.');
assert.match(dispatchScript, /employeeId: employeeId/, 'As OS devem receber o vínculo do colaborador selecionado.');
assert.match(dispatchScript, /causaSolicitacao: cause/, 'A descrição do problema deve ser preservada na OS.');

assert.ok((dispatchScript.match(/serviceType: ''/g) || []).length >= 2, 'Toda parada deve começar sem tipo pré-selecionado, exigindo classificação explícita.');
assert.match(dispatchScript, /Selecione o tipo de atendimento/, 'A interface deve orientar a classificação individual da parada.');
assert.match(dispatchScript, /Rota planejada para '\s*\+\s*routeDate/, 'A data e a ordem da parada devem acompanhar a OS criada.');
assert.match(dispatchScript, /Photon[/]OpenStreetMap/, 'A interface deve informar a consulta externa de geocodificação.');
assert.match(dispatchScript, /A sequência considera proximidade quando há coordenadas/, 'A interface deve explicar que a sugestão inicial usa proximidade e não trânsito.');
assert.match(dispatchScript, /state\.selected\.length >= 50/, 'A interface deve impedir seleção acima de 50 locais por lote.');
assert.match(dispatchScript, /Motivo . problema \(obrigatório\)/, 'A corretiva deve exibir justificativa obrigatória.');
assert.match(dispatchScript, /corretiv\|emergencial/, 'A justificativa da corretiva/emergência deve ser obrigatória.');
assert.match(dispatchScript, /window\.parent\.postMessage\(\{[\s\S]*DBS_CONTROL_CREATE_DISPATCH_ROUTE_ORDERS/, 'A emissão em lote deve usar a ponte autenticada do shell.');

const duplicateSiteRepresentations = planner.buildSiteCandidates(
  [
    { id: 'single-site', clienteId: 'single-client', nome: 'Única loja', endereco: 'Rua Única, 10, Niterói, RJ' },
    { id: 'single-site', clienteId: 'single-client', nome: 'Única loja', endereco: 'Rua Única, 10, Niterói, RJ' }
  ],
  [{ id: 'single-client', nome: 'Cliente com uma loja' }]
);
assert.equal(duplicateSiteRepresentations.candidates.length, 1);
assert.equal(duplicateSiteRepresentations.candidates[0].clientSiteCount, 1, 'As listas compatíveis sites/locais não podem duplicar a contagem de unidades.');

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
assert.match(parentRoute, /DBS_CONTROL_LIST_ACTIVE_TECHNICIANS/, 'O bridge precisa responder ao carregamento dos técnicos ativos.');
assert.match(technicianRoute, /Mapa-base carregado/, 'O mapa-base deve aparecer antes da geocodificação dos endereços.');
assert.match(technicianRoute, /GPS atualizado nos últimos 3 minutos/, 'O mapa da rota deve identificar a posição recebida dentro da janela de 3 minutos.');
assert.match(pontoFunctions, /await requireRh\(context\)/, 'A leitura da localização deve ser restrita ao RH.');
assert.match(pontoFunctions, /employee_found:/, 'O servidor deve confirmar o vínculo ativo do técnico, mesmo sem sessão GPS.');
assert.match(parentRoute, /msg\.type === "DBS_CONTROL_GET_TECHNICIAN_LOCATION"/, 'O shell deve receber consulta de localização.');
assert.match(parentRoute, /msg\.type === "DBS_CONTROL_CREATE_DISPATCH_ROUTE_ORDERS"/, 'O shell deve receber a aprovação de criação em lote.');
assert.match(parentRoute, /changes: \{ ordens: orders \}/, 'A aprovação precisa enviar a lista efetivamente recebida para a camada relacional.');
assert.doesNotMatch(parentRoute, /changes: \{ ordens \}/, 'A aprovação não pode referenciar uma variável inexistente.');
assert.match(pontoFunctionsSource, /new Map<string, any>\(employees\.map/, 'A consulta de localizações deve manter a tipagem do cadastro do RH.');

assert.match(parentRoute, /assignedId !== technicianEmployeeId/, 'Toda OS do lote deve ser atribuída ao técnico selecionado.');
assert.match(parentRoute, /technicianCheck\.employee_found/, 'O servidor deve rejeitar técnico sem vínculo ativo no RH.');
assert.match(parentRoute, /Nenhuma OS foi criada/, 'A detecção de duplicidade deve bloquear o lote antes de gravar.');

console.log('DBS CONTROL technician-first route: GPS do técnico, locais sem OS prévia, proximidade, edição e OS em lote atribuídas verificados.');


// Server-side geocoding must avoid browser CORS failures from the public Photon endpoint.
assert.ok(!dispatchScript.includes("photon.komoot.io"), "O navegador não deve acessar o Photon diretamente; a chamada precisa passar pelo servidor autenticado.");
assert.ok(dispatchScript.includes("DBS_CONTROL_GEOCODE_SITE_ADDRESS"), "O mapa deve consultar o geocodificador por meio da ponte autenticada do shell.");
assert.ok(dispatchScript.includes("Endereço cadastrado; serviço de geocodificação indisponível"), "Falhas de rede do provedor não podem ser rotuladas como endereço ausente.");
assert.ok(dispatchScript.includes("Endereço cadastrado: "), "O endereço original deve permanecer visível na lista de revisão.");
assert.ok(dispatchScript.includes('data-action="review-map"'), "A revisão deve permitir abrir o endereço cadastrado no Google Maps.");
assert.ok(parentRoute.includes('msg.type === "DBS_CONTROL_GEOCODE_SITE_ADDRESS"'), "O shell deve receber a geocodificação e chamar a ação do servidor.");
assert.ok(parentRoute.includes("geocodeDbsControlSiteAddress({ data: { address } })"), "A consulta externa deve ocorrer exclusivamente pela função autenticada do servidor.");
assert.ok(dbsControlFunctions.includes("export const geocodeDbsControlSiteAddress = createServerFn"), "A geocodificação deve existir como função server-side autenticada.");
assert.ok(dbsControlFunctions.includes('administrativeRoles = ["SUPER_ADMIN", "ADMIN_OPERACIONAL", "GESTOR_CONTA", "GESTOR_REGIONAL"]'), "A geocodificação deve ser restrita aos papéis administrativos.");
assert.ok(dbsControlFunctions.includes('new URL("https://photon.komoot.io/api/")'), "O servidor deve montar a chamada Photon com URL e parâmetros estruturados.");
assert.ok(dbsControlFunctions.includes("response.status === 400"), "HTTP 400 deve acionar uma consulta simplificada, sem rotular o endereço como inexistente.");
assert.ok(dbsControlFunctions.includes('code: "provider_unavailable"'), "Erros de rede e serviço precisam de categoria própria.");
assert.ok(parentRoute.includes('requested.pathname.startsWith("/maps/search/")'), "O shell deve permitir pesquisa do endereço no Google Maps com host validado.");
assert.ok(html.includes("dbs-control-technician-route.js?v=20261125-6"), "A correção deve ser servida sem cache antigo.");


// The address map must include more than 100 sites (the current customer set has 135).
assert.ok(dispatchScript.includes("audit.candidates.slice(0, 250)"), "O mapa não pode descartar filiais após a centésima; deve suportar pelo menos 135 endereços.");
assert.ok(dispatchScript.includes("A lista excede 250 locais."), "Somente listas acima do limite ampliado podem ser direcionadas à divisão por região.");
assert.ok(dispatchScript.includes("state.selected.length >= 50"), "A ampliação do mapa não pode alterar o limite de emissão de até 50 OS por lote.");


 // Technician route must remain usable before address geocoding finishes.
 assert.ok(dispatchScript.includes("function optimizeRoutePreservingUnlocated"), "A ordem da rota deve preservar locais sem coordenadas.");
 assert.ok(dispatchScript.includes("const unlocated = source.filter(item => !hasValidCoordinates(item))"), "Endereços sem pino devem continuar como paradas selecionáveis.");
 assert.ok(dispatchScript.includes("state.candidates = optimizeRoutePreservingUnlocated(measured, originForRoute())"), "A lista completa de locais deve ser mantida após a leitura dos indicadores.");
 assert.ok(dispatchScript.includes("queueSelectedGeocoding(state.selected)"), "A geocodificação deve ocorrer apenas nas paradas selecionadas.");
 assert.ok(!/const workers = Array.from\(\{ length: 1 \}, async \(\) => \{/.test(dispatchScript), "O mapa não deve geocodificar todos os clientes em sequência antes de liberar a rota.");
 assert.ok(dispatchScript.includes("A rota e os links do Google Maps já podem ser usados pelos endereços"), "Links da rota devem ficar disponíveis mesmo durante geocodificação.");
 assert.ok(dispatchScript.includes("Endereços sem pino"), "A interface deve contar endereços que ainda não possuem marcador.");
 assert.ok(dispatchScript.includes("Endereço pronto para navegação; pino em processamento"), "Paradas sem coordenadas devem continuar disponíveis para navegação.");
 assert.ok(dispatchScript.includes("if (!/(tecnic|hvac|refriger|instalad|mecanic|manutenc)/.test(role)) return false;"), "O seletor deve listar apenas colaboradores com cargo técnico real.");
 assert.ok(parentRoute.includes('posicao: String(registration.position || registration.cargo || "").trim()'), "O shell deve enviar o cargo RH real e não inventar o cargo Técnico quando está vazio.");
 assert.ok(dispatchScript.includes("function queueSelectedGeocoding(items)"), "A fila progressiva de pinos deve existir.");
 assert.ok(dispatchScript.includes("state.geocodeGeneration"), "A troca de técnico/reabertura deve invalidar uma fila de geocodificação anterior.");
