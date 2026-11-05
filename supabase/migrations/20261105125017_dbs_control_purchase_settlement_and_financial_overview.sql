-- Additive purchase settlement and management metrics for DBS Treasury.
-- All monetary movements are posted through the existing double-entry Ledger.

begin;

alter table public.dbs_control_purchases
  add column if not exists paid_cents bigint not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'dbs_control_purchases_paid_cents_check'
      and conrelid = 'public.dbs_control_purchases'::regclass
  ) then
    alter table public.dbs_control_purchases
      add constraint dbs_control_purchases_paid_cents_check
      check (paid_cents >= 0 and paid_cents <= total_cents);
  end if;
end;
$$;

create table if not exists public.dbs_control_purchase_payments (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.dbs_control_purchases(id) on delete restrict,
  scope_key text not null,
  amount_cents bigint not null check (amount_cents > 0),
  payment_method text not null
    check (payment_method in ('cash','pix','bank_transfer','card','other')),
  ledger_entry_id uuid not null references public.treasury_ledger_entries(id) on delete restrict,
  idempotency_key text not null
    check (char_length(trim(idempotency_key)) between 8 and 240),
  payload_hash text not null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (scope_key, idempotency_key)
);

create index if not exists dbs_control_purchase_payments_purchase_idx
  on public.dbs_control_purchase_payments(purchase_id, created_at desc);

alter table public.dbs_control_purchase_payments enable row level security;
revoke all on public.dbs_control_purchase_payments from anon, authenticated;
grant all on public.dbs_control_purchase_payments to service_role;

create or replace function public.dbs_control_settle_purchase(
  p_purchase_id uuid,
  p_actor_user_id uuid,
  p_amount_cents bigint,
  p_payment_method text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_purchase public.dbs_control_purchases%rowtype;
  v_actor_company uuid;
  v_key text := nullif(btrim(p_idempotency_key), '');
  v_method text := lower(coalesce(nullif(btrim(p_payment_method), ''), 'other'));
  v_hash text;
  v_existing public.dbs_control_purchase_payments%rowtype;
  v_remaining bigint;
  v_ledger jsonb;
  v_ledger_id uuid;
  v_paid bigint;
  v_status text;
begin
  if p_actor_user_id is null or not public.dbs_control_is_admin_actor(p_actor_user_id) then
    raise exception 'DBS_PURCHASE_PAYMENT_FORBIDDEN' using errcode = '42501';
  end if;
  if p_purchase_id is null or p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'DBS_PURCHASE_PAYMENT_AMOUNT_INVALID' using errcode = '22023';
  end if;
  if v_key is null or char_length(v_key) not between 8 and 240 then
    raise exception 'DBS_PURCHASE_PAYMENT_IDEMPOTENCY_REQUIRED' using errcode = '22023';
  end if;
  if v_method not in ('cash','pix','bank_transfer','card','other') then
    raise exception 'DBS_PURCHASE_PAYMENT_METHOD_INVALID' using errcode = '22023';
  end if;

  select company_id into v_actor_company
    from public.users where id = p_actor_user_id and status = 'ativo';
  select * into v_purchase
    from public.dbs_control_purchases
   where id = p_purchase_id
   for update;
  if not found then
    raise exception 'DBS_PURCHASE_NOT_FOUND' using errcode = '23503';
  end if;
  if v_actor_company is not null and v_actor_company is distinct from v_purchase.company_id then
    raise exception 'DBS_PURCHASE_SCOPE_MISMATCH' using errcode = '42501';
  end if;
  if v_purchase.status = 'cancelled' then
    raise exception 'DBS_PURCHASE_CANCELLED' using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_purchase.scope_key || ':purchase-payment:' || v_key, 0));
  select * into v_existing
    from public.dbs_control_purchase_payments
   where scope_key = v_purchase.scope_key and idempotency_key = v_key
   for update;
  v_hash := md5(jsonb_build_object(
    'purchase_id', p_purchase_id,
    'amount_cents', p_amount_cents,
    'payment_method', v_method
  )::text);
  if found then
    if v_existing.payload_hash <> v_hash then
      raise exception 'DBS_PURCHASE_PAYMENT_IDEMPOTENCY_REUSE' using errcode = '22023';
    end if;
    return jsonb_build_object(
      'ok', true, 'replayed', true, 'purchase_id', p_purchase_id,
      'payment_id', v_existing.id, 'amount_cents', v_existing.amount_cents,
      'ledger_entry_id', v_existing.ledger_entry_id,
      'paid_cents', v_purchase.paid_cents, 'payment_status', v_purchase.payment_status
    );
  end if;

  v_remaining := v_purchase.total_cents - v_purchase.paid_cents;
  if p_amount_cents > v_remaining then
    raise exception 'DBS_PURCHASE_PAYMENT_EXCEEDS_BALANCE: saldo restante % centavos.', v_remaining
      using errcode = '22023';
  end if;

  v_ledger := public.post_treasury_ledger_entry(
    v_purchase.scope_key, v_purchase.company_id, current_date, current_date,
    'purchase_payment', 'Pagamento de fornecedor · ' || v_purchase.supplier_name,
    left('purchase-payment:' || v_key, 200),
    'purchase-payment:' || p_purchase_id::text || ':' || v_key,
    p_actor_user_id, 'posted',
    jsonb_build_object(
      'source', 'dbs_control_purchase_payment',
      'purchase_id', p_purchase_id,
      'payment_method', v_method
    ),
    jsonb_build_array(
      jsonb_build_object(
        'account_code', '2.1.01', 'account_name', 'Fornecedores',
        'account_type', 'liability', 'debit_cents', p_amount_cents,
        'credit_cents', 0, 'memo', 'Baixa de contas a pagar'
      ),
      jsonb_build_object(
        'account_code', '1.1.01', 'account_name', 'Caixa e bancos',
        'account_type', 'asset', 'debit_cents', 0,
        'credit_cents', p_amount_cents, 'memo', 'Pagamento ao fornecedor'
      )
    )
  );
  v_ledger_id := nullif(v_ledger->>'entry_id', '')::uuid;
  if v_ledger_id is null then
    raise exception 'DBS_PURCHASE_PAYMENT_LEDGER_FAILED' using errcode = '23514';
  end if;

  insert into public.dbs_control_purchase_payments(
    purchase_id, scope_key, amount_cents, payment_method,
    ledger_entry_id, idempotency_key, payload_hash, created_by
  ) values (
    p_purchase_id, v_purchase.scope_key, p_amount_cents, v_method,
    v_ledger_id, v_key, v_hash, p_actor_user_id
  );

  v_paid := v_purchase.paid_cents + p_amount_cents;
  v_status := case when v_paid >= v_purchase.total_cents then 'paid' else 'partial' end;
  update public.dbs_control_purchases
     set paid_cents = v_paid,
         payment_status = v_status,
         version = version + 1,
         updated_at = now()
   where id = p_purchase_id;

  return jsonb_build_object(
    'ok', true, 'replayed', false, 'purchase_id', p_purchase_id,
    'payment_id', (select id from public.dbs_control_purchase_payments where scope_key = v_purchase.scope_key and idempotency_key = v_key),
    'amount_cents', p_amount_cents, 'paid_cents', v_paid,
    'remaining_cents', v_purchase.total_cents - v_paid,
    'payment_status', v_status, 'ledger_entry_id', v_ledger_id
  );
