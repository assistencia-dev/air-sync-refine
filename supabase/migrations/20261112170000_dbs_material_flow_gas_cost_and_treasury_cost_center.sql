begin;

alter table public.dbs_control_gas_cylinders
  add column if not exists cost_per_kg_cents integer;
alter table public.dbs_control_gas_usage
  add column if not exists unit_cost_cents_per_kg integer,
  add column if not exists gas_cost_cents bigint,
  add column if not exists ledger_entry_id uuid;
alter table public.dbs_control_work_order_financials
  add column if not exists gas_cost_cents bigint not null default 0;

create unique index if not exists dbs_control_gas_usage_ledger_entry_uidx
  on public.dbs_control_gas_usage(ledger_entry_id) where ledger_entry_id is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='dbs_control_gas_cylinders_cost_per_kg_positive') then
    alter table public.dbs_control_gas_cylinders
      add constraint dbs_control_gas_cylinders_cost_per_kg_positive
      check (cost_per_kg_cents is null or cost_per_kg_cents > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='dbs_control_gas_usage_unit_cost_positive') then
    alter table public.dbs_control_gas_usage
      add constraint dbs_control_gas_usage_unit_cost_positive
      check (unit_cost_cents_per_kg is null or unit_cost_cents_per_kg > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='dbs_control_gas_usage_cost_nonnegative') then
    alter table public.dbs_control_gas_usage
      add constraint dbs_control_gas_usage_cost_nonnegative
      check (gas_cost_cents is null or gas_cost_cents >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='dbs_control_work_order_financials_gas_cost_nonnegative') then
    alter table public.dbs_control_work_order_financials
      add constraint dbs_control_work_order_financials_gas_cost_nonnegative
      check (gas_cost_cents >= 0);
  end if;
end
$$;

