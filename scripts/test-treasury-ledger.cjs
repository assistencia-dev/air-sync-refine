const fs = require('node:fs');
const assert = require('node:assert/strict');
const ts = require('typescript');

const route = fs.readFileSync('src/routes/_authenticated/treasury.tsx', 'utf8');
const functions = fs.readFileSync('src/lib/treasury.functions.ts', 'utf8');
const viewer = fs.readFileSync('src/lib/treasury-viewer.functions.ts', 'utf8');
const fieldControl = fs.readFileSync('src/lib/fieldcontrol.functions.ts', 'utf8');
const html = fs.readFileSync('public/treasury.html', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20261027155816_treasury_ledger_command_rpc.sql', 'utf8');
const healthMigration = fs.readFileSync('supabase/migrations/20261027162135_treasury_ledger_health_rpc.sql', 'utf8');
const securityMigration = fs.readFileSync('supabase/migrations/20261027162711_treasury_ledger_security_grants.sql', 'utf8');
const fkMigration = fs.readFileSync('supabase/migrations/20261027162717_treasury_ledger_fk_indexes.sql', 'utf8');
const aclMigration = fs.readFileSync('supabase/migrations/20261030115938_treasury_server_bridge_acl_hardening.sql', 'utf8');
const healthScript = fs.readFileSync('scripts/check-treasury-ledger-health.mjs', 'utf8');
const healthWorkflow = fs.readFileSync('.github/workflows/treasury-ledger-health.yml', 'utf8');

assert.doesNotMatch(route, /from\(["']treasury_snapshots["']\)[\s\S]*?\.(?:insert|update|upsert)\(/);
assert.doesNotMatch(functions, /from\(["']treasury_snapshots["']\)[\s\S]*?\.(?:insert|update|upsert)\(/);
assert.doesNotMatch(fieldControl, /from\("treasury_snapshots"\)\.insert\(/);
assert.doesNotMatch(html, /DBS_TREASURY_SAVE/);
assert.match(route, /DBS_TREASURY_LEDGER_COMMAND/);
assert.match(route, /postTreasuryLedgerEntry\(\{ data: msg\.command \}\)/);
assert.match(functions, /post_treasury_ledger_entry/);
assert.match(functions, /const delays = \[0, 250, 750, 1500\]/);
assert.match(viewer, /readTreasuryScope/);
assert.match(html, /idempotency_key/);
assert.match(html, /await persistTreasuryLedgerMovement/);
assert.match(html, /external_key: sourceId \? `treasury:\$\{sourceKind\}:\$\{sourceId\}:\$\{status\}:\$\{idempotencyKey\}`/);
assert.match(migration, /alter table public\.treasury_ledger_entries\s+add column if not exists metadata/i);
assert.match(migration, /pg_advisory_xact_lock\(hashtextextended/i);
assert.match(migration, /case when p_status = 'posted' then 'draft' else p_status end/i);
assert.match(migration, /revoke all on function public\.post_treasury_ledger_entry/i);
assert.match(healthMigration, /treasury_ledger_health/);
assert.match(healthMigration, /pending_over_sla/);
assert.match(healthMigration, /revoke all on function public\.treasury_ledger_health/i);
assert.match(healthScript, /dead_letter/);
assert.match(healthScript, /pending_critical/);
assert.match(healthWorkflow, /cron: "\*\/5 \* \* \* \*"/);
assert.match(securityMigration, /from public, anon, authenticated/);
assert.match(securityMigration, /to service_role/);
assert.match(fkMigration, /treasury_outbox_entry_fk_idx/);
assert.match(aclMigration, /revoke all privileges on table[\s\S]*treasury_ledger_outbox[\s\S]*from anon, authenticated/i);
assert.match(aclMigration, /revoke insert, update, delete, truncate, references, trigger[\s\S]*treasury_snapshots from authenticated/i);
assert.match(aclMigration, /revoke insert, update, delete, truncate, references, trigger[\s\S]*dbs_control_snapshots from authenticated/i);

// Catch syntax regressions in the inline HTML script without executing browser APIs.
const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)].map((match) => match[1]);
const treasuryScript = inlineScripts.find((source) => source.includes('function persistTreasuryLedgerMovement'));
assert.ok(treasuryScript);
ts.createSourceFile('treasury-ledger-inline.js', treasuryScript, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);

console.log('Treasury Ledger: snapshot writes blocked, delta bridge/retry/idempotency and inline syntax verified.');
