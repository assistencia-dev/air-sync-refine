const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const indexRoute = fs.readFileSync("src/routes/index.tsx", "utf8");
const siteRoute = fs.readFileSync("src/routes/site.tsx", "utf8");
const loginRoute = fs.readFileSync("src/routes/login.tsx", "utf8");
const collaboratorNavigation = fs.readFileSync("src/lib/collaborator-navigation.ts", "utf8");
const authenticatedRoute = fs.readFileSync("src/routes/_authenticated/route.tsx", "utf8");
const folhaPontoRoute = fs.readFileSync("src/routes/_authenticated/folha-ponto.tsx", "utf8");
const rhFunctions = fs.readFileSync("src/lib/rh.functions.ts", "utf8");
const adminSurface = fs.readFileSync("src/routes/_authenticated/admin.tsx", "utf8");
const rhWorkspace = fs.readFileSync("src/components/HrWorkspace.tsx", "utf8");
const html = fs.readFileSync("public/dbs-control.html", "utf8");
const route = fs.readFileSync("src/routes/_authenticated/dbs-control.tsx", "utf8");
const ux = fs.readFileSync("public/dbs-control-ux.js", "utf8");
const pdf = fs.readFileSync("public/dbs-control-pdf.js", "utf8");
const observations = fs.readFileSync("public/dbs-control-observations.js", "utf8");
const theme = fs.readFileSync("public/dbs-control-theme.css", "utf8");

