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
  v_part2 uuid;
  v_before_stock numeric;
  v_before_cost integer;
  v_before_stock2 numeric;
  v_before_cost2 integer;
  v_after_stock numeric;
  v_after_cost integer;
  v_after_stock2 numeric;
  v_after_cost2 integer;
  v_key text := 'integration-test:' || gen_random_uuid()::text;
  v_payload jsonb;
  v_result jsonb;
  v_replay jsonb;
  v_purchase uuid;
  v_ledger uuid;
  v_receipt_ledger uuid;
  v_revenue_entry uuid;
  v_revenue_cents bigint;
  v_work_order uuid;
  v_batch uuid;
  v_os_result jsonb;
  v_os_replay jsonb;
  v_os_ledger uuid;
  v_os_cost_before bigint := 0;
  v_os_cost_after bigint := 0;
  v_os_movement_count integer := 0;
  v_payment jsonb;
  v_payment_ledger uuid;
  v_total bigint;
  v_paid bigint;
  v_remaining bigint;
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
  select id, stock_quantity, cost_cents
    into v_part2, v_before_stock2, v_before_cost2
    from public.dbs_control_parts
   where id <> v_part
   order by created_at, id
   limit 1;
  if v_part2 is null then
    raise exception 'TEST_SETUP: são necessárias duas peças distintas para testar uma compra com dois itens.';
  end if;

  -- Reactivation is transaction-local; the full test rolls back.
  update public.dbs_control_parts set status = 'ativo' where id in (v_part, v_part2);

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
    'items', jsonb_build_array(
      jsonb_build_object('part_id', v_part, 'quantity', 2, 'unit_cost_cents', 12345),
      jsonb_build_object('part_id', v_part2, 'quantity', 1, 'unit_cost_cents', 11111)
    )
  );

  v_result := public.dbs_control_register_purchase(v_payload);
  v_purchase := nullif(v_result->>'purchase_id', '')::uuid;
  v_ledger := nullif(v_result->>'ledger_entry_id', '')::uuid;
  if v_purchase is null or v_ledger is null or v_result->>'status' <> 'draft' then
    raise exception 'TEST_PURCHASE: registro não criou pedido e conta a pagar em draft: %', v_result;
  end if;

  -- Registering a purchase must create AP but must not touch stock.
  select stock_quantity, cost_cents into v_after_stock, v_after_cost
    from public.dbs_control_parts where id = v_part;
  if v_after_stock <> coalesce(v_before_stock, 0) or v_after_cost <> coalesce(v_before_cost, 0) then
    raise exception 'TEST_DRAFT_STOCK: compra ainda não recebida alterou o estoque.';
  end if;
  select count(*) into v_movement_count
    from public.dbs_control_inventory_movements
   where purchase_id = v_purchase and movement_type = 'receipt';
  if v_movement_count <> 0 then
    raise exception 'TEST_DRAFT_MOVEMENT: pedido não recebido gerou movimento de estoque.';
  end if;

  -- Same registration replay must return the same purchase and not duplicate AP.
  v_replay := public.dbs_control_register_purchase(v_payload);
  if nullif(v_replay->>'purchase_id', '')::uuid is distinct from v_purchase then
    raise exception 'TEST_IDEMPOTENCY: replay retornou outra compra.';
  end if;

  v_result := public.dbs_control_receive_registered_purchase(v_purchase, v_actor, v_key || ':receipt');
  v_receipt_ledger := nullif(v_result->>'receipt_ledger_entry_id', '')::uuid;
  if v_result->>'status' <> 'received' or v_receipt_ledger is null then
    raise exception 'TEST_RECEIPT: recebimento não confirmou estoque e reclassificação: %', v_result;
  end if;

  -- Repeating receipt is safe even with a different retry token.
  v_replay := public.dbs_control_receive_registered_purchase(v_purchase, v_actor, v_key || ':receipt-retry');
  if nullif(v_replay->>'receipt_ledger_entry_id', '')::uuid is distinct from v_receipt_ledger then
    raise exception 'TEST_RECEIPT_IDEMPOTENCY: replay criou outra entrada contábil.';
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

  select stock_quantity, cost_cents into v_after_stock2, v_after_cost2
    from public.dbs_control_parts where id = v_part2;
  if v_after_stock2 <> coalesce(v_before_stock2, 0) + 1
     or v_after_cost2 <> round(((coalesce(v_before_stock2, 0) * coalesce(v_before_cost2, 0)) + 11111) / (coalesce(v_before_stock2, 0) + 1))::integer then
    raise exception 'TEST_SECOND_ITEM_STOCK: saldo/custo médio incorreto para o segundo item: %, %.', v_after_stock2, v_after_cost2;
  end if;

  select count(*) into v_movement_count
    from public.dbs_control_inventory_movements
   where purchase_id = v_purchase and movement_type = 'receipt';
  if v_movement_count <> 2 then
    raise exception 'TEST_MOVEMENT_IDEMPOTENCY: esperadas exatamente 2 entradas (uma por item); encontradas %.', v_movement_count;
  end if;

  select total_cents into v_total
    from public.dbs_control_purchases where id = v_purchase;
  if v_total <> 35801 then
    raise exception 'TEST_PURCHASE_TOTAL: esperado 35801 centavos, recebido %.', v_total;
  end if;

  select coalesce(sum(debit_cents),0), coalesce(sum(credit_cents),0)
    into v_debits, v_credits
    from public.treasury_ledger_lines where entry_id = v_ledger;
  if v_debits <> v_credits or v_debits <> v_total then
    raise exception 'TEST_PURCHASE_LEDGER: lançamento não balanceado (débito %, crédito %, total %).', v_debits, v_credits, v_total;
  end if;
  select coalesce(sum(debit_cents),0), coalesce(sum(credit_cents),0)
    into v_debits, v_credits
    from public.treasury_ledger_lines where entry_id = v_receipt_ledger;
  if v_debits <> v_credits or v_debits <> v_total then
    raise exception 'TEST_RECEIPT_LEDGER: reclassificação não balanceada (débito %, crédito %, total %).', v_debits, v_credits, v_total;
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
  select total_cents-paid_cents into v_remaining
    from public.dbs_control_purchases where id=v_purchase;
  if v_remaining <> 25801 then
    raise exception 'TEST_ACCOUNTS_PAYABLE: saldo esperado 25801, recebido %.',v_remaining;
  end if;

  select coalesce(sum(debit_cents),0), coalesce(sum(credit_cents),0)
    into v_debits, v_credits
    from public.treasury_ledger_lines where entry_id = v_payment_ledger;
  if v_debits <> v_credits or v_debits <> 10000 then
    raise exception 'TEST_PAYMENT_LEDGER: baixa não balanceada (débito %, crédito %).', v_debits, v_credits;
  end if;

  -- Exercise the existing OS reservation consumption RPC in the same
  -- rollback-only transaction: stock decreases once and parts COGS is posted.
  select w.id into v_work_order
    from public.dbs_control_work_orders w
    cross join lateral public.dbs_control_inventory_scope_for_work_order(w.id) s
   where s.scope_key = v_scope
     and lower(trim(coalesce(w.status,''))) not in ('concluida','concluída','concluido','concluído','cancelada','cancelado','cancelled','canceled')
     and w.deleted_at is null
     and not exists(select 1 from public.dbs_control_reservation_consumptions rc where rc.work_order_id=w.id)
     and not exists(select 1 from public.dbs_control_work_order_reservations rr where rr.work_order_id=w.id)
   order by w.created_at desc
   limit 1;
  if v_work_order is null then
    raise exception 'TEST_OS_SETUP: não foi encontrada OS de teste sem consumo anterior.';
  end if;

  insert into public.dbs_control_reservation_batches(
    scope_key,company_id,work_order_id,idempotency_key,created_by
  ) values(
    v_scope,v_company,v_work_order,v_key||':os-batch',v_actor
  ) returning id into v_batch;

  update public.dbs_control_parts
     set reserved_quantity=coalesce(reserved_quantity,0)+1
   where id=v_part;

  insert into public.dbs_control_work_order_reservations(
    batch_id,scope_key,company_id,work_order_id,part_id,quantity,unit_cost_cents,
    status,idempotency_key,created_by
  ) values(
    v_batch,v_scope,v_company,v_work_order,v_part,1,12345,
    'reserved',v_key||':os-reservation',v_actor
  );

  select coalesce(parts_cost_cents,0) into v_os_cost_before
    from public.dbs_control_work_order_financials where work_order_id=v_work_order;
  v_os_cost_before := coalesce(v_os_cost_before,0);

  v_os_result := public.dbs_control_consume_work_order_reservations(
    v_work_order,v_actor,v_key||':os-consume'
  );
  v_os_ledger := nullif(v_os_result->>'ledger_entry_id','')::uuid;
  if (v_os_result->>'cost_cents')::bigint <> 12345 or v_os_ledger is null then
    raise exception 'TEST_OS_CONSUMPTION: consumo não lançou custo/ledger corretamente: %',v_os_result;
  end if;

  select stock_quantity into v_after_stock from public.dbs_control_parts where id=v_part;
  if v_after_stock <> coalesce(v_before_stock,0)+1 then
    raise exception 'TEST_OS_STOCK: esperado saldo após consumo %, recebido %.',coalesce(v_before_stock,0)+1,v_after_stock;
  end if;
  select count(*) into v_os_movement_count
    from public.dbs_control_inventory_movements
   where work_order_id=v_work_order and part_id=v_part and movement_type='consume';
  if v_os_movement_count <> 1 then
    raise exception 'TEST_OS_MOVEMENT: esperado 1 movimento de consumo, encontrados %.',v_os_movement_count;
  end if;

  select parts_cost_cents into v_os_cost_after
    from public.dbs_control_work_order_financials where work_order_id=v_work_order;
  if coalesce(v_os_cost_after,0) <> v_os_cost_before+12345 then
    raise exception 'TEST_OS_COST: custo operacional esperado %, recebido %.',v_os_cost_before+12345,v_os_cost_after;
  end if;

  select coalesce(sum(debit_cents),0),coalesce(sum(credit_cents),0)
    into v_debits,v_credits
    from public.treasury_ledger_lines where entry_id=v_os_ledger;
  if v_debits<>v_credits or v_debits<>12345 then
    raise exception 'TEST_OS_LEDGER: COGS não balanceado (débito %, crédito %).',v_debits,v_credits;
  end if;

  v_os_replay := public.dbs_control_consume_work_order_reservations(
    v_work_order,v_actor,v_key||':os-consume-retry'
  );
  if coalesce((v_os_replay->>'replayed')::boolean,false) is not true then
    raise exception 'TEST_OS_IDEMPOTENCY: repetição do consumo não foi reconhecida como replay.';
  end if;
  select count(*) into v_os_movement_count
    from public.dbs_control_inventory_movements
   where work_order_id=v_work_order and part_id=v_part and movement_type='consume';
  if v_os_movement_count <> 1 then
    raise exception 'TEST_OS_IDEMPOTENCY: replay duplicou baixa de estoque.';
  end if;

  -- Close the OS with an explicit service amount; the revenue trigger must
  -- post receivable/revenue to the Ledger exactly once.
  update public.dbs_control_work_orders
     set status = 'concluida', total_cents = 50000, completed_at = now()
   where id = v_work_order;

  select revenue_entry_id, revenue_cents
    into v_revenue_entry, v_revenue_cents
    from public.dbs_control_work_order_financials
   where work_order_id = v_work_order;
  if v_revenue_entry is null or v_revenue_cents <> 50000 then
    raise exception 'TEST_OS_REVENUE: fechamento da OS não reconheceu receita: %, %.', v_revenue_entry, v_revenue_cents;
  end if;
  select coalesce(sum(debit_cents),0), coalesce(sum(credit_cents),0)
    into v_debits, v_credits
    from public.treasury_ledger_lines where entry_id = v_revenue_entry;
  if v_debits <> 50000 or v_credits <> 50000 then
    raise exception 'TEST_OS_REVENUE_LEDGER: lançamento de receita não balanceado (%, %).', v_debits, v_credits;
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
  if (v_overview->>'accounts_payable_cents')::bigint < v_remaining
    or (v_overview->>'purchases_month_cents')::bigint < v_total
    or (v_overview->>'stock_value_cents')::bigint <= 0
    or (v_overview->>'operating_cost_cents')::bigint <= 0
    or (v_overview->>'revenue_cents')::bigint <= 0
    or (v_overview->>'gross_profit_cents')::bigint <= 0
    or (v_overview->>'gross_margin_pct')::numeric <= 0 then
    raise exception 'TEST_OVERVIEW_TOTALS: agregados não refletem todos os fluxos com valores positivos: %',v_overview;
  end if;

  raise notice 'PASS: two-item purchase -> AP -> exactly two receipt movements -> weighted average -> partial supplier payment -> one OS part consumption -> parts COGS -> OS closure/revenue Ledger -> all seven overview metrics.';
end;
$test$;

rollback;
select 'PASS'::text as integration_test_status;
