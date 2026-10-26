const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261026180000_dbs_control_bases_issue_scope.sql'), 'utf8');
const rh = fs.readFileSync(path.join(root, 'src/lib/rh.functions.ts'), 'utf8');
const control = fs.readFileSync(path.join(root, 'src/lib/dbs-control.functions.ts'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/dbs-control.html'), 'utf8');
const route = fs.readFileSync(path.join(root, 'src/routes/_authenticated/dbs-control.tsx'), 'utf8');

const required = [
  ['base table', /create table if not exists public\.dbs_control_bases/i],
  ['base/client relation', /create table if not exists public\.dbs_control_base_clients/i],
  ['employee base FK', /add column if not exists dbs_control_base_id/i],
  ['issue permission', /add column if not exists dbs_control_can_issue_work_orders boolean not null default false/i],
  ['server issue RPC', /create or replace function public\.dbs_control_issue_work_order/i],
  ['scope enforcement', /DBS_OS_ISSUE_CLIENT_OUT_OF_SCOPE/i],
  ['forced issuing employee', /assigned_employee_id', v_employee_id/i],
  ['RH base manager', /export const listDbsControlBases/i],
  ['RH links mutation', /export const setDbsControlBaseClients/i],
  ['collaborator scope hydration', /getCollaboratorBaseScope/i],
  ['employee issue flag in URL', /can_issue_os=/i],
  ['employee issue tab guard', /dbs-control-can-issue-os/i],
  ['legacy client canonicalization', /resolveCollaboratorClientIdMap[\s\S]*dbs_control_legacy_id_map/i],
  ['normalized active base', /normalizeDbsStatus\(baseResult\.data\?\.status\) === "ativo"/i],
];

for (const [name, pattern] of required) {
  const haystack = [migration, rh, control, html, route].join('\n');
  if (!pattern.test(haystack)) throw new Error(`Missing base-scope contract: ${name}`);
}

if (!/revoke all on function public\.dbs_control_issue_work_order\(jsonb\).*grant execute on function public\.dbs_control_issue_work_order\(jsonb\) to service_role/is.test(migration)) {
  throw new Error('Issue RPC must be service_role-only.');
}
if (!/filterCollaboratorState[\s\S]{0,1600}clientIds/.test(control)) {
  throw new Error('Collaborator state must be filtered by base client IDs.');
}

console.log('DBS CONTROL base scope: base, client scoping, permission, RPC and mobile UI contracts passed.');
