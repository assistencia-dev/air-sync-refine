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
assert.match(cloudFunctions, /rpc\("dbs_control_save_snapshot_safe_v2", \{ p_payload: savePayload \}\)/, "O snapshot deve usar o contrato safe_v2 com controle de versão.");
assert.match(atomicSnapshotMigration, /for update/i, "A gravação atômica deve bloquear o snapshot do escopo durante a transação.");
assert.match(atomicSnapshotMigration, /pg_advisory_xact_lock\(hashtextextended\(v_scope_key, 0\)\)/i, "A primeira gravação também deve ser serializada quando ainda não existe snapshot.");
assert.match(atomicSnapshotMigration, /not \(v_key = any\(v_seen_keys\)\)/, "A migração deve preservar OS ausentes de autosaves atrasados.");
assert.match(atomicSnapshotMigration, /grant execute on function public\.dbs_control_save_snapshot_safe\(jsonb\) to service_role/i, "O RPC de snapshot deve ser restrito ao service_role.");
assert.match(cloudFunctions, /function fetchAllDbsControlWorkOrders\s*\(/, "A auditoria da base deve buscar todas as OS, não apenas o limite padrão do Supabase.");
assert.match(cloudFunctions, /async function hydrateDbsControlStateFromCanonicalDb\([\s\S]*?return normalizeState\(state\)/, "O estado operacional deve vir exclusivamente do snapshot compartilhado.");
assert.match(cloudFunctions, /async function syncAdminOrdersToCanonical\(/, "A projeção relacional de despacho deve existir como compatibilidade operacional.");
assert.match(cloudFunctions, /_canonicalSyncPending: true/, "Uma OS cuja projeção falhe deve ficar marcada para retentativa.");
assert.match(cloudFunctions, /const saved = saveResult\.data;[\s\S]*?await syncAdminOrdersToCanonical\(/, "A projeção deve acontecer somente depois de confirmar a gravação do snapshot.");
assert.match(cloudFunctions, /canonical_sync_warning/, "Falhas de projeção precisam voltar explicitamente para a interface.");
assert.match(cloudFunctions, /já consta como concluída na projeção operacional[\s\S]*?A retentativa foi mantida/, "Uma OS concluída na projeção não pode ser silenciosamente rebaixada pelo snapshot.");
assert.match(route, /dispatchWarning/, "A interface precisa mostrar quando a projeção de despacho ainda está pendente.");
assert.doesNotMatch(route, /table: "dbs_control_work_orders"/, "A atualização em tempo real da UI deve observar a fonte compartilhada, não uma segunda fonte de leitura.");
const snapshotHydrator = cloudFunctions.match(/async function hydrateDbsControlStateFromCanonicalDb\([\s\S]*?\n\}/)?.[0] ?? "";\nassert.ok(snapshotHydrator, "A função de leitura do snapshot precisa existir.");\nassert.doesNotMatch(snapshotHydrator, /dbs_control_work_orders/, "A projeção relacional não pode substituir o snapshot como fonte de leitura.");
assert.match(cloudFunctions, /\.eq\("owner_user_id", user\.id\)[\s\S]*?newestPopulated\(ownedSnapshots as any\[\]\)/, "O administrador deve reutilizar seu snapshot existente antes de criar outro escopo.");
assert.match(cloudFunctions, /\.in\("owner_user_id", companyAdminIds\)[\s\S]*?newestPopulated\(matchingCompanySnapshots as any\[\]\)/, "O administrador deve reutilizar o snapshot legado de outro administrador da mesma empresa.");
assert.doesNotMatch(cloudFunctions, /from\("dbs_control_work_orders"\)\s*\.update\(update\)/, "A conclusão do colaborador não deve gravar uma cópia concorrente da OS.");
assert.match(cloudFunctions, /rpc\("dbs_control_save_snapshot_safe_v2"/, "A emissão e conclusão devem persistir pelo RPC atômico do snapshot.");
assert.match(cloudFunctions, /mergeAppendOnlyCollaboratorObservations\(currentOrder, incomingOrder\)/, "O histórico técnico deve ser preservado na fonte única.");
assert.match(cloudFunctions, /\.update\(\{ \.\.\.fields, version: currentVersion \}\)[\s\S]*?order\.version = Number\(updated\.version \|\| currentVersion \+ 1\)/, "A projeção deve enviar a versão atual e aceitar o incremento atômico do trigger do banco.");
assert.match(route, /projectionRetryInFlightRef/, "A retentativa automática precisa ser serializada para não competir com o salvamento normal.");
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