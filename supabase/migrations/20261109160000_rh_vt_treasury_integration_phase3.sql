-- DBS AIR · Fase 3 RH → DBS TREASURY V10
-- Aditiva, dependente da Fase 2. Não altera o razão existente nem o Outbox do DBS Control.
begin;

alter table public.rh_vt_topups
  add column if not exists financial_entry_id uuid
    references public.treasury_ledger_entries(id) on delete restrict,
  add column if not exists financial_reversal_entry_id uuid
    references public.treasury_ledger_entries(id) on delete restrict,
  add column if not exists financial_revision integer not null default 0
    check (financial_revision >= 0);

create table if not exists public.rh_vt_financial_events (
  id uuid primary key default gen_random_uuid(),
  topup_id uuid not null,
  employee_id uuid not null references public.rh_employees(id) on delete restrict,
  company_id uuid references public.companies(id) on delete restrict,
  event_type text not null check (event_type in ('approved','edit_reversal','edit_approved','cancel_reversal')),
  revision integer not null default 0 check (revision >= 0),
  amount_cents bigint not null check (amount_cents > 0),
  competence_month date not null,
  ledger_entry_id uuid not null references public.treasury_ledger_entries(id) on delete restrict,
  reversed_entry_id uuid references public.treasury_ledger_entries(id) on delete restrict,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  constraint rh_vt_financial_events_topup_fk
    foreign key (topup_id) references public.rh_vt_topups(id) on delete restrict
    deferrable initially deferred
);

create index if not exists rh_vt_financial_events_competence_idx
  on public.rh_vt_financial_events(company_id, competence_month, employee_id);
create index if not exists rh_vt_financial_events_ledger_idx
  on public.rh_vt_financial_events(ledger_entry_id);

alter table public.rh_vt_financial_events enable row level security;
revoke all on public.rh_vt_financial_events from anon, authenticated;
grant all on public.rh_vt_financial_events to service_role;

