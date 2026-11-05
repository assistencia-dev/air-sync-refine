begin;

-- Normalize numeric SKUs and case/whitespace variants. Resolve only exact,
-- unused zero-stock duplicates; abort rather than merge referenced inventory.
do $$
declare
  v_group record;
  v_keeper uuid;
  v_duplicate record;
begin
  for v_group in
    select
      case
        when btrim(sku) ~ '^[0-9]+$'
          then coalesce(nullif(ltrim(btrim(sku), '0'), ''), '0')
        else upper(btrim(sku))
      end as normalized_sku
    from public.dbs_control_parts
    where sku is not null and btrim(sku) <> ''
    group by 1
    having count(*) > 1
  loop
    select p.id into v_keeper
    from public.dbs_control_parts p
    where (
      case
        when btrim(p.sku) ~ '^[0-9]+$'
          then coalesce(nullif(ltrim(btrim(p.sku), '0'), ''), '0')
        else upper(btrim(p.sku))
      end
    ) = v_group.normalized_sku
    order by (btrim(p.sku) = v_group.normalized_sku) desc, p.created_at, p.id
    limit 1;

    for v_duplicate in
      select p.*
      from public.dbs_control_parts p
      where p.id <> v_keeper
        and (
          case
            when btrim(p.sku) ~ '^[0-9]+$'
              then coalesce(nullif(ltrim(btrim(p.sku), '0'), ''), '0')
            else upper(btrim(p.sku))
          end
        ) = v_group.normalized_sku
      for update
    loop
      if exists (
        select 1
        from public.dbs_control_parts keeper
        where keeper.id = v_keeper
          and (
            keeper.name is distinct from v_duplicate.name
            or keeper.description is distinct from v_duplicate.description
            or keeper.cost_cents is distinct from v_duplicate.cost_cents
            or keeper.sale_cents is distinct from v_duplicate.sale_cents
            or keeper.stock_quantity <> 0
            or keeper.reserved_quantity <> 0
          )
      ) or v_duplicate.stock_quantity <> 0
        or v_duplicate.reserved_quantity <> 0
        or exists (select 1 from public.dbs_control_purchase_items i where i.part_id = v_duplicate.id)
        or exists (select 1 from public.dbs_control_inventory_movements m where m.part_id = v_duplicate.id)
        or exists (select 1 from public.dbs_control_work_order_reservations r where r.part_id = v_duplicate.id)
        or exists (select 1 from public.dbs_control_work_order_parts wp where wp.part_id = v_duplicate.id)
      then
        raise exception 'SKU_NORMALIZATION_REQUIRES_MANUAL_REVIEW: duplicate SKU %, part % has differing data or operational references.',
          v_group.normalized_sku, v_duplicate.id;
      end if;

      if exists (
        select 1 from public.dbs_control_parts p
        where upper(btrim(p.sku)) = upper('LEGACY-' || v_duplicate.sku)
          and p.id <> v_duplicate.id
      ) then
        raise exception 'SKU_NORMALIZATION_ALIAS_CONFLICT: LEGACY alias already exists for part %.', v_duplicate.id;
      end if;

      update public.dbs_control_parts
         set sku = 'LEGACY-' || btrim(v_duplicate.sku),
             status = 'inativo',
             version = version + 1,
             updated_at = now()
       where id = v_duplicate.id;
    end loop;
  end loop;
end;
$$;

create or replace function public.dbs_control_normalize_part_sku()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.sku is null or btrim(new.sku) = '' then
    new.sku := null;
  elsif btrim(new.sku) ~ '^[0-9]+$' then
    new.sku := coalesce(nullif(ltrim(btrim(new.sku), '0'), ''), '0');
  else
    new.sku := upper(btrim(new.sku));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_dbs_control_normalize_part_sku on public.dbs_control_parts;
create trigger trg_dbs_control_normalize_part_sku
before insert or update of sku on public.dbs_control_parts
for each row execute function public.dbs_control_normalize_part_sku();

create unique index if not exists dbs_control_parts_sku_normalized_uidx
on public.dbs_control_parts ((
  case
    when btrim(sku) ~ '^[0-9]+$'
      then coalesce(nullif(ltrim(btrim(sku), '0'), ''), '0')
    else upper(btrim(sku))
  end
))
where sku is not null and btrim(sku) <> '';

