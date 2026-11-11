-- Restrict global OS financial reconciliation to SUPER_ADMIN and recover
-- missing financial projections for completed legacy OS with an explicit total.
-- No inventory movement is fabricated; costs come only from recorded movements.
begin;

CREATE OR REPLACE FUNCTION public.dbs_control_inventory_scope_for_work_order(p_work_order_id uuid)
 RETURNS TABLE(scope_key text, company_id uuid, owner_user_id uuid)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with single_admin_company as (
    select
      count(distinct u.company_id) as company_count,
      (array_agg(u.id order by (u.company_id is not null) desc, u.id))[1] as owner_id,
      (array_agg(u.company_id order by (u.company_id is not null) desc, u.id))[1] as company_id
    from public.users u
    where u.status = 'ativo'
      and u.role_key::text = 'SUPER_ADMIN'
  )
  select
    case
      when u.company_id is not null then 'company:' || u.company_id::text
      when w.created_by_user_id is not null then 'user:' || w.created_by_user_id::text
      when a.company_count = 1 and a.company_id is not null then 'company:' || a.company_id::text
      else 'work_order:' || w.id::text
    end,
    coalesce(u.company_id, case when w.created_by_user_id is null and a.company_count = 1 then a.company_id end),
    coalesce(w.created_by_user_id, case when a.company_count = 1 and a.company_id is not null then a.owner_id end)
  from public.dbs_control_work_orders w
  left join public.users u on u.id = w.created_by_user_id
  cross join single_admin_company a
  where w.id = p_work_order_id;
$function$

