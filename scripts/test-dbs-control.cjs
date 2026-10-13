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
assert.match(cloudFunctions, /function fetchAllDbsControlWorkOrders\s*\(/, "A hidratação precisa buscar todas as OS, não apenas o limite padrão do Supabase.");
assert.match(cloudFunctions, /\.range\(offset, offset \+ pageSize - 1\)/, "A consulta de OS deve paginar a base completa.");
assert.match(cloudFunctions, /fetchAllDbsControlWorkOrders\(\)/, "A hidratação e a auditoria devem usar a consulta paginada.");
assert.match(route, /function mergeDbsControlStates\s*\(/, "A inicialização deve unir estado local e nuvem sem descartar registros.");
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
assert.match(route, /setTimeout\(async \(\) => \{[\s\S]*?saveDbsControlCloudState/, "O salvamento na nuvem precisa ser processado.");
assert.match(ux, /DOMContentLoaded/, "A camada UX precisa ter inicialização compatível com carregamento tardio.");
assert.match(html, /dbs-control-theme\.css/, "O tema visual do DBS Control precisa estar carregado.");
assert.doesNotMatch(ux, /quick-flow\{display:none!important\}/, "O guia de fluxo do dashboard não deve ser ocultado.");
assert.doesNotMatch(ux, /table th:nth-child\((?:7|9)\).*display:none/i, "Colunas do dashboard não devem ser removidas da visualização.");
assert.match(ux, /overflow-x:auto!important/, "Tabelas amplas devem usar rolagem horizontal em telas estreitas.");
assert.match(theme, /employee-observation-field/, "O tema deve contemplar a área de observações do colaborador.");
assert.match(html, /employee-observation-field/, "A execução deve oferecer campo complementar separado para observações técnicas.");
assert.match(html, /Novas notas serão anexadas ao histórico/, "O técnico deve ser informado de que as notas anteriores serão preservadas.");
assert.match(cloudFunctions, /mergeAppendOnlyCollaboratorObservations\(currentOrder, incomingOrder\)/, "A gravação do colaborador deve mesclar observações sem substituir o histórico.");
assert.match(pdf, /function observationBox\(value\)/, "O PDF deve renderizar observações em uma caixa dedicada.");
assert.match(pdf, /const includeValues = !employeeMode && options\.includeValues === true/, "O colaborador nunca deve receber valores financeiros no PDF.");
assert.match(pdf, /if \(includeValues && total != null && total !== 0\)/, "Os totais financeiros precisam respeitar a permissão do modelo de PDF.");
assert.match(observations, /Nenhuma observação registrada\./, "O detalhe administrativo deve exibir um estado vazio explícito.");

const appendHelper = cloudFunctions.match(/function mergeAppendOnlyCollaboratorObservations\(currentOrder: any, incomingOrder: any\) \{[\s\S]*?\n\}\n(?=\nfunction mergeCollaboratorOrderState)/)?.[0];
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
assert.match(html, /dbs-control-orcamentos-flex\\.js\\?v=/, "O montador flexível de propostas deve estar carregado com versão de cache.");
assert.match(quoteBuilder, /function readItems\\(/, "A proposta deve suportar uma lista de itens.");
assert.match(quoteBuilder, /function pdf\\(/, "A proposta deve oferecer exportação PDF.");
assert.match(quoteBuilder, /ERP_STATE\\.orcamentos\\.push\\(q\\)/, "A proposta nova deve ser salva no estado compartilhado.");
assert.match(quoteBuilder, /Validade e condições|VALIDADE E CONDIÇÕES/, "O PDF deve exibir validade e condições comerciais.");
assert.doesNotMatch(quoteBuilder, /ERP_STATE\\.pecas\\s*\\.push|ERP_STATE\\.estoque\\s*=/, "A montagem da proposta não deve gravar estoque nem alterar catálogo.");
