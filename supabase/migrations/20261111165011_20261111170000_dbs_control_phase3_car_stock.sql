begin;

create table if not exists public.dbs_control_car_stock (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete restrict,
  scope_key text not null,
  employee_id uuid not null references public.rh_employees(id) on delete restrict,
  part_id uuid not null references public.dbs_control_parts(id) on delete restrict,
  vehicle_label text not null default 'Veículo do colaborador',
  quantity numeric(14,3) not null default 0 check (quantity >= 0),
  unit_cost_cents integer not null default 0 check (unit_cost_cents >= 0),
  status text not null default 'active' check (status in ('active','inactive')),
  version bigint not null default 1 check (version > 0),
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(scope_key,employee_id,part_id,vehicle_label)
);
create index if not exists dbs_control_car_stock_employee_idx
  on public.dbs_control_car_stock(employee_id,status,updated_at desc);

create table if not exists public.dbs_control_car_stock_consumptions (
  id uuid primary key default gen_random_uuid(),
  car_stock_id uuid not null references public.dbs_control_car_stock(id) on delete restrict,
  work_order_id uuid not null references public.dbs_control_work_orders(id) on delete restrict,
  work_order_part_id uuid not null references public.dbs_control_work_order_parts(id) on delete restrict,
  employee_id uuid not null references public.rh_employees(id) on delete restrict,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_cost_cents integer not null check (unit_cost_cents >= 0),
  idempotency_key text not null unique check (char_length(trim(idempotency_key)) between 8 and 240),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists dbs_control_car_stock_consumptions_os_idx
  on public.dbs_control_car_stock_consumptions(work_order_id,created_at desc);

alter table public.dbs_control_car_stock enable row level security;
alter table public.dbs_control_car_stock_consumptions enable row level security;
revoke all on public.dbs_control_car_stock, public.dbs_control_car_stock_consumptions from anon, authenticated;
grant select on public.dbs_control_car_stock to authenticated;

create or replace function public.dbs_control_list_my_car_stock(p_work_order_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid(); v_employee uuid; v_os public.dbs_control_work_orders%rowtype;
begin
  if v_actor is null then raise exception 'DBS_CAR_STOCK_UNAUTHENTICATED' using errcode='42501'; end if;
  select * into v_os from public.dbs_control_work_orders where id=p_work_order_id and deleted_at is null;
  if not found then raise exception 'DBS_OS_NOT_FOUND' using errcode='23503'; end if;
  select ea.employee_id into v_employee
    from public.users u join public.rh_employee_access ea on ea.user_id=u.id and ea.access_enabled=true
    where u.id=v_actor and u.status='ativo'
  union
  select re.id from public.users u join public.rh_employees re
    on re.ponto_portal_user_id=u.id and re.dbs_control_access_enabled=true and re.is_active=true
    where u.id=v_actor and u.status='ativo';
  if public.dbs_control_is_admin_actor(v_actor) then
    return coalesce((select jsonb_agg(jsonb_build_object('id',cs.id,'part_id',cs.part_id,'name',p.name,
      'sku',p.sku,'quantity',cs.quantity,'vehicle_label',cs.vehicle_label,
      'unit_cost_cents',cs.unit_cost_cents) order by p.name)
      from public.dbs_control_car_stock cs join public.dbs_control_parts p on p.id=cs.part_id
      where cs.status='active' and cs.quantity>0 and cs.scope_key=(select scope_key from public.dbs_control_inventory_scope_for_work_order(p_work_order_id))), '[]'::jsonb);
  end if;
  if v_employee is null or v_os.assigned_employee_id is distinct from v_employee then
    raise exception 'DBS_CAR_STOCK_FORBIDDEN' using errcode='42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',cs.id,'part_id',cs.part_id,'name',p.name,
    'sku',p.sku,'quantity',cs.quantity,'vehicle_label',cs.vehicle_label,
    'unit_cost_cents',cs.unit_cost_cents) order by p.name)
    from public.dbs_control_car_stock cs join public.dbs_control_parts p on p.id=cs.part_id
    where cs.employee_id=v_employee and cs.status='active' and cs.quantity>0
      and cs.scope_key=(select scope_key from public.dbs_control_inventory_scope_for_work_order(p_work_order_id))), '[]'::jsonb);
end $$;

