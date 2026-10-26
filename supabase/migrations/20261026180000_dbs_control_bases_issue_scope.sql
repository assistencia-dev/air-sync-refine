-- DBS CONTROL: bases operacionais, escopo de clientes e emissão de OS por colaborador.
-- Migração aditiva: nenhuma OS, cliente, colaborador ou vínculo existente é removido.
begin;

create table if not exists public.dbs_control_bases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete restrict,
  name text not null,
  code text,
  address_json jsonb not null default '{}'::jsonb,
  status text not null default 'ativo' check (status in ('ativo','inativo')),
  created_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dbs_control_bases_name_not_blank check (length(btrim(name)) > 0)
);

create unique index if not exists uq_dbs_control_bases_company_name
  on public.dbs_control_bases (coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)));
create index if not exists idx_dbs_control_bases_company_status
  on public.dbs_control_bases(company_id, status, name);

create table if not exists public.dbs_control_base_clients (
  base_id uuid not null references public.dbs_control_bases(id) on delete cascade,
  client_id uuid not null references public.dbs_control_clients(id) on delete restrict,
  created_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (base_id, client_id)
);

create index if not exists idx_dbs_control_base_clients_client
  on public.dbs_control_base_clients(client_id, base_id);

alter table public.rh_employees
  add column if not exists dbs_control_base_id uuid references public.dbs_control_bases(id) on delete set null,
  add column if not exists dbs_control_can_issue_work_orders boolean not null default false;

create index if not exists idx_rh_employees_dbs_control_base
  on public.rh_employees(dbs_control_base_id)
  where dbs_control_base_id is not null;
create index if not exists idx_rh_employees_dbs_control_issue
  on public.rh_employees(dbs_control_can_issue_work_orders, dbs_control_base_id)
  where dbs_control_can_issue_work_orders = true;

alter table public.dbs_control_bases enable row level security;
alter table public.dbs_control_base_clients enable row level security;
revoke all on public.dbs_control_bases from anon, authenticated;
revoke all on public.dbs_control_base_clients from anon, authenticated;
grant all on public.dbs_control_bases to service_role;
grant all on public.dbs_control_base_clients to service_role;

drop policy if exists dbs_control_bases_service_only on public.dbs_control_bases;
create policy dbs_control_bases_service_only on public.dbs_control_bases
  for all to service_role using (true) with check (true);
drop policy if exists dbs_control_base_clients_service_only on public.dbs_control_base_clients;
create policy dbs_control_base_clients_service_only on public.dbs_control_base_clients
  for all to service_role using (true) with check (true);

