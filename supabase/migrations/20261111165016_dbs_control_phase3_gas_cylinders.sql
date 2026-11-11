begin;

create table if not exists public.dbs_control_gas_cylinders (
 id uuid primary key default gen_random_uuid(),
 company_id uuid references public.companies(id) on delete restrict,
 scope_key text not null,
 serial_number text not null,
 refrigerant_type text not null,
 employee_id uuid not null references public.rh_employees(id) on delete restrict,
 vehicle_label text,
 total_charges integer not null check(total_charges>0),
 used_charges integer not null default 0 check(used_charges>=0),
 remaining_charges integer not null check(remaining_charges>=0),
 refill_count integer not null default 0 check(refill_count>=0),
 status text not null default 'active' check(status in ('active','empty','inactive')),
 assigned_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 created_by uuid references public.users(id) on delete set null,
 unique(scope_key,serial_number),
 check(used_charges+remaining_charges=total_charges)
);
create index if not exists dbs_control_gas_cylinders_employee_idx
 on public.dbs_control_gas_cylinders(employee_id,status,updated_at desc);

create table if not exists public.dbs_control_gas_usage (
 id uuid primary key default gen_random_uuid(),
 cylinder_id uuid not null references public.dbs_control_gas_cylinders(id) on delete restrict,
 work_order_id uuid not null references public.dbs_control_work_orders(id) on delete restrict,
 employee_id uuid not null references public.rh_employees(id) on delete restrict,
 equipment_reference text,
 application_note text,
 idempotency_key text not null unique check(char_length(trim(idempotency_key)) between 8 and 240),
 created_by uuid references public.users(id) on delete set null,
 created_at timestamptz not null default now()
);
create index if not exists dbs_control_gas_usage_os_idx on public.dbs_control_gas_usage(work_order_id,created_at desc);
alter table public.dbs_control_gas_cylinders enable row level security;
alter table public.dbs_control_gas_usage enable row level security;
revoke all on public.dbs_control_gas_cylinders,public.dbs_control_gas_usage from anon,authenticated;
grant select on public.dbs_control_gas_cylinders to authenticated;

create or replace function public.dbs_control_list_my_gas_cylinders(p_work_order_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid(); v_employee uuid; v_os public.dbs_control_work_orders%rowtype;
begin
 if v_actor is null then raise exception 'DBS_GAS_UNAUTHENTICATED' using errcode='42501'; end if;
 select * into v_os from public.dbs_control_work_orders where id=p_work_order_id and deleted_at is null;
 if not found then raise exception 'DBS_OS_NOT_FOUND' using errcode='23503'; end if;
 select ea.employee_id into v_employee from public.users u join public.rh_employee_access ea on ea.user_id=u.id and ea.access_enabled=true where u.id=v_actor and u.status='ativo'
 union select re.id from public.users u join public.rh_employees re on re.ponto_portal_user_id=u.id and re.dbs_control_access_enabled=true and re.is_active=true where u.id=v_actor and u.status='ativo';
 if public.dbs_control_is_admin_actor(v_actor) then v_employee:=v_os.assigned_employee_id; end if;
 if v_employee is null or v_os.assigned_employee_id is distinct from v_employee then raise exception 'DBS_GAS_FORBIDDEN' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'serial_number',serial_number,'refrigerant_type',refrigerant_type,
 'total_charges',total_charges,'used_charges',used_charges,'remaining_charges',remaining_charges,'refill_count',refill_count,
 'vehicle_label',vehicle_label,'status',status) order by assigned_at desc)
 from public.dbs_control_gas_cylinders where employee_id=v_employee and status='active'), '[]'::jsonb);
end $$;

