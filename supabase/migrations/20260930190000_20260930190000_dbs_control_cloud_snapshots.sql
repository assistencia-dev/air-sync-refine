create table if not exists public.dbs_control_snapshots (
  id uuid primary key default gen_random_uuid(),
  scope_key text not null unique,
  company_id uuid references public.companies(id) on delete cascade,
  owner_user_id uuid references public.users(id) on delete set null,
  state jsonb not null,
  state_version integer not null default 2,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.dbs_control_snapshots enable row level security;
revoke all on public.dbs_control_snapshots from anon;

drop policy if exists "dbs_control_snapshots_select" on public.dbs_control_snapshots;
drop policy if exists "dbs_control_snapshots_insert" on public.dbs_control_snapshots;
drop policy if exists "dbs_control_snapshots_update" on public.dbs_control_snapshots;

create policy "dbs_control_snapshots_select"
on public.dbs_control_snapshots for select
to authenticated
using (current_role_key() = 'SUPER_ADMIN');

create policy "dbs_control_snapshots_insert"
on public.dbs_control_snapshots for insert
to authenticated
with check (current_role_key() = 'SUPER_ADMIN');

create policy "dbs_control_snapshots_update"
on public.dbs_control_snapshots for update
to authenticated
using (current_role_key() = 'SUPER_ADMIN')
with check (current_role_key() = 'SUPER_ADMIN');