end;
$$;

create or replace function public.dbs_control_inventory_financial_overview(
  p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_id uuid;
  v_scope_key text;
  v_stock_value bigint := 0;
  v_purchases_month bigint := 0;
  v_accounts_payable bigint := 0;
  v_operating_cost bigint := 0;
  v_revenue bigint := 0;
  v_gross_profit bigint := 0;
  v_margin numeric(12,2) := 0;
begin
  if p_actor_user_id is null or not public.dbs_control_is_admin_actor(p_actor_user_id) then
    raise exception 'DBS_INVENTORY_OVERVIEW_FORBIDDEN' using errcode = '42501';
  end if;
  select company_id into v_company_id
    from public.users where id = p_actor_user_id and status = 'ativo';
  v_scope_key := case
    when v_company_id is not null then 'company:' || v_company_id::text
    else 'user:' || p_actor_user_id::text
  end;

  select coalesce(round(sum(greatest(stock_quantity, 0) * greatest(cost_cents, 0))), 0)::bigint
    into v_stock_value
    from public.dbs_control_parts
   where status = 'ativo';

  select coalesce(sum(total_cents), 0)::bigint
    into v_purchases_month
    from public.dbs_control_purchases
   where scope_key = v_scope_key
     and purchase_date >= date_trunc('month', current_date)::date
     and purchase_date < (date_trunc('month', current_date) + interval '1 month')::date
     and status <> 'cancelled';

  select coalesce(sum(greatest(total_cents - paid_cents, 0)), 0)::bigint
    into v_accounts_payable
    from public.dbs_control_purchases
   where scope_key = v_scope_key and status <> 'cancelled';

  select coalesce(sum(parts_cost_cents), 0)::bigint,
         coalesce(sum(revenue_cents), 0)::bigint
    into v_operating_cost, v_revenue
    from public.dbs_control_work_order_financials
   where scope_key = v_scope_key and status <> 'reversed';

  v_gross_profit := v_revenue - v_operating_cost;
  v_margin := case when v_revenue > 0
    then round((v_gross_profit::numeric / v_revenue::numeric) * 100, 2)
    else 0 end;

  return jsonb_build_object(
    'scope_key', v_scope_key,
    'stock_value_cents', v_stock_value,
    'purchases_month_cents', v_purchases_month,
    'accounts_payable_cents', v_accounts_payable,
    'operating_cost_cents', v_operating_cost,
    'revenue_cents', v_revenue,
    'gross_profit_cents', v_gross_profit,
    'gross_margin_pct', v_margin,
    'as_of', now()
  );
end;
$$;

revoke all on function public.dbs_control_settle_purchase(uuid,uuid,bigint,text,text) from public, anon, authenticated;
grant execute on function public.dbs_control_settle_purchase(uuid,uuid,bigint,text,text) to service_role;
revoke all on function public.dbs_control_inventory_financial_overview(uuid) from public, anon, authenticated;
grant execute on function public.dbs_control_inventory_financial_overview(uuid) to service_role;

commit;
