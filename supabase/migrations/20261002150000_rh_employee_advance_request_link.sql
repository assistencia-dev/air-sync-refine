-- DBS AIR · RH · compatibilidade do lançamento de adiantamentos e vínculo com solicitações
-- Aditivo e idempotente: cria a estrutura ausente no histórico Supabase sem remover dados.
-- Se a tabela já existir (produção), CREATE TABLE IF NOT EXISTS preserva integralmente seus registros.

create table if not exists public.rh_employee_advances (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.rh_employees(id) on delete restrict,
  advance_type text not null default 'VALE' check (advance_type in ('VALE','ADIANTAMENTO','OUTRO')),
  description text not null,
  amount_cents bigint not null check (amount_cents > 0),
  competence date not null,
  authorized boolean not null default false,
  status text not null default 'programado' check (status in ('programado','descontado','cancelado')),
  notes text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rh_employee_advances_employee_competence_idx
  on public.rh_employee_advances(employee_id, competence, status);
create index if not exists rh_employee_advances_competence_idx
  on public.rh_employee_advances(competence, status, authorized);

grant all on public.rh_employee_advances to service_role;
grant select on public.rh_employee_advances to authenticated;
revoke all on public.rh_employee_advances from anon;
alter table public.rh_employee_advances enable row level security;

do language plpgsql 'begin
  if not exists (
    select 1 from pg_policies
    where schemaname = ''public''
      and tablename = ''rh_employee_advances''
      and policyname = ''rh_employee_advances_admin_select''
  ) then
    execute ''create policy rh_employee_advances_admin_select
      on public.rh_employee_advances for select to authenticated
      using (public.is_admin())'';
  end if;
end';

do language plpgsql 'begin
  if not exists (
    select 1 from pg_trigger
    where tgname = ''rh_employee_advances_updated_at''
      and tgrelid = ''public.rh_employee_advances''::regclass
      and not tgisinternal
  ) then
    execute ''create trigger rh_employee_advances_updated_at
      before update on public.rh_employee_advances
      for each row execute function public.rh_set_updated_at()'';
  end if;
end';

alter table public.rh_employee_advances
  add column if not exists source_request_id uuid
  references public.rh_employee_requests(id) on delete set null;

create unique index if not exists rh_employee_advances_source_request_uq
  on public.rh_employee_advances(source_request_id)
  where source_request_id is not null;

notify pgrst, 'reload schema';
