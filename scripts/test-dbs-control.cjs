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

const cloudFunctions = fs.readFileSync("src/lib/dbs-control.functions.ts", "utf8");
const atomicSnapshotMigration = fs.readFileSync("supabase/migrations/20261016120000_dbs_control_snapshot_atomic_save.sql", "utf8");
const protocolReconciliationMigration = fs.readFileSync("supabase/migrations/20261017222141_dbs_control_snapshot_reconcile_by_protocol.sql", "utf8");
const syncAuditMigration = fs.readFileSync("supabase/migrations/20261018200000_dbs_control_sync_runs_audit.sql", "utf8");

assert.match(cloudFunctions, /function ensurePersistedSnapshotWrite\(/, "Toda gravação do snapshot precisa confirmar explicitamente que o banco retornou state e updated_at válidos.");
assert.match(cloudFunctions, /throw new Error\(`A gravação do snapshot \(\$\{operation\}\) não foi confirmada pelo banco\.`\)/, "Mecanismo de confirmação de persistência não pode aceitar retorno vazio.");
assert.match(cloudFunctions, /recordDbsControlSyncAttempt\(/, "Qualquer tentativa de save precisa gerar um registro de auditoria sem sobrescrever dados.");
assert.match(syncAuditMigration, /create table if not exists public\.dbs_control_sync_runs/, "Tabela de auditoria de sincronização deve existir e ser append-only.");
assert.match(syncAuditMigration, /status text not null check \(status in \('success','error','retry'\)\)/, "Tabela de auditoria precisa separar sucesso, erro e retry.");
assert.match(cloudFunctions, /throw new Error\(error\.message \|\| `Falha ao salvar o snapshot do DBS CONTROL \(\$\{operation\}\)\.`\)/, "Erros de persistência não podem ser ignorados.");
assert.match(atomicSnapshotMigration, /for update/i, "A gravação atômica deve bloquear o snapshot do escopo durante a transação.");
assert.match(atomicSnapshotMigration, /pg_advisory_xact_lock\(hashtextextended\(v_scope_key, 0\)\)/i, "A primeira gravação também deve ser serializada quando ainda não existe snapshot.");
assert.match(cloudFunctions, /rpc\("dbs_control_save_snapshot_safe_v2", \{ p_payload: payload \}\)/, "O snapshot deve usar o contrato safe_v2 com controle de versão.");
assert.match(cloudFunctions, /adminOrdersToSync/, "Admin saves still need reconciliation against the latest shared snapshot.");
assert.match(cloudFunctions, /protectedCompletedFields/, "Completed OS must protect technician, signature, and diagnostic fields.");

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

if (process.exitCode) {
  console.error("DBS CONTROL: smoke checks falharam.");
} else {
  console.log("DBS CONTROL: smoke checks aprovados.");
  console.log("Scripts inline com sintaxe válida: " + parsedInlineScripts);
}
