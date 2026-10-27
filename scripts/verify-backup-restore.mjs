import crypto from "node:crypto";

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const backupBucket = process.env.SUPABASE_BACKUP_BUCKET || "db-backups";
const requireDocuments = process.env.SUPABASE_REQUIRE_DOCUMENT_BACKUP !== "false";

if (!url || !serviceRoleKey) {
  throw new Error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.");
}

const baseUrl = url.replace(/\/$/, "");
const headers = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` };
const objectPath = (bucket, path) => `/storage/v1/object/${encodeURIComponent(bucket)}/${String(path).split("/").map(encodeURIComponent).join("/")}`;

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  const text = await response.text();
  if (!response.ok) throw new Error(`${options.method || "GET"} ${path} (${response.status}): ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

async function bytes(path) {
  const response = await fetch(`${baseUrl}${path}`, { headers });
  const payload = Buffer.from(await response.arrayBuffer());
  if (!response.ok) throw new Error(`GET ${path} (${response.status}): ${payload.toString("utf8").slice(0, 500)}`);
  return payload;
}

const rows = await request(`/rest/v1/dbs_control_backup_manifests?select=*&status=eq.verified&order=generated_at.desc&limit=1`);
const record = Array.isArray(rows) ? rows[0] : rows;
if (!record) throw new Error("Nenhum manifesto verificado disponível para o drill de restauração.");

const manifestBytes = await bytes(objectPath(backupBucket, record.manifest_path));
const manifest = JSON.parse(manifestBytes.toString("utf8"));
if (manifest.sha256 !== record.snapshot_sha256) throw new Error("SHA-256 do manifesto diverge do registro no banco.");
if (Number(manifest.document_count) !== (manifest.document_manifest || []).length) {
  throw new Error("Manifesto inconsistente: document_count não confere com document_manifest.");
}
if (requireDocuments && Number(manifest.document_count) === 0) {
  throw new Error("Manifesto rejeitado: document_count=0 sob política de backup de documentos obrigatória.");
}

const snapshot = await bytes(objectPath(backupBucket, manifest.object_path));
const snapshotSha256 = crypto.createHash("sha256").update(snapshot).digest("hex");
if (snapshotSha256 !== manifest.sha256) throw new Error("SHA-256 do snapshot diverge do manifesto.");
const parsedSnapshot = JSON.parse(snapshot.toString("utf8"));

const checkedDocuments = [];
for (const document of manifest.document_manifest || []) {
  const documentBytes = await bytes(objectPath(backupBucket, document.backup_path));
  const sha256 = crypto.createHash("sha256").update(documentBytes).digest("hex");
  if (sha256 !== document.sha256) throw new Error(`Checksum divergente: ${document.source_bucket}/${document.source_path}`);
  if (Number(document.size) !== documentBytes.byteLength) throw new Error(`Tamanho divergente: ${document.source_bucket}/${document.source_path}`);
  checkedDocuments.push({ bucket: document.source_bucket, path: document.source_path, bytes: documentBytes.byteLength, sha256 });
}

console.log(JSON.stringify({
  ok: true,
  generated_at: manifest.generated_at,
  snapshot_path: manifest.object_path,
  snapshot_sha256: snapshotSha256,
  table_count: Object.keys(parsedSnapshot.tables || {}).length,
  document_count: checkedDocuments.length,
  documents: checkedDocuments,
  mode: "read-only restore verification",
}, null, 2));