CREATE OR REPLACE FUNCTION public.dbs_control_reconcile_work_order_financials(p_actor_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_order record;
  v_scope record;
  v_cost bigint;
  v_ledger jsonb;
  v_revenue_id uuid;
  v_financial_id uuid;
  v_existing_parts_cost bigint;
  v_existing_revenue_entry_id uuid;
  v_cost_rows integer := 0;
  v_financial_rows_created integer := 0;
  v_revenue_rows integer := 0;
  v_pending_no_value integer := 0;
begin
  if p_actor_user_id is null or not exists (
    select 1
    from public.users u
    where u.id = p_actor_user_id
      and u.status = 'ativo'
      and u.role_key::text = 'SUPER_ADMIN'
  ) then
    raise exception 'DBS_WORK_ORDER_FINANCIAL_RECONCILE_FORBIDDEN' using errcode = '42501';
  end if;

  -- Include existing financial rows and legacy OS that need a projection:
  -- completed OS with explicit value, or any OS that already has stock movements.
  for v_order in
    select w.id, w.protocol, w.protocolo, w.status, w.total_cents
    from public.dbs_control_work_orders w
    left join public.dbs_control_work_order_financials f on f.work_order_id = w.id
    where (f.id is not null and f.status <> 'reversed')
       or (
         f.id is null
         and (
           (
             lower(trim(coalesce(w.status,''))) in
               ('concluida','concluída','concluido','concluído',
                'concluida_com_pendencia','concluída_com_pendência','completed','complete')
             and coalesce(w.total_cents,0) > 0
           )
           or exists (
             select 1 from public.dbs_control_inventory_movements m
             where m.work_order_id = w.id
           )
         )
       )
    order by w.id
    for update of w
  loop
    -- Serialize the projection and its idempotent Ledger post per work order.
    perform pg_advisory_xact_lock(
      hashtextextended('dbs-control-financial-reconcile:' || v_order.id::text, 0)
    );

    select f.id, f.parts_cost_cents, f.revenue_entry_id
      into v_financial_id, v_existing_parts_cost, v_existing_revenue_entry_id
    from public.dbs_control_work_order_financials f
    where f.work_order_id = v_order.id
    for update;

    if not found then
      select * into v_scope
      from public.dbs_control_inventory_scope_for_work_order(v_order.id);

      if v_scope.scope_key is null then
        v_scope.scope_key := 'work_order:' || v_order.id::text;
        v_scope.company_id := null;
        v_scope.owner_user_id := null;
      end if;

      insert into public.dbs_control_work_order_financials (
        work_order_id, company_id, scope_key, metadata
      )
      values (
        v_order.id,
        v_scope.company_id,
        v_scope.scope_key,
        jsonb_build_object(
          'source', 'dbs_control_work_order_financial_reconcile',
          'reconciliation_version', 2
        )
      )
      on conflict (work_order_id) do nothing
      returning id into v_financial_id;

      if v_financial_id is null then
        select f.id, f.parts_cost_cents, f.revenue_entry_id
          into v_financial_id, v_existing_parts_cost, v_existing_revenue_entry_id
        from public.dbs_control_work_order_financials f
        where f.work_order_id = v_order.id
        for update;
      else
        v_existing_parts_cost := 0;
        v_existing_revenue_entry_id := null;
        v_financial_rows_created := v_financial_rows_created + 1;
      end if;
    end if;

    -- COGS is reconstructed only from recorded stock movements.
    select greatest(0, round(coalesce(sum(
      case
        when m.movement_type in ('consume','return','reversal')
          then -m.quantity_delta * m.unit_cost_cents
        else 0
      end
    ), 0))::bigint)
      into v_cost
    from public.dbs_control_inventory_movements m
    where m.work_order_id = v_order.id;

    if v_existing_parts_cost is distinct from v_cost then
      update public.dbs_control_work_order_financials
         set parts_cost_cents = v_cost,
             updated_at = now(),
             version = version + 1
       where id = v_financial_id;
      v_cost_rows := v_cost_rows + 1;
    end if;

    -- Revenue is posted only for a completed OS with an explicit positive
    -- source amount and an unambiguous company/user scope.
    if lower(trim(coalesce(v_order.status,''))) in
       ('concluida','concluída','concluido','concluído',
        'concluida_com_pendencia','concluída_com_pendência','completed','complete')
       and coalesce(v_order.total_cents,0) > 0
       and v_existing_revenue_entry_id is null then
      select * into v_scope
        from public.dbs_control_inventory_scope_for_work_order(v_order.id);

      if v_scope.owner_user_id is not null and v_scope.scope_key not like 'work_order:%' then
        v_ledger := public.post_treasury_ledger_entry(
          v_scope.scope_key, v_scope.company_id, current_date, current_date,
          'work_order_revenue',
          'Receita de serviço · ' || coalesce(v_order.protocol, v_order.protocolo, v_order.id::text),
          left('work-order:revenue:' || v_order.id::text, 200),
          'work-order-revenue:' || v_order.id::text,
          p_actor_user_id, 'posted',
          jsonb_build_object('source','dbs_control_work_order_financial_reconcile','work_order_id',v_order.id),
          jsonb_build_array(
            jsonb_build_object('account_code','1.1.02','account_name','Contas a receber','account_type','asset','debit_cents',v_order.total_cents,'credit_cents',0),
            jsonb_build_object('account_code','4.1.01','account_name','Receita de serviços','account_type','revenue','debit_cents',0,'credit_cents',v_order.total_cents)
          )
        );
        v_revenue_id := nullif(v_ledger->>'entry_id','')::uuid;
        if v_revenue_id is not null then
          update public.dbs_control_work_order_financials
             set company_id = v_scope.company_id,
                 scope_key = v_scope.scope_key,
                 revenue_cents = v_order.total_cents,
                 revenue_entry_id = v_revenue_id,
                 status = 'posted',
                 updated_at = now(),
                 version = version + 1
           where id = v_financial_id;
          v_revenue_rows := v_revenue_rows + 1;
        end if;
      end if;
    elsif lower(trim(coalesce(v_order.status,''))) in
       ('concluida','concluída','concluido','concluído',
        'concluida_com_pendencia','concluída_com_pendência','completed','complete')
       and coalesce(v_order.total_cents,0) <= 0 then
      v_pending_no_value := v_pending_no_value + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'financial_rows_created', v_financial_rows_created,
    'cost_rows_reconciled', v_cost_rows,
    'revenue_rows_posted', v_revenue_rows,
    'completed_without_source_value', v_pending_no_value,
    'as_of', now()
  );
end;
$function$

revoke all on function public.dbs_control_inventory_scope_for_work_order(uuid) from public, anon, authenticated;
grant execute on function public.dbs_control_inventory_scope_for_work_order(uuid) to service_role;
revoke all on function public.dbs_control_reconcile_work_order_financials(uuid) from public, anon, authenticated;
grant execute on function public.dbs_control_reconcile_work_order_financials(uuid) to service_role;

notify pgrst, 'reload schema';
commit;
