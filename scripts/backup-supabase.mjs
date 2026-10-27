import crypto from "node:crypto";

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.env.SUPABASE_BACKUP_BUCKET || "db-backups";
const documentBuckets = String(
  process.env.SUPABASE_DOCUMENT_BUCKETS || process.env.SUPABASE_DOCUMENT_BUCKET || "dbs-control-os,rh-files,ticket-files",
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const pageSize = 1000;
const requireDocumentBackup = process.env.SUPABASE_REQUIRE_DOCUMENT_BACKUP === "true";

if (!url || !serviceRoleKey) {
  throw new Error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.");
}

const baseUrl = url.replace(/\/$/, "");
const headers = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  "Content-Type": "application/json",
};

const tables = [
  // Core/administrative tables: keep the logical backup useful for a full
  // recovery, not only for the DBS Control screens.
  "project",
  "users",
  "companies",
  "units",
  "assets",
  "tickets",
  "ticket_attachments",
  "ticket_timeline",
  "audit_log",
  "rh_employees",
  "rh_topups",
  "rh_benefit_requests",
  "rh_request_attachments",
  "rh_request_audit",
  "rh_ponto_records",
  "rh_ponto_audit",
  "rh_departments",
  "rh_positions",
  "rh_employee_access",
  "rh_employee_contracts",
  "rh_employee_dependents",
  "rh_employee_documents",
  "rh_work_schedules",
  "rh_employee_schedule_assignments",
  "rh_employee_events",
  "rh_audit_log",
  "rh_vacation_periods",
  "rh_vacation_requests",
  "rh_leave_records",
  "rh_payroll_periods",
  "rh_payroll_items",
  "rh_payroll_runs",
  "rh_payroll_rules",
  "rh_time_adjustments",
  "rh_time_closures",
  "rh_admission_processes",
  "rh_termination_processes",
  "rh_medical_exams",
  "rh_safety_events",
  "rh_employee_requests",
  "rh_employee_advances",
  "treasury_snapshots",
  "treasury_viewer_access",
  // DBS Control: preserve OS, cadastro, vínculos, anexos e integração FieldControl.
  "dbs_control_bases",
  "dbs_control_base_clients",
  "dbs_control_clients",
  "dbs_control_sites",
  "dbs_control_equipment",
  "dbs_control_service_catalog",
  "dbs_control_parts",
  "dbs_control_work_orders",
  "dbs_control_work_order_equipment",
  "dbs_control_work_order_parts",
  "dbs_control_work_order_services",
  "dbs_control_work_order_events",
  "dbs_control_work_order_attachments",
  "dbs_control_snapshots",
  "dbs_control_snapshot_history",
  "dbs_control_integrations",
  "dbs_control_external_refs",
  "dbs_control_sync_runs",
  "dbs_control_sync_commands",
  "dbs_control_entity_records",
  "dbs_control_outbox",
  "dbs_control_outbox_dlq",
  "dbs_control_work_order_status_catalog",
  "dbs_control_legacy_id_map",
  "dbs_control_sync_metrics",
  "dbs_control_backup_manifests",
];

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${options.method || "GET"} ${path} (${response.status}): ${body}`);
  return body ? JSON.parse(body) : null;
}

async function requestBinary(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  });
  const body = Buffer.from(await response.arrayBuffer());
  if (!response.ok) throw new Error(`${options.method || "GET"} ${path} (${response.status}): ${body.toString("utf8").slice(0, 500)}`);
  return body;
}

function storageObjectPath(storageBucket, objectPath) {
  const encoded = String(objectPath).split("/").map((part) => encodeURIComponent(part)).join("/");
  return `/storage/v1/object/${encodeURIComponent(storageBucket)}/${encoded}`;
}

async function listStorageObjects(storageBucket) {
  const objects = [];
  const prefixes = [""];
  while (prefixes.length) {
    const prefix = prefixes.shift();
    for (let offset = 0; ; offset += pageSize) {
      const page = await request(`/storage/v1/object/list/${encodeURIComponent(storageBucket)}`, {
        method: "POST",
        body: JSON.stringify({
          prefix,
          limit: pageSize,
          offset,
          sortBy: { column: "name", order: "asc" },
        }),
      });
      if (!Array.isArray(page)) throw new Error(`A listagem do bucket ${storageBucket} retornou formato inválido.`);
      for (const entry of page) {
        const name = String(entry?.name ?? "").trim();
        if (!name) continue;
        const objectPath = prefix ? `${prefix}/${name}` : name;
        // Storage represents folders as entries without an id/metadata.
        if (!entry.id && !entry.metadata) prefixes.push(objectPath);
        else objects.push({
          path: objectPath,
          size: Number(entry.metadata?.size ?? entry.size ?? 0),
          contentType: entry.metadata?.mimetype || entry.metadata?.contentType || "application/octet-stream",
          updatedAt: entry.updated_at || entry.updatedAt || null,
        });
      }
      if (page.length < pageSize) break;
    }
  }
  return objects;
}

async function ensureBucket() {
  let existing;
  try {
    existing = await request(`/storage/v1/bucket/${encodeURIComponent(bucket)}`);
  } catch (error) {
    if (!String(error.message).includes("(404)")) throw error;
    await request("/storage/v1/bucket", {
      method: "POST",
      body: JSON.stringify({ id: bucket, name: bucket, public: false }),
    });
    existing = await request(`/storage/v1/bucket/${encodeURIComponent(bucket)}`);
  }

  // Existing buckets are not assumed private: force private mode and verify it.
  if (existing?.public !== false) {
    await request(`/storage/v1/bucket/${encodeURIComponent(bucket)}`, {
      method: "PUT",
      body: JSON.stringify({ public: false }),
    });
  }
  const verified = await request(`/storage/v1/bucket/${encodeURIComponent(bucket)}`);
  if (verified?.public !== false) {
    throw new Error(`O bucket de backup "${bucket}" não está privado; backup cancelado.`);
  }
}

async function readTable(table) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await request(`/rest/v1/${table}?select=*&limit=${pageSize}&offset=${offset}`);
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

const now = new Date();
const stamp = now.toISOString().replace(/[:.]/g, "-");
const snapshot = { generated_at: now.toISOString(), source: baseUrl, tables: {} };
for (const table of tables) {
  snapshot.tables[table] = await readTable(table);
  console.log(`${table}: ${snapshot.tables[table].length} registros`);
}

const payload = Buffer.from(JSON.stringify(snapshot, null, 2));
const sha256 = crypto.createHash("sha256").update(payload).digest("hex");
const path = `daily/${stamp}/supabase-${stamp}.json`;
const documentManifest = [];
await ensureBucket();
const relationalDocumentsByBucket = {
  "dbs-control-os": snapshot.tables.dbs_control_work_order_attachments || [],
  "rh-files": [
    ...(snapshot.tables.rh_employee_documents || []),
    ...(snapshot.tables.rh_request_attachments || []),
  ],
  "ticket-files": snapshot.tables.ticket_attachments || [],
};
for (const documentBucket of documentBuckets) {
  let sourceDocuments = [];
  try {
    sourceDocuments = await listStorageObjects(documentBucket);
  } catch (error) {
    // A new/empty project may not have a bucket yet. If relational metadata
    // already exists for that bucket, failing closed is mandatory: otherwise
    // the logical snapshot would claim a recoverable document that is absent.
    const metadataRows = relationalDocumentsByBucket[documentBucket] || [];
    if (metadataRows.length || !String(error.message).includes("(404)")) throw error;
    console.warn(`Bucket de documentos ${documentBucket} ainda não existe; nenhum anexo relacional foi encontrado.`);
    continue;
  }
  for (const document of sourceDocuments) {
    const sourcePath = storageObjectPath(documentBucket, document.path);
    const bytes = await requestBinary(sourcePath);
    const documentSha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    const backupPath = `daily/${stamp}/documents/${documentBucket}/${document.path}`;
    await request(storageObjectPath(bucket, backupPath), {
      method: "POST",
      headers: { "x-upsert": "false", "Content-Type": document.contentType || "application/octet-stream" },
      body: bytes,
    });
    const verifiedBytes = await requestBinary(storageObjectPath(bucket, backupPath));
    const verifiedSha256 = crypto.createHash("sha256").update(verifiedBytes).digest("hex");
    if (verifiedSha256 !== documentSha256) {
      throw new Error(`Checksum divergente no documento ${documentBucket}/${document.path}; backup interrompido.`);
    }
    documentManifest.push({
      source_bucket: documentBucket,
      source_path: document.path,
      backup_path: backupPath,
      size: bytes.byteLength,
      content_type: document.contentType || "application/octet-stream",
      sha256: documentSha256,
      updated_at: document.updatedAt,
    });
    console.log(`documento: ${documentBucket}/${document.path} (${bytes.byteLength} bytes) verificado`);
  }
}

if (requireDocumentBackup && documentManifest.length === 0) {
  throw new Error("Nenhum documento foi inventariado nos buckets obrigatórios; backup rejeitado para evitar manifesto falso.");
}

const manifest = {
  generated_at: snapshot.generated_at,
  object_path: path,
  sha256,
  tables: Object.fromEntries(Object.entries(snapshot.tables).map(([name, rows]) => [name, rows.length])),
  // Keep the old scalar field for readers already deployed, while the array
  // makes the source coverage explicit for all document buckets.
  document_bucket: documentBuckets.join(","),
  document_buckets: documentBuckets,
  document_count: documentManifest.length,
  document_manifest: documentManifest,
  status: "verified",
  verified_at: new Date().toISOString(),
};

await request(`/storage/v1/object/${bucket}/${path}`, {
  method: "POST",
  headers: { "x-upsert": "false", "Content-Type": "application/json" },
  body: payload,
});
const verifiedSnapshot = await requestBinary(storageObjectPath(bucket, path));
const verifiedSnapshotSha256 = crypto.createHash("sha256").update(verifiedSnapshot).digest("hex");
if (verifiedSnapshotSha256 !== sha256) throw new Error("Checksum divergente no snapshot principal; backup interrompido.");

const manifestPath = `daily/${stamp}/manifest.json`;
await request(storageObjectPath(bucket, manifestPath), {
  method: "POST",
  headers: { "x-upsert": "false", "Content-Type": "application/json" },
  body: JSON.stringify(manifest, null, 2),
});
const verifiedManifest = await requestBinary(storageObjectPath(bucket, manifestPath));
const parsedManifest = JSON.parse(verifiedManifest.toString("utf8"));
if (parsedManifest.sha256 !== sha256 || parsedManifest.document_count !== documentManifest.length) {
  throw new Error("Manifesto de backup não confere com os objetos verificados.");
}

await request("/rest/v1/dbs_control_backup_manifests", {
  method: "POST",
  headers: { Prefer: "return=minimal" },
  body: JSON.stringify({
    generated_at: snapshot.generated_at,
    object_path: path,
    manifest_path: manifestPath,
    snapshot_sha256: sha256,
    table_counts: manifest.tables,
    document_buckets: documentBuckets,
    document_count: documentManifest.length,
    document_manifest: documentManifest,
    status: "verified",
    verified_at: manifest.verified_at,
  }),
});
console.log(JSON.stringify(manifest, null, 2));