-- Imported FieldControl OSs may not have an actor. Attribute their operational
-- scope to the sole active admin's company only when that relationship is
-- unambiguous; never guess in a multi-admin or company-less environment.
create or replace function public.dbs_control_inventory_scope_for_work_order(p_work_order_id uuid)
returns table(scope_key text, company_id uuid, owner_user_id uuid)
language sql
security definer
set search_path = public, pg_temp
as $$
  with sole_admin as (
    select
      count(*) as admin_count,
      (array_agg(u.id order by u.id))[1] as owner_id,
      (array_agg(u.company_id order by u.id))[1] as company_id
    from public.users u
    where u.status = 'ativo'
      and u.role_key::text in ('SUPER_ADMIN','ADMIN_OPERACIONAL','GESTOR_CONTA','GESTOR_REGIONAL')
  )
  select
    case
      when u.company_id is not null then 'company:' || u.company_id::text
      when w.created_by_user_id is not null then 'user:' || w.created_by_user_id::text
      when a.admin_count = 1 and a.company_id is not null then 'company:' || a.company_id::text
      else 'work_order:' || w.id::text
    end,
    coalesce(u.company_id, case when w.created_by_user_id is null and a.admin_count = 1 then a.company_id end),
    coalesce(w.created_by_user_id, case when a.admin_count = 1 and a.company_id is not null then a.owner_id end)
  from public.dbs_control_work_orders w
  left join public.users u on u.id = w.created_by_user_id
  cross join sole_admin a
  where w.id = p_work_order_id;
$$;

-- Re-scope only orphaned financial projections that have no posted Ledger
-- references and no inventory movement history. Do not rewrite immutable books.
do $$
declare
  v_admin_count bigint;
  v_company_id uuid;
begin
  select count(*), (array_agg(u.company_id order by u.id))[1]
    into v_admin_count, v_company_id
  from public.users u
  where u.status = 'ativo'
    and u.role_key::text in ('SUPER_ADMIN','ADMIN_OPERACIONAL','GESTOR_CONTA','GESTOR_REGIONAL');

  if v_admin_count = 1 and v_company_id is not null then
    update public.dbs_control_work_order_financials f
       set company_id = v_company_id,
           scope_key = 'company:' || v_company_id::text,
           updated_at = now(),
           version = f.version + 1
      from public.dbs_control_work_orders w
     where w.id = f.work_order_id
       and w.created_by_user_id is null
       and f.scope_key = 'work_order:' || w.id::text
       and f.revenue_entry_id is null
       and f.revenue_reversal_entry_id is null
       and not exists (
         select 1 from public.dbs_control_inventory_movements m
         where m.work_order_id = w.id
       );
  end if;
end;
$$;

-- Rebuild cost only from immutable inventory movements. Recognize revenue only
-- for completed OS with an explicit positive total; zero-value OS remain pending.
create or replace function public.dbs_control_reconcile_work_order_financials(p_actor_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order record;
  v_scope record;
  v_cost bigint;
  v_ledger jsonb;
  v_revenue_id uuid;
  v_cost_rows integer := 0;
  v_revenue_rows integer := 0;
  v_pending_no_value integer := 0;
begin
  if p_actor_user_id is null or not public.dbs_control_is_admin_actor(p_actor_user_id) then
    raise exception 'DBS_WORK_ORDER_FINANCIAL_RECONCILE_FORBIDDEN' using errcode = '42501';
  end if;

  for v_order in
    select w.id, w.protocol, w.protocolo, w.status, w.total_cents,
           f.id as financial_id, f.scope_key, f.company_id,
           f.parts_cost_cents, f.revenue_cents, f.revenue_entry_id, f.status as financial_status
      from public.dbs_control_work_orders w
      join public.dbs_control_work_order_financials f on f.work_order_id = w.id
     where f.status <> 'reversed'
     order by w.id
     for update of f
  loop
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

    if v_order.parts_cost_cents is distinct from v_cost then
      update public.dbs_control_work_order_financials
         set parts_cost_cents = v_cost,
             updated_at = now(),
             version = version + 1
       where id = v_order.financial_id;
      v_cost_rows := v_cost_rows + 1;
    end if;

    if lower(trim(coalesce(v_order.status,''))) in
       ('concluida','concluída','concluido','concluído',
        'concluida_com_pendencia','concluída_com_pendência','completed','complete')
       and coalesce(v_order.total_cents,0) > 0
       and v_order.revenue_entry_id is null then
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
           where id = v_order.financial_id;
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
    'cost_rows_reconciled', v_cost_rows,
    'revenue_rows_posted', v_revenue_rows,
    'completed_without_source_value', v_pending_no_value,
    'as_of', now()
  );
end;
$$;

revoke all on function public.dbs_control_normalize_part_sku() from public, anon, authenticated;
revoke all on function public.dbs_control_reconcile_work_order_financials(uuid) from public, anon, authenticated;
grant execute on function public.dbs_control_reconcile_work_order_financials(uuid) to service_role;

notify pgrst, 'reload schema';
commit;
