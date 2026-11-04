-- DBS Air | Fase 3: relatórios consolidados derivados exclusivamente do Ledger.
-- Views read-only, sem snapshots, tabelas operacionais ou mutação de lançamentos.
begin;

create index if not exists treasury_entries_scope_document_date_idx
  on public.treasury_ledger_entries(scope_key,status,document_date desc);
create index if not exists treasury_lines_account_entry_idx
  on public.treasury_ledger_lines(account_id,entry_id);

create or replace view public.treasury_vw_dre_competence_by_account
with (security_invoker = true) as
select
  e.company_id,
  e.scope_key,
  date_trunc('month',e.competence_date)::date as competence_month,
  a.id as account_id,
  a.code as account_code,
  a.name as account_name,
  a.account_type,
  sum(l.debit_cents)::numeric as debit_cents,
  sum(l.credit_cents)::numeric as credit_cents,
  case
    when a.account_type='revenue' then sum(l.credit_cents-l.debit_cents)
    when a.account_type='expense' then sum(l.debit_cents-l.credit_cents)
    else 0
  end::numeric as signed_amount_cents
from public.treasury_ledger_entries e
join public.treasury_ledger_lines l on l.entry_id=e.id
join public.treasury_accounts a on a.id=l.account_id
where e.status='posted'
  and a.account_type in ('revenue','expense')
group by e.company_id,e.scope_key,date_trunc('month',e.competence_date)::date,
  a.id,a.code,a.name,a.account_type;

create or replace view public.treasury_vw_dre_competence
with (security_invoker = true) as
select
  d.company_id,
  d.scope_key,
  d.competence_month,
  coalesce(sum(d.signed_amount_cents) filter(where d.account_type='revenue'),0)::numeric as revenue_cents,
  coalesce(sum(d.signed_amount_cents) filter(where d.account_type='expense'),0)::numeric as expense_cents,
  (
    coalesce(sum(d.signed_amount_cents) filter(where d.account_type='revenue'),0)
    - coalesce(sum(d.signed_amount_cents) filter(where d.account_type='expense'),0)
  )::numeric as net_result_cents
from public.treasury_vw_dre_competence_by_account d
group by d.company_id,d.scope_key,d.competence_month;

create or replace view public.treasury_vw_cash_flow_monthly_by_account
with (security_invoker = true) as
with monthly_cash as (
  select
    e.company_id,
    e.scope_key,
    date_trunc('month',coalesce(e.document_date,e.competence_date))::date as cash_month,
    a.id as account_id,
    a.code as account_code,
    a.name as account_name,
    sum(l.debit_cents)::numeric as inflow_cents,
    sum(l.credit_cents)::numeric as outflow_cents,
    sum(l.debit_cents-l.credit_cents)::numeric as net_cash_movement_cents
  from public.treasury_ledger_entries e
  join public.treasury_ledger_lines l on l.entry_id=e.id
  join public.treasury_accounts a on a.id=l.account_id
  where e.status='posted'
    and a.account_type='asset'
    and (a.code='1.1.01' or a.code like '1.1.01.%')
  group by e.company_id,e.scope_key,
    date_trunc('month',coalesce(e.document_date,e.competence_date))::date,
    a.id,a.code,a.name
)
select
  m.*,
  coalesce(sum(m.net_cash_movement_cents) over (
    partition by m.scope_key,m.account_id
    order by m.cash_month
    rows between unbounded preceding and 1 preceding
  ),0)::numeric as opening_balance_cents,
  sum(m.net_cash_movement_cents) over (
    partition by m.scope_key,m.account_id
    order by m.cash_month
    rows between unbounded preceding and current row
  )::numeric as closing_balance_cents
from monthly_cash m;

create or replace view public.treasury_vw_cash_flow_monthly
with (security_invoker = true) as
with monthly_cash as (
  select
    e.company_id,
    e.scope_key,
    date_trunc('month',coalesce(e.document_date,e.competence_date))::date as cash_month,
    sum(l.debit_cents)::numeric as inflow_cents,
    sum(l.credit_cents)::numeric as outflow_cents,
    sum(l.debit_cents-l.credit_cents)::numeric as net_cash_movement_cents
  from public.treasury_ledger_entries e
  join public.treasury_ledger_lines l on l.entry_id=e.id
  join public.treasury_accounts a on a.id=l.account_id
  where e.status='posted'
    and a.account_type='asset'
    and (a.code='1.1.01' or a.code like '1.1.01.%')
  group by e.company_id,e.scope_key,
    date_trunc('month',coalesce(e.document_date,e.competence_date))::date
)
select
  m.*,
  coalesce(sum(m.net_cash_movement_cents) over (
    partition by m.scope_key order by m.cash_month
    rows between unbounded preceding and 1 preceding
  ),0)::numeric as opening_balance_cents,
  sum(m.net_cash_movement_cents) over (
    partition by m.scope_key order by m.cash_month
    rows between unbounded preceding and current row
  )::numeric as closing_balance_cents
from monthly_cash m;

revoke all on public.treasury_vw_dre_competence_by_account,
  public.treasury_vw_dre_competence,
  public.treasury_vw_cash_flow_monthly_by_account,
  public.treasury_vw_cash_flow_monthly
from public,anon;
grant select on public.treasury_vw_dre_competence_by_account,
  public.treasury_vw_dre_competence,
  public.treasury_vw_cash_flow_monthly_by_account,
  public.treasury_vw_cash_flow_monthly
to authenticated,service_role;

comment on view public.treasury_vw_dre_competence_by_account is
  'DRE por competência e conta, derivada apenas de linhas de lançamentos Ledger postados.';
comment on view public.treasury_vw_dre_competence is
  'DRE consolidada mensal por escopo: receita, despesas e resultado líquido em centavos.';
comment on view public.treasury_vw_cash_flow_monthly_by_account is
  'Fluxo mensal por conta caixa/bancos (1.1.01), usando data documental e saldo acumulado do Ledger.';
comment on view public.treasury_vw_cash_flow_monthly is
  'Fluxo mensal consolidado de caixa/bancos por escopo, usando exclusivamente lançamentos Ledger postados.';

notify pgrst,'reload schema';
commit;
