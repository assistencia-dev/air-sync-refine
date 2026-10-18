-- DBS CONTROL snapshot save audit.
-- Kept separate from the existing integration-sync runs table, whose schema has a different contract.
create extension if not exists pgcrypto;

create table if not exists public.dbs_control_snapshot_save_audit (
  id uuid primary key default gen_random_uuid(),
  scope_key text not null,
  company_id uuid,
  owner_user_id uuid,
  user_id uuid,
  action text not null,
  status text not null check (status in ('success','error','retry')),
  payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists dbs_control_snapshot_save_audit_scope_time_idx
  on public.dbs_control_snapshot_save_audit (scope_key, created_at desc);
create index if not exists dbs_control_snapshot_save_audit_user_time_idx
  on public.dbs_control_snapshot_save_audit (user_id, created_at desc);

alter table public.dbs_control_snapshot_save_audit enable row level security;

do $policy$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'dbs_control_snapshot_save_audit'
      and policyname = 'dbs_control_snapshot_save_audit_service_role_all'
  ) then
    create policy dbs_control_snapshot_save_audit_service_role_all
      on public.dbs_control_snapshot_save_audit
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end
$policy$;

comment on table public.dbs_control_snapshot_save_audit is
  'Append-only audit trail for DBS CONTROL snapshot saves, retries and errors.';