create or replace function public.dbs_control_assign_gas_cylinder_weighted(
  p_serial_number text,
  p_refrigerant_type text,
  p_employee_id uuid,
  p_total_charges integer,
  p_vehicle_label text,
  p_tare_weight_kg numeric,
  p_initial_gross_weight_kg numeric,
  p_cost_per_kg_cents integer
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_result jsonb;
  v_id uuid;
begin
  if p_tare_weight_kg is null or p_initial_gross_weight_kg is null
     or p_tare_weight_kg<0 or p_initial_gross_weight_kg<=p_tare_weight_kg then
    raise exception 'DBS_GAS_INITIAL_WEIGHTS_INVALID' using errcode='22023';
  end if;
  if p_cost_per_kg_cents is null or p_cost_per_kg_cents<=0 then
    raise exception 'DBS_GAS_COST_PER_KG_REQUIRED' using errcode='22023';
  end if;

  v_result:=public.dbs_control_assign_gas_cylinder(
    p_serial_number,p_refrigerant_type,p_employee_id,p_total_charges,p_vehicle_label
  );
  v_id:=nullif(v_result->>'cylinder_id','')::uuid;
  update public.dbs_control_gas_cylinders
     set tare_weight_kg=p_tare_weight_kg,
         initial_gross_weight_kg=p_initial_gross_weight_kg,
         current_gross_weight_kg=p_initial_gross_weight_kg,
         cost_per_kg_cents=p_cost_per_kg_cents,
         updated_at=now()
   where id=v_id;

  return v_result||jsonb_build_object(
    'tare_weight_kg',p_tare_weight_kg,
    'initial_gross_weight_kg',p_initial_gross_weight_kg,
    'current_gross_weight_kg',p_initial_gross_weight_kg,
    'cost_per_kg_cents',p_cost_per_kg_cents,
    'remaining_net_weight_kg',p_initial_gross_weight_kg-p_tare_weight_kg
  );
end
$$;

create or replace function public.dbs_control_update_gas_cylinder_cost(
  p_cylinder_id uuid,
  p_cost_per_kg_cents integer
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor uuid:=auth.uid();
  v_actor_company uuid;
  v_actor_scope text;
  v_cylinder public.dbs_control_gas_cylinders%rowtype;
begin
  if v_actor is null or not public.dbs_control_is_admin_actor(v_actor) then
    raise exception 'DBS_GAS_COST_UPDATE_FORBIDDEN' using errcode='42501';
  end if;
  if p_cylinder_id is null or p_cost_per_kg_cents is null or p_cost_per_kg_cents<=0 then
    raise exception 'DBS_GAS_COST_PER_KG_INVALID' using errcode='22023';
  end if;
  select company_id into v_actor_company
    from public.users where id=v_actor and status='ativo';
  if not found then
    raise exception 'DBS_GAS_COST_UPDATE_FORBIDDEN' using errcode='42501';
  end if;
  v_actor_scope:=case when v_actor_company is not null
    then 'company:'||v_actor_company::text
    else 'user:'||v_actor::text end;

  select * into v_cylinder
    from public.dbs_control_gas_cylinders
   where id=p_cylinder_id
   for update;
  if not found then
    raise exception 'DBS_GAS_CYLINDER_NOT_FOUND' using errcode='23503';
  end if;
  if v_cylinder.scope_key is distinct from v_actor_scope then
    raise exception 'DBS_GAS_COMPANY_MISMATCH' using errcode='42501';
  end if;

  update public.dbs_control_gas_cylinders
     set cost_per_kg_cents=p_cost_per_kg_cents,updated_at=now()
   where id=p_cylinder_id;

  return jsonb_build_object(
    'ok',true,
    'cylinder_id',p_cylinder_id,
    'cost_per_kg_cents',p_cost_per_kg_cents
  );
end
$$;

create or replace function public.dbs_control_list_my_gas_cylinders(p_work_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor uuid:=auth.uid();
  v_employee uuid;
  v_os public.dbs_control_work_orders%rowtype;
begin
  if v_actor is null then raise exception 'DBS_GAS_UNAUTHENTICATED' using errcode='42501'; end if;
  select * into v_os from public.dbs_control_work_orders where id=p_work_order_id and deleted_at is null;
  if not found then raise exception 'DBS_OS_NOT_FOUND' using errcode='23503'; end if;

  select ea.employee_id into v_employee
    from public.users u
    join public.rh_employee_access ea on ea.user_id=u.id and ea.access_enabled=true
   where u.id=v_actor and u.status='ativo'
  union
  select re.id
    from public.users u
    join public.rh_employees re on re.ponto_portal_user_id=u.id and re.dbs_control_access_enabled=true and re.is_active=true
   where u.id=v_actor and u.status='ativo';

  if public.dbs_control_is_admin_actor(v_actor) then v_employee:=v_os.assigned_employee_id; end if;
  if v_employee is null or v_os.assigned_employee_id is distinct from v_employee then
    raise exception 'DBS_GAS_FORBIDDEN' using errcode='42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',id,
      'serial_number',serial_number,
      'refrigerant_type',refrigerant_type,
      'total_charges',total_charges,
      'used_charges',used_charges,
      'remaining_charges',remaining_charges,
      'refill_count',refill_count,
      'vehicle_label',vehicle_label,
      'status',status,
      'tare_weight_kg',tare_weight_kg,
      'initial_gross_weight_kg',initial_gross_weight_kg,
      'current_gross_weight_kg',current_gross_weight_kg,
      'cost_per_kg_cents',cost_per_kg_cents,
      'remaining_net_weight_kg',case
        when tare_weight_kg is not null and current_gross_weight_kg is not null
          then greatest(current_gross_weight_kg-tare_weight_kg,0)
        else null
      end
    ) order by assigned_at desc)
      from public.dbs_control_gas_cylinders
     where employee_id=v_employee and status='active'
  ),'[]'::jsonb);
end
$$;

