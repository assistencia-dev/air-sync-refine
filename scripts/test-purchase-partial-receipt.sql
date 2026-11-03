-- Integração transacional: recebimento parcial de 4/10 unidades.
-- Executar SOMENTE em banco descartável/staging com fixture real de admin e peça.
-- Exemplo: psql "$DATABASE_URL" -v actor_user_id=<uuid> -v part_id=<uuid> -v scope_key=company:<uuid> -f scripts/test-purchase-partial-receipt.sql
-- Toda a simulação termina em ROLLBACK: nenhum dado de fixture permanece.
\set ON_ERROR_STOP on
begin;

create temporary table _purchase_test_context (
  actor_id uuid not null,
  part_id uuid not null,
  scope_key text not null,
  company_id uuid,
  before_stock numeric not null,
  before_cost integer not null
) on commit drop;

insert into _purchase_test_context(actor_id,part_id,scope_key,company_id,before_stock,before_cost)
select :'actor_user_id'::uuid,p.id,:'scope_key',
       u.company_id,p.stock_quantity,p.cost_cents
from public.dbs_control_parts p
join public.users u on u.id=:'actor_user_id'::uuid
where p.id=:'part_id'::uuid and p.status='ativo'
  and public.dbs_control_is_admin_actor(u.id);

do $$
declare
  ctx record;
  v_order uuid;
  v_item uuid;
  v_result jsonb;
  v_replay jsonb;
  v_payload jsonb;
  v_receipt uuid;
  v_ledger uuid;
  v_status text;
  v_stock numeric;
  v_received bigint;
  v_debits bigint;
  v_credits bigint;
  v_inventory_debit bigint;
  v_supplier_credit bigint;
  v_qty numeric;
begin
  select * into strict ctx from _purchase_test_context;
  insert into public.dbs_purchase_orders(
    company_id,scope_key,supplier_name,status,total_ordered_cents,idempotency_key,created_by
  ) values (
    ctx.company_id,ctx.scope_key,'FORNECEDOR TESTE - ROLLBACK','pending',10000,
    'test-partial-order-'||gen_random_uuid()::text,ctx.actor_id
  ) returning id into v_order;

  insert into public.dbs_purchase_order_items(
    purchase_order_id,part_id,line_no,quantity_ordered,unit_cost_cents,total_ordered_cents
  ) values(v_order,ctx.part_id,1,10,1000,10000) returning id into v_item;

  v_payload:=jsonb_build_object(
    'actor_user_id',ctx.actor_id,
    'purchase_order_id',v_order,
    'idempotency_key','test-partial-receipt-'||gen_random_uuid()::text,
    'items',jsonb_build_array(jsonb_build_object(
      'purchase_order_item_id',v_item,'quantity_received',4
    ))
  );
  v_result:=public.dbs_process_purchase_receipt(v_payload);
  v_replay:=public.dbs_process_purchase_receipt(v_payload);
  if coalesce((v_replay->>'replayed')::boolean,false) is not true then
    raise exception 'FAIL retry deveria retornar replayed=true';
  end if;
  v_receipt:=(v_result->>'receipt_id')::uuid;
  v_ledger:=(v_result->>'ledger_entry_id')::uuid;

  select status into v_status from public.dbs_purchase_orders where id=v_order;
  select stock_quantity into v_stock from public.dbs_control_parts where id=ctx.part_id;
  select quantity_received into v_qty from public.dbs_purchase_order_items where id=v_item;
  select coalesce(sum(l.debit_cents),0),coalesce(sum(l.credit_cents),0),
         coalesce(sum(l.debit_cents) filter(where a.code='1.1.03'),0),
         coalesce(sum(l.credit_cents) filter(where a.code='2.1.01'),0)
    into v_debits,v_credits,v_inventory_debit,v_supplier_credit
    from public.treasury_ledger_lines l
    join public.treasury_accounts a on a.id=l.account_id
   where l.entry_id=v_ledger;

  if v_stock-ctx.before_stock<>4 then
    raise exception 'FAIL estoque esperado +4; obtido %',v_stock-ctx.before_stock;
  end if;
  if v_qty<>4 then raise exception 'FAIL recebido esperado 4; obtido %',v_qty; end if;
  if v_status<>'partially_received' then raise exception 'FAIL status esperado partially_received; obtido %',v_status; end if;
  if v_debits<>4000 or v_credits<>4000 or v_inventory_debit<>4000 or v_supplier_credit<>4000 then
    raise exception 'FAIL AP/Ledger esperado R$40,00; débito %, crédito %',v_debits,v_credits;
  end if;
  if v_debits-v_credits<>0 then raise exception 'FAIL Ledger não balanceado'; end if;

  raise notice 'PASS | pedido: 10 un | recebido: 4 un | pendente: 6 un';
  raise notice 'PASS | repetição idempotente: estoque e Ledger não duplicados';
  raise notice 'PASS | estoque físico: +4 un (antes %, depois %)',ctx.before_stock,v_stock;
  raise notice 'PASS | contas a pagar: R$ 40,00 (crédito Fornecedores 2.1.01)';
  raise notice 'PASS | estoque: R$ 40,00 (débito Estoque 1.1.03)';
  raise notice 'PASS | status: %',v_status;
  raise notice 'PASS | Ledger: débito R$ 40,00 - crédito R$ 40,00 = R$ 0,00';
  raise notice 'PASS | receipt_id=% | ledger_entry_id=%',v_receipt,v_ledger;
end;
$$;

rollback;
