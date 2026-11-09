-- DBS AIR · Fase 2 RH / Vale-Transporte
-- Aditiva e isolada: não altera VA, Financeiro, Compras, Estoque ou DBS Control.
-- Identidade: public.rh_employees.id (cadastro central); sem cadastro pessoal paralelo.

create table if not exists public.rh_vt_employee_config (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.rh_employees(id) on delete restrict,
  company_id uuid references public.companies(id) on delete restrict,
  transit_lines text[] not null default '{}'::text[],
  fare_cents integer not null check (fare_cents > 0),
  trips_per_day integer not null default 2 check (trips_per_day between 1 and 12),
  recharge_rule jsonb not null default '{"mode":"manual"}'::jsonb,
  cost_center text,
  is_active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rh_vt_employee_config_employee_uq unique (employee_id)
);

create index if not exists rh_vt_employee_config_company_idx
  on public.rh_vt_employee_config(company_id, is_active);

create table if not exists public.rh_vt_topups (
  id uuid primary key default gen_random_uuid(),
  source_legacy_topup_id uuid unique,
  employee_id uuid not null references public.rh_employees(id) on delete restrict,
  company_id uuid references public.companies(id) on delete restrict,
  paid_at date not null,
  competence_month date not null,
  amount_cents bigint not null check (amount_cents > 0),
  cost_center text,
  receipt_storage_path text,
  status text not null default 'ativa' check (status in ('ativa','cancelada')),
  cancel_reason text,
  change_reason text,
  idempotency_key text not null unique,
  -- Reservado para integração futura com o Ledger; não cria lançamento nesta fase.
  treasury_idempotency_key text not null unique,
  financial_status text not null default 'nao_integrado'
    check (financial_status in ('nao_integrado','pendente_integracao','integrado')),
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  cancelled_by uuid references public.users(id) on delete set null,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rh_vt_topups_competence_month_first_day
    check (date_trunc('month', competence_month)::date = competence_month),
  constraint rh_vt_topups_cancel_state
    check ((status = 'cancelada' and cancel_reason is not null and cancelled_at is not null)
        or status = 'ativa')
);

-- Importa o histórico legado de VT sem apagar nem modificar rh_topups.
-- O vínculo é resolvido para o registro central por registry_employee_id.
insert into public.rh_vt_topups(
  source_legacy_topup_id, employee_id, paid_at, competence_month, amount_cents,
  idempotency_key, treasury_idempotency_key, created_by, updated_by, created_at, updated_at
)
select
  old.id,
  canonical.id,
  old.paid_at,
  date_trunc('month', old.paid_at)::date,
  old.amount_cents,
  'legacy-rh-topup:' || old.id::text,
  'rh-vt:legacy:' || old.id::text,
  old.created_by,
  old.created_by,
  old.created_at,
  old.created_at
from public.rh_topups old
join public.rh_employees legacy_employee on legacy_employee.id = old.employee_id
join public.rh_employees canonical
  on canonical.id = coalesce(legacy_employee.registry_employee_id, legacy_employee.id)
 and canonical.registry_employee_id = canonical.id
where old.benefit_type = 'passagem'
on conflict (source_legacy_topup_id) do nothing;

-- Registra a origem histórica sem simular uma ação feita agora pelo operador.
insert into public.rh_vt_topup_audit(topup_id, employee_id, actor_user_id, action, after_data, created_at)
select vt.id, vt.employee_id, vt.created_by, 'importada', to_jsonb(vt), vt.created_at
from public.rh_vt_topups vt
where vt.source_legacy_topup_id is not null
  and not exists (select 1 from public.rh_vt_topup_audit a where a.topup_id=vt.id);

create index if not exists rh_vt_topups_employee_history_idx
  on public.rh_vt_topups(employee_id, paid_at desc, created_at desc);
create index if not exists rh_vt_topups_competence_idx
  on public.rh_vt_topups(company_id, competence_month, status);

