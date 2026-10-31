-- DBS CONTROL: hardening aditivo do ciclo estoque -> OS -> Financeiro.
-- Corrige o custo líquido após devoluções e registra estornos/reversões
-- quando uma OS concluída é cancelada ou excluída logicamente.

begin;

alter table public.dbs_control_work_order_financials
  add column if not exists revenue_reversal_entry_id uuid
    references public.treasury_ledger_entries(id) on delete restrict;

-- Mantém a conciliação derivada do livro imutável. O custo de uma OS é a
-- soma líquida de consumos (+) e devoluções (-), nunca um snapshot editável.
create or replace function public.dbs_control_reconcile_work_order_parts_cost()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cost bigint;
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  select greatest(0, round(coalesce(sum(
    case
      when m.movement_type in ('consume', 'return', 'reversal')
        then -m.quantity_delta * m.unit_cost_cents
      else 0
    end
  ), 0))::bigint)
    into v_cost
  from public.dbs_control_inventory_movements m
  where m.work_order_id = new.work_order_id;

  if new.parts_cost_cents is distinct from v_cost then
    update public.dbs_control_work_order_financials
       set parts_cost_cents = v_cost,
           updated_at = now(),
           version = version + 1
     where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_dbs_control_reconcile_work_order_parts_cost
  on public.dbs_control_work_order_financials;
create trigger trg_dbs_control_reconcile_work_order_parts_cost
after insert or update of parts_cost_cents
on public.dbs_control_work_order_financials
for each row execute function public.dbs_control_reconcile_work_order_parts_cost();

-- Este trigger roda depois do trigger de receita existente (prefixo zz),
-- completando o ciclo sem reescrever a função já publicada.
create or replace function public.dbs_control_work_order_financial_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text := lower(trim(coalesce(new.status, '')));
  v_old_status text := lower(trim(coalesce(old.status, '')));
  v_completed boolean := v_status in (
    'concluida','concluída','concluido','concluído',
    'concluida_com_pendencia','concluída_com_pendência',
    'completed','complete'
  );
  v_cancelled boolean := v_status in ('cancelada','cancelado','cancelled','canceled')
    or new.deleted_at is not null;
  v_transition boolean := tg_op = 'INSERT'
    or old.status is distinct from new.status
    or old.deleted_at is distinct from new.deleted_at;
  v_scope record;
  v_actor uuid;
  v_financial public.dbs_control_work_order_financials%rowtype;
  v_ledger jsonb;
  v_key text := nullif(current_setting('app.dbs_control_idempotency_key', true), '');
  v_revenue bigint := greatest(coalesce(new.total_cents, 0), 0);
  v_delta bigint;
  v_reversal_id uuid;
  v_has_financial boolean := false;