assert.match(indexRoute, /beforeLoad:\s*\(\)\s*=>\s*\{\s*throw redirect\(\{ to: ["']\/login["'] \}\);/, "A entrada padrão deve levar o usuário à tela de login, não deixar o app operacional escondido atrás da landing page.");
assert.match(siteRoute, /createFileRoute\(["']\/site["']\)/, "A landing page corporativa deve continuar disponível em /site.");
assert.match(siteRoute, /import \{ Index \} from ["']\.\/index["']/, "A rota /site deve reutilizar a landing page original, sem remover seu conteúdo.");
assert.match(loginRoute, /function resolveAuthenticatedRoleProfile\(authUserId: string\)/, "O login deve centralizar a resolução do perfil autenticado.");
assert.match(loginRoute, /const profile = await getMyProfile\(\)/, "Se a consulta normal de perfil falhar, o login deve tentar o resolvedor autenticado do servidor.");
assert.match(loginRoute, /if \(!profile\?\.role_key\) \{\s*setError\(profileAccessError\);\s*return;/, "Uma falha de perfil não pode encaminhar silenciosamente um administrador ao portal do cliente.");
assert.match(loginRoute, /if \(!profile\?\.role_key\) throw new Error\(profileAccessError\)/, "Após autenticar, o sistema deve explicar quando não conseguiu determinar as permissões.");
assert.match(loginRoute, /href=["']\/site["']/, "O retorno do login deve abrir a landing page preservada em /site, e não voltar para a raiz que redireciona ao login.");
assert.doesNotMatch(loginRoute, /<Link to=["']\/["']/, "O link de retorno do login não pode apontar para a raiz que agora redireciona para /login.");
assert.match(collaboratorNavigation, /Promise\.allSettled/, "O login do colaborador deve consultar Ponto e DBS CONTROL sem uma falha opcional derrubar a outra.");
assert.match(collaboratorNavigation, /if \(pontoEnabled\) return "\/folha-ponto"/, "Colaborador com Ponto deve entrar no shell compartilhado de jornada.");
assert.match(collaboratorNavigation, /if \(controlEnabled\) return "\/dbs-control"/, "Colaborador com somente DBS CONTROL deve entrar direto nas OS.");
assert.match(loginRoute, /resolveCollaboratorLanding/, "O login precisa respeitar o destino por permissão, sem cair no portal do cliente.");
assert.match(authenticatedRoute, /resolveCollaboratorLanding/, "O guard autenticado deve impedir o ciclo mobile portal/folha de ponto.");
assert.match(folhaPontoRoute, /collaborator-topbar/, "O portal do colaborador precisa de shell compacto próprio para mobile.");
assert.match(folhaPontoRoute, /aria-current="page"/, "A navegação mobile deve indicar a área ativa.");


let parsedInlineScripts = 0;
const scriptTag = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
for (const match of html.matchAll(scriptTag)) {
  const attrs = match[1] || "";
  const source = match[2] || "";
  if (/\bsrc\s*=/.test(attrs) || !source.trim()) continue;
  if (/\btype\s*=\s*["']?(?:application\/json|importmap)/i.test(attrs)) continue;
  if (/\btype\s*=\s*["']?module/i.test(attrs)) continue;
  parsedInlineScripts += 1;
  try {
    new vm.Script(source, { filename: "public/dbs-control.html:inline-script-" + parsedInlineScripts });
  } catch (error) {
    console.error("Falha de sintaxe no script inline #" + parsedInlineScripts + ": " + (error.stack || error.message));
    process.exitCode = 1;
  }
}
assert.ok(parsedInlineScripts > 0, "Nenhum script inline foi validado.");

const firstPartyScripts = [
  "public/dbs-control-ux.js",
  "public/dbs-control-import.js",
  "public/dbs-control-orcamentos-v2.js",
  "public/dbs-control-orcamentos-flex.js",
  "public/dbs-control-orcamentos-pdf.js",
  "public/dbs-control-pdf.js",
  "public/dbs-control-observations.js",
];
for (const file of firstPartyScripts) {
  const source = fs.readFileSync(file, "utf8");
  try {
    new vm.Script(source, { filename: file });
    parsedInlineScripts += 1;
  } catch (error) {
    console.error("Falha de sintaxe em " + file + ": " + (error.stack || error.message));
    process.exitCode = 1;
  }
}

const tabIds = new Set([...html.matchAll(/\bid=["'](tab-[^"']+)["']/g)].map((m) => m[1]));
const referencedTabs = new Set();
for (const source of [html, ux]) {
  for (const match of source.matchAll(/switchTab\(\s*['"]([^'"]+)['"]/g)) {
    if (match[1].startsWith("tab-")) referencedTabs.add(match[1]);
  }
}
const missingTabs = [...referencedTabs].filter((id) => !tabIds.has(id));
assert.deepEqual(missingTabs, [], "Há ações de navegação para abas inexistentes: " + missingTabs.join(", "));

const cloudFunctions = fs.readFileSync("src/lib/dbs-control.functions.ts", "utf8");
const fieldControl = fs.readFileSync("src/lib/fieldcontrol.functions.ts", "utf8");
const atomicSnapshotMigration = fs.readFileSync("supabase/migrations/20261016120000_dbs_control_snapshot_atomic_save.sql", "utf8");
const protocolReconciliationMigration = fs.readFileSync("supabase/migrations/20261017222141_dbs_control_snapshot_reconcile_by_protocol.sql", "utf8");
const deltaMigration = fs.readFileSync("supabase/migrations/20261026130000_dbs_control_delta_outbox.sql", "utf8");
const legacyBackfillMigration = fs.readFileSync("supabase/migrations/20261026150000_dbs_control_legacy_relational_backfill.sql", "utf8");
const legacyHistoryRepairMigration = fs.readFileSync("supabase/migrations/20261026153000_dbs_control_legacy_history_repair.sql", "utf8");
const deletedAtMigration = fs.readFileSync("supabase/migrations/20261026160000_dbs_control_deleted_at_backfill.sql", "utf8");
const protocolMigration = fs.readFileSync("supabase/migrations/20261026190000_dbs_control_autogenerate_protocol.sql", "utf8");
const protocolLookupFixMigration = fs.readFileSync("supabase/migrations/20261026191000_dbs_control_delta_empty_protocol_fix.sql", "utf8");
const timestampMigration = fs.readFileSync("supabase/migrations/20261026192000_dbs_control_normalize_empty_timestamps.sql", "utf8");
const collaboratorIndependentAccessMigration = fs.readFileSync("supabase/migrations/20261026160010_dbs_control_collaborator_independent_access.sql", "utf8");
const collaboratorPrivateScopeMigration = fs.readFileSync("supabase/migrations/20261026160020_dbs_control_private_employee_scope.sql", "utf8");
assert.match(cloudFunctions, /export const applyDbsControlDelta/, "A gravação do DBS CONTROL deve usar a API de deltas relacionais.");
assert.doesNotMatch(cloudFunctions, /rpc\("dbs_control_save_snapshot_safe_v2"/, "Nenhum autosave novo pode chamar o RPC de snapshot completo.");
assert.match(atomicSnapshotMigration, /for update/i, "A gravação atômica deve bloquear o snapshot do escopo durante a transação.");
assert.match(atomicSnapshotMigration, /pg_advisory_xact_lock\(hashtextextended\(v_scope_key, 0\)\)/i, "A primeira gravação também deve ser serializada quando ainda não existe snapshot.");
assert.match(atomicSnapshotMigration, /not \(v_key = any\(v_seen_keys\)\)/, "A migração deve preservar OS ausentes de autosaves atrasados.");
assert.match(atomicSnapshotMigration, /grant execute on function public\.dbs_control_save_snapshot_safe\(jsonb\) to service_role/i, "O RPC de snapshot deve ser restrito ao service_role.");
assert.match(cloudFunctions, /function fetchAllDbsControlWorkOrders\s*\(/, "A hidratação precisa buscar todas as OS, não apenas o limite padrão do Supabase.");
assert.match(cloudFunctions, /const merged: Record<string, unknown> = \{ \.\.\.current \};[\s\S]*?for \(const \[key, value\] of Object\.entries\(canonical\)\)/, "Campos canônicos preenchidos no banco devem prevalecer sobre snapshots legados.");
assert.match(cloudFunctions, /preserveCompletedWorkOrderStatus: true/, "A hidratação das OS deve proteger uma conclusão já registrada no snapshot contra status canônico desatualizado.");
assert.match(cloudFunctions, /isCompleted\(item\?\.status\) && !isCompleted\(canonical\?\.status\)/, "Um status canônico antigo não pode reabrir uma OS concluída no snapshot.");
assert.match(cloudFunctions, /status: canonicalCompleted \? "Concluída" : \(snapshotCompleted \? merged\.status : canonical\.status\)/, "Um completed_at antigo ou inconsistente não pode rebaixar o status concluído do snapshot.");
assert.match(cloudFunctions, /\.limit\(pageSize\)[\s\S]*?\.gt\("id", cursor\)/, "A consulta de OS deve usar paginação por cursor para a base completa.");
assert.match(cloudFunctions, /fetchAllDbsControlWorkOrders\(\s*(?:\{\s*\}|\n)/, "A hidratação e a auditoria devem usar a consulta paginada.");
assert.match(fieldControl, /async function preserveUserScopedSnapshotsBeforeCompanyLink\(userId: string, companyId: string\)/, "Vincular o administrador a uma empresa deve verificar snapshots pessoais preexistentes.");
assert.match(fieldControl, /if \(userDbs\.data && companyDbs\.data\)/, "O vínculo deve pausar quando os escopos pessoal e empresarial já têm snapshots DBS divergentes.");
assert.match(fieldControl, /if \(userTreasury\.data && companyTreasury\.data\)/, "O vínculo deve pausar quando os dois escopos financeiros já têm snapshots.");
assert.doesNotMatch(fieldControl, /from\("dbs_control_snapshots"\)\.insert\(/, "O vínculo não pode criar um novo snapshot DBS completo.");
assert.match(fieldControl, /Existe um retrato legado do DBS CONTROL no escopo pessoal/, "Um snapshot DBS legado deve bloquear o vínculo até a reconciliação relacional, sem perder a origem.");
assert.doesNotMatch(fieldControl, /from\("treasury_snapshots"\)\.insert\(/, "O vínculo não pode criar novos snapshots financeiros legados.");
assert.match(fieldControl, /await preserveUserScopedSnapshotsBeforeCompanyLink\(String\(data\.id\), String\(companyId\)\)/, "A preservação deve acontecer antes de atualizar company_id do administrador.");
assert.match(route, /const reconciledInitialState = employeeModeRef\.current[\s\S]*?mergeDbsControlStates\(cloudState, localState\)/, "Quando existe snapshot compartilhado, a administração deve reconciliar a nuvem e a cópia local por identidade antes de hidratar o módulo.");
assert.match(route, /if \(!cloudState && !employeeModeRef\.current\) \{[\s\S]*?tecnicos: \[\], clientes: \[\], equipamentos: \[\], pecas: \[\],[\s\S]*?osHistorico: \[\],[\s\S]*?type: "DBS_CONTROL_CLOUD_STATE", state: initialState, allowEmptyBaseBootstrap: true/, "Quando não há snapshot nem registros canônicos no escopo, a administração pode iniciar a base compartilhada vazia sem usar o cache antigo como fonte.");
assert.match(html, /const allowEmptyBaseBootstrap = msg\.allowEmptyBaseBootstrap === true[\s\S]*?event\.source === window\.parent[\s\S]*?event\.origin === window\.location\.origin/, "O bootstrap vazio deve exigir a mensagem da janela pai e mesma origem.");
assert.match(html, /if \(!allowEmptyBaseBootstrap && !collaboratorSession && localRecoveryCount > 0 && incomingCloudCount < localRecoveryCount\)/, "O cache continua protegido, exceto na inicialização vazia expressamente autorizada.");
assert.match(route, /A recuperação local é explicitamente somente leitura e nunca é enviada à nuvem/, "Cache local com dados deve continuar bloqueado em recuperação em vez de ser sobrescrito.");
assert.match(route, /function dbsControlStateIsSmallerThan\(/, "A inicialização deve detectar quando a nuvem tem menos registros que a cópia local.");
assert.match(route, /if \(!employeeModeRef\.current && localHasData && dbsControlStateIsSmallerThan\(localState, cloudState\)\)/, "A inicialização deve detectar uma redução administrativa sem comparar o recorte filtrado do colaborador.");
assert.match(route, /const reconciledLatestState = employeeModeRef\.current[\s\S]*?mergeDbsControlStates\(latestCloudState, localRecoveryStateRef\.current\)/, "O Realtime deve reconciliar reduções do snapshot administrativo sem misturar o recorte filtrado do colaborador.");
assert.match(route, /if \(!employeeModeRef\.current && dbsControlStateIsSmallerThan\(localRecoveryStateRef\.current, latestCloudState\)\)/, "A redução do snapshot deve ser registrada para diagnóstico sem bloquear o salvamento administrativo.");
assert.match(route, /pendingChangesRef/, "A fila de salvamento deve transportar somente alterações por registro.");
assert.match(route, /scope: \"dbs-control-sync\"/, "Falhas, retries e reconciliações precisam gerar logs estruturados sem payload operacional.");
assert.match(route, /realtime_status/, "O estado do canal Realtime precisa ser observável no navegador.");
assert.match(route, /applyDbsControlDelta/, "A rota deve persistir deltas no contrato relacional.");
assert.match(route, /isCompleted\(localRecord\.status\) && !isCompleted\(cloudRecord\.status\)/, "Uma resposta de nuvem atrasada não pode reabrir uma OS concluída localmente.");
assert.match(route, /"concluidoPorEmployeeId"[\s\S]*?"fotoDepois"/, "A reconciliação deve preservar os campos de execução já preenchidos na OS concluída.");
assert.match(route, /if \(hasValue\(value\) \|\| !hasValue\(combined\[field\]\)\) combined\[field\] = value/, "Dados locais só podem preencher campos vazios da nuvem.");
assert.match(html, /DBS_AIR_ERP_STATE_PRE_CLOUD_HYDRATION/, "O estado local precisa ser copiado antes da hidratação da nuvem.");
assert.match(html, /!collaboratorSession && localRecoveryCount > 0 && incomingCloudCount < localRecoveryCount/, "O modo colaborador deve permitir a hidratação de uma base filtrada.");
assert.match(html, /Não substitui um backup maior por um estado local menor/, "Um backup local mais completo não deve ser sobrescrito por um estado menor.");
assert.match(html, /function verificarRecuperacaoLocalDBS\s*\(/, "A central de cadastros deve expor recuperação de cópias locais.");
assert.match(html, /DBS_AIR_ERP_STATE_PREVIOUS/, "O fluxo de recuperação deve procurar o backup local anterior.");
assert.match(html, /function mesclarEstadoRecuperacaoDBS\s*\(/, "A recuperação deve mesclar sem remover registros.");
assert.match(html, /atualizarSelects\(\)/, "A troca de aba deve atualizar seletores dos formulários.");
assert.match(html, /safe\(window\.renderizarOrcamentos\)/, "A aba Orçamentos precisa de renderização própria.");
assert.match(fs.readFileSync("public/dbs-control-orcamentos-v2.js", "utf8"), /window\.renderizarOrcamentos/, "O módulo de orçamentos deve expor seu renderizador.");
assert.match(html, /function switchTab\s*\(/, "A navegação principal switchTab precisa existir.");
assert.match(html, /function renderizarAbaAtiva\s*\(/, "O renderizador sob demanda precisa existir.");
assert.match(html, /employeeTab[\s\S]*?tab-dashboard[\s\S]*?tab-pwa[\s\S]*?tab-nova-os/, "O modo colaborador deve permitir apenas dashboard, Minhas OS e emissão autorizada.");
assert.match(html, /data-employee-visible=["']true["']/, "A área do colaborador precisa ter item de navegação explícito.");
assert.match(route, /msg\.type === ["']DBS_CONTROL_SAVE["']/, "A rota deve receber eventos de salvamento do iframe.");
assert.match(route, /msg\.type === ["']DBS_CONTROL_READY["']/, "A rota deve sincronizar o estado inicial do iframe.");
assert.match(route, /const persist = async \(\) => \{[\s\S]*?applyDbsControlDelta/, "O salvamento na nuvem precisa ser processado por deltas.");
assert.match(route, /saveQueueRef = useRef<Promise<void>>\(Promise\.resolve\(\)\)/, "Os salvamentos em um mesmo dispositivo devem ser serializados para evitar gravações fora de ordem.");
assert.match(route, /saveQueueRef\.current = saveQueueRef\.current\.then\(persist, persist\)/, "Cada gravação deve aguardar a anterior mesmo quando a anterior falhar.");
assert.match(route, /v=202610\d+-[a-z-]+-\d+/, "A tela do DBS Control deve usar uma versão de URL nova para evitar HTML antigo em cache no celular.");
assert.match(html, /dbs-employee-issue-cta/, "O colaborador autorizado precisa ter uma ação de emissão visível mesmo com o menu lateral recolhido.");
assert.match(html, /dbs-employee-menu-final-20261026/, "O colaborador precisa de um menu único e preenchido, sem uma segunda navegação no cabeçalho.");
assert.match(html, /data-employee-visible=["']true["']/, "O menu do colaborador precisa conter Dashboard e Minhas OS.");
assert.match(html, /data-employee-issue-visible=["']true["']/, "O menu do colaborador precisa conter Emitir OS quando autorizado.");
assert.doesNotMatch(html, /id=["']dbs-employee-context-nav["']/, "A navegação não deve ficar duplicada em um cabeçalho separado.");
assert.doesNotMatch(html, /employee-issue-inline/, "A emissão de OS não deve ser duplicada dentro da tela Minhas OS.");
const employeeDashboardSource = html.slice(html.indexOf("function renderizarEmployeeDashboard"), html.indexOf("function renderizarAbaAtiva"));
assert.doesNotMatch(employeeDashboardSource, /＋ Emitir OS/, "O dashboard não deve duplicar a ação Emitir OS do cabeçalho.");
assert.match(html, /canIssueOs = params\.get\('can_issue_os'\) === '1'[\s\S]*?dbs-employee-issue-cta/, "A ação de emissão deve respeitar a flag de autorização recebida do servidor.");
assert.match(rhFunctions, /let baseActive = false[\s\S]*?baseActive = baseStatus === "ativo"/, "A autorização do colaborador deve validar o estado da base, não o texto do nome.");
assert.match(rhFunctions, /can_issue_work_orders: Boolean\(resolvedEmployee\.dbs_control_can_issue_work_orders && baseActive\)/, "A permissão de emitir OS deve chegar ao portal quando a base vinculada estiver ativa.");
assert.doesNotMatch(rhFunctions, /can_issue_work_orders:[^\n]*baseName !== null/, "O nome da base não pode bloquear uma permissão já autorizada.");
assert.match(route, /base_active=\$\{access\.data\.employee\?\.base_active \? "1" : "0"\}/, "O shell deve transportar o estado da base sem depender do nome exibido.");
assert.match(html, /dbs-employee-clean-nav-20261027/, "O painel do colaborador deve carregar o refinamento visual sem depender de cache antigo.");
assert.match(html, /<span>Meu painel<\/span>/, "O colaborador deve ver um único ponto de entrada chamado Meu painel.");
assert.doesNotMatch(html, /<span>Dashboard Principal<\/span>/, "O rótulo antigo Dashboard Principal não deve duplicar a experiência do colaborador.");
assert.doesNotMatch(adminSurface, /<p className="text-sm font-bold text-slate-900">Módulo RH<\/p>/, "O admin não deve criar um segundo cabeçalho em cima do centro RH.");
assert.doesNotMatch(rhWorkspace, /Acesso rápido[\s\S]*Cadastrar funcionário[\s\S]*Tratar solicitações/, "O RH não deve repetir o mesmo bloco de ações rápidas duas vezes.");
assert.match(html, /function renderizarEmployeeDashboard\(\)/, "O colaborador precisa de um dashboard próprio de progresso.");
assert.match(html, /await saveStateAndConfirmCloud\(\)/, "A criação da OS do colaborador deve aguardar ACK relacional antes de sair do formulário.");
assert.match(html, /ERP_STATE\.ordens = ERP_STATE\.ordens\.filter\(order => order !== novaOS/, "Falha na criação deve remover somente o draft local não confirmado.");
assert.match(html, /const beforeCompletion = JSON\.parse\(JSON\.stringify\(os\)\)/, "A conclusão deve guardar o estado anterior para rollback seguro.");
assert.match(html, /ERP_STATE\.ordens\[currentIndex\] = beforeCompletion/, "Uma conclusão sem ACK deve restaurar a OS anterior.");
assert.match(html, /mergeCollaboratorCloudState\(msg\.state\)/, "Leitura atrasada não pode reabrir visualmente uma OS concluída.");

assert.match(html, /switchTab\('tab-dashboard', dashboardNav \|\| undefined\)/, "O login do colaborador deve abrir automaticamente o dashboard de progresso.");
assert.match(route, /className="flex min-h-\[100dvh\] flex-col overflow-hidden/, "O shell autenticado do DBS CONTROL deve reservar a altura do celular sem cortar o iframe quando o aviso de sincronização aparece.");
assert.match(route, /className="min-h-0 w-full flex-1 border-0"/, "O iframe do DBS CONTROL deve ocupar o espaço restante em telas móveis.");
assert.match(html, /const collaboratorSession = new URLSearchParams\(window\.location\.search\)\.get\('mode'\) === 'employee';[\s\S]*?if \(collaboratorSession && \(!DBS_CONTROL_CLOUD_READY/, "O modo colaborador deve aguardar a hidratação filtrada antes de renderizar OS do cache local.");
assert.match(html, /Release the filtered view before rendering/, "A hidratação filtrada deve liberar o portal do colaborador antes da renderização da mesma mensagem.");
const styles = fs.readFileSync("src/styles.css", "utf8");
assert.match(styles, /body:has\(input\[autocomplete=\"username\"\]\)[\s\S]*?\.grid-cols-1\.lg\\:grid-cols-2 > div:first-child \{\s*display: none !important;/, "O login mobile não deve deixar um painel de apresentação vazio acima do formulário.");
assert.match(loginRoute, /autoCapitalize=\"none\"[\s\S]*?autoCorrect=\"off\"[\s\S]*?enterKeyHint=\"next\"/, "O campo de identificação deve respeitar teclado e preenchimento do celular.");
assert.match(loginRoute, /role=\"alert\" aria-live=\"polite\"/, "Falhas de login precisam ser anunciadas de forma acessível no celular.");
assert.match(ux, /DOMContentLoaded/, "A camada UX precisa ter inicialização compatível com carregamento tardio.");
assert.match(html, /dbs-control-theme\.css/, "O tema visual do DBS Control precisa estar carregado.");
assert.doesNotMatch(ux, /quick-flow\{display:none!important\}/, "O guia de fluxo do dashboard não deve ser ocultado.");
assert.doesNotMatch(ux, /table th:nth-child\((?:7|9)\).*display:none/i, "Colunas do dashboard não devem ser removidas da visualização.");
assert.match(ux, /overflow-x:auto!important/, "Tabelas amplas devem usar rolagem horizontal em telas estreitas.");
assert.match(theme, /employee-observation-field/, "O tema deve contemplar a área de observações do colaborador.");
assert.match(html, /employee-observation-field/, "A execução deve oferecer campo complementar separado para observações técnicas.");
assert.match(html, /Novas notas serão anexadas ao histórico/, "O técnico deve ser informado de que as notas anteriores serão preservadas.");
assert.match(cloudFunctions, /mergeAppendOnlyCollaboratorObservations\(/, "A gravação do colaborador deve mesclar observações sem substituir o histórico.");
assert.match(deltaMigration, /DBS_OS_COMPLETED_LOCKED/, "OS concluída deve preservar campos assinados contra autosaves antigos.");
assert.match(deltaMigration, /v_expected is null or v_expected <> v_current\.version/, "A RPC deve rejeitar gravações sem a versão esperada ou com versão antiga.");
assert.match(deltaMigration, /dbs_control_apply_work_order_parts_in_tx/, "Peças e estoque devem ser aplicados no caminho relacional transacional.");
assert.match(deltaMigration, /DBS_OS_STOCK_INSUFFICIENT/, "Estoque insuficiente deve rejeitar a intenção sem desconto parcial.");
assert.match(legacyBackfillMigration, /dbs_control_legacy_id_map/, "A recuperação legada deve manter um mapa estável entre IDs antigos e chaves UUID relacionais.");
assert.doesNotMatch(legacyBackfillMigration, /state->'ordens'\) else .*osHistorico/s, "Eventos históricos não podem ser materializados como novas OS.");
assert.match(legacyHistoryRepairMigration, /event_type,\s*details,\s*idempotency_key/, "O histórico legado deve ser preservado como evento relacional idempotente.");
assert.match(deletedAtMigration, /add column if not exists deleted_at timestamptz/i, "Exclusões antigas devem permanecer auditáveis sem apagar a OS relacional.");
assert.match(cloudFunctions, /buildDbsControlWorkOrderPatch/, "O servidor deve converter registros de UI em patches canônicos.");
assert.match(cloudFunctions, /dbs_control_apply_work_order_delta/, "A alteração da OS deve passar pelo RPC transacional com versão esperada.");
assert.match(cloudFunctions, /event_type: "work_order_delta"/, "Cada lote de OS deve carregar um tipo de evento auditável.");
assert.match(cloudFunctions, /const orderLabel = protocol \|\|/, "Uma OS nova deve usar um rótulo transitório sem exigir protocolo no formulário.");
assert.doesNotMatch(cloudFunctions, /Não é possível sincronizar OS sem protocolo/, "O sincronizador não pode bloquear uma OS nova sem protocolo.");
assert.match(protocolMigration, /dbs_control_work_order_protocol_seq/, "A migração deve criar o gerador canônico de protocolos de OS.");
assert.match(protocolMigration, /'DBS-' \|\| to_char\(clock_timestamp\(\), 'YYYY'\)/, "O protocolo automático deve ser legível e gerado no banco.");
assert.match(protocolMigration, /v_current_found boolean/, "A migração deve separar explicitamente consulta encontrada de FOUND residual.");
assert.match(protocolLookupFixMigration, /v_current_found := found/, "A correção de protocolo vazio deve proteger o caminho de criação contra falso conflito.");
assert.match(cloudFunctions, /normalizeOptionalTimestamp/, "Campos de data opcionais devem ser normalizados antes do RPC relacional.");
assert.match(cloudFunctions, /scheduled_at: normalizeOptionalTimestamp/, "A data de agendamento vazia deve virar NULL, nunca string vazia.");
assert.match(cloudFunctions, /sla_deadline: normalizeOptionalTimestamp/, "O SLA vazio deve virar NULL, nunca string vazia.");
assert.match(timestampMigration, /dbs_control_normalize_work_order_timestamps/, "A RPC deve normalizar timestamps opcionais no servidor.");
assert.match(timestampMigration, /v_raw := nullif\(btrim\(v_patch->>v_key\), ''\)/, "A migração deve converter timestamps vazios em NULL.");
assert.match(timestampMigration, /exception when others then/, "Timestamp inválido não pode bloquear a sincronização da OS.");
assert.match(pdf, /function observationBox\(value\)/, "O PDF deve renderizar observações em uma caixa dedicada.");
assert.match(pdf, /const includeValues = !employeeMode && options\.includeValues === true/, "O colaborador nunca deve receber valores financeiros no PDF.");
assert.match(pdf, /if \(includeValues && total != null && total !== 0\)/, "Os totais financeiros precisam respeitar a permissão do modelo de PDF.");
assert.match(observations, /Nenhuma observação registrada\./, "O detalhe administrativo deve exibir um estado vazio explícito.");

const appendHelper = cloudFunctions.match(/function mergeAppendOnlyCollaboratorObservations\(currentOrder: any, incomingOrder: any\) \{[\s\S]*?\n\}\n(?=\nfunction normalizeDbsStatus)/)?.[0];
assert.ok(appendHelper, "A função isolada de merge append-only deve existir.");
const helperForTest = appendHelper
  .replace("currentOrder: any", "currentOrder")
  .replace("incomingOrder: any", "incomingOrder")
  .replace("const merged: Record<string, string> = {};", "const merged = {};") +
  "\nglobalThis.mergeAppendOnlyCollaboratorObservations = mergeAppendOnlyCollaboratorObservations;";
const observationTestContext = vm.createContext({});
vm.runInContext(helperForTest, observationTestContext);
const oldNote = "Nota antiga que deve permanecer.";
const newEntry = "[11/10/2026 13:30 · Técnico] Nota nova.";
const appended = observationTestContext.mergeAppendOnlyCollaboratorObservations(
  { observacao: oldNote },
  { observacao: oldNote + "\n\n" + newEntry },
);
assert.equal(appended.observacao, oldNote + "\n\n" + newEntry, "Uma nota nova deve ser anexada sem substituir o histórico.");
const rejectedOverwrite = observationTestContext.mergeAppendOnlyCollaboratorObservations(
  { observacao: oldNote },
  { observacao: "Tentativa de substituir o histórico." },
);
assert.equal(JSON.stringify(rejectedOverwrite), "{}", "Uma substituição do histórico deve ser ignorada.");
const concurrent = observationTestContext.mergeAppendOnlyCollaboratorObservations(
  { observacao: oldNote + "\n\n[11/10/2026 13:29 · Outro técnico] Nota concorrente." },
  { observacao: oldNote + "\n\n" + newEntry },
);
assert.match(concurrent.observacao, /Nota concorrente\./, "O merge concorrente deve manter a nota já salva no servidor.");
assert.match(concurrent.observacao, /Nota nova\./, "O merge concorrente deve anexar a nova nota do colaborador.");

if (process.exitCode) {
  console.error("DBS CONTROL: smoke checks falharam.");
} else {
  console.log("DBS CONTROL: smoke checks aprovados.");
  console.log("Scripts inline com sintaxe válida: " + parsedInlineScripts);
  console.log("Referências estáticas de navegação verificadas: " + referencedTabs.size);
  console.log("Fluxo de sincronização, renderização e isolamento do colaborador presentes.");
}

assert.match(html, /id=["']ops-overview-grid["']/, "O painel precisa apresentar a fila operacional.");
assert.match(html, /function renderizarResumoOperacional\s*\(/, "Os indicadores operacionais devem ser calculados a partir do estado real.");
assert.match(html, /Sem técnico vinculado/, "O painel deve identificar OS abertas sem técnico.");
assert.match(html, /Vínculos a conferir/, "O painel deve sinalizar referências cadastrais não resolvidas.");
assert.match(html, /safe\(renderizarResumoOperacional\)/, "A fila operacional deve atualizar ao abrir o dashboard.");
assert.match(html, /id=["']os-filter-classificacao["']/, "A gestão de OS deve permitir filtrar por classificação operacional.");
assert.match(html, /id=["']os-filter-cliente["']/, "A gestão de OS deve permitir filtrar por cliente.");
assert.match(html, /id=["']os-filter-tecnico["']/, "A gestão de OS deve permitir filtrar por técnico.");
assert.match(html, /id=["']os-filter-prioridade["']/, "A gestão de OS deve permitir filtrar por prioridade.");
assert.match(html, /id=["']os-filter-summary["']/, "A gestão de OS deve informar quantos registros estão visíveis após os filtros.");
assert.match(html, /function classificacoesOS\s*\(/, "A classificação deve ser calculada a partir dos campos já registrados na OS.");
assert.match(html, /PENDENCIA_EXECUCAO/, "A classificação deve sinalizar pendência de execução.");
assert.match(html, /function popularFiltrosOS\s*\(/, "Os filtros de cliente e técnico devem acompanhar os cadastros carregados.");
assert.match(html, /data-classifications=/, "Cada linha de OS deve carregar suas classificações para filtragem sem nova consulta.");
assert.match(html, /function agendarFiltrosOS\s*\(/, "A busca textual de OS deve ser levemente desduplicada para evitar re-render a cada tecla.");


const quoteBuilder = fs.readFileSync("public/dbs-control-orcamentos-flex.js", "utf8");
const quotePdf = fs.readFileSync("public/dbs-control-orcamentos-pdf.js", "utf8");
assert.match(html, /dbs-control-orcamentos-flex\.js\?v=/, "O montador flexível de propostas deve estar carregado com versão de cache.");
assert.match(html, /dbs-control-orcamentos-pdf\.js\?v=20261014-pdf-standard-1/, "O renderer comercial padronizado deve estar carregado antes do módulo flexível.");
assert.match(html, /dbs-control-orcamentos-flex\.js\?v=20261026-quote-ack-1/, "O módulo comercial precisa invalidar o cache após conectar o novo renderer.");
assert.match(quoteBuilder, /function readItems\(/, "A proposta deve suportar uma lista de itens.");
assert.match(quoteBuilder, /function pdf\(/, "A proposta deve oferecer exportação PDF.");
assert.match(quoteBuilder, /ERP_STATE\.orcamentos\.push\(q\)/, "A proposta nova deve ser salva no estado compartilhado.");
assert.match(quoteBuilder, /Validade e condições|VALIDADE E CONDIÇÕES/, "O PDF deve exibir validade e condições comerciais.");
assert.match(quoteBuilder, /(?:function catalog\s*\(|(?:var|let|const)\s+catalog\s*=\s*function\s*\()/, "A proposta deve consultar o catálogo já cadastrado.");
assert.match(quoteBuilder, /x\.venda/, "O seletor deve usar o preço de venda do cadastro de estoque existente.");
assert.match(quoteBuilder, /oq-quick-product/, "A proposta deve oferecer cadastro rápido de produto.");
assert.match(quoteBuilder, /ERP_STATE\.pecas\.push\(product\)/, "O cadastro rápido deve incluir o produto no cadastro compartilhado de peças.");
assert.match(quoteBuilder, /logo-dbs-air\.jpg/, "O cabeçalho da proposta e o PDF devem usar a logo oficial DBS Air.");

assert.match(quoteBuilder, /DBS AIR REFRIGERACAO LTDA - ME/, "O PDF deve conter a razão social oficial do emissor.");
assert.match(quoteBuilder, /13\.352\.707\/0001-09/, "O PDF deve conter o CNPJ oficial do emissor.");
assert.match(quoteBuilder, /assistencia@dbsair\.com\.br/, "O PDF deve conter o e-mail comercial.");
assert.match(quoteBuilder, /99825-6991/, "O PDF deve conter telefone/WhatsApp comercial.");
assert.match(quoteBuilder, /oq-unit/, "Cada item deve permitir unidade de medida.");
assert.match(quoteBuilder, /subtotalProdutos/, "O orçamento deve discriminar subtotal de produtos.");
assert.match(quoteBuilder, /subtotalServicos/, "O orçamento deve discriminar subtotal de serviços.");
assert.match(quoteBuilder, /function openAcceptance\(/, "A proposta deve permitir aceite web.");
assert.match(quoteBuilder, /oq-accept-approve/, "O aceite web deve oferecer aprovação.");
assert.match(quoteBuilder, /oq-accept-reject/, "O aceite web deve oferecer recusa.");
assert.match(quoteBuilder, /oq-search/, "O menu de orçamentos deve permitir busca por proposta, cliente ou serviço.");
assert.match(quoteBuilder, /oq-accept-status/, "O modal de aceite deve informar o estado da gravação.");
assert.match(quoteBuilder, /saveStateAndConfirmCloud/, "O aceite web deve aguardar a confirmação da nuvem.");
assert.match(quoteBuilder, /acceptanceInFlight/, "O aceite web deve bloquear duplo envio durante a gravação.");
assert.match(quoteBuilder, /signatureCanvas\.toDataURL/, "A assinatura desenhada deve ser registrada na proposta.");

assert.match(quoteBuilder, /function unitsCompatible\(/, "O orçamento deve validar compatibilidade dimensional.");
assert.match(quoteBuilder, /function convertedLine\(/, "O orçamento deve converter unidades antes de calcular.");
assert.match(quoteBuilder, /UNIT_DIM.*mass/s, "O conversor deve reconhecer dimensões físicas.");
assert.match(quoteBuilder, /unidadePreco/, "Cada item deve registrar a unidade usada como base do preço.");
assert.match(quoteBuilder, /invalidUnits/, "A proposta deve bloquear unidades incompatíveis.");
assert.match(quoteBuilder, /function quoteSnapshot\(/, "O aceite deve congelar os dados comerciais aceitos.");
assert.match(quoteBuilder, /hashConteudo/, "O aceite deve registrar uma impressão digital do conteúdo.");
assert.match(quoteBuilder, /historico:/, "O aceite deve preservar histórico de decisões.");
assert.match(quoteBuilder, /if\(compatible\) subtotal \+= line/, "Linhas incompatíveis não podem contaminar o subtotal com NaN.");
assert.doesNotMatch(quoteBuilder, /subtotal \+= line; row\.querySelector\("\.oq-line-total"\)\.textContent = money\(line\)/, "O total inválido não pode sobrescrever o aviso de unidade incompatível.");
assert.match(quoteBuilder, /"M³":1000/, "Um metro cúbico deve equivaler a 1.000 litros na base de conversão.");
assert.match(quoteBuilder, /"ML":"volume","L":"volume","GAL":"volume"/, "Mililitros, litros, galões e metros cúbicos devem compartilhar dimensão de volume.");
assert.match(quoteBuilder, /var lineTotal = Number\.isFinite\(Number\(it\.total\)\)/, "O PDF deve usar o total já convertido salvo no item.");
assert.match(quoteBuilder, /String\(it\.unidadePreco \|\| it\.unidade \|\| "UN"\)/, "O PDF deve mostrar a unidade-base do preço.");
assert.match(quoteBuilder, /window\.DbsControlQuotePdf\.generate/, "A exportação deve delegar ao renderer comercial padronizado.");
assert.match(quoteBuilder, /aceiteWeb && quoteToExport\.aceiteWeb\.snapshot/, "Uma proposta aceita deve exportar o snapshot imutável aprovado.");
assert.match(quoteBuilder, /acceptedSnapshot\.itens/, "As linhas do PDF aceito devem vir do snapshot, não de alterações posteriores.");
assert.match(quotePdf, /function drawHeader\(firstPage\)/, "O orçamento deve usar cabeçalho próprio e repetido em cada página.");
assert.match(quotePdf, /function drawIssuer\(\)/, "O PDF deve preservar razão social, CNPJ e canais oficiais do emissor.");
assert.match(quotePdf, /subtotalProducts[\s\S]*?subtotalServices[\s\S]*?TOTAL DA PROPOSTA/, "O resumo comercial deve manter produtos, serviços e total da proposta.");
assert.match(quotePdf, /Página " \+ page \+ " de " \+ totalPages/, "O orçamento deve mostrar paginação completa.");
assert.match(quotePdf, /doc\.line\(margin, 285, pageWidth - margin, 285\)/, "O rodapé comercial deve alinhar com o padrão da OS.");
assert.match(quotePdf, /Hash do conteúdo aceito/, "O PDF deve identificar o hash do conteúdo congelado no aceite web.");
assert.match(quotePdf, /doc\.rect\(totalBoxX, y - 3\.8, contentWidth, 11, "F"\)/, "O total deve ter uma faixa larga sem sobrepor o rótulo ao valor.");
assert.doesNotMatch(quotePdf, /ERP_STATE|localStorage|saveState/, "O renderer de PDF não deve ler nem gravar o estado comercial.");
assert.match(route, /v=202610\d+-[a-z-]+-\d+/, "A rota autenticada deve invalidar o cache dos documentos no mobile e no desktop.");
assert.match(collaboratorIndependentAccessMigration, /create or replace function public\.dbs_my_employee_ids/, "O vínculo DBS do colaborador deve ser independente da Folha de Ponto.");
assert.doesNotMatch(collaboratorIndependentAccessMigration, /where e\.ponto_portal_user_id = public\.current_app_user_id\(\)[\s\S]*?and e\.ponto_access_enabled = true/, "A política DBS não pode exigir a flag da Folha de Ponto.");
assert.match(collaboratorIndependentAccessMigration, /dbs_control_can_issue_work_orders = true/, "A leitura de clientes para emissão deve continuar limitada à permissão explícita.");
assert.match(collaboratorPrivateScopeMigration, /create or replace function private\.dbs_my_employee_ids/, "O helper RLS do colaborador deve ficar fora do schema exposto pela API.");
assert.match(collaboratorPrivateScopeMigration, /revoke all on function public\.dbs_my_employee_ids\(\) from public, anon, authenticated/i, "O helper público de escopo não pode ficar executável pelo endpoint RPC.");


const osPdf = fs.readFileSync("public/dbs-control-pdf.js", "utf8");
const osTheme = fs.readFileSync("public/dbs-control-theme.css", "utf8");
assert.match(osPdf, /statusColor/, "O PDF da OS deve padronizar o status com destaque visual sem alterar o status gravado.");
assert.match(osPdf, /roundedRect\(195 - badgeW/, "O cabeçalho do PDF deve apresentar status em selo visual consistente.");
assert.match(osTheme, /#tab-ordens #os-table thead th/, "A lista de OS deve ter cabeçalho padronizado e legível.");
assert.match(osTheme, /@media \(max-width: 760px\)/, "A tela de OS deve se adaptar a telas menores.");
assert.match(html, /id="os-table-body"/, "A padronização deve manter o mesmo corpo de tabela ligado aos dados existentes.");
assert.match(html, /baixarPDFIndividual/, "A padronização deve preservar a ação de exportar PDF.");


const persistence = fs.readFileSync("src/lib/dbs-control.functions.ts", "utf8");
assert.match(persistence, /sourceOfTruth: "relational_delta"/, "Toda gravação nova deve declarar a fonte relacional de verdade.");
assert.match(persistence, /persistDbsControlLegacyEntityDeltas/, "Compras e orçamentos devem ser preservados como registros relacionais individuais.");
assert.match(persistence, /scope\.scopeKey,/, "A hidratação deve carregar registros legados do escopo administrativo correto.");
assert.match(persistence, /dbs_control_apply_work_order_delta/, "OS deve ser aplicada no RPC transacional com idempotência.");
assert.match(persistence, /expected_version/, "O cliente precisa enviar a versão esperada para rejeitar concorrência silenciosa.");
assert.match(persistence, /pendingChangesRef|buildDbsControlWorkOrderPatch/, "A camada de persistência deve operar em mudanças por registro.");
assert.match(protocolReconciliationMigration, /latest\.value->>'id'[\s\S]*latest\.value->>'protocolo'/, "SQL reconciliation must fall back from ID to protocol.");
assert.match(protocolReconciliationMigration, /v_seen_ids[\s\S]*v_seen_protocols/, "SQL must deduplicate and preserve records by both ID and protocol.");
assert.match(protocolReconciliationMigration, /'tecnicoId','employeeId','assignedEmployeeId'[\s\S]*'signature_data'[\s\S]*'diagnostico'/, "SQL must protect technician and completed document fields.");
assert.match(protocolReconciliationMigration, /not \(v_latest_id = any\(v_seen_ids\)\)/, "SQL must retain OS omitted by delayed snapshots without creating protocol duplicates.");

const dashboardUx = fs.readFileSync("public/dbs-control-ux.js", "utf8");
assert.match(dashboardUx, /\["dash-client-count","Clientes Base",clients\.length\]/, "O dashboard deve contar clientes do cadastro, não OS abertas.");
assert.match(dashboardUx, /\["dash-equip-count","Equipamentos Mapeados",equipment\.length\]/, "O dashboard deve contar equipamentos do parque, não OS em atendimento.");
assert.match(dashboardUx, /\["dash-os-andamento","OS em Atendimento",active\]/, "O KPI de atendimento deve contar OS ativas.");
assert.match(dashboardUx, /\["dash-os-concluidas","OS Concluídas",done\]/, "O KPI de concluídas deve contar OS concluídas.");

const authFunctions = fs.readFileSync("src/lib/auth.functions.ts", "utf8");
const adminFunctions = fs.readFileSync("src/lib/admin.functions.ts", "utf8");
const ticketFunctions = fs.readFileSync("src/lib/tickets.functions.ts", "utf8");
const profileLookup = authFunctions.slice(authFunctions.indexOf("export const getMyProfile"));
assert.match(
  profileLookup,
  /if \(data\.unit_id\)[\s\S]*?\.from\("units"\)[\s\S]*?\.select\("name, cnpj, address_json"\)[\s\S]*?\.eq\("id", data\.unit_id\)/,
  "O perfil deve carregar a unidade pela consulta canônica usando unit_id.",
);
assert.match(
  profileLookup,
  /if \(data\.company_id\)[\s\S]*?\.from\("companies"\)[\s\S]*?\.select\("legal_name, trade_name"\)[\s\S]*?\.eq\("id", data\.company_id\)/,
  "O perfil deve carregar a empresa pela consulta canônica usando company_id.",
);
assert.ok(adminFunctions.includes("unit:units!users_unit_id_fkey("), "A lista de acessos deve usar a relação real de unidades.");
assert.ok(adminFunctions.includes("company:companies!users_company_id_fkey("), "A lista de acessos deve usar a relação real de empresas.");
assert.ok(ticketFunctions.includes("users:users!tickets_created_by_user_id_fkey("), "Os chamados devem carregar o autor pela FK real.");
assert.ok(ticketFunctions.includes("assumed:users!tickets_assumed_by_fkey("), "Os chamados devem carregar o responsável pela FK real.");
assert.ok(ticketFunctions.includes("unit:units!tickets_unit_id_fkey("), "Os chamados devem carregar unidade pela FK real.");
assert.match(ticketFunctions, /async function requireStaff\(context: \{ userId: string \}\)[\s\S]*?supabaseAdmin[\s\S]*?\.select\("id, role_key, status"\)[\s\S]*?me\.status !== "ativo"/, "Ações de chamados devem verificar perfil ativo e papel pelo backend.");
assert.match(ticketFunctions, /export const createTicket = createServerFn[\s\S]*?supabaseAdmin[\s\S]*?\.select\("id, unit_id, status"\)[\s\S]*?me\.status !== "ativo"/, "Contas inativas não podem criar chamados com uma sessão antiga.");
assert.match(ticketFunctions, /export const reopenTicket = createServerFn[\s\S]*?supabaseAdmin[\s\S]*?\.select\("id, status"\)[\s\S]*?me\.status !== "ativo"/, "Contas inativas não podem reabrir chamados.");
const reopenTicketSource = ticketFunctions.slice(ticketFunctions.indexOf("export const reopenTicket = createServerFn"));
assert.equal((reopenTicketSource.match(/const \{ supabaseAdmin \}/g) || []).length, 1, "A rotina de reabertura deve declarar o cliente administrativo uma única vez.");


assert.match(ticketFunctions, /export const updateTicketStatus = createServerFn[\s\S]*?await requireStaff\(context\)/, "A mudança de status precisa ser autorizada também no servidor.");
assert.match(ticketFunctions, /export const completeTicket = createServerFn[\s\S]*?await requireStaff\(context\)[\s\S]*?\.neq\("status", "concluido"\)[\s\S]*?\.neq\("status", "cancelado"\)[\s\S]*?if \(!updated\)/, "A conclusão deve recusar chamados já encerrados.");
assert.match(ticketFunctions, /export const cancelTicket = createServerFn[\s\S]*?await requireStaff\(context\)[\s\S]*?\.neq\("status", "concluido"\)[\s\S]*?\.neq\("status", "cancelado"\)[\s\S]*?if \(!updated\)/, "O cancelamento deve recusar chamados já encerrados.");

assert.match(ticketFunctions, /const allowed = \["aberto", "atribuido", "em_rota", "em_atendimento", "aguardando_peca", "concluido", "cancelado"\]/, "A API de status deve rejeitar status arbitrários.");
assert.match(ticketFunctions, /\.neq\("status", "concluido"\)[\s\S]*?\.neq\("status", "cancelado"\)[\s\S]*?Este chamado já foi encerrado/, "Chamados encerrados não podem ser reabertos por uma chamada direta à API.");
assert.match(ticketFunctions, /data\.status === "concluido" \|\| data\.status === "cancelado" \? new Date\(\)\.toISOString\(\) : null/, "Conclusão e cancelamento devem gravar a data de encerramento.");

assert.equal(authFunctions.includes("unit:unit_id("), false, "O perfil não pode tratar a coluna unit_id como tabela relacionada.");
assert.equal(authFunctions.includes("company:company_id("), false, "O perfil não pode tratar a coluna company_id como tabela relacionada.");
assert.equal(adminFunctions.includes("unit:unit_id("), false, "A lista de acessos não pode usar uma coluna como tabela relacionada.");
assert.equal(adminFunctions.includes("company:company_id("), false, "A lista de acessos não pode usar uma coluna como tabela relacionada.");
console.log("Admin/Auth: relações de perfil, usuários e chamados verificadas.");

const adminProfile = fs.readFileSync("src/lib/admin-profile.functions.ts", "utf8");
const adminRoute = fs.readFileSync("src/routes/_authenticated/admin.tsx", "utf8");
const passageRoute = fs.readFileSync("src/routes/_authenticated/passage.tsx", "utf8");
const adminManagement = fs.readFileSync("src/lib/admin.functions.ts", "utf8");
assert.ok(adminProfile.includes('const { supabase } = context;'), "O perfil deve usar o cliente da identidade validada no servidor, sem depender do segredo administrativo.");
assert.ok(adminProfile.includes('.eq("auth_id", context.userId)'), "A consulta do perfil deve ficar restrita à identidade autenticada.");
assert.ok(adminProfile.includes("return { ...data, unit, company };"), "O perfil deve preservar os campos originais, incluindo role_key, sem reclassificá-los.");
assert.ok(adminRoute.includes('import { getMyProfile } from "@/lib/admin-profile.functions";'), "O painel administrativo deve usar a leitura de perfil da identidade autenticada.");
assert.ok(adminRoute.includes('<WalletCards className="h-4 w-4" /> RH'), "O item RH deve continuar registrado no menu administrativo.");
assert.ok(adminRoute.includes('<Landmark className="h-4 w-4" /> Financeiro'), "O item Financeiro deve continuar registrado no menu administrativo.");
assert.match(passageRoute, /profile\.data\.role_key === "SUPER_ADMIN"[\s\S]*?profile\.data\.role_key === "ADMIN_OPERACIONAL"/, "O RH direto deve aceitar os mesmos papéis administrativos do menu.");
assert.equal((adminManagement.match(/const adminDb = \(await import\("@\/integrations\/supabase\/client\.server"\)\)\.supabaseAdmin;/g) || []).length, 6, "Todas as seis operações administrativas devem conferir o papel pelo backend autenticado.");
assert.equal(adminManagement.includes("context.supabase"), false, "A autorização administrativa não deve depender de uma leitura RLS que oculta o próprio perfil.");
for (const path of [
  "src/routes/_authenticated/route.tsx",
  "src/routes/_authenticated/passage.tsx",
  "src/routes/_authenticated/folha-ponto.tsx",
  "src/routes/_authenticated/portal.tsx",
  "src/routes/_authenticated/dbs-control.tsx",
  "src/components/TicketNotificationListener.tsx",
  "src/components/RhPontoWorkspace.tsx",
]) {
  assert.ok(fs.readFileSync(path, "utf8").includes('from "@/lib/admin-profile.functions";'), "A tela " + path + " deve usar a leitura de perfil confiável.");
}
console.log("Admin menu: perfil, RH, Financeiro e permissões verificados.");
assert.match(adminManagement, /\.select\("id, role_key, status"\)[\s\S]*?me\.status !== "ativo"/, "Todas as operações privilegiadas devem recusar administradores inativos.");
assert.match(adminManagement, /\.select\("role_key, status"\)[\s\S]*?me\.status !== "ativo"/, "A listagem de empresas/unidades também deve exigir um operador ativo.");
assert.match(ticketFunctions, /async function requireStaff\(context: \{ userId: string \}\)[\s\S]*?supabaseAdmin[\s\S]*?\.select\("id, role_key, status"\)[\s\S]*?me\.status !== "ativo"/, "Ações de chamados devem verificar perfil ativo e papel pelo backend.");
assert.match(ticketFunctions, /export const updateTicketStatus = createServerFn[\s\S]*?await requireStaff\(context\)/, "A mudança de status precisa ser autorizada também no servidor.");
assert.match(ticketFunctions, /const allowed = \["aberto", "atribuido", "em_rota", "em_atendimento", "aguardando_peca", "concluido", "cancelado"\]/, "A API de status deve rejeitar status arbitrários.");
assert.match(ticketFunctions, /\.neq\("status", "concluido"\)[\s\S]*?\.neq\("status", "cancelado"\)[\s\S]*?Este chamado já foi encerrado/, "Chamados encerrados não podem ser reabertos por uma chamada direta à API.");
assert.match(ticketFunctions, /data\.status === "concluido" \|\| data\.status === "cancelado" \? new Date\(\)\.toISOString\(\) : null/, "Conclusão e cancelamento devem gravar a data de encerramento.");
const authHeader = authFunctions.slice(0, authFunctions.indexOf('.handler(async ({ data })'));
assert.doesNotMatch(authHeader, /BOOTSTRAP_PASSWORD|DBS_SUPER_ADMIN_BOOTSTRAP_PASSWORD/, "O segredo de bootstrap não deve ser capturado no escopo superior do módulo.");
assert.match(authFunctions, /\.handler\(async \(\{ data \}\) => \{[\s\S]*?const BOOTSTRAP_PASSWORD = process\.env\.DBS_SUPER_ADMIN_BOOTSTRAP_PASSWORD/, "A variável de senha de bootstrap só pode ser lida dentro do handler servidor.");


const activeAccountRlsMigration = fs.readFileSync("supabase/migrations/20261022203516_active_account_rls_guards.sql", "utf8");
const privateRlsHelperMigration = fs.readFileSync("supabase/migrations/20261022203929_private_rls_helper_functions.sql", "utf8");
const treasuryHtml = fs.readFileSync("public/treasury.html", "utf8");
let parsedTreasuryInlineScripts = 0;
const treasuryScriptTag = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
for (const match of treasuryHtml.matchAll(treasuryScriptTag)) {
  const attrs = match[1] || "";
  const source = match[2] || "";
  if (/\bsrc\s*=/.test(attrs) || !source.trim()) continue;
  if (/\btype\s*=\s*["']?(?:application\/json|importmap)/i.test(attrs)) continue;
  if (/\btype\s*=\s*["']?module/i.test(attrs)) continue;
  try {
    new vm.Script(source, { filename: "public/treasury.html:inline-script" + parsedTreasuryInlineScripts });
    parsedTreasuryInlineScripts += 1;
  } catch (error) {
    console.error("Falha de sintaxe no DBS TREASURY inline #" + parsedTreasuryInlineScripts + ": " + (error.stack || error.message));
    process.exitCode = 1;
  }
}
assert.ok(parsedTreasuryInlineScripts >= 2, "Os scripts de segurança e financeiro do Treasury devem ser validados.");

assert.match(activeAccountRlsMigration, /CREATE OR REPLACE FUNCTION public\.current_role_key\(\)[\s\S]*?SET search_path TO pg_catalog[\s\S]*?u\.status = 'ativo'/, "O papel do usuário deve ficar indisponível para sessões desativadas e a função deve usar search_path restrito.");
assert.match(activeAccountRlsMigration, /CREATE OR REPLACE FUNCTION public\.current_app_user_id\(\)[\s\S]*?u\.status = 'ativo'/, "Sessões desativadas não devem continuar identificando o usuário nas políticas.");
assert.match(activeAccountRlsMigration, /CREATE OR REPLACE FUNCTION public\.is_admin\(\)[\s\S]*?public\.current_role_key\(\)/, "A verificação administrativa deve herdar o bloqueio de conta inativa.");
assert.match(activeAccountRlsMigration, /CREATE POLICY rh_ponto_audit_admin_select[\s\S]*?public\.usuario_esta_ativo\(\)/, "A consulta de auditoria do ponto deve exigir conta ativa.");
assert.match(activeAccountRlsMigration, /CREATE POLICY rh_ponto_records_admin_update[\s\S]*?public\.usuario_esta_ativo\(\)[\s\S]*?WITH CHECK \([\s\S]*?public\.usuario_esta_ativo\(\)/, "Atualizações do ponto devem validar USING e WITH CHECK.");
assert.match(activeAccountRlsMigration, /CREATE POLICY users_self_select[\s\S]*?public\.usuario_esta_ativo\(\)[\s\S]*?OR public\.is_admin\(\)/, "A Data API não deve expor o próprio perfil de uma conta inativa.");
assert.match(privateRlsHelperMigration, /CREATE SCHEMA IF NOT EXISTS private[\s\S]*?REVOKE ALL ON SCHEMA private FROM PUBLIC, anon[\s\S]*?GRANT USAGE ON SCHEMA private TO authenticated, service_role/, "O schema interno não deve ser exposto a usuários anônimos.");
assert.match(privateRlsHelperMigration, /CREATE OR REPLACE FUNCTION private\.current_role_key_internal\(\)[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path TO pg_catalog[\s\S]*?u\.status = 'ativo'/, "A implementação privilegiada da consulta de papel deve ser privada, ter caminho de busca fixo e exigir conta ativa.");
assert.match(privateRlsHelperMigration, /CREATE OR REPLACE FUNCTION public\.current_role_key\(\)[\s\S]*?SECURITY INVOKER[\s\S]*?SELECT private\.current_role_key_internal\(\)/, "O wrapper público de compatibilidade não deve ser SECURITY DEFINER.");
assert.match(privateRlsHelperMigration, /REVOKE EXECUTE ON FUNCTION private\.is_admin_internal\(\) FROM PUBLIC, anon[\s\S]*?GRANT EXECUTE ON FUNCTION private\.is_admin_internal\(\) TO authenticated, service_role/, "A função interna de autorização deve ter execução restrita.");
assert.match(privateRlsHelperMigration, /REVOKE EXECUTE ON FUNCTION public\.is_admin\(\) FROM PUBLIC, anon[\s\S]*?GRANT EXECUTE ON FUNCTION public\.is_admin\(\) TO authenticated, service_role/, "O wrapper de autorização pública deve estar disponível apenas para os papéis necessários.");

console.log("RLS/Auth: políticas e helpers de conta ativa verificados.");


const treasuryRoute = fs.readFileSync("src/routes/_authenticated/treasury.tsx", "utf8");
assert.ok(authFunctions.includes("process.env.DBS_SUPER_ADMIN_BOOTSTRAP_PASSWORD"), "A senha de bootstrap do Superadministrador deve vir de um segredo privado do servidor.");
assert.doesNotMatch(authFunctions, /123456DBS/, "A senha administrativa padrão não pode ficar gravada no código.");
assert.match(authFunctions, /BOOTSTRAP_PASSWORD\.length < 12/, "O bootstrap deve exigir senha privada com pelo menos 12 caracteres.");
assert.doesNotMatch(treasuryHtml, /123456DBS|SENHA_ADMIN_OPERACIONAL/, "O HTML financeiro não pode conter uma senha administrativa reutilizável.");
assert.match(treasuryHtml, /id="dbs-treasury-auth-frame-guard"/, "O Financeiro deve verificar o contexto de iframe antes de inicializar os dados.");
assert.match(treasuryHtml, /window\.__DBS_TREASURY_ALLOWED_FRAME__ !== true/, "A página Financeira aberta diretamente deve parar antes de ler e renderizar o estado.");
assert.match(treasuryHtml, /window\.parent\.location\.pathname === "\/treasury"/, "O Financeiro embutido deve ser originado pela rota autenticada.");
assert.match(treasuryHtml, /DBS_TREASURY_VERIFY_ADMIN_PASSWORD/, "As alterações retroativas devem solicitar verificação à sessão autenticada.");
assert.match(treasuryHtml, /async function validarDatasRetroativas/, "As validações de datas devem aguardar a reautenticação sem aplicar alterações antes da resposta.");
assert.match(treasuryHtml, /await verifyTreasuryAdminPasswordInParent\(senha\)/, "A senha real do administrador precisa ser validada no portal antes da edição retroativa.");
assert.match(treasuryHtml, /async function alternarFechamentoPeriodo/, "Reabrir um mês financeiro deve aguardar a reautenticação do administrador.");
assert.match(treasuryRoute, /const TREASURY_URL = "\/treasury\.html\?v=20261027-ledger-1"/, "A atualização do Ledger deve invalidar o cache do HTML.");
assert.match(treasuryRoute, /supabase\.auth\.signInWithPassword/, "A reautenticação deve ser conferida pelo Supabase Auth.");
assert.match(treasuryRoute, /verified\.user\?\.id !== auth\.user\.id/, "A reautenticação só é aceita para a mesma identidade Superadministradora.");
assert.doesNotMatch(treasuryRoute, /treasury_snapshots.*(?:update|insert|upsert)/s, "A rota não pode escrever snapshots financeiros.");
assert.match(treasuryRoute, /DBS_TREASURY_LEDGER_COMMAND/, "A rota deve receber comandos de delta do Ledger.");
assert.match(treasuryRoute, /postTreasuryLedgerEntry\(\{ data: msg\.command \}\)/, "A rota deve encaminhar o comando para o RPC relacional.");
assert.match(treasuryRoute, /cloudReadyRef\.current = false;[\s\S]*?setLoading\(true\);/, "Conflito ou falha de sincronização deve bloquear o financeiro até nova tentativa.");

assert.match(treasuryRoute, /cloudReadyRef\.current = true;[\s\S]*?setCloudError\(null\);\s*setLoading\(false\);/, "O Financeiro só pode liberar a tela depois da hidratação compartilhada bem-sucedida.");
assert.match(treasuryRoute, /setIframeReloadKey\(\(key\) => key \+ 1\)/, "A falha de sincronização precisa permitir uma nova tentativa sem apagar snapshots.");
assert.match(treasuryRoute, /O módulo permanecerá bloqueado para evitar alterações locais que não sejam gravadas na nuvem/, "Falha na sincronização deve bloquear edição local não persistida.");
assert.doesNotMatch(treasuryRoute, /onLoad=\{\(\) => setLoading\(false\)\}/, "O evento load do iframe, sozinho, não pode indicar sincronização pronta.");

assert.match(treasuryRoute, /DBS_TREASURY_ADMIN_PASSWORD_RESULT/, "O portal deve devolver o resultado de reautenticação ao iframe esperado.");
console.log("Financeiro/Auth: senha, reautenticação e bloqueio de acesso direto verificados.");