create table if not exists public.rh_vt_topup_audit (
  id uuid primary key default gen_random_uuid(),
  topup_id uuid not null references public.rh_vt_topups(id) on delete restrict,
  employee_id uuid not null references public.rh_employees(id) on delete restrict,
  actor_user_id uuid references public.users(id) on delete set null,
  action text not null check (action in ('criada','editada','cancelada')),
  before_data jsonb,
  after_data jsonb not null,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists rh_vt_topup_audit_topup_idx
  on public.rh_vt_topup_audit(topup_id, created_at desc);

alter table public.rh_vt_employee_config enable row level security;
alter table public.rh_vt_topups enable row level security;
alter table public.rh_vt_topup_audit enable row level security;
revoke all on public.rh_vt_employee_config, public.rh_vt_topups, public.rh_vt_topup_audit from anon, authenticated;
grant all on public.rh_vt_employee_config, public.rh_vt_topups, public.rh_vt_topup_audit to service_role;

create or replace function public.rh_vt_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists rh_vt_employee_config_updated_at on public.rh_vt_employee_config;
create trigger rh_vt_employee_config_updated_at before update on public.rh_vt_employee_config
for each row execute function public.rh_vt_set_updated_at();
drop trigger if exists rh_vt_topups_updated_at on public.rh_vt_topups;
create trigger rh_vt_topups_updated_at before update on public.rh_vt_topups
for each row execute function public.rh_vt_set_updated_at();

create or replace function public.rh_vt_audit_topup_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_action text;
  v_actor uuid;
  v_reason text;
begin
  if tg_op = 'INSERT' then
    v_action := 'criada';
    v_actor := new.created_by;
    insert into public.rh_vt_topup_audit(topup_id, employee_id, actor_user_id, action, before_data, after_data)
    values (new.id, new.employee_id, v_actor, v_action, null, to_jsonb(new));
    return new;
  end if;

  v_actor := coalesce(new.updated_by, new.cancelled_by);
  if old.status = 'ativa' and new.status = 'cancelada' then
    v_action := 'cancelada';
    v_reason := new.cancel_reason;
  else
    v_action := 'editada';
    v_reason := new.change_reason;
  end if;

  insert into public.rh_vt_topup_audit(topup_id, employee_id, actor_user_id, action, before_data, after_data, reason)
  values (new.id, new.employee_id, v_actor, v_action, to_jsonb(old), to_jsonb(new), v_reason);
  return new;
end;
$$;

drop trigger if exists rh_vt_topups_audit on public.rh_vt_topups;
create trigger rh_vt_topups_audit after insert or update on public.rh_vt_topups
for each row execute function public.rh_vt_audit_topup_change();

create or replace function public.rh_vt_block_audit_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'A auditoria de Vale-Transporte é imutável.';
end;
$$;
drop trigger if exists rh_vt_topup_audit_immutable on public.rh_vt_topup_audit;
create trigger rh_vt_topup_audit_immutable before update or delete on public.rh_vt_topup_audit
for each row execute function public.rh_vt_block_audit_mutation();

create or replace function public.rh_vt_create_topups_batch(p_rows jsonb, p_actor uuid)
returns setof public.rh_vt_topups
language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb;
  v_employee uuid;
  v_idempotency text;
  v_treasury_key text;
  v_created public.rh_vt_topups;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Informe ao menos uma recarga.';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'O lote não pode exceder 500 recargas.';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_employee := (v_row->>'employee_id')::uuid;
    v_idempotency := nullif(trim(v_row->>'idempotency_key'), '');
    v_treasury_key := nullif(trim(v_row->>'treasury_idempotency_key'), '');
    if v_idempotency is null or v_treasury_key is null then
      raise exception 'Chaves de idempotência são obrigatórias.';
    end if;
    if not exists (
      select 1 from public.rh_employees e
      where e.id = v_employee and e.registry_employee_id = e.id and e.is_active = true
    ) then
      raise exception 'Funcionário central inexistente ou inativo: %', v_employee;
    end if;

    insert into public.rh_vt_topups(
      employee_id, company_id, paid_at, competence_month, amount_cents, cost_center,
      receipt_storage_path, idempotency_key, treasury_idempotency_key, created_by, updated_by
    ) values (
      v_employee,
      nullif(v_row->>'company_id','')::uuid,
      (v_row->>'paid_at')::date,
      date_trunc('month', (v_row->>'paid_at')::date)::date,
      (v_row->>'amount_cents')::bigint,
      nullif(trim(v_row->>'cost_center'),''),
      nullif(trim(v_row->>'receipt_storage_path'),''),
      v_idempotency,
      v_treasury_key,
      p_actor,
      p_actor
    )
    on conflict (idempotency_key) do nothing
    returning * into v_created;

    if not found then
      select * into v_created from public.rh_vt_topups where idempotency_key = v_idempotency;
      if v_created.employee_id <> v_employee
         or v_created.amount_cents <> (v_row->>'amount_cents')::bigint
         or v_created.paid_at <> (v_row->>'paid_at')::date then
        raise exception 'Chave de idempotência reutilizada com dados diferentes.';
      end if;
    end if;
    return next v_created;
  end loop;
end;
$$;

create or replace function public.rh_vt_update_topup(
  p_topup_id uuid, p_amount_cents bigint, p_paid_at date, p_cost_center text,
  p_receipt_storage_path text, p_reason text, p_actor uuid
) returns public.rh_vt_topups
language plpgsql security definer set search_path = public as $$
declare v_result public.rh_vt_topups;
begin
  if p_amount_cents <= 0 or nullif(trim(p_reason),'') is null then
    raise exception 'Valor válido e motivo da edição são obrigatórios.';
  end if;
  update public.rh_vt_topups
  set amount_cents=p_amount_cents, paid_at=p_paid_at,
      competence_month=date_trunc('month',p_paid_at)::date,
      cost_center=nullif(trim(p_cost_center),''),
      receipt_storage_path=nullif(trim(p_receipt_storage_path),''),
      change_reason=trim(p_reason), updated_by=p_actor
  where id=p_topup_id and status='ativa'
  returning * into v_result;
  if not found then raise exception 'Recarga ativa não encontrada.'; end if;
  return v_result;
end;
$$;

create or replace function public.rh_vt_cancel_topup(p_topup_id uuid, p_reason text, p_actor uuid)
returns public.rh_vt_topups
language plpgsql security definer set search_path = public as $$
declare v_result public.rh_vt_topups;
begin
  if nullif(trim(p_reason),'') is null then raise exception 'Justificativa do cancelamento é obrigatória.'; end if;
  update public.rh_vt_topups
  set status='cancelada', cancel_reason=trim(p_reason), cancelled_by=p_actor,
      cancelled_at=now(), updated_by=p_actor
  where id=p_topup_id and status='ativa'
  returning * into v_result;
  if not found then raise exception 'Recarga ativa não encontrada.'; end if;
  return v_result;
end;
$$;

revoke all on function public.rh_vt_create_topups_batch(jsonb,uuid) from public, anon, authenticated;
revoke all on function public.rh_vt_update_topup(uuid,bigint,date,text,text,text,uuid) from public, anon, authenticated;
revoke all on function public.rh_vt_cancel_topup(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.rh_vt_create_topups_batch(jsonb,uuid) to service_role;
grant execute on function public.rh_vt_update_topup(uuid,bigint,date,text,text,text,uuid) to service_role;
grant execute on function public.rh_vt_cancel_topup(uuid,text,uuid) to service_role;

comment on table public.rh_vt_employee_config is 'Configuração de Vale-Transporte vinculada ao cadastro central rh_employees.id.';
comment on table public.rh_vt_topups is 'Recargas de VT com competência, idempotência e preparação de integração futura; não gera lançamento financeiro.';
comment on table public.rh_vt_topup_audit is 'Trilha imutável de criação, edição e cancelamento de recargas de Vale-Transporte.';

notify pgrst, 'reload schema';
