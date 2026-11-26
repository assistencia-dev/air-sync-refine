const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const backup = fs.readFileSync(path.join(root, "scripts/backup-supabase.mjs"), "utf8");
const retention = fs.readFileSync(path.join(root, "supabase/migrations/20261016100000_dbs_control_os_document_retention.sql"), "utf8");
const integrity = fs.readFileSync(path.join(root, "supabase/migrations/20261026164116_operational_integrity_indexes_and_backup_manifest.sql"), "utf8");
const bucketMigration = fs.readFileSync(path.join(root, "supabase/migrations/20261026164612_backup_manifest_document_buckets.sql"), "utf8");
const workflow = fs.readFileSync(path.join(root, ".github/workflows/daily-supabase-backup.yml"), "utf8");
const restoreDrill = fs.readFileSync(path.join(root, "scripts/verify-backup-restore.mjs"), "utf8");
const restoreWorkflow = fs.readFileSync(path.join(root, ".github/workflows/backup-restore-drill.yml"), "utf8");
const masterData = fs.readFileSync(path.join(root, "supabase/migrations/20261111133659_dbs_control_supplier_uom_master_data.sql"), "utf8");
const purchaseApproval = fs.readFileSync(path.join(root, "supabase/migrations/20261111134918_dbs_control_purchase_mandatory_approval.sql"), "utf8");
const osAuditMigration = fs.readFileSync(path.join(root, "supabase/migrations/20261117180729_dbs_control_os_audit_immutability_and_actor_attribution.sql"), "utf8");

assert.match(backup, /dbs-control-os/);
assert.match(backup, /listStorageObjects/);
assert.match(backup, /documentManifest/);
assert.match(backup, /verifiedSha256/);
assert.match(backup, /dbs_control_backup_manifests/);
assert.match(backup, /relationalDocumentsByBucket/);
assert.match(backup, /documentBuckets/);
assert.match(backup, /metadataRows\.length \|\| !String\(error\.message\)\.includes\("\(404\)"\)/);
for (const table of [
  "dbs_control_suppliers",
  "dbs_control_measure_units",
  "dbs_control_unit_conversions",
  "dbs_control_purchases",
  "dbs_control_purchase_approval_history",
  "dbs_control_purchase_items",
  "dbs_control_inventory_movements",
  "dbs_control_inventory_commands",
  "dbs_control_work_order_financials",
  "treasury_accounts",
  "treasury_ledger_entries",
  "treasury_ledger_lines",
  "treasury_ledger_outbox",
]) {
  assert.match(backup, new RegExp(`"${table}"`), `Backup must include relational table ${table}.`);
}
assert.match(masterData, /create table if not exists public\.dbs_control_suppliers/i);
assert.match(masterData, /create table if not exists public\.dbs_control_measure_units/i);
assert.match(masterData, /create table if not exists public\.dbs_control_unit_conversions/i);
assert.match(masterData, /enable row level security/i);
assert.match(masterData, /supplier_name/);
assert.match(masterData, /conversion_factor/);
assert.match(purchaseApproval, /approval_status text not null default 'pending'/i);
assert.match(purchaseApproval, /dbs_control_purchase_approval_history/i);
assert.match(purchaseApproval, /dbs_control_decide_purchase_approval/i);
assert.match(purchaseApproval, /DBS_PURCHASE_APPROVAL_REQUIRED/);
assert.match(purchaseApproval, /legacy_received/);
assert.match(retention, /Exclusão física de Ordem de Serviço bloqueada/);
assert.match(retention, /dbs_control_work_order_revisions/);
assert.match(osAuditMigration, /dbs_control_resolve_os_actor/, "O autor da revisão deve vir de identidade autenticada ou comando idempotente confiável.");
assert.match(osAuditMigration, /DBS_OS_ACTOR_REQUIRED/, "Alterações sem responsável não podem ser gravadas na OS.");
assert.match(osAuditMigration, /trg_dbs_control_os_events_append_only/, "A trilha de eventos deve ser append-only.");
assert.match(osAuditMigration, /trg_dbs_control_os_revisions_append_only/, "As revisões devem ser append-only.");
assert.match(osAuditMigration, /trg_dbs_control_os_attachments_append_only/, "Metadados de anexos não podem ser apagados ou substituídos.");
assert.match(osAuditMigration, /trg_dbs_control_log_os_attachment/, "Todo novo anexo deve gerar um evento de auditoria.");
assert.match(osAuditMigration, /uniquely_attributed/, "Backfill de autoria deve exigir correspondência inequívoca por OS e horário.");
assert.match(osAuditMigration, /attachment_id/, "A auditoria de anexos deve identificar cada arquivo sem guardar seu conteúdo binário.");
assert.match(integrity, /rh_ponto_records_employee_date_type_uq/);
assert.match(integrity, /dbs_control_backup_manifests/);
assert.match(bucketMigration, /document_buckets/);
assert.match(workflow, /SUPABASE_SERVICE_ROLE_KEY/);
assert.match(workflow, /SUPABASE_DOCUMENT_BUCKETS/);
assert.match(workflow, /schedule:/);
assert.match(restoreDrill, /document_count/);
assert.match(restoreDrill, /createHash\("sha256"\)/);
assert.match(restoreDrill, /mode: "read-only restore verification"/);
assert.match(restoreWorkflow, /SUPABASE_SERVICE_ROLE_KEY/);
assert.match(restoreWorkflow, /SUPABASE_REQUIRE_DOCUMENT_BACKUP/);
console.log("Data protection: immutable OS history, document checksums, verified manifests, daily workflow and duplicate-punch guard passed.");

assert.match(backup, /"dbs_control_purchase_receipts"/);
assert.match(backup, /"dbs_control_purchase_receipt_items"/);
for (const table of [
  "dbs_control_material_requests",
  "dbs_control_material_request_purchase_links",
  "dbs_control_material_request_fulfillments",
  "dbs_control_supplier_warranties",
  "dbs_control_customer_warranties",
  "dbs_control_warranty_claims",
  "dbs_control_warranty_claim_history",
]) {
  assert.match(backup, new RegExp(`"${table}"`), `Backup must include ${table}.`);
}

