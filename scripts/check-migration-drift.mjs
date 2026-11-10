import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import postgres from "postgres";

const root = process.cwd();
const migrationsDirectory = path.resolve(root, process.env.MIGRATIONS_DIR || "supabase/migrations");
const pendingDocument = path.resolve(
  root,
  process.env.MIGRATIONS_PENDING_DOC || "docs/MIGRACOES_PENDENTES.md",
);
const localOnly = process.argv.includes("--local-only");
const recover = process.argv.includes("--recover");
const productionPreflight = process.argv.includes("--preflight");

function migrationFileName(version, name) {
  return `${version}_${name}.sql`;
}

function parseMigrationFile(fileName) {
  const match = /^(\d+)_(.+)\.sql$/.exec(fileName);
  if (!match) {
    return {
      fileName,
      error: "nome inválido: esperado <versão>_<nome>.sql",
    };
  }
  return { fileName, version: match[1], name: match[2] };
}

function safeFileNamePart(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^\.+/, "")
    .replace(/_+/g, "_");
  return normalized || "recovered_from_database";
}

async function scanRepositoryMigrations() {
  const entries = await fs.readdir(migrationsDirectory, { withFileTypes: true });
  const migrations = new Map();
  const invalidFiles = [];
  const duplicateVersions = [];

  for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith(".sql"))) {
    const parsed = parseMigrationFile(entry.name);
    if (parsed.error) {
      invalidFiles.push(parsed);
      continue;
    }
    const fullPath = path.join(migrationsDirectory, entry.name);
    if (migrations.has(parsed.version)) {
      duplicateVersions.push({
        version: parsed.version,
        files: [migrations.get(parsed.version).fileName, parsed.fileName],
      });
      continue;
    }
    migrations.set(parsed.version, { ...parsed, path: fullPath });
  }

  return { migrations, invalidFiles, duplicateVersions };
}

function normalizeStatements(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    const statements = value.map((statement) => String(statement));
    return statements.join("\n");
  }
  if (typeof value === "object") {
    if (Array.isArray(value.statements)) return normalizeStatements(value.statements);
    return String(value);
  }
  return String(value);
}

function normalizeDatabaseMigration(row, hasName, hasStatements) {
  const version = String(row.version);
  let name = hasName && row.name !== null && row.name !== undefined ? String(row.name) : null;
  // Some historical Supabase records stored the version twice in "name".
  // Normalize only that exact prefix; retain meaningful embedded timestamps.
  if (name && name.startsWith(`${version}_`)) name = name.slice(version.length + 1);
  return {
    version,
    name,
    statements: hasStatements ? normalizeStatements(row.statements) : null,
  };
}