create or replace function public.dbs_control_issue_work_order(p_payload jsonb)
returns table(
  ok boolean, status text, work_order_id uuid, protocol text, version bigint,
  command_id uuid, idempotency_key text, error_code text, error_message text,
  changed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := nullif(p_payload->>'actor_user_id', '')::uuid;
  v_key text := nullif(btrim(p_payload->>'idempotency_key'), '');
  v_client_id uuid := nullif(p_payload->'patch'->>'client_id', '')::uuid;
  v_site_id uuid := nullif(p_payload->'patch'->>'site_id', '')::uuid;
  v_base_id uuid;
  v_employee_id uuid;
  v_employee_company_id uuid;
  v_base_company_id uuid;
  v_base_status text;
  v_client_status text;
  v_patch jsonb;
  v_effective_payload jsonb;
begin
  if v_actor is null then
    raise exception 'DBS_OS_ISSUE_ACTOR_REQUIRED: usuário emissor não informado.' using errcode = '42501';
  end if;
  if v_key is null then
    raise exception 'DBS_OS_ISSUE_IDEMPOTENCY_REQUIRED: idempotency_key é obrigatório.' using errcode = '22023';
  end if;
  if nullif(p_payload->>'work_order_id', '') is not null then
    raise exception 'DBS_OS_ISSUE_ONLY_CREATE: emissão de colaborador aceita apenas uma nova OS.' using errcode = '42501';
  end if;
  if v_client_id is null then
    raise exception 'DBS_OS_ISSUE_CLIENT_REQUIRED: cliente da OS é obrigatório.' using errcode = '22023';
  end if;

  -- O vínculo do RH é a única autorização para emissão: acesso ao DBS CONTROL
  -- sozinho não libera a função. A consulta contempla os dois modelos de
  -- vínculo existentes (ponto_portal_user_id e rh_employee_access).
  select e.id, e.dbs_control_base_id, u.company_id
    into v_employee_id, v_base_id, v_employee_company_id
  from public.rh_employees e
  left join public.users u on u.id = e.ponto_portal_user_id
  where e.is_active = true
    and e.ponto_access_enabled = true
    and e.dbs_control_access_enabled = true
    and e.dbs_control_can_issue_work_orders = true
    and (
      e.ponto_portal_user_id = v_actor
      or exists (
        select 1 from public.rh_employee_access ea
        where ea.employee_id = e.id and ea.user_id = v_actor and ea.access_enabled = true
      )
    )
  order by (e.ponto_portal_user_id = v_actor) desc
  limit 1;

  if v_employee_id is null or v_base_id is null then
    raise exception 'DBS_OS_ISSUE_FORBIDDEN: este colaborador não está autorizado a emitir OS ou não possui base operacional.' using errcode = '42501';
  end if;

  select b.company_id, b.status into v_base_company_id, v_base_status
  from public.dbs_control_bases b
  where b.id = v_base_id;
  if v_base_status is distinct from 'ativo' then
    raise exception 'DBS_OS_ISSUE_BASE_INACTIVE: a base operacional está inativa.' using errcode = '42501';
  end if;
  if v_base_company_id is not null and v_employee_company_id is not null
     and v_base_company_id is distinct from v_employee_company_id then
    raise exception 'DBS_OS_ISSUE_COMPANY_MISMATCH: base e colaborador pertencem a empresas diferentes.' using errcode = '42501';
  end if;

  select c.status into v_client_status
  from public.dbs_control_clients c
  join public.dbs_control_base_clients bc on bc.client_id = c.id and bc.base_id = v_base_id
  where c.id = v_client_id;
  if v_client_status is null then
    raise exception 'DBS_OS_ISSUE_CLIENT_OUT_OF_SCOPE: cliente não está vinculado à base do colaborador.' using errcode = '42501';
  end if;
  if v_client_status <> 'ativo' then
    raise exception 'DBS_OS_ISSUE_CLIENT_INACTIVE: cliente selecionado está inativo.' using errcode = '42501';
  end if;

  if v_site_id is not null and not exists (
    select 1 from public.dbs_control_sites s
    where s.id = v_site_id and s.client_id = v_client_id and s.status = 'ativo'
  ) then
    raise exception 'DBS_OS_ISSUE_SITE_INVALID: local não pertence ao cliente selecionado.' using errcode = '42501';
  end if;

  -- A função transacional existente continua sendo a fonte única de gravação;
  -- este wrapper apenas aplica o escopo e força o responsável para o emissor.
  v_patch := coalesce(p_payload->'patch', '{}'::jsonb)
    || jsonb_build_object(
      'client_id', v_client_id,
      'assigned_employee_id', v_employee_id,
      'created_by_user_id', v_actor
    );
  v_effective_payload := jsonb_set(p_payload, '{patch}', v_patch, true)
    || jsonb_build_object('operation', 'upsert', 'event_type', coalesce(nullif(p_payload->>'event_type', ''), 'work_order_created'));

  return query select * from public.dbs_control_apply_work_order_delta(v_effective_payload);
end;
$$;

revoke all on function public.dbs_control_issue_work_order(jsonb) from public, anon, authenticated;
grant execute on function public.dbs_control_issue_work_order(jsonb) to service_role;

commit;