create or replace function public.dbs_control_register_gas_usage_weighted(
  p_work_order_id uuid,
  p_cylinder_id uuid,
  p_equipment_reference text,
  p_application_note text,
  p_gross_weight_before_kg numeric,
  p_gross_weight_after_kg numeric,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor uuid:=auth.uid();
  v_employee uuid;
  v_os public.dbs_control_work_orders%rowtype;
  v_cylinder public.dbs_control_gas_cylinders%rowtype;
  v_existing public.dbs_control_gas_usage%rowtype;
  v_scope record;
  v_usage_id uuid;
  v_ledger jsonb;
  v_ledger_id uuid;
  v_consumed numeric(12,3);
  v_cost bigint;
begin
  if v_actor is null then
    raise exception 'DBS_GAS_UNAUTHENTICATED' using errcode='42501';
  end if;
  if nullif(trim(p_idempotency_key),'') is null
     or char_length(trim(p_idempotency_key)) not between 8 and 240 then
    raise exception 'DBS_GAS_IDEMPOTENCY_REQUIRED' using errcode='22023';
  end if;
  if p_gross_weight_before_kg is null or p_gross_weight_after_kg is null
     or p_gross_weight_before_kg<0 or p_gross_weight_after_kg<0
     or p_gross_weight_after_kg>=p_gross_weight_before_kg then
    raise exception 'DBS_GAS_WEIGHT_INVALID' using errcode='22023';
  end if;

  select * into v_os
    from public.dbs_control_work_orders
   where id=p_work_order_id and deleted_at is null
   for update;
  if not found then raise exception 'DBS_OS_NOT_FOUND' using errcode='23503'; end if;

  select ea.employee_id into v_employee
    from public.users u
    join public.rh_employee_access ea on ea.user_id=u.id and ea.access_enabled=true
   where u.id=v_actor and u.status='ativo'
  union
  select re.id
    from public.users u
    join public.rh_employees re on re.ponto_portal_user_id=u.id and re.dbs_control_access_enabled=true and re.is_active=true
   where u.id=v_actor and u.status='ativo';

  if public.dbs_control_is_admin_actor(v_actor) then
    v_employee:=v_os.assigned_employee_id;
  end if;
  if v_employee is null or v_os.assigned_employee_id is distinct from v_employee then
    raise exception 'DBS_GAS_NOT_ASSIGNED' using errcode='42501';
  end if;

  select * into v_scope
    from public.dbs_control_inventory_scope_for_work_order(p_work_order_id);
  if not found then raise exception 'DBS_OS_NOT_FOUND' using errcode='23503'; end if;

  select * into v_cylinder
    from public.dbs_control_gas_cylinders
   where id=p_cylinder_id
     and employee_id=v_employee
     and scope_key=v_scope.scope_key
     and status='active'
   for update;
  if not found then raise exception 'DBS_GAS_CYLINDER_NOT_ASSIGNED' using errcode='42501'; end if;
  if v_cylinder.tare_weight_kg is null or v_cylinder.current_gross_weight_kg is null then
    raise exception 'DBS_GAS_TARE_WEIGHT_REQUIRED' using errcode='23514';
  end if;
  if v_cylinder.cost_per_kg_cents is null or v_cylinder.cost_per_kg_cents<=0 then
    raise exception 'DBS_GAS_COST_PER_KG_REQUIRED' using errcode='23514';
  end if;

  select * into v_existing
    from public.dbs_control_gas_usage
   where idempotency_key=p_idempotency_key;
  if found then
    if v_existing.work_order_id<>p_work_order_id or v_existing.cylinder_id<>p_cylinder_id
       or abs(coalesce(v_existing.gross_weight_before_kg,-1)-p_gross_weight_before_kg)>0.001
       or abs(coalesce(v_existing.gross_weight_after_kg,-1)-p_gross_weight_after_kg)>0.001 then
      raise exception 'DBS_GAS_WEIGHT_IDEMPOTENCY_CONFLICT' using errcode='23505';
    end if;
    return jsonb_build_object(
      'ok',true,
      'replayed',true,
      'work_order_id',p_work_order_id,
      'cylinder_id',p_cylinder_id,
      'gas_consumed_kg',v_existing.gas_consumed_kg,
      'gross_weight_after_kg',v_existing.gross_weight_after_kg,
      'unit_cost_cents_per_kg',v_existing.unit_cost_cents_per_kg,
      'gas_cost_cents',v_existing.gas_cost_cents,
      'cost_pending',v_existing.gas_cost_cents is null,
      'remaining_net_weight_kg',greatest(v_existing.gross_weight_after_kg-v_cylinder.tare_weight_kg,0)
    );
  end if;

  if p_gross_weight_after_kg<v_cylinder.tare_weight_kg then
    raise exception 'DBS_GAS_WEIGHT_BELOW_TARE' using errcode='23514';
  end if;
  if abs(v_cylinder.current_gross_weight_kg-p_gross_weight_before_kg)>0.05 then
    raise exception 'DBS_GAS_WEIGHT_STALE: atualize a pesagem antes de registrar o consumo.' using errcode='40001';
  end if;
  if v_cylinder.remaining_charges<1 then
    raise exception 'DBS_GAS_CYLINDER_EMPTY' using errcode='23514';
  end if;

  v_consumed:=round((p_gross_weight_before_kg-p_gross_weight_after_kg)::numeric,3);
  if v_consumed<=0 then raise exception 'DBS_GAS_NO_WEIGHT_CHANGE' using errcode='22023'; end if;
  v_cost:=round(v_consumed*v_cylinder.cost_per_kg_cents)::bigint;
  if v_cost<=0 then raise exception 'DBS_GAS_COST_INVALID' using errcode='22023'; end if;

  update public.dbs_control_gas_cylinders
     set used_charges=used_charges+1,
         remaining_charges=remaining_charges-1,
         current_gross_weight_kg=p_gross_weight_after_kg,
         status=case when remaining_charges-1=0 then 'empty' else 'active' end,
         updated_at=now()
   where id=p_cylinder_id;

  insert into public.dbs_control_gas_usage(
    cylinder_id,work_order_id,employee_id,equipment_reference,application_note,
    idempotency_key,created_by,gross_weight_before_kg,gross_weight_after_kg,
    gas_consumed_kg,unit_cost_cents_per_kg,gas_cost_cents
  ) values (
    p_cylinder_id,p_work_order_id,v_employee,
    nullif(trim(p_equipment_reference),''),nullif(trim(p_application_note),''),
    trim(p_idempotency_key),v_actor,p_gross_weight_before_kg,p_gross_weight_after_kg,
    v_consumed,v_cylinder.cost_per_kg_cents,v_cost
  ) returning id into v_usage_id;

  -- The gas cost enters the Treasury DRE as a balanced, immutable COGS entry.
  -- It is posted only for this new idempotent usage, never for a replay.
  v_ledger:=public.post_treasury_ledger_entry(
    v_scope.scope_key,v_scope.company_id,current_date,current_date,
    'work_order_gas_cogs',
    'Consumo de gás refrigerante · OS '||coalesce(v_os.protocol,p_work_order_id::text),
    'work-order-gas:'||md5(trim(p_idempotency_key)),
    'work-order-gas:'||md5(trim(p_idempotency_key)),
    v_actor,'posted',
    jsonb_build_object(
      'source','dbs_control_gas_usage_weighted',
      'work_order_id',p_work_order_id,
      'gas_usage_id',v_usage_id,
      'cylinder_id',p_cylinder_id,
      'cost_center_id',v_os.cost_center_id,
      'gas_consumed_kg',v_consumed,
      'unit_cost_cents_per_kg',v_cylinder.cost_per_kg_cents
    ),
    jsonb_build_array(
      jsonb_build_object(
        'account_code','5.1.02',
        'account_name','Custo de gás refrigerante aplicado',
        'account_type','expense',
        'debit_cents',v_cost,
        'credit_cents',0
      ),
      jsonb_build_object(
        'account_code','1.1.05',
        'account_name','Estoque de gás refrigerante',
        'account_type','asset',
        'debit_cents',0,
        'credit_cents',v_cost
      )
    )
  );
  v_ledger_id:=nullif(v_ledger->>'entry_id','')::uuid;
  if v_ledger_id is null then
    raise exception 'DBS_GAS_LEDGER_POST_FAILED' using errcode='23514';
  end if;
  update public.dbs_control_gas_usage set ledger_entry_id=v_ledger_id where id=v_usage_id;

  insert into public.dbs_control_work_order_financials(
    work_order_id,company_id,scope_key,parts_cost_cents,gas_cost_cents,status,metadata
  ) values (
    p_work_order_id,v_scope.company_id,v_scope.scope_key,0,v_cost,'pending',
    jsonb_build_object('gas_cost_source','weighted_gas_usage','last_gas_usage_key',trim(p_idempotency_key))
  )
  on conflict (work_order_id) do update
    set gas_cost_cents=coalesce(public.dbs_control_work_order_financials.gas_cost_cents,0)+excluded.gas_cost_cents,
        version=public.dbs_control_work_order_financials.version+1,
        updated_at=now(),
        metadata=coalesce(public.dbs_control_work_order_financials.metadata,'{}'::jsonb)
          || jsonb_build_object('last_gas_usage_key',trim(p_idempotency_key));

  return jsonb_build_object(
    'ok',true,
    'replayed',false,
    'work_order_id',p_work_order_id,
    'cylinder_id',p_cylinder_id,
    'serial_number',v_cylinder.serial_number,
    'refrigerant_type',v_cylinder.refrigerant_type,
    'gas_consumed_kg',v_consumed,
    'unit_cost_cents_per_kg',v_cylinder.cost_per_kg_cents,
    'gas_cost_cents',v_cost,
    'ledger_entry_id',v_ledger_id,
    'remaining_charges',v_cylinder.remaining_charges-1,
    'used_charges',v_cylinder.used_charges+1,
    'gross_weight_after_kg',p_gross_weight_after_kg,
    'remaining_net_weight_kg',greatest(p_gross_weight_after_kg-v_cylinder.tare_weight_kg,0),
    'cost_center_id',v_os.cost_center_id
  );
end
$$;

create or replace view public.dbs_treasury_purchase_commitments as
select
  p.id as purchase_id,
  p.company_id,
  p.scope_key,
  p.supplier_id,
  p.supplier_name,
  p.document_number,
  p.purchase_date as commitment_date,
  p.status as purchase_status,
  p.approval_status,
  p.payment_status,
  p.total_cents,
  p.paid_cents,
  greatest(p.total_cents-p.paid_cents,0::bigint) as outstanding_cents,
  p.received_total_cents,
  p.ledger_entry_id as payable_ledger_entry_id,
  le.status as payable_ledger_status,
  p.created_at,
  p.updated_at,
  p.cost_center_id,
  cc.code as cost_center_code,
  cc.name as cost_center_name
from public.dbs_control_purchases p
join public.treasury_ledger_entries le
  on le.id=p.ledger_entry_id and le.scope_key=p.scope_key
left join public.dbs_control_cost_centers cc
  on cc.id=p.cost_center_id and cc.scope_key=p.scope_key
where p.approval_status='approved'
  and p.status<>'cancelled'
  and p.paid_cents<p.total_cents
  and le.status in ('draft','posted');

revoke all on function public.dbs_control_update_gas_cylinder_cost(uuid,integer) from public,anon;
revoke all on function public.dbs_control_assign_gas_cylinder_weighted(text,text,uuid,integer,text,numeric,numeric,integer) from public,anon;
revoke all on function public.dbs_control_register_gas_usage_weighted(uuid,uuid,text,text,numeric,numeric,text) from public,anon;
grant execute on function public.dbs_control_update_gas_cylinder_cost(uuid,integer) to authenticated;
grant execute on function public.dbs_control_assign_gas_cylinder_weighted(text,text,uuid,integer,text,numeric,numeric,integer) to authenticated;
grant execute on function public.dbs_control_register_gas_usage_weighted(uuid,uuid,text,text,numeric,numeric,text) to authenticated;

-- Prevent client-side calls from bypassing the weighted, costed gas usage entrypoint.
revoke all on function public.dbs_control_register_gas_usage(uuid,uuid,text,text,text) from public,anon,authenticated;

notify pgrst,'reload schema';
commit;
