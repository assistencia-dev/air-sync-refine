import crypto from "node:crypto";

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.env.SUPABASE_BACKUP_BUCKET || "db-backups";
const pageSize = 1000;

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
  "users",
  "companies",
  "units",
  "tickets",
  "ticket_attachments",
  "ticket_timeline",
  "audit_log",
  "rh_employees",
  "rh_topups",
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

async function ensureBucket() {
  try {
    await request("/storage/v1/bucket", {
      method: "POST",
      body: JSON.stringify({ id: bucket, name: bucket, public: false }),
    });
  } catch (error) {
    if (!String(error.message).includes("already exists")) throw error;
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
const manifest = {
  generated_at: snapshot.generated_at,
  object_path: path,
  sha256,
  tables: Object.fromEntries(Object.entries(snapshot.tables).map(([name, rows]) => [name, rows.length])),
};

await ensureBucket();
await request(`/storage/v1/object/${bucket}/${path}`, {
  method: "POST",
  headers: { "x-upsert": "false", "Content-Type": "application/json" },
  body: payload,
});
await request(`/storage/v1/object/${bucket}/daily/${stamp}/manifest.json`, {
  method: "POST",
  headers: { "x-upsert": "false", "Content-Type": "application/json" },
  body: JSON.stringify(manifest, null, 2),
});
console.log(JSON.stringify(manifest, null, 2));
