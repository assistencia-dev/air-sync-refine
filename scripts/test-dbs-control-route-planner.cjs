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

assert.match(html, /dbs-control-route-planner\.js\?v=20261124-1/, 'O planejador deve entrar com cache busting próprio.');
assert.match(html, /abrirRotaAtividadesDia\(\)/, 'A agenda administrativa deve oferecer o atalho de rota.');
assert.match(html, /data-dbs-route-order-id/, 'O planejador deve usar apenas as OS que aparecem na lista filtrada do dia.');
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
assert.match(html, /DBS_CONTROL_CREATE_SERVICE_ROUTE/, 'A programação genérica deve passar pelo shell autenticado.');
assert.match(parentRoute, /DBS_CONTROL_CREATE_PMOC_ROUTE.*DBS_CONTROL_CREATE_SERVICE_ROUTE/, 'O shell deve manter compatibilidade PMOC e aceitar programação genérica.');
assert.match(parentRoute, /applyDbsControlDelta\(/, 'A emissão deve usar o fluxo relacional oficial de OS.');
assert.match(parentRoute, /validUuid\.test\(siteId\)/, 'A emissão deve exigir IDs relacionais canônicos de loja/cliente.');
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

const servicePlanner = pmocWindow.DbsServiceRoutePlanner;
assert.equal(servicePlanner, pmoc, 'O nome genérico do planejador deve manter compatibilidade com o contrato PMOC legado.');
assert.equal(servicePlanner.typeFamily('Manutenção Corretiva'), 'corretiva');
assert.equal(servicePlanner.typeFamily('Visita Técnica'), 'visita');
assert.equal(servicePlanner.typeFamily('Manutenção Preventiva'), 'preventiva');
assert.equal(servicePlanner.typeFamily('PMOC Preventiva · Mensal'), 'pmoc');
assert.equal(servicePlanner.typeFamily('Instalação / Start-Up'), 'instalacao');
assert.equal(servicePlanner.typeFamily('Inspeção Técnica'), 'inspecao');
assert.equal(servicePlanner.typeFamily('Retorno Técnico'), 'retorno');
assert.equal(servicePlanner.typeFamily('Atendimento Emergencial'), 'emergencial');
assert.equal(servicePlanner.typeFamily('Outro Atendimento'), 'outro');
assert.equal(servicePlanner.dayOf('24/11/2026'), '2026-11-24');
assert.equal(servicePlanner.monthOf('24/11/2026'), '2026-11');

const serviceAudit = servicePlanner.buildCandidates(
  [
    { id: 'site-corrective-open', clienteId: 'client-1', nome: 'Loja com corretiva aberta', endereco: 'Rua Um, 10, Rio de Janeiro, RJ', status: 'ativo' },
    { id: 'site-corrective-free', clienteId: 'client-2', nome: 'Loja sem corretiva', endereco: 'Rua Dois, 20, Niterói, RJ', status: 'ativo' },
    { id: 'site-inactive', clienteId: 'client-3', nome: 'Loja inativa', endereco: 'Rua Três, 30, Rio de Janeiro, RJ', status: 'inativo' },
    { id: 'site-without-address', clienteId: 'client-4', nome: 'Loja sem endereço', endereco: '', status: 'ativo' }
  ],
  [
    { id: 'client-1', nome: 'Cliente 1' }, { id: 'client-2', nome: 'Cliente 2' },
    { id: 'client-3', nome: 'Cliente 3' }, { id: 'client-4', nome: 'Cliente 4' }
  ],
  [
    { id: 'corr-open', clienteId: 'client-1', siteId: 'site-corrective-open', tipo: 'Manutenção Corretiva', status: 'em_atendimento', data: '2026-11-24' },
    { id: 'legacy-corr', clienteId: 'client-2', tipo: 'manutenção corretiva', status: 'aberta', data: '2026-11-24' }
  ],
  '',
  { serviceType: 'Manutenção Corretiva', routeDate: '2026-11-25' }
);
assert.equal(serviceAudit.pmocMode, false, 'Uma rota corretiva não pode depender da competência PMOC.');
assert.equal(serviceAudit.serviceType, 'Manutenção Corretiva');
assert.equal(serviceAudit.routeDate, '2026-11-25');
assert.equal(serviceAudit.candidates.length, 2, 'Outros serviços devem listar todos os locais ativos com endereço sem selecionar automaticamente.');
assert.equal(serviceAudit.candidates[0].existingOpenCount, 1, 'OS corretivas em aberto devem ser exibidas como aviso, não ocultadas da seleção.');
assert.match(serviceAudit.candidates[0].warning, /OS deste tipo ainda em aberto/);
assert.equal(serviceAudit.candidates[0].status, 'disponivel');
assert.equal(serviceAudit.candidates[1].existingOpenCount, 0);
assert.ok(serviceAudit.candidates[1].warning.includes('sem loja vinculada'), 'Histórico antigo do cliente sem site deve ser informado sem atribuição presumida.');
assert.ok(serviceAudit.review.some(row => row.id === 'site-without-address'), 'Local sem endereço precisa de revisão.');
assert.equal(servicePlanner.buildCandidates([], [], [], '', { serviceType: 'Visita Técnica' }).pmocMode, false);

assert.match(html, /id="pmoc-route-type"/, 'A interface deve permitir escolher o tipo do atendimento.');
for (const type of [
  'Visita Técnica','PMOC Preventiva · Mensal','PMOC Preventiva · Trimestral',
  'Manutenção Preventiva','Manutenção Corretiva','Instalação / Start-Up',
  'Inspeção Técnica','Retorno Técnico','Atendimento Emergencial','Outro Atendimento'
]) assert.ok(html.includes(type), 'A interface deve oferecer o tipo: ' + type);
assert.match(html, /id="pmoc-route-subject"/, 'A rota deve registrar o assunto informado pelo cliente.');
assert.match(html, /id="pmoc-route-cause"/, 'A rota deve registrar a causa/relato do solicitante.');
assert.match(html, /id="pmoc-route-instructions"/, 'A rota deve aceitar informações complementares.');
assert.match(html, /id="pmoc-route-date"/, 'A rota deve pedir a data prevista.');
assert.match(html, /id="pmoc-route-start-time"/, 'A rota deve pedir o horário inicial.');
assert.match(html, /id="pmoc-route-duration"/, 'A rota deve definir a duração por parada.');
assert.match(html, /id="pmoc-route-technician"/, 'A rota deve permitir atribuir um técnico com vínculo RH.');
assert.match(html, /id="pmoc-route-priority"/, 'A rota deve permitir definir prioridade.');
assert.match(html, /equipamentosDisponiveisRotaPMOC/, 'A rota deve permitir vincular um equipamento do cliente/local.');
assert.match(html, /DBS_CONTROL_CREATE_SERVICE_ROUTE/, 'A nova programação deve usar uma mensagem de shell própria.');
assert.match(html, /scheduledAt,/, 'Cada OS deve receber horário sequencial.');
assert.match(html, /pmocCompetencia: pmocMode \? competence : null/, 'Somente o tipo PMOC deve carregar competência PMOC.');
assert.match(html, /function abrirProgramadorRotas\(/, 'A programação deve estar acessível a partir da agenda do dia.');
assert.match(html, /Causa ou relato informado/, 'A causa deve acompanhar o conteúdo da OS.');

assert.match(parentRoute, /msg\.type === "DBS_CONTROL_CREATE_SERVICE_ROUTE"/, 'O shell deve aceitar a nova programação de serviços.');
for (const serverType of [
  'pmoc preventiva · mensal','pmoc preventiva · trimestral','manutencao preventiva',
  'manutencao corretiva','visita tecnica','instalacao / start-up',
  'inspecao tecnica','retorno tecnico','atendimento emergencial','outro atendimento'
]) assert.ok(parentRoute.includes(serverType), 'O shell deve autorizar o tipo: ' + serverType);
assert.match(parentRoute, /dbs_control_sites/, 'O shell deve validar as lojas relacionais.');
assert.match(parentRoute, /dbs_control_clients/, 'O shell deve validar os clientes relacionais.');
assert.match(parentRoute, /dbs_control_equipment/, 'O shell deve validar os equipamentos selecionados.');
assert.match(parentRoute, /rh_employees/, 'O shell deve validar o vínculo RH do técnico.');
assert.match(parentRoute, /is_active !== true/, 'O shell deve impedir atribuição a técnico inativo.');
assert.match(parentRoute, /applyDbsControlDelta\(/, 'A emissão deve usar o fluxo relacional oficial.');
assert.match(parentRoute, /existingPmoc|Já existe uma OS PMOC/i, 'O fluxo deve verificar OS PMOC concorrentes antes de criar outra.');
assert.match(parentRoute, /SERVICE-ROUTE:/, 'As OS de outras categorias devem receber chave de idempotência própria da rota.');
assert.match(parentRoute, /PMOC-RETURN/, 'Os retornos PMOC devem preservar uma chave distinta da primeira visita.');
console.log('DBS CONTROL service route planner: tipos de serviço, causa da solicitação, agenda, equipamento/técnico, avisos de duplicidade e validação relacional aprovados.');