create or replace function public.rh_vt_post_financial_entry(
  p_topup_id uuid,
  p_employee_id uuid,
  p_company_id uuid,
  p_actor uuid,
  p_competence date,
  p_document_date date,
  p_amount_cents bigint,
  p_cost_center text,
  p_revision integer,
  p_event_type text,
  p_idempotency_key text,
  p_lines jsonb,
  p_reversed_entry_id uuid default null
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_scope text;
  v_result jsonb;
  v_entry_id uuid;
  v_existing public.treasury_ledger_entries;
  v_account record;
  v_metadata jsonb;
begin
  if p_amount_cents <= 0 or p_competence is null or p_actor is null then
    raise exception 'RH_VT_FINANCIAL_PAYLOAD_INVALID';
  end if;
  v_scope := case when p_company_id is not null
    then 'company:' || p_company_id::text
    else 'user:' || p_actor::text end;

  -- Do not silently reuse a code already assigned to a different account.
  for v_account in
    select * from (values
      ('3.1.02.01'::text, 'Despesas com Vale-Transporte'::text, 'expense'::text),
      ('2.1.02.01'::text, 'Vale-Transporte a Pagar'::text, 'liability'::text)
    ) as expected(code,name,account_type)
  loop
    if exists (
      select 1 from public.treasury_accounts a
      where a.scope_key = v_scope and a.code = v_account.code
        and (a.account_type <> v_account.account_type or a.name <> v_account.name or not a.is_active)
    ) then
      raise exception 'RH_VT_ACCOUNT_MAPPING_CONFLICT: %', v_account.code;
    end if;
  end loop;

  v_metadata := jsonb_build_object(
    'source_module','rh',
    'source_type','vale_transporte',
    'rh_vt_topup_id',p_topup_id,
    'employee_id',p_employee_id,
    'cost_center',p_cost_center,
    'financial_event',p_event_type,
    'financial_revision',p_revision
  );

  v_result := public.post_treasury_ledger_entry(
    v_scope,
    p_company_id,
    date_trunc('month',p_competence)::date,
    p_document_date,
    'rh_vt_' || p_event_type,
    case
      when p_event_type in ('edit_reversal','cancel_reversal')
        then 'Estorno de Vale-Transporte · recarga ' || p_topup_id::text
      else 'Vale-Transporte · recarga ' || p_topup_id::text
    end,
    p_idempotency_key,
    'RH_VT:' || p_topup_id::text || ':' || p_event_type || ':' || p_revision::text,
    p_actor,
    'posted',
    v_metadata,
    p_lines
  );
  v_entry_id := (v_result->>'entry_id')::uuid;

  select * into v_existing
    from public.treasury_ledger_entries where id = v_entry_id;
  if v_existing.metadata->>'rh_vt_topup_id' is distinct from p_topup_id::text
     or v_existing.idempotency_key <> p_idempotency_key then
    raise exception 'RH_VT_IDEMPOTENCY_COLLISION';
  end if;

  -- Tag only the entry returned for this RH idempotency key; no ledger lines or
  -- previously posted entries are rewritten.
  update public.treasury_ledger_entries
     set source_module = 'rh',
         metadata = coalesce(metadata,'{}'::jsonb) || v_metadata,
         reversed_entry_id = coalesce(p_reversed_entry_id, reversed_entry_id)
   where id = v_entry_id;

  return v_result || jsonb_build_object('entry_id',v_entry_id,'scope_key',v_scope);
end;
$$;

create or replace function public.rh_vt_reverse_financial_entry(
  p_original_entry_id uuid,
  p_topup_id uuid,
  p_employee_id uuid,
  p_company_id uuid,
  p_actor uuid,
  p_revision integer,
  p_event_type text,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_original public.treasury_ledger_entries;
  v_amount bigint;
  v_lines jsonb;
begin
  select * into v_original
    from public.treasury_ledger_entries
   where id = p_original_entry_id for share;
  if not found then raise exception 'RH_VT_ORIGINAL_ENTRY_NOT_FOUND'; end if;
  if v_original.status <> 'posted' then raise exception 'RH_VT_ORIGINAL_ENTRY_NOT_POSTED'; end if;
  if v_original.source_module <> 'rh'
     or v_original.metadata->>'rh_vt_topup_id' <> p_topup_id::text then
    raise exception 'RH_VT_ORIGINAL_ENTRY_SOURCE_MISMATCH';
  end if;

  select coalesce(sum(l.debit_cents),0)
    into v_amount
    from public.treasury_ledger_lines l
    join public.treasury_accounts a on a.id=l.account_id
   where l.entry_id=p_original_entry_id and a.code='3.1.02.01';
  if v_amount <= 0 then raise exception 'RH_VT_ORIGINAL_AMOUNT_INVALID'; end if;

  select jsonb_agg(jsonb_build_object(
    'account_code',a.code,
    'account_name',a.name,
    'account_type',a.account_type,
    'debit_cents',l.credit_cents,
    'credit_cents',l.debit_cents,
    'memo','Estorno · ' || coalesce(l.memo,'Vale-Transporte'),
    'metadata',coalesce(l.metadata,'{}'::jsonb) || jsonb_build_object('reversal_of_entry_id',p_original_entry_id)
  ) order by l.line_no)
  into v_lines
  from public.treasury_ledger_lines l
  join public.treasury_accounts a on a.id=l.account_id
  where l.entry_id=p_original_entry_id;

  return public.rh_vt_post_financial_entry(
    p_topup_id,p_employee_id,p_company_id,p_actor,
    v_original.competence_date,current_date,v_amount,
    v_original.metadata->>'cost_center',p_revision,p_event_type,
    p_idempotency_key,v_lines,p_original_entry_id
  );
end;
$$;

create or replace function public.rh_vt_financial_sync_before_write()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_post jsonb;
  v_reversal jsonb;
  v_new_entry_id uuid;
  v_reversal_entry_id uuid;
  v_revision integer;
  v_key text;
  v_lines jsonb;
begin
  if tg_op = 'UPDATE' then
    -- Imported legacy rows are not posted retroactively. If an operator edits
    -- one after this integration is enabled, the edited active value is posted
    -- as a new recognition; a cancellation without a prior entry has no reversal.
    if old.status = new.status
       and old.amount_cents = new.amount_cents
       and old.paid_at = new.paid_at
       and old.cost_center is not distinct from new.cost_center
       and old.company_id is not distinct from new.company_id
       and old.employee_id = new.employee_id then
      return new;
    end if;
    v_revision := old.financial_revision + 1;
    new.financial_revision := v_revision;

    if old.financial_entry_id is not null then
      if old.status = 'ativa' then
        v_key := 'RH_VT_RECHARGE_' || old.id::text || case
          when new.status = 'cancelada' then '_CANCEL_REVERSAL'
          else '_EDIT_REVERSAL_' || v_revision::text end;
        v_reversal := public.rh_vt_reverse_financial_entry(
          old.financial_entry_id,old.id,old.employee_id,old.company_id,
          coalesce(new.updated_by,new.cancelled_by,old.updated_by,old.created_by),
          v_revision,
          case when new.status='cancelada' then 'cancel_reversal' else 'edit_reversal' end,
          v_key
        );
        v_reversal_entry_id := (v_reversal->>'entry_id')::uuid;
        insert into public.rh_vt_financial_events(
          topup_id,employee_id,company_id,event_type,revision,amount_cents,
          competence_month,ledger_entry_id,reversed_entry_id,idempotency_key
        ) values (
          old.id,old.employee_id,old.company_id,
          case when new.status='cancelada' then 'cancel_reversal' else 'edit_reversal' end,
          v_revision,old.amount_cents,date_trunc('month',old.paid_at)::date,
          v_reversal_entry_id,old.financial_entry_id,v_key
        ) on conflict (idempotency_key) do nothing;
      end if;
    end if;

    if new.status = 'cancelada' then
      new.financial_status := case when old.financial_entry_id is null then 'nao_integrado' else 'integrado' end;
      new.financial_reversal_entry_id := v_reversal_entry_id;
      return new;
    end if;

    new.financial_entry_id := null;
    new.financial_reversal_entry_id := v_reversal_entry_id;
  else
    v_revision := 0;
    new.financial_revision := 0;
  end if;

  if new.status = 'ativa' then
    v_key := 'RH_VT_RECHARGE_' || new.id::text ||
      case when tg_op='INSERT' then '_APPROVED' else '_EDIT_APPROVED_' || v_revision::text end;
    v_lines := jsonb_build_array(
      jsonb_build_object(
        'account_code','3.1.02.01',
        'account_name','Despesas com Vale-Transporte',
        'account_type','expense',
        'debit_cents',new.amount_cents,
        'credit_cents',0,
        'memo','Despesa VT · ' || coalesce(new.cost_center,'sem centro de custo'),
        'metadata',jsonb_build_object('employee_id',new.employee_id,'cost_center',new.cost_center)
      ),
      jsonb_build_object(
        'account_code','2.1.02.01',
        'account_name','Vale-Transporte a Pagar',
        'account_type','liability',
        'debit_cents',0,
        'credit_cents',new.amount_cents,
        'memo','Obrigação VT · ' || coalesce(new.cost_center,'sem centro de custo'),
        'metadata',jsonb_build_object('employee_id',new.employee_id,'cost_center',new.cost_center)
      )
    );
    v_post := public.rh_vt_post_financial_entry(
      new.id,new.employee_id,new.company_id,
      coalesce(new.updated_by,new.created_by),
      new.paid_at,current_date,new.amount_cents,new.cost_center,
      v_revision,
      case when tg_op='INSERT' then 'approved' else 'edit_approved' end,
      v_key,v_lines,null
    );
    v_new_entry_id := (v_post->>'entry_id')::uuid;
    new.financial_entry_id := v_new_entry_id;
    new.financial_status := 'integrado';
    insert into public.rh_vt_financial_events(
      topup_id,employee_id,company_id,event_type,revision,amount_cents,
      competence_month,ledger_entry_id,reversed_entry_id,idempotency_key
    ) values (
      new.id,new.employee_id,new.company_id,
      case when tg_op='INSERT' then 'approved' else 'edit_approved' end,
      v_revision,new.amount_cents,date_trunc('month',new.paid_at)::date,
      v_new_entry_id,null,v_key
    ) on conflict (idempotency_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists rh_vt_topups_financial_sync on public.rh_vt_topups;
create trigger rh_vt_topups_financial_sync
before insert or update on public.rh_vt_topups
for each row execute function public.rh_vt_financial_sync_before_write();

create or replace function public.rh_vt_block_financial_event_mutation()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'A trilha financeira RH/VT é imutável.';
end;
$$;
drop trigger if exists rh_vt_financial_events_immutable on public.rh_vt_financial_events;
create trigger rh_vt_financial_events_immutable
before update or delete on public.rh_vt_financial_events
for each row execute function public.rh_vt_block_financial_event_mutation();

create or replace function public.rh_vt_financial_report(
  p_competence_start date,
  p_competence_end date,
  p_company_id uuid default null
) returns table (
  employee_id uuid,
  employee_name text,
  company_id uuid,
  competence_month date,
  rh_total_cents bigint,
  treasury_total_cents bigint,
  difference_cents bigint,
  divergence boolean
)
language sql stable security definer
set search_path = public, pg_temp
as $$
  with rh as (
    select t.employee_id,t.company_id,t.competence_month,
           sum(t.amount_cents)::bigint as total_cents
      from public.rh_vt_topups t
     where t.status='ativa'
       and t.competence_month >= date_trunc('month',p_competence_start)::date
       and t.competence_month < date_trunc('month',p_competence_end)::date
       and (p_company_id is null or t.company_id=p_company_id)
     group by t.employee_id,t.company_id,t.competence_month
  ), ledger as (
    select (e.metadata->>'employee_id')::uuid as employee_id,
           e.company_id,date_trunc('month',e.competence_date)::date as competence_month,
           sum(l.debit_cents-l.credit_cents)::bigint as total_cents
      from public.treasury_ledger_entries e
      join public.treasury_ledger_lines l on l.entry_id=e.id
      join public.treasury_accounts a on a.id=l.account_id
     where e.status='posted' and e.source_module='rh'
       and e.metadata->>'source_type'='vale_transporte'
       and a.code='3.1.02.01'
       and e.competence_date >= date_trunc('month',p_competence_start)::date
       and e.competence_date < date_trunc('month',p_competence_end)::date
       and (p_company_id is null or e.company_id=p_company_id)
     group by (e.metadata->>'employee_id')::uuid,e.company_id,date_trunc('month',e.competence_date)::date
  ), combined as (
    select coalesce(r.employee_id,l.employee_id) as employee_id,
           coalesce(r.company_id,l.company_id) as company_id,
           coalesce(r.competence_month,l.competence_month) as competence_month,
           coalesce(r.total_cents,0)::bigint as rh_total_cents,
           coalesce(l.total_cents,0)::bigint as treasury_total_cents
      from rh r full join ledger l
        on l.employee_id=r.employee_id
       and l.company_id is not distinct from r.company_id
       and l.competence_month=r.competence_month
  )
  select c.employee_id,e.full_name,c.company_id,c.competence_month,
         c.rh_total_cents,c.treasury_total_cents,
         c.rh_total_cents-c.treasury_total_cents,
         c.rh_total_cents<>c.treasury_total_cents
    from combined c
    left join public.rh_employees e on e.id=c.employee_id
   order by c.competence_month desc,e.full_name;
$$;

revoke all on function public.rh_vt_post_financial_entry(uuid,uuid,uuid,uuid,date,date,bigint,text,integer,text,text,jsonb,uuid) from public, anon, authenticated;
revoke all on function public.rh_vt_reverse_financial_entry(uuid,uuid,uuid,uuid,uuid,integer,text,text) from public, anon, authenticated;
revoke all on function public.rh_vt_financial_sync_before_write() from public, anon, authenticated;
revoke all on function public.rh_vt_block_financial_event_mutation() from public, anon, authenticated;
revoke all on function public.rh_vt_financial_report(date,date,uuid) from public, anon, authenticated;
grant execute on function public.rh_vt_post_financial_entry(uuid,uuid,uuid,uuid,date,date,bigint,text,integer,text,text,jsonb,uuid) to service_role;
grant execute on function public.rh_vt_reverse_financial_entry(uuid,uuid,uuid,uuid,uuid,integer,text,text) to service_role;
grant execute on function public.rh_vt_financial_report(date,date,uuid) to service_role;

comment on table public.rh_vt_financial_events is 'Trilha append-only de lançamentos, ajustes e estornos de Vale-Transporte no DBS TREASURY V10.';
comment on function public.rh_vt_financial_report(date,date,uuid) is 'Conciliação RH x Treasury por funcionário e competência; diferenças são retornadas sem ajuste automático.';

notify pgrst, 'reload schema';
commit;