begin
  if not v_transition then
    return new;
  end if;

  select * into v_scope
  from public.dbs_control_inventory_scope_for_work_order(new.id);
  if not found then
    return new;
  end if;

  select sc.actor_user_id into v_actor
  from public.dbs_control_sync_commands sc
  where sc.idempotency_key = v_key;
  v_actor := coalesce(v_actor, v_scope.owner_user_id);

  select f.* into v_financial
  from public.dbs_control_work_order_financials f
  where f.work_order_id = new.id
  for update;
  v_has_financial := v_financial.id is not null;

  -- Cancelamento/exclusão: devolve peças que ainda estavam consumidas e
  -- reverte a receita publicada. Tudo permanece dentro da mesma transação.
  if v_cancelled then
    if v_actor is not null then
      perform public.dbs_control_apply_work_order_parts_in_tx(new.id, '[]'::jsonb);
    end if;

    if v_has_financial and v_financial.status = 'posted'
       and v_financial.revenue_cents > 0
       and v_financial.revenue_reversal_entry_id is null
       and v_actor is not null then
      v_reversal_id := null;
      v_ledger := public.post_treasury_ledger_entry(
        v_scope.scope_key, v_scope.company_id, current_date, current_date,
        'work_order_revenue_reversal',
        'Estorno de receita · ' || coalesce(new.protocol, new.protocolo, new.id::text),
        left('work-order:revenue-reversal:' || new.id::text, 200),
        left('work-order-revenue-reversal:' || new.id::text, 200),
        v_actor, 'posted',
        jsonb_build_object('source', 'dbs_control_work_order', 'work_order_id', new.id, 'reason', 'cancelled_or_deleted'),
        jsonb_build_array(
          jsonb_build_object('account_code','4.1.01','account_name','Receita de serviços','account_type','revenue','debit_cents',v_financial.revenue_cents,'credit_cents',0),
          jsonb_build_object('account_code','1.1.02','account_name','Contas a receber','account_type','asset','debit_cents',0,'credit_cents',v_financial.revenue_cents)
        )
      );
      v_reversal_id := nullif(v_ledger->>'entry_id', '')::uuid;
      update public.dbs_control_work_order_financials
         set status = 'reversed',
             revenue_reversal_entry_id = v_reversal_id,
             updated_at = now(),
             version = version + 1
       where id = v_financial.id;
    end if;
    return new;
  end if;

  if not v_completed or v_revenue <= 0 or v_actor is null then
    return new;
  end if;

  -- Reabertura/reconclusão após cancelamento: cria uma nova receita com uma
  -- chave própria, preservando a receita e o estorno anteriores para auditoria.
  if v_has_financial and v_financial.status = 'reversed' then
    v_ledger := public.post_treasury_ledger_entry(
      v_scope.scope_key, v_scope.company_id, current_date, current_date,
      'work_order_revenue',
      'Receita reativada · ' || coalesce(new.protocol, new.protocolo, new.id::text),
      left('work-order:revenue:reactivation:' || new.id::text || ':' || new.version::text, 200),
      left('work-order-revenue-reactivation:' || new.id::text || ':' || new.version::text, 200),
      v_actor, 'posted',
      jsonb_build_object('source', 'dbs_control_work_order', 'work_order_id', new.id, 'reason', 'reactivated'),
      jsonb_build_array(
        jsonb_build_object('account_code','1.1.02','account_name','Contas a receber','account_type','asset','debit_cents',v_revenue,'credit_cents',0),
        jsonb_build_object('account_code','4.1.01','account_name','Receita de serviços','account_type','revenue','debit_cents',0,'credit_cents',v_revenue)
      )
    );
    update public.dbs_control_work_order_financials
       set revenue_cents = v_revenue,
           revenue_entry_id = nullif(v_ledger->>'entry_id', '')::uuid,
           status = 'posted',
           updated_at = now(),
           version = version + 1
     where id = v_financial.id;
    return new;
  end if;

  -- Alteração de valor após publicação: registra apenas a diferença, sem
  -- apagar o lançamento original.
  if v_has_financial and v_financial.status = 'posted'
     and v_financial.revenue_cents is distinct from v_revenue then
    v_delta := v_revenue - v_financial.revenue_cents;
    if v_delta <> 0 then
      v_ledger := public.post_treasury_ledger_entry(
        v_scope.scope_key, v_scope.company_id, current_date, current_date,
        'work_order_revenue_adjustment',
        'Ajuste de receita · ' || coalesce(new.protocol, new.protocolo, new.id::text),
        left('work-order:revenue-adjustment:' || new.id::text || ':' || new.version::text, 200),
        left('work-order-revenue-adjustment:' || new.id::text || ':' || new.version::text, 200),
        v_actor, 'posted',
        jsonb_build_object('source', 'dbs_control_work_order', 'work_order_id', new.id, 'delta_cents', v_delta),
        case when v_delta > 0 then
          jsonb_build_array(
            jsonb_build_object('account_code','1.1.02','account_name','Contas a receber','account_type','asset','debit_cents',v_delta,'credit_cents',0),
            jsonb_build_object('account_code','4.1.01','account_name','Receita de serviços','account_type','revenue','debit_cents',0,'credit_cents',v_delta)
          )
        else
          jsonb_build_array(
            jsonb_build_object('account_code','4.1.01','account_name','Receita de serviços','account_type','revenue','debit_cents',abs(v_delta),'credit_cents',0),
            jsonb_build_object('account_code','1.1.02','account_name','Contas a receber','account_type','asset','debit_cents',0,'credit_cents',abs(v_delta))
          )
        end
      );
      update public.dbs_control_work_order_financials
         set revenue_cents = v_revenue,
             updated_at = now(),
             version = version + 1
       where id = v_financial.id;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists zz_dbs_control_work_order_financial_lifecycle
  on public.dbs_control_work_orders;
create trigger zz_dbs_control_work_order_financial_lifecycle
after insert or update of status, total_cents, deleted_at
on public.dbs_control_work_orders
for each row execute function public.dbs_control_work_order_financial_lifecycle();

revoke all on function public.dbs_control_reconcile_work_order_parts_cost() from public, anon, authenticated;
revoke all on function public.dbs_control_work_order_financial_lifecycle() from public, anon, authenticated;
grant execute on function public.dbs_control_reconcile_work_order_parts_cost() to service_role;
grant execute on function public.dbs_control_work_order_financial_lifecycle() to service_role;

comment on column public.dbs_control_work_order_financials.revenue_reversal_entry_id is
  'Lançamento imutável que estornou a receita da OS; preserva a trilha de auditoria.';

notify pgrst, 'reload schema';
commit;
