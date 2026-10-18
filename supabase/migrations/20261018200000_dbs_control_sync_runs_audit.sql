-- Safe DBS CONTROL sync audit log.
-- Append-only: application code inserts audit events and never updates/deletes history.
create extension if not exists pgcrypto;

create table if not exists public.dbs_control_sync_runs (
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

create index if not exists dbs_control_sync_runs_scope_key_idx on public.dbs_control_sync_runs (scope_key, created_at desc);
create index if not exists dbs_control_sync_runs_user_idx on public.dbs_control_sync_runs (user_id, created_at desc);

alter table public.dbs_control_sync_runs enable row level security;

do $policy$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'dbs_control_sync_runs'
      and policyname = 'dbs_control_sync_runs_service_role_all'
  ) then
    create policy dbs_control_sync_runs_service_role_all
      on public.dbs_control_sync_runs
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end
$policy$;

comment on table public.dbs_control_sync_runs is
  'Append-only DBS CONTROL save audit trail used to track snapshot writes, retries and conflicts without deleting business data.';
