-- Integration test against the connected Supabase project.
-- Safe to execute: all catalog, purchase, inventory, Ledger and payment writes
-- are enclosed in one transaction and rolled back at the end.
begin;

do $test$
declare
  v_actor uuid;
  v_company uuid;
  v_scope text;
  v_part uuid;
  v_before_stock numeric;
  v_before_cost integer;
  v_after_stock numeric;
  v_after_cost integer;
  v_key text := 'integration-test:' || gen_random_uuid()::text;
  v_payload jsonb;
  v_result jsonb;
  v_replay jsonb;
  v_purchase uuid;
  v_ledger uuid;
  v_payment jsonb;
  v_payment_ledger uuid;
  v_total bigint;
  v_paid bigint;
  v_status text;
  v_movement_count integer;
  v_debits bigint;
  v_credits bigint;
  v_overview jsonb;
begin
  select id, company_id
    into v_actor, v_company
    from public.users
   where status = 'ativo'
     and role_key in ('SUPER_ADMIN','ADMIN_OPERACIONAL','GESTOR_CONTA','GESTOR_REGIONAL')
   order by case role_key when 'SUPER_ADMIN' then 0 else 1 end
   limit 1;
  if v_actor is null then
    raise exception 'TEST_SETUP: nenhum usuário administrador ativo foi encontrado.';
  end if;

  v_scope := case when v_company is not null then 'company:' || v_company::text else 'user:' || v_actor::text end;

  select id, stock_quantity, cost_cents
    into v_part, v_before_stock, v_before_cost
    from public.dbs_control_parts
   order by created_at, id
   limit 1;
  if v_part is null then
    raise exception 'TEST_SETUP: cadastre ao menos uma peça para executar o teste transacional.';
  end if;

  -- The current catalog contains inactive legacy parts. Reactivation is local
  -- to this transaction and is rolled back after the assertions.
  update public.dbs_control_parts set status = 'ativo' where id = v_part;

  v_payload := jsonb_build_object(
    'actor_user_id', v_actor,
    'company_id', v_company,
    'scope_key', v_scope,
    'supplier_name', 'Fornecedor de teste automatizado',
    'document_number', 'TEST-' || replace(v_key, ':', '-'),
    'purchase_date', current_date,
    'payment_status', 'unpaid',
    'idempotency_key', v_key,
    'legacy_key', v_key,
    'items', jsonb_build_array(jsonb_build_object(
      'part_id', v_part,
      'quantity', 2,
      'unit_cost_cents', 12345
    ))
  );

  v_result := public.dbs_control_receive_purchase_safe(v_payload);
  v_purchase := nullif(v_result->>'purchase_id', '')::uuid;
  v_ledger := nullif(v_result->>'ledger_entry_id', '')::uuid;
  if v_purchase is null or v_ledger is null then
    raise exception 'TEST_PURCHASE: RPC não retornou purchase_id e ledger_entry_id: %', v_result;
  end if;

  -- Same request replay must not add another stock movement.
  v_replay := public.dbs_control_receive_purchase_safe(v_payload);
  if nullif(v_replay->>'purchase_id', '')::uuid is distinct from v_purchase then
    raise exception 'TEST_IDEMPOTENCY: replay retornou outra compra.';
  end if;

  select stock_quantity, cost_cents
    into v_after_stock, v_after_cost
    from public.dbs_control_parts where id = v_part;
  if v_after_stock <> coalesce(v_before_stock, 0) + 2 then
    raise exception 'TEST_STOCK: saldo esperado %, recebido %.',
      coalesce(v_before_stock, 0) + 2, v_after_stock;
  end if;
  if v_after_cost <> round(((coalesce(v_before_stock, 0) * coalesce(v_before_cost, 0)) + (2 * 12345)) / (coalesce(v_before_stock, 0) + 2))::integer then
    raise exception 'TEST_AVERAGE_COST: custo médio não foi recalculado. Esperado %, recebido %.',
      round(((coalesce(v_before_stock, 0) * coalesce(v_before_cost, 0)) + (2 * 12345)) / (coalesce(v_before_stock, 0) + 2))::integer,
      v_after_cost;
  end if;

  select count(*) into v_movement_count
    from public.dbs_control_inventory_movements
   where purchase_id = v_purchase and movement_type = 'receipt';
  if v_movement_count <> 1 then
    raise exception 'TEST_MOVEMENT_IDEMPOTENCY: esperada exatamente 1 entrada; encontradas %.', v_movement_count;
  end if;

  select total_cents into v_total
    from public.dbs_control_purchases where id = v_purchase;
  if v_total <> 24690 then
    raise exception 'TEST_PURCHASE_TOTAL: esperado 24690 centavos, recebido %.', v_total;
  end if;

  select coalesce(sum(debit_cents),0), coalesce(sum(credit_cents),0)
    into v_debits, v_credits
    from public.treasury_ledger_lines where entry_id = v_ledger;
  if v_debits <> v_credits or v_debits <> v_total then
    raise exception 'TEST_PURCHASE_LEDGER: lançamento não balanceado (débito %, crédito %, total %).', v_debits, v_credits, v_total;
  end if;

  v_payment := public.dbs_control_settle_purchase(
    v_purchase, v_actor, 10000, 'pix', v_key || ':payment'
  );
  v_payment_ledger := nullif(v_payment->>'ledger_entry_id', '')::uuid;
  if v_payment_ledger is null then
    raise exception 'TEST_PAYMENT: baixa não gerou lançamento contábil: %', v_payment;
  end if;

  select paid_cents, payment_status
    into v_paid, v_status
    from public.dbs_control_purchases where id = v_purchase;
  if v_paid <> 10000 or v_status <> 'partial' then
    raise exception 'TEST_PAYMENT_BALANCE: esperado 10000/partial; recebido %/%', v_paid, v_status;
  end if;

  select coalesce(sum(debit_cents),0), coalesce(sum(credit_cents),0)
    into v_debits, v_credits
    from public.treasury_ledger_lines where entry_id = v_payment_ledger;
  if v_debits <> v_credits or v_debits <> 10000 then
    raise exception 'TEST_PAYMENT_LEDGER: baixa não balanceada (débito %, crédito %).', v_debits, v_credits;
  end if;

  v_overview := public.dbs_control_inventory_financial_overview(v_actor);
  if not (v_overview ? 'stock_value_cents'
      and v_overview ? 'purchases_month_cents'
      and v_overview ? 'accounts_payable_cents'
      and v_overview ? 'operating_cost_cents'
      and v_overview ? 'revenue_cents'
      and v_overview ? 'gross_profit_cents'
      and v_overview ? 'gross_margin_pct') then
    raise exception 'TEST_OVERVIEW: painel não retornou todas as métricas: %', v_overview;
  end if;

  raise notice 'PASS: purchase -> exactly one stock receipt -> weighted average -> balanced AP Ledger -> partial payment -> balanced cash Ledger -> management metrics.';
end;
$test$;

rollback;
