begin;
create table if not exists public.dbs_control_gas_cylinder_movements (
 id uuid primary key default gen_random_uuid(),
 company_id uuid references public.companies(id) on delete restrict,
 scope_key text not null,
 cylinder_id uuid not null references public.dbs_control_gas_cylinders(id) on delete restrict,
 movement_type text not null check (movement_type in ('assigned','transferred','vehicle_changed','refilled','status_changed','usage_registered')),
 from_employee_id uuid references public.rh_employees(id) on delete restrict,
 to_employee_id uuid references public.rh_employees(id) on delete restrict,
 from_vehicle_label text, to_vehicle_label text, from_status text, to_status text,
 remaining_before integer, remaining_after integer, used_before integer, used_after integer,
 work_order_id uuid references public.dbs_control_work_orders(id) on delete restrict,
 gas_usage_id uuid references public.dbs_control_gas_usage(id) on delete restrict,
 actor_user_id uuid references public.users(id) on delete set null,
 created_at timestamptz not null default now()
);
create index if not exists dbs_control_gas_cylinder_movements_scope_idx
 on public.dbs_control_gas_cylinder_movements(scope_key,cylinder_id,created_at desc);
create index if not exists dbs_control_gas_cylinder_movements_os_idx
 on public.dbs_control_gas_cylinder_movements(work_order_id,created_at desc) where work_order_id is not null;
alter table public.dbs_control_gas_cylinder_movements enable row level security;
revoke all on public.dbs_control_gas_cylinder_movements from public,anon,authenticated;
grant select,insert on public.dbs_control_gas_cylinder_movements to service_role;

create or replace function public.dbs_control_capture_gas_cylinder_movement()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $function$
declare v_type text; v_actor uuid;
begin
 select id into v_actor from public.users where auth_id=auth.uid() and status='ativo' limit 1;
 if tg_op='INSERT' then
  insert into public.dbs_control_gas_cylinder_movements(company_id,scope_key,cylinder_id,movement_type,to_employee_id,to_vehicle_label,to_status,remaining_after,used_after,actor_user_id)
  values(new.company_id,new.scope_key,new.id,'assigned',new.employee_id,new.vehicle_label,new.status,new.remaining_charges,new.used_charges,coalesce(v_actor,new.created_by));
  return new;
 end if;
 if old.employee_id is distinct from new.employee_id then v_type:='transferred';
 elsif old.vehicle_label is distinct from new.vehicle_label then v_type:='vehicle_changed';
 elsif new.refill_count>old.refill_count then v_type:='refilled';
 elsif old.status is distinct from new.status and old.remaining_charges=new.remaining_charges and old.used_charges=new.used_charges then v_type:='status_changed';
 else return new;
 end if;
 insert into public.dbs_control_gas_cylinder_movements(company_id,scope_key,cylinder_id,movement_type,from_employee_id,to_employee_id,from_vehicle_label,to_vehicle_label,from_status,to_status,remaining_before,remaining_after,used_before,used_after,actor_user_id)
 values(new.company_id,new.scope_key,new.id,v_type,old.employee_id,new.employee_id,old.vehicle_label,new.vehicle_label,old.status,new.status,old.remaining_charges,new.remaining_charges,old.used_charges,new.used_charges,v_actor);
 return new;
end;
$function$;

create or replace function public.dbs_control_capture_gas_usage_movement()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $function$
declare v_cylinder public.dbs_control_gas_cylinders%rowtype; v_actor uuid;
begin
 select * into v_cylinder from public.dbs_control_gas_cylinders where id=new.cylinder_id;
 select id into v_actor from public.users where auth_id=auth.uid() and status='ativo' limit 1;
 insert into public.dbs_control_gas_cylinder_movements(company_id,scope_key,cylinder_id,movement_type,from_employee_id,to_employee_id,from_vehicle_label,to_vehicle_label,from_status,to_status,remaining_before,remaining_after,used_before,used_after,work_order_id,gas_usage_id,actor_user_id,created_at)
 values(v_cylinder.company_id,v_cylinder.scope_key,v_cylinder.id,'usage_registered',v_cylinder.employee_id,v_cylinder.employee_id,v_cylinder.vehicle_label,v_cylinder.vehicle_label,
 case when v_cylinder.status='empty' then 'active' else v_cylinder.status end,v_cylinder.status,v_cylinder.remaining_charges+1,v_cylinder.remaining_charges,greatest(v_cylinder.used_charges-1,0),v_cylinder.used_charges,new.work_order_id,new.id,coalesce(v_actor,new.created_by),new.created_at);
 return new;
end;
$function$;

create or replace function public.dbs_control_reject_gas_cylinder_movement_mutation()
returns trigger language plpgsql set search_path=public,pg_temp as $function$
begin raise exception 'DBS_GAS_CYLINDER_MOVEMENT_IMMUTABLE' using errcode='55000'; end;
$function$;

drop trigger if exists dbs_control_gas_cylinder_movement_capture on public.dbs_control_gas_cylinders;
create trigger dbs_control_gas_cylinder_movement_capture after insert or update on public.dbs_control_gas_cylinders for each row execute function public.dbs_control_capture_gas_cylinder_movement();
drop trigger if exists dbs_control_gas_usage_movement_capture on public.dbs_control_gas_usage;
create trigger dbs_control_gas_usage_movement_capture after insert on public.dbs_control_gas_usage for each row execute function public.dbs_control_capture_gas_usage_movement();
drop trigger if exists dbs_control_gas_cylinder_movements_immutable on public.dbs_control_gas_cylinder_movements;
create trigger dbs_control_gas_cylinder_movements_immutable before update or delete on public.dbs_control_gas_cylinder_movements for each row execute function public.dbs_control_reject_gas_cylinder_movement_mutation();
revoke all on function public.dbs_control_capture_gas_cylinder_movement() from public,anon,authenticated;
revoke all on function public.dbs_control_capture_gas_usage_movement() from public,anon,authenticated;
revoke all on function public.dbs_control_reject_gas_cylinder_movement_mutation() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
