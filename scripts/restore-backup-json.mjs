import crypto from "node:crypto";
import postgres from "postgres";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const backupBucket = process.env.SUPABASE_BACKUP_BUCKET || "db-backups";
const restoreDatabaseUrl = process.env.RESTORE_DATABASE_URL;
const restoreSchema = process.env.RESTORE_SCHEMA || "backup_restore";
const requireDocuments = process.env.SUPABASE_REQUIRE_DOCUMENT_BACKUP !== "false";

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios para leitura do backup.");
}
if (!restoreDatabaseUrl) {
  throw new Error("RESTORE_DATABASE_URL é obrigatório e deve apontar somente para o PostgreSQL descartável do drill.");
}
if (!/^[a-z_][a-z0-9_]*$/i.test(restoreSchema)) {
  throw new Error(`RESTORE_SCHEMA inválido: ${restoreSchema}`);
}

const baseUrl = supabaseUrl.replace(/\/$/, "");
const headers = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` };
const identifier = (value) => `"${String(value).replaceAll('"', '""')}"`;
const qualified = (schema, table) => `${identifier(schema)}.${identifier(table)}`;
const rowsTable = (table) => `rows_${table}`;

async function request(path) {
  const response = await fetch(`${baseUrl}${path}`, { headers });
  const text = await response.text();
  if (!response.ok) throw new Error(`GET ${path} (${response.status}): ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

async function requestBinary(path) {
  const response = await fetch(`${baseUrl}${path}`, { headers });
  const body = Buffer.from(await response.arrayBuffer());
  if (!response.ok) throw new Error(`GET ${path} (${response.status}): ${body.toString("utf8").slice(0, 500)}`);
  return body;
}

function storageObjectPath(storageBucket, objectPath) {
  const encoded = String(objectPath).split("/").map((part) => encodeURIComponent(part)).join("/");
  return `/storage/v1/object/${encodeURIComponent(storageBucket)}/${encoded}`;
}

const manifestRows = await request(
  "/rest/v1/dbs_control_backup_manifests?select=*&status=eq.verified&order=generated_at.desc&limit=1",
);
const record = Array.isArray(manifestRows) ? manifestRows[0] : manifestRows;
if (!record) throw new Error("Nenhum manifesto verificado disponível para restauração.");

const manifestBytes = await requestBinary(storageObjectPath(backupBucket, record.manifest_path));
const manifest = JSON.parse(manifestBytes.toString("utf8"));
if (manifest.sha256 !== record.snapshot_sha256) {
  throw new Error("SHA-256 do manifesto diverge do registro de backup.");
}
if (!Number.isInteger(manifest.snapshot_size_bytes) || manifest.snapshot_size_bytes < 0) {
  throw new Error("Manifesto sem snapshot_size_bytes válido; o backup precisa ser regenerado pela Fase 1.");
}
if (!manifest.tables || typeof manifest.tables !== "object") {
  throw new Error("Manifesto sem mapa de contagem das tabelas.");
}
if (Object.keys(manifest.tables).length !== 78) {
  throw new Error(`Manifesto incompleto: esperado 78 tabelas, encontrado ${Object.keys(manifest.tables).length}.`);
}
if (Number(manifest.document_count) !== (manifest.document_manifest || []).length) {
  throw new Error("Manifesto inconsistente: document_count não confere com document_manifest.");
}
if (requireDocuments && Number(manifest.document_count) === 0) {
  throw new Error("Manifesto rejeitado: document_count=0 sob política de backup obrigatório.");
}

const snapshotBytes = await requestBinary(storageObjectPath(backupBucket, manifest.object_path));
const snapshotSha256 = crypto.createHash("sha256").update(snapshotBytes).digest("hex");
if (snapshotSha256 !== manifest.sha256) throw new Error("SHA-256 do snapshot diverge do manifesto.");
if (snapshotBytes.byteLength !== manifest.snapshot_size_bytes) {
  throw new Error(
    `Tamanho do snapshot diverge: manifesto=${manifest.snapshot_size_bytes}, download=${snapshotBytes.byteLength}.`,
  );
}

const snapshot = JSON.parse(snapshotBytes.toString("utf8"));
if (!snapshot.tables || typeof snapshot.tables !== "object") {
  throw new Error("Snapshot sem objeto tables.");
}
const tableNames = Object.keys(manifest.tables);
const snapshotTableNames = Object.keys(snapshot.tables);
const missingTables = tableNames.filter((table) => !snapshotTableNames.includes(table));
const extraTables = snapshotTableNames.filter((table) => !tableNames.includes(table));
if (missingTables.length || extraTables.length) {
  throw new Error(
    `Manifesto e snapshot divergem. Ausentes: ${missingTables.join(",") || "nenhuma"}; extras: ${extraTables.join(",") || "nenhuma"}.`,
  );
}
for (const table of tableNames) {
  const rows = snapshot.tables[table];
  if (!Array.isArray(rows)) throw new Error(`Snapshot da tabela ${table} não é uma lista.`);
  if (rows.length !== Number(manifest.tables[table])) {
    throw new Error(`Contagem interna divergente para ${table}: manifesto=${manifest.tables[table]}, snapshot=${rows.length}.`);
  }
}

const documentChecks = [];
for (const document of manifest.document_manifest || []) {
  const bytes = await requestBinary(storageObjectPath(backupBucket, document.backup_path));
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== document.sha256) throw new Error(`Checksum divergente: ${document.source_bucket}/${document.source_path}`);
  if (bytes.byteLength !== Number(document.size)) {
    throw new Error(`Tamanho divergente: ${document.source_bucket}/${document.source_path}`);
  }
  documentChecks.push({
    source_bucket: document.source_bucket,
    source_path: document.source_path,
    size: bytes.byteLength,
    sha256,
  });
}

const sql = postgres(restoreDatabaseUrl, { max: 1, onnotice: () => {} });
try {
  const schemaIdentifier = identifier(restoreSchema);
  const schemaExists = await sql`select to_regnamespace(${restoreSchema}::text) is not null as exists`;
  if (schemaExists[0]?.exists) {
    throw new Error(`Schema de restauração já existe: ${restoreSchema}. O drill deve iniciar em banco limpo.`);
  }

  await sql.begin(async (transaction) => {
    await transaction.unsafe(`create schema ${schemaIdentifier}`);
    await transaction.unsafe(`
      create table ${qualified(restoreSchema, "manifest_counts")} (
        table_name text primary key,
        restored_table_name text not null unique,
        expected_count bigint not null check (expected_count >= 0)
      )
    `);
    await transaction.unsafe(`
      create table ${qualified(restoreSchema, "restore_metadata")} (
        id boolean primary key default true,
        manifest_path text not null,
        snapshot_path text not null,
        snapshot_sha256 text not null,
        snapshot_size_bytes bigint not null,
        downloaded_size_bytes bigint not null,
        table_count integer not null,
        document_count integer not null,
        restored_at timestamptz not null default now()
      )
    `);
    await transaction.unsafe(`
      create table ${qualified(restoreSchema, "document_manifest")} (
        source_bucket text not null,
        source_path text not null,
        size_bytes bigint not null,
        sha256 text not null,
        primary key (source_bucket, source_path)
      )
    `);

    await transaction.unsafe(
      `insert into ${qualified(restoreSchema, "restore_metadata")}\n        (manifest_path, snapshot_path, snapshot_sha256, snapshot_size_bytes, downloaded_size_bytes, table_count, document_count)\n       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        record.manifest_path,
        manifest.object_path,
        manifest.sha256,
        manifest.snapshot_size_bytes,
        snapshotBytes.byteLength,
        tableNames.length,
        documentChecks.length,
      ],
    );

    for (const document of documentChecks) {
      await transaction.unsafe(
        `insert into ${qualified(restoreSchema, "document_manifest")} (source_bucket, source_path, size_bytes, sha256) values ($1, $2, $3, $4)`,
        [document.source_bucket, document.source_path, document.size, document.sha256],
      );
    }

    for (const table of tableNames) {
      const restoredTable = rowsTable(table);
      if (!/^[a-z_][a-z0-9_]*$/i.test(restoredTable)) throw new Error(`Nome de tabela inválido no backup: ${table}`);
      await transaction.unsafe(`
        create table ${qualified(restoreSchema, restoredTable)} (
          row_no bigint generated always as identity primary key,
          payload jsonb not null
        )
      `);
      await transaction.unsafe(
        `insert into ${qualified(restoreSchema, "manifest_counts")} (table_name, restored_table_name, expected_count) values ($1, $2, $3)`,
        [table, restoredTable, Number(manifest.tables[table])],
      );
      for (const row of snapshot.tables[table]) {
        await transaction.unsafe(
          `insert into ${qualified(restoreSchema, restoredTable)} (payload) values ($1::jsonb)`,
          [JSON.stringify(row)],
        );
      }
    }
  });
} finally {
  await sql.end({ timeout: 5 });
}

console.log(
  JSON.stringify(
    {
      ok: true,
      restore_schema: restoreSchema,
      manifest_path: record.manifest_path,
      snapshot_path: manifest.object_path,
      snapshot_sha256: snapshotSha256,
      snapshot_size_bytes: snapshotBytes.byteLength,
      table_count: tableNames.length,
      document_count: documentChecks.length,
      mode: "isolated-json-restore",
    },
    null,
    2,
  ),
);