create or replace function public.dbs_control_transfer_to_car_stock(
  p_employee_id uuid,p_part_id uuid,p_quantity numeric,p_vehicle_label text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid(); v_user public.users%rowtype; v_employee_user public.users%rowtype; v_part public.dbs_control_parts%rowtype;
 v_scope text; v_existing public.dbs_control_car_stock%rowtype; v_new numeric;
begin
 if v_actor is null or not public.dbs_control_is_admin_actor(v_actor) then raise exception 'DBS_CAR_STOCK_TRANSFER_FORBIDDEN' using errcode='42501'; end if;
 if p_quantity is null or p_quantity<=0 or p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 8 and 240 then raise exception 'DBS_CAR_STOCK_TRANSFER_INPUT_INVALID' using errcode='22023'; end if;
 select * into v_user from public.users where id=v_actor and status='ativo';
 select u.* into v_employee_user from public.rh_employee_access ea join public.users u on u.id=ea.user_id where ea.employee_id=p_employee_id and ea.access_enabled=true and u.status='ativo';
 if not found then raise exception 'DBS_CAR_STOCK_EMPLOYEE_ACCESS_MISSING' using errcode='23503'; end if;
 if v_user.company_id is not null and v_employee_user.company_id is distinct from v_user.company_id then raise exception 'DBS_CAR_STOCK_COMPANY_MISMATCH' using errcode='42501'; end if;
 v_scope:=case when v_employee_user.company_id is not null then 'company:'||v_employee_user.company_id::text else 'user:'||v_employee_user.id::text end;
 perform pg_advisory_xact_lock(hashtextextended(v_scope||':car-stock-transfer:'||p_idempotency_key,0));
 if exists(select 1 from public.dbs_control_car_stock_consumptions where idempotency_key=p_idempotency_key) then raise exception 'DBS_CAR_STOCK_IDEMPOTENCY_CONFLICT' using errcode='23505'; end if;
 select * into v_part from public.dbs_control_parts where id=p_part_id for update;
 if not found or v_part.status<>'ativo' or v_part.stock_quantity-v_part.reserved_quantity<p_quantity then raise exception 'DBS_CAR_STOCK_INSUFFICIENT' using errcode='23514'; end if;
 if not exists(select 1 from public.rh_employees where id=p_employee_id and is_active=true) then raise exception 'DBS_CAR_STOCK_EMPLOYEE_INVALID' using errcode='23503'; end if;
 update public.dbs_control_parts set stock_quantity=stock_quantity-p_quantity,version=version+1,updated_at=now() where id=p_part_id returning stock_quantity into v_new;
 insert into public.dbs_control_inventory_movements(company_id,scope_key,part_id,movement_type,quantity_delta,unit_cost_cents,balance_after,idempotency_key,created_by,metadata)
 values(v_employee_user.company_id,v_scope,p_part_id,'adjustment',-p_quantity,v_part.cost_cents,v_new,left(p_idempotency_key,200),v_actor,
 jsonb_build_object('source','car_stock_transfer','employee_id',p_employee_id,'vehicle_label',coalesce(nullif(trim(p_vehicle_label),''),'Veículo do colaborador')));
 insert into public.dbs_control_car_stock(scope_key,company_id,employee_id,part_id,vehicle_label,quantity,unit_cost_cents,created_by,updated_by)
 values(v_scope,v_employee_user.company_id,p_employee_id,p_part_id,coalesce(nullif(trim(p_vehicle_label),''),'Veículo do colaborador'),p_quantity,coalesce(v_part.cost_cents,0),v_actor,v_actor)
 on conflict(scope_key,employee_id,part_id,vehicle_label) do update set quantity=dbs_control_car_stock.quantity+excluded.quantity,
 unit_cost_cents=excluded.unit_cost_cents,version=dbs_control_car_stock.version+1,updated_by=v_actor,updated_at=now()
 returning * into v_existing;
 return jsonb_build_object('ok',true,'car_stock_id',v_existing.id,'quantity',v_existing.quantity,'part_id',p_part_id);
end $$;

create or replace function public.dbs_control_consume_car_stock_item(
 p_work_order_id uuid,p_car_stock_id uuid,p_quantity numeric,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid(); v_os public.dbs_control_work_orders%rowtype; v_stock public.dbs_control_car_stock%rowtype;
 v_employee uuid; v_scope record; v_part_id uuid; v_cost integer; v_wop uuid; v_key text:=nullif(trim(p_idempotency_key),''); v_previous public.dbs_control_car_stock_consumptions%rowtype;
 v_ledger jsonb; v_ledger_id uuid; v_total bigint;
begin
 if v_actor is null then raise exception 'DBS_CAR_STOCK_UNAUTHENTICATED' using errcode='42501'; end if;
 if p_quantity is null or p_quantity<=0 or v_key is null or char_length(v_key) not between 8 and 240 then raise exception 'DBS_CAR_STOCK_INPUT_INVALID' using errcode='22023'; end if;
 select * into v_os from public.dbs_control_work_orders where id=p_work_order_id and deleted_at is null for update;
 if not found then raise exception 'DBS_OS_NOT_FOUND' using errcode='23503'; end if;
 select ea.employee_id into v_employee from public.users u join public.rh_employee_access ea on ea.user_id=u.id and ea.access_enabled=true where u.id=v_actor and u.status='ativo'
 union select re.id from public.users u join public.rh_employees re on re.ponto_portal_user_id=u.id and re.dbs_control_access_enabled=true and re.is_active=true where u.id=v_actor and u.status='ativo';
 if public.dbs_control_is_admin_actor(v_actor) then v_employee:=v_os.assigned_employee_id; end if;
 if v_employee is null or v_os.assigned_employee_id is distinct from v_employee then raise exception 'DBS_CAR_STOCK_NOT_ASSIGNED' using errcode='42501'; end if;
 select * into v_scope from public.dbs_control_inventory_scope_for_work_order(p_work_order_id);
 select * into v_stock from public.dbs_control_car_stock where id=p_car_stock_id and employee_id=v_employee and scope_key=v_scope.scope_key and status='active' for update;
 if not found then raise exception 'DBS_CAR_STOCK_ITEM_NOT_FOUND' using errcode='23503'; end if;
 select * into v_previous from public.dbs_control_car_stock_consumptions where idempotency_key=v_key;
 if found then
   if v_previous.work_order_id<>p_work_order_id or v_previous.car_stock_id<>p_car_stock_id or v_previous.employee_id<>v_employee or v_previous.quantity<>p_quantity then raise exception 'DBS_CAR_STOCK_IDEMPOTENCY_CONFLICT' using errcode='23505'; end if;
   return jsonb_build_object('ok',true,'replayed',true,'work_order_id',p_work_order_id,'work_order_part_id',v_previous.work_order_part_id);
 end if;
 if v_stock.quantity<p_quantity then raise exception 'DBS_CAR_STOCK_BALANCE_INSUFFICIENT' using errcode='23514'; end if;
 v_part_id:=v_stock.part_id; v_cost:=v_stock.unit_cost_cents;
 update public.dbs_control_car_stock set quantity=quantity-p_quantity,version=version+1,updated_by=v_actor,updated_at=now() where id=v_stock.id;
 insert into public.dbs_control_work_order_parts(work_order_id,part_id,quantity,unit_cents,cost_cents,consumption_status,idempotency_key)
 values(p_work_order_id,v_part_id,p_quantity,coalesce((select sale_cents from public.dbs_control_parts where id=v_part_id),0),v_cost,'consumed',v_key)
 returning id into v_wop;
 insert into public.dbs_control_car_stock_consumptions(car_stock_id,work_order_id,work_order_part_id,employee_id,quantity,unit_cost_cents,idempotency_key,created_by)
 values(v_stock.id,p_work_order_id,v_wop,v_employee,p_quantity,v_cost,v_key,v_actor);
 v_total:=round(p_quantity*v_cost)::bigint;
 if v_total>0 then
   v_ledger:=public.post_treasury_ledger_entry(v_scope.scope_key,v_scope.company_id,current_date,current_date,
    'work_order_car_stock_cogs','Consumo de peça do carro · OS '||coalesce(v_os.protocol,p_work_order_id::text),
    left(v_key,150)||':ledger','work-order-car-stock:'||v_key,v_actor,'posted',
    jsonb_build_object('source','dbs_control_car_stock','work_order_id',p_work_order_id,'part_id',v_part_id),
    jsonb_build_array(
     jsonb_build_object('account_code','5.1.01','account_name','Custo de peças aplicadas','account_type','expense','debit_cents',v_total,'credit_cents',0),
     jsonb_build_object('account_code','1.1.03','account_name','Estoque de peças','account_type','asset','debit_cents',0,'credit_cents',v_total)));
   v_ledger_id:=nullif(v_ledger->>'entry_id','')::uuid;
 end if;
 insert into public.dbs_control_work_order_financials(work_order_id,company_id,scope_key,parts_cost_cents)
 values(p_work_order_id,v_scope.company_id,v_scope.scope_key,v_total)
 on conflict(work_order_id) do update set parts_cost_cents=dbs_control_work_order_financials.parts_cost_cents+excluded.parts_cost_cents,
 version=dbs_control_work_order_financials.version+1,updated_at=now();
 return jsonb_build_object('ok',true,'replayed',false,'work_order_id',p_work_order_id,'work_order_part_id',v_wop,'quantity_remaining',v_stock.quantity-p_quantity,'cost_cents',v_total,'ledger_entry_id',v_ledger_id);
end $$;

revoke all on function public.dbs_control_list_my_car_stock(uuid) from public,anon;
revoke all on function public.dbs_control_transfer_to_car_stock(uuid,uuid,numeric,text,text) from public,anon;
revoke all on function public.dbs_control_consume_car_stock_item(uuid,uuid,numeric,text) from public,anon;
grant execute on function public.dbs_control_list_my_car_stock(uuid) to authenticated;
grant execute on function public.dbs_control_transfer_to_car_stock(uuid,uuid,numeric,text,text) to authenticated;
grant execute on function public.dbs_control_consume_car_stock_item(uuid,uuid,numeric,text) to authenticated;
notify pgrst,'reload schema';
commit;
