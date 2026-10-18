const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const html = fs.readFileSync("public/dbs-control.html", "utf8");
const route = fs.readFileSync("src/routes/_authenticated/dbs-control.tsx", "utf8");
const ux = fs.readFileSync("public/dbs-control-ux.js", "utf8");
const pdf = fs.readFileSync("public/dbs-control-pdf.js", "utf8");
const observations = fs.readFileSync("public/dbs-control-observations.js", "utf8");
const theme = fs.readFileSync("public/dbs-control-theme.css", "utf8");

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
const atomicSnapshotMigration = fs.readFileSync("supabase/migrations/20261016120000_dbs_control_snapshot_atomic_save.sql", "utf8");
const protocolReconciliationMigration = fs.readFileSync("supabase/migrations/20261017222141_dbs_control_snapshot_reconcile_by_protocol.sql", "utf8");
assert.match(cloudFunctions, /rpc\("dbs_control_save_snapshot_safe", \{ p_payload: payload \}\)/, "O snapshot deve ser salvo pela função SQL atômica.");
assert.match(atomicSnapshotMigration, /for update/i, "A gravação atômica deve bloquear o snapshot do escopo durante a transação.");
assert.match(atomicSnapshotMigration, /pg_advisory_xact_lock\(hashtextextended\(v_scope_key, 0\)\)/i, "A primeira gravação também deve ser serializada quando ainda não existe snapshot.");
assert.match(atomicSnapshotMigration, /not \(v_key = any\(v_seen_keys\)\)/, "A migração deve preservar OS ausentes de autosaves atrasados.");
assert.match(atomicSnapshotMigration, /grant execute on function public\.dbs_control_save_snapshot_safe\(jsonb\) to service_role/i, "O RPC de snapshot deve ser restrito ao service_role.");
assert.match(cloudFunctions, /function fetchAllDbsControlWorkOrders\s*\(/, "A hidratação precisa buscar todas as OS, não apenas o limite padrão do Supabase.");
assert.match(cloudFunctions, /const merged: Record<string, unknown> = \{ \.\.\.current \};[\s\S]*?for \(const \[key, value\] of Object\.entries\(canonical\)\)/, "Campos canônicos preenchidos no banco devem prevalecer sobre snapshots legados.");
assert.match(cloudFunctions, /preserveCompletedWorkOrderStatus: true/, "A hidratação das OS deve proteger uma conclusão já registrada no snapshot contra status canônico desatualizado.");
assert.match(cloudFunctions, /isCompleted\(item\?\.status\) && !isCompleted\(canonical\?\.status\)/, "Um status canônico antigo não pode reabrir uma OS concluída no snapshot.");
assert.match(cloudFunctions, /status: canonicalCompleted \? "Concluída" : \(snapshotCompleted \? merged\.status : canonical\.status\)/, "Um completed_at antigo ou inconsistente não pode rebaixar o status concluído do snapshot.");
assert.match(cloudFunctions, /\.range\(offset, offset \+ pageSize - 1\)/, "A consulta de OS deve paginar a base completa.");
assert.match(cloudFunctions, /fetchAllDbsControlWorkOrders\(\)/, "A hidratação e a auditoria devem usar a consulta paginada.");
assert.match(route, /postMessage\(\s*\{ type: "DBS_CONTROL_CLOUD_STATE", state: cloudState \}/, "Quando existe snapshot compartilhado, a inicialização deve entregar a nuvem sem mesclar/gravar o snapshot local.");
assert.match(route, /function dbsControlStateIsSmallerThan\(/, "A inicialização deve detectar quando a nuvem tem menos registros que a cópia local.");
assert.match(route, /const cloudIsIncomplete = localHasData && dbsControlStateIsSmallerThan\(localState, cloudState\)/, "Um snapshot parcial não pode substituir uma cópia local mais completa.");
assert.match(route, /if \(dbsControlStateIsSmallerThan\(localRecoveryStateRef\.current, latest\.state as Record<string, unknown>\)\)/, "O Realtime também deve bloquear snapshots incompletos após a inicialização.");
assert.match(route, /if \(!cloudReadyRef\.current\) \{[\s\S]*?return;\s*\}\s*pendingStateRef\.current = msg\.state/, "Uma gravação bloqueada não pode entrar na fila de salvamento.");
assert.match(route, /isCompleted\(localRecord\.status\) && !isCompleted\(cloudRecord\.status\)/, "Uma resposta de nuvem atrasada não pode reabrir uma OS concluída localmente.");
assert.match(route, /"concluidoPorEmployeeId"[\s\S]*?"fotoDepois"/, "A reconciliação deve preservar os campos de execução já preenchidos na OS concluída.");
assert.match(route, /if \(hasValue\(value\) \|\| !hasValue\(combined\[field\]\)\) combined\[field\] = value/, "Dados locais só podem preencher campos vazios da nuvem.");
assert.match(html, /DBS_AIR_ERP_STATE_PRE_CLOUD_HYDRATION/, "O estado local precisa ser copiado antes da hidratação da nuvem.");
assert.match(html, /Não substitui um backup maior por um estado local menor/, "Um backup local mais completo não deve ser sobrescrito por um estado menor.");
assert.match(html, /function verificarRecuperacaoLocalDBS\s*\(/, "A central de cadastros deve expor recuperação de cópias locais.");
assert.match(html, /DBS_AIR_ERP_STATE_PREVIOUS/, "O fluxo de recuperação deve procurar o backup local anterior.");
assert.match(html, /function mesclarEstadoRecuperacaoDBS\s*\(/, "A recuperação deve mesclar sem remover registros.");
assert.match(html, /atualizarSelects\(\)/, "A troca de aba deve atualizar seletores dos formulários.");
assert.match(html, /safe\(window\.renderizarOrcamentos\)/, "A aba Orçamentos precisa de renderização própria.");
assert.match(fs.readFileSync("public/dbs-control-orcamentos-v2.js", "utf8"), /window\.renderizarOrcamentos/, "O módulo de orçamentos deve expor seu renderizador.");
assert.match(html, /function switchTab\s*\(/, "A navegação principal switchTab precisa existir.");
assert.match(html, /function renderizarAbaAtiva\s*\(/, "O renderizador sob demanda precisa existir.");
assert.match(html, /dbs-control-employee-mode[^]*?String\(tabId\s*\|\|\s*['"]{0,1}['"]\)\s*!==\s*['"]tab-pwa['"]/, "O modo colaborador deve bloquear a navegação para abas administrativas.");
assert.match(html, /data-employee-visible=["']true["']/, "A área do colaborador precisa ter item de navegação explícito.");
assert.match(route, /msg\.type === ["']DBS_CONTROL_SAVE["']/, "A rota deve receber eventos de salvamento do iframe.");
assert.match(route, /msg\.type === ["']DBS_CONTROL_READY["']/, "A rota deve sincronizar o estado inicial do iframe.");
assert.match(route, /const persist = async \(\) => \{[\s\S]*?saveDbsControlCloudState/, "O salvamento na nuvem precisa ser processado.");
assert.match(route, /saveQueueRef = useRef<Promise<void>>\(Promise\.resolve\(\)\)/, "Os salvamentos em um mesmo dispositivo devem ser serializados para evitar gravações fora de ordem.");
assert.match(route, /saveQueueRef\.current = saveQueueRef\.current\.then\(persist, persist\)/, "Cada gravação deve aguardar a anterior mesmo quando a anterior falhar.");
assert.match(route, /v=202610\d+-[a-z-]+-\d+/, "A tela do DBS Control deve usar uma versão de URL nova para evitar HTML antigo em cache no celular.");
assert.match(ux, /DOMContentLoaded/, "A camada UX precisa ter inicialização compatível com carregamento tardio.");
assert.match(html, /dbs-control-theme\.css/, "O tema visual do DBS Control precisa estar carregado.");
assert.doesNotMatch(ux, /quick-flow\{display:none!important\}/, "O guia de fluxo do dashboard não deve ser ocultado.");
assert.doesNotMatch(ux, /table th:nth-child\((?:7|9)\).*display:none/i, "Colunas do dashboard não devem ser removidas da visualização.");
assert.match(ux, /overflow-x:auto!important/, "Tabelas amplas devem usar rolagem horizontal em telas estreitas.");
assert.match(theme, /employee-observation-field/, "O tema deve contemplar a área de observações do colaborador.");
assert.match(html, /employee-observation-field/, "A execução deve oferecer campo complementar separado para observações técnicas.");
assert.match(html, /Novas notas serão anexadas ao histórico/, "O técnico deve ser informado de que as notas anteriores serão preservadas.");
assert.match(cloudFunctions, /mergeAppendOnlyCollaboratorObservations\(currentOrder, incomingOrder\)/, "A gravação do colaborador deve mesclar observações sem substituir o histórico.");
assert.match(cloudFunctions, /const preserveCompletedValue = \(field: string, fallback: unknown\)/, "OS concluída deve preservar campos preenchidos contra autosaves antigos.");
assert.match(cloudFunctions, /const wasCompleted = normalizeDbsStatus\(canonicalOrder\.status\) === ["']concluida["']/, "The canonical save must detect work orders already completed.");
assert.match(cloudFunctions, /!String\(canonicalOrder\.signature_data \?\? ""\)\.trim\(\)/, "Assinatura já gravada de OS concluída não pode ser substituída.");
assert.match(cloudFunctions, /from\("dbs_control_work_order_events"\)[\s\S]*?event_type: "status_changed"/, "Transições de status devem ser registradas no histórico de auditoria.");
assert.match(cloudFunctions, /technical_opinion,observation,completed_at,signature_data,signature_name/, "A proteção deve ler os campos canônicos antes de decidir se pode preenchê-los.");
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


const quoteBuilder = fs.readFileSync("public/dbs-control-orcamentos-flex.js", "utf8");
const quotePdf = fs.readFileSync("public/dbs-control-orcamentos-pdf.js", "utf8");
assert.match(html, /dbs-control-orcamentos-flex\.js\?v=/, "O montador flexível de propostas deve estar carregado com versão de cache.");
assert.match(html, /dbs-control-orcamentos-pdf\.js\?v=20261014-pdf-standard-1/, "O renderer comercial padronizado deve estar carregado antes do módulo flexível.");
assert.match(html, /dbs-control-orcamentos-flex\.js\?v=20261014-pdf-standard-1/, "O módulo comercial precisa invalidar o cache após conectar o novo renderer.");
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


const osPdf = fs.readFileSync("public/dbs-control-pdf.js", "utf8");
const osTheme = fs.readFileSync("public/dbs-control-theme.css", "utf8");
assert.match(osPdf, /statusColor/, "O PDF da OS deve padronizar o status com destaque visual sem alterar o status gravado.");
assert.match(osPdf, /roundedRect\(195 - badgeW/, "O cabeçalho do PDF deve apresentar status em selo visual consistente.");
assert.match(osTheme, /#tab-ordens #os-table thead th/, "A lista de OS deve ter cabeçalho padronizado e legível.");
assert.match(osTheme, /@media \(max-width: 760px\)/, "A tela de OS deve se adaptar a telas menores.");
assert.match(html, /id="os-table-body"/, "A padronização deve manter o mesmo corpo de tabela ligado aos dados existentes.");
assert.match(html, /baixarPDFIndividual/, "A padronização deve preservar a ação de exportar PDF.");


const persistence = fs.readFileSync("src/lib/dbs-control.functions.ts", "utf8");
assert.match(persistence, /Reconcile complete snapshots against the latest shared snapshot/, "Admin saves must reconcile against the latest shared snapshot.");
assert.match(persistence, /missingLatestOrders/, "A delayed snapshot must preserve OS records missing from the submitted payload.");
assert.match(persistence, /latestById[\s\S]*latestByProtocol/, "Admin reconciliation must match work orders by ID first and protocol second.");
assert.match(persistence, /protectedCompletedFields[\s\S]*tecnicoId[\s\S]*signature_data[\s\S]*diagnostico/, "Completed OS must protect technician, signature, and diagnostic fields.");
assert.match(persistence, /incomingByProtocol\.get\(protocolKey\(currentOrder\)\)/, "Collaborator reconciliation must accept protocol aliases when IDs differ.");
assert.match(protocolReconciliationMigration, /latest\.value->>'id'[\s\S]*latest\.value->>'protocolo'/, "SQL reconciliation must fall back from ID to protocol.");
assert.match(protocolReconciliationMigration, /v_seen_ids[\s\S]*v_seen_protocols/, "SQL must deduplicate and preserve records by both ID and protocol.");
assert.match(protocolReconciliationMigration, /'tecnicoId','employeeId','assignedEmployeeId'[\s\S]*'signature_data'[\s\S]*'diagnostico'/, "SQL must protect technician and completed document fields.");
assert.match(protocolReconciliationMigration, /not \(v_latest_id = any\(v_seen_ids\)\)/, "SQL must retain OS omitted by delayed snapshots without creating protocol duplicates.");

const dashboardUx = fs.readFileSync("public/dbs-control-ux.js", "utf8");
assert.match(dashboardUx, /\["dash-client-count","Clientes Base",clients\.length\]/, "O dashboard deve contar clientes do cadastro, não OS abertas.");
assert.match(dashboardUx, /\["dash-equip-count","Equipamentos Mapeados",equipment\.length\]/, "O dashboard deve contar equipamentos do parque, não OS em atendimento.");
assert.match(dashboardUx, /\["dash-os-andamento","OS em Atendimento",active\]/, "O KPI de atendimento deve contar OS ativas.");
assert.match(dashboardUx, /\["dash-os-concluidas","OS Concluídas",done\]/, "O KPI de concluídas deve contar OS concluídas.");

const versionHistoryMigration = fs.readFileSync("supabase/migrations/20261018190000_dbs_control_snapshot_version_history.sql", "utf8");
assert.match(versionHistoryMigration, /SNAPSHOT_VERSION_CONFLICT/, "Snapshots devem rejeitar gravações baseadas em uma versão antiga.");
assert.match(versionHistoryMigration, /expected_updated_at/, "O RPC deve comparar a revisão que o cliente recebeu.");
assert.match(versionHistoryMigration, /SNAPSHOT_GUARD_CONFIRMATION_REQUIRED/, "Cadastros críticos devem exigir confirmação para redução destrutiva.");
assert.match(versionHistoryMigration, /create table if not exists public\.dbs_control_snapshot_history/, "O histórico de snapshots deve ser criado pela migration.");
assert.match(versionHistoryMigration, /enable row level security/i, "O histórico deve ter RLS ativada.");
assert.match(versionHistoryMigration, /revoke all on table public\.dbs_control_snapshot_history from public, anon, authenticated/i, "O histórico não deve ser acessível por anon/authenticated.");
assert.match(versionHistoryMigration, /limit 30/i, "O histórico deve reter somente as 30 versões mais recentes por escopo.");
assert.match(persistence, /expected_updated_at: data\.expectedUpdatedAt/, "O cliente deve enviar a revisão esperada para a gravação.");
assert.match(route, /mergeOnlyChangedWorkOrders/, "Conflitos só podem reaplicar alterações de OS quando a mesclagem for segura.");
assert.match(route, /allowDestructiveSnapshot: true/, "A redução destrutiva exige confirmação explícita administrativa.");

assert.match(html, /Pendente de envio · não confirmado/, "Falha ao confirmar uma OS deve aparecer como pendente de envio, não como sucesso.");
assert.match(html, /id="dbs-sync-retry"/, "A tela deve manter o botão manual de tentar novamente quando houver falha.");
assert.match(route, /requiresHumanReview/, "Conflitos e reduções destrutivas não devem ser reenviados automaticamente sem revisão humana.");
assert.match(html, /await saveStateAndConfirmCloud\(\)/, "A conclusão de OS só deve ser confirmada após resposta do servidor.");