create or replace function public.dbs_control_assign_gas_cylinder(
 p_serial_number text,p_refrigerant_type text,p_employee_id uuid,p_total_charges integer,p_vehicle_label text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid(); v_user public.users%rowtype; v_employee_user public.users%rowtype; v_scope text; v_row public.dbs_control_gas_cylinders%rowtype;
begin
 if v_actor is null or not public.dbs_control_is_admin_actor(v_actor) then raise exception 'DBS_GAS_ASSIGN_FORBIDDEN' using errcode='42501'; end if;
 if nullif(trim(p_serial_number),'') is null or nullif(trim(p_refrigerant_type),'') is null or p_total_charges<=0 then raise exception 'DBS_GAS_ASSIGN_INPUT_INVALID' using errcode='22023'; end if;
 if not exists(select 1 from public.rh_employees where id=p_employee_id and is_active=true) then raise exception 'DBS_GAS_EMPLOYEE_INVALID' using errcode='23503'; end if;
 select * into v_user from public.users where id=v_actor and status='ativo';
 select u.* into v_employee_user from public.rh_employee_access ea join public.users u on u.id=ea.user_id where ea.employee_id=p_employee_id and ea.access_enabled=true and u.status='ativo';
 if not found then raise exception 'DBS_GAS_EMPLOYEE_ACCESS_MISSING' using errcode='23503'; end if;
 if v_user.company_id is not null and v_employee_user.company_id is distinct from v_user.company_id then raise exception 'DBS_GAS_COMPANY_MISMATCH' using errcode='42501'; end if;
 v_scope:=case when v_employee_user.company_id is not null then 'company:'||v_employee_user.company_id::text else 'user:'||v_employee_user.id::text end;
 insert into public.dbs_control_gas_cylinders(company_id,scope_key,serial_number,refrigerant_type,employee_id,vehicle_label,total_charges,remaining_charges,created_by)
 values(v_employee_user.company_id,v_scope,trim(p_serial_number),upper(trim(p_refrigerant_type)),p_employee_id,nullif(trim(p_vehicle_label),''),p_total_charges,p_total_charges,v_actor)
 returning * into v_row;
 return jsonb_build_object('ok',true,'cylinder_id',v_row.id,'serial_number',v_row.serial_number,'remaining_charges',v_row.remaining_charges);
end $$;

create or replace function public.dbs_control_refill_gas_cylinder(p_cylinder_id uuid,p_total_charges integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid(); v_row public.dbs_control_gas_cylinders%rowtype;
begin
 if v_actor is null or not public.dbs_control_is_admin_actor(v_actor) then raise exception 'DBS_GAS_REFILL_FORBIDDEN' using errcode='42501'; end if;
 if p_total_charges<=0 then raise exception 'DBS_GAS_REFILL_INVALID' using errcode='22023'; end if;
 select * into v_row from public.dbs_control_gas_cylinders where id=p_cylinder_id for update;
 if not found then raise exception 'DBS_GAS_CYLINDER_NOT_FOUND' using errcode='23503'; end if;
 update public.dbs_control_gas_cylinders set total_charges=p_total_charges,used_charges=0,remaining_charges=p_total_charges,
 refill_count=refill_count+1,status='active',updated_at=now() where id=p_cylinder_id;
 return jsonb_build_object('ok',true,'cylinder_id',p_cylinder_id,'remaining_charges',p_total_charges);
end $$;

create or replace function public.dbs_control_register_gas_usage(
 p_work_order_id uuid,p_cylinder_id uuid,p_equipment_reference text,p_application_note text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid(); v_employee uuid; v_os public.dbs_control_work_orders%rowtype; v_cylinder public.dbs_control_gas_cylinders%rowtype; v_key text:=nullif(trim(p_idempotency_key),''); v_previous public.dbs_control_gas_usage%rowtype; v_scope record;
begin
 if v_actor is null then raise exception 'DBS_GAS_UNAUTHENTICATED' using errcode='42501'; end if;
 if v_key is null or char_length(v_key) not between 8 and 240 then raise exception 'DBS_GAS_IDEMPOTENCY_REQUIRED' using errcode='22023'; end if;
 select * into v_os from public.dbs_control_work_orders where id=p_work_order_id and deleted_at is null for update;
 if not found then raise exception 'DBS_OS_NOT_FOUND' using errcode='23503'; end if;
 select ea.employee_id into v_employee from public.users u join public.rh_employee_access ea on ea.user_id=u.id and ea.access_enabled=true where u.id=v_actor and u.status='ativo'
 union select re.id from public.users u join public.rh_employees re on re.ponto_portal_user_id=u.id and re.dbs_control_access_enabled=true and re.is_active=true where u.id=v_actor and u.status='ativo';
 if public.dbs_control_is_admin_actor(v_actor) then v_employee:=v_os.assigned_employee_id; end if;
 if v_employee is null or v_os.assigned_employee_id is distinct from v_employee then raise exception 'DBS_GAS_NOT_ASSIGNED' using errcode='42501'; end if;
 select * into v_previous from public.dbs_control_gas_usage where idempotency_key=v_key;
 if found then
   if v_previous.work_order_id<>p_work_order_id or v_previous.cylinder_id<>p_cylinder_id or v_previous.employee_id<>v_employee then raise exception 'DBS_GAS_IDEMPOTENCY_CONFLICT' using errcode='23505'; end if;
   return jsonb_build_object('ok',true,'replayed',true,'work_order_id',p_work_order_id,'cylinder_id',p_cylinder_id);
 end if;
 select * into v_scope from public.dbs_control_inventory_scope_for_work_order(p_work_order_id);
 select * into v_cylinder from public.dbs_control_gas_cylinders where id=p_cylinder_id and employee_id=v_employee and scope_key=v_scope.scope_key and status='active' for update;
 if not found then raise exception 'DBS_GAS_CYLINDER_NOT_ASSIGNED' using errcode='42501'; end if;
 if v_cylinder.remaining_charges<1 then raise exception 'DBS_GAS_CYLINDER_EMPTY' using errcode='23514'; end if;
 update public.dbs_control_gas_cylinders set used_charges=used_charges+1,remaining_charges=remaining_charges-1,
 status=case when remaining_charges-1=0 then 'empty' else 'active' end,updated_at=now() where id=p_cylinder_id;
 insert into public.dbs_control_gas_usage(cylinder_id,work_order_id,employee_id,equipment_reference,application_note,idempotency_key,created_by)
 values(p_cylinder_id,p_work_order_id,v_employee,nullif(trim(p_equipment_reference),''),nullif(trim(p_application_note),''),v_key,v_actor);
 return jsonb_build_object('ok',true,'replayed',false,'work_order_id',p_work_order_id,'cylinder_id',p_cylinder_id,
 'serial_number',v_cylinder.serial_number,'refrigerant_type',v_cylinder.refrigerant_type,'remaining_charges',v_cylinder.remaining_charges-1,
 'used_charges',v_cylinder.used_charges+1);
end $$;

revoke all on function public.dbs_control_list_my_gas_cylinders(uuid) from public,anon;
revoke all on function public.dbs_control_assign_gas_cylinder(text,text,uuid,integer,text) from public,anon;
revoke all on function public.dbs_control_refill_gas_cylinder(uuid,integer) from public,anon;
revoke all on function public.dbs_control_register_gas_usage(uuid,uuid,text,text,text) from public,anon;
grant execute on function public.dbs_control_list_my_gas_cylinders(uuid) to authenticated;
grant execute on function public.dbs_control_assign_gas_cylinder(text,text,uuid,integer,text) to authenticated;
grant execute on function public.dbs_control_refill_gas_cylinder(uuid,integer) to authenticated;
grant execute on function public.dbs_control_register_gas_usage(uuid,uuid,text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