async function readDatabaseMigrations() {
  const databaseUrl = process.env.SUPABASE_DB_URL_READONLY;
  if (!databaseUrl) {
    throw new Error("SUPABASE_DB_URL_READONLY é obrigatório para a auditoria remota.");
  }

  const sql = postgres(databaseUrl, {
    max: 1,
    prepare: false,
  });

  try {
    return await sql.begin(async (transaction) => {
      await transaction.unsafe("set transaction read only");

      const readOnlyState = await transaction.unsafe("show transaction_read_only");
      const columns = await transaction`
        select column_name
        from information_schema.columns
        where table_schema = 'supabase_migrations'
          and table_name = 'schema_migrations'
        order by ordinal_position
      `;
      const columnNames = new Set(columns.map((column) => String(column.column_name)));
      if (!columnNames.has("version")) {
        throw new Error("supabase_migrations.schema_migrations não possui a coluna version.");
      }

      const hasName = columnNames.has("name");
      const hasStatements = columnNames.has("statements");
      const selectColumns = [
        '"version"::text as "version"',
        hasName ? '"name"::text as "name"' : 'null::text as "name"',
        hasStatements ? '"statements" as "statements"' : 'null as "statements"',
      ];
      const rows = await transaction.unsafe(`
        select ${selectColumns.join(", ")}
        from "supabase_migrations"."schema_migrations"
        order by "version"
      `);

      return {
        transaction_read_only: String(readOnlyState[0]?.transaction_read_only || ""),
        columns: [...columnNames],
        has_name_column: hasName,
        has_statements_column: hasStatements,
        migrations: rows.map((row) => normalizeDatabaseMigration(row, hasName, hasStatements)),
      };
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function compareMigrations(repository, database) {
  const repositoryVersions = new Set(repository.migrations.keys());
  const databaseMigrations = new Map(
    database.migrations.map((migration) => [migration.version, migration]),
  );
  const databaseVersions = new Set(databaseMigrations.keys());

  const onlyInDatabase = [...databaseMigrations.values()]
    .filter((migration) => !repositoryVersions.has(migration.version))
    .sort((left, right) => left.version.localeCompare(right.version));
  const onlyInRepository = [...repository.migrations.values()]
    .filter((migration) => !databaseVersions.has(migration.version))
    .map(({ path: _path, ...migration }) => migration)
    .sort((left, right) => left.version.localeCompare(right.version));
  const nameMismatches = [];

  if (database.has_name_column) {
    for (const databaseMigration of database.migrations) {
      const repositoryMigration = repository.migrations.get(databaseMigration.version);
      if (!repositoryMigration || !databaseMigration.name) continue;
      if (databaseMigration.name !== repositoryMigration.name) {
        nameMismatches.push({
          version: databaseMigration.version,
          database_name: databaseMigration.name,
          repository_name: repositoryMigration.name,
          repository_file: repositoryMigration.fileName,
        });
      }
    }
  }

  const latestDatabaseVersion = [...databaseVersions].sort((a, b) => a.localeCompare(b)).at(-1) ?? null;
  const pendingOutOfOrder = latestDatabaseVersion
    ? onlyInRepository.filter((migration) => migration.version < latestDatabaseVersion)
      .map(({ path: _path, ...migration }) => ({
        ...migration,
        latest_database_version: latestDatabaseVersion,
      }))
    : [];
  return { onlyInDatabase, onlyInRepository, nameMismatches, pendingOutOfOrder };
}

async function appendPendingDocument(pending) {
  if (!pending.length) return null;
  await fs.mkdir(path.dirname(pendingDocument), { recursive: true });
  let existing = "";
  try {
    existing = await fs.readFile(pendingDocument, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const fresh = pending.filter(
    (migration) => !existing.includes(`<!-- migration-drift:${migration.version} -->`),
  );
  if (!fresh.length) return pendingDocument;

  const block = [
    existing.trimEnd(),
    existing.trim() ? "" : "# Migrações pendentes de recuperação",
    existing.trim() ? "" : "",
    existing.trim() ? "## Novas versões sem SQL recuperável" : "## Versões sem SQL recuperável",
    "",
    ...fresh.flatMap((migration) => [
      `<!-- migration-drift:${migration.version} -->`,
      `- **${migration.version}** — ${migration.name || "nome ausente"}: ${migration.reason}`,
    ]),
    "",
  ].join("\n");
  await fs.writeFile(pendingDocument, `${block.trimEnd()}\n`, "utf8");
  return pendingDocument;
}

async function recoverMissingMigrations(repository, onlyInDatabase, hasStatementsColumn) {
  if (!onlyInDatabase.length) {
    return { generated: [], pending: [], pending_document: null };
  }

  if (!recover) {
    return {
      generated: [],
      pending: onlyInDatabase.map((migration) => ({
        version: migration.version,
        name: migration.name,
        reason: hasStatementsColumn
          ? "SQL disponível no banco; execute novamente com --recover para salvar o conteúdo exato."
          : "a coluna statements não existe em schema_migrations",
      })),
      pending_document: null,
      recovery_requested: false,
    };
  }

  const generated = [];
  const pending = [];
  const occupiedNames = new Set(
    [...repository.migrations.values()].map((migration) => migration.fileName),
  );

  for (const migration of onlyInDatabase) {
    const statements = migration.statements;
    if (!hasStatementsColumn || !statements || !statements.trim()) {
      pending.push({
        version: migration.version,
        name: migration.name,
        reason: hasStatementsColumn
          ? "statements está vazio ou nulo no banco"
          : "a coluna statements não existe em schema_migrations",
      });
      continue;
    }

    const fileName = migrationFileName(
      migration.version,
      safeFileNamePart(migration.name || "recovered_from_database"),
    );
    if (occupiedNames.has(fileName)) {
      throw new Error(`Arquivo de recuperação já existe e não pode ser sobrescrito: ${fileName}`);
    }
    await fs.writeFile(
      path.join(migrationsDirectory, fileName),
      statements.endsWith("\n") ? statements : `${statements}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    occupiedNames.add(fileName);
    generated.push({ version: migration.version, name: migration.name, fileName });
  }

  const pendingDocumentPath = await appendPendingDocument(pending);
  return {
    generated,
    pending,
    pending_document: pendingDocumentPath,
    recovery_requested: true,
  };
}

async function main() {
  const repository = await scanRepositoryMigrations();
  const localErrors = [
    ...repository.invalidFiles.map((file) => file.error),
    ...repository.duplicateVersions.map(
      (duplicate) => `versão ${duplicate.version} repetida em: ${duplicate.files.join(", ")}`,
    ),
  ];

  const report = {
    ok: localErrors.length === 0,
    mode: localOnly ? "local-only" : productionPreflight ? "read-only-production-preflight" : "read-only-database",
    repository: {
      directory: path.relative(root, migrationsDirectory),
      file_count: repository.migrations.size + repository.invalidFiles.length,
      valid_file_count: repository.migrations.size,
      invalid_files: repository.invalidFiles,
      duplicate_versions: repository.duplicateVersions,
    },
    errors: localErrors,
  };

  if (!localOnly && localErrors.length === 0) {
    const database = await readDatabaseMigrations();
    const comparison = compareMigrations(repository, database);
    const recovery = await recoverMissingMigrations(
      repository,
      comparison.onlyInDatabase,
      database.has_statements_column,
    );
    report.database = {
      transaction_read_only: database.transaction_read_only,
      columns: database.columns,
      has_name_column: database.has_name_column,
      has_statements_column: database.has_statements_column,
      migration_count: database.migrations.length,
    };
    report.drift = comparison;
    report.recovery = recovery;
    report.ok =
      report.ok &&
      database.transaction_read_only === "on" &&
      comparison.onlyInDatabase.length === 0 &&
      comparison.nameMismatches.length === 0 &&
      (productionPreflight
        ? comparison.pendingOutOfOrder.length === 0
        : comparison.onlyInRepository.length === 0);
  }

  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        mode: localOnly ? "local-only" : "read-only-database",
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
