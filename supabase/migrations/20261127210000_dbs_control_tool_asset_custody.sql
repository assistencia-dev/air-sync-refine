begin;

create table if not exists public.dbs_control_tool_assets (
 id uuid primary key default gen_random_uuid(),
 company_id uuid references public.companies(id) on delete restrict,
 scope_key text not null,
 asset_tag text not null,
 name text not null,
 category text not null,
 serial_number text,
 brand_model text,
 status text not null default 'available' check(status in ('available','assigned','maintenance','retired','lost')),
 employee_id uuid references public.rh_employees(id) on delete restrict,
 vehicle_label text,
 condition_label text not null default 'good' check(condition_label in ('new','good','worn','damaged')),
 notes text,
 created_by uuid references public.users(id) on delete set null,
 updated_by uuid references public.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 assigned_at timestamptz,
 returned_at timestamptz,
 unique(scope_key,asset_tag),
 check((status='assigned' and employee_id is not null) or (status<>'assigned' and employee_id is null))
);
create index if not exists dbs_control_tool_assets_scope_status_idx
 on public.dbs_control_tool_assets(scope_key,status,updated_at desc);
create index if not exists dbs_control_tool_assets_employee_idx
 on public.dbs_control_tool_assets(employee_id,status,updated_at desc);

create table if not exists public.dbs_control_tool_asset_movements (
 id uuid primary key default gen_random_uuid(),
 company_id uuid references public.companies(id) on delete restrict,
 scope_key text not null,
 tool_asset_id uuid not null references public.dbs_control_tool_assets(id) on delete restrict,
 movement_type text not null check(movement_type in ('registered','assigned','returned','transferred','vehicle_changed','status_changed','condition_changed')),
 from_employee_id uuid references public.rh_employees(id) on delete restrict,
 to_employee_id uuid references public.rh_employees(id) on delete restrict,
 from_vehicle_label text,
 to_vehicle_label text,
 from_status text,
 to_status text,
 from_condition text,
 to_condition text,
 notes text,
 actor_user_id uuid references public.users(id) on delete set null,
 created_at timestamptz not null default now()
);
create index if not exists dbs_control_tool_asset_movements_scope_idx
 on public.dbs_control_tool_asset_movements(scope_key,tool_asset_id,created_at desc);

alter table public.dbs_control_tool_assets enable row level security;
alter table public.dbs_control_tool_asset_movements enable row level security;
revoke all on public.dbs_control_tool_assets,public.dbs_control_tool_asset_movements from public,anon,authenticated;
grant select,insert,update on public.dbs_control_tool_assets to service_role;
grant select,insert on public.dbs_control_tool_asset_movements to service_role;

create or replace function public.dbs_control_capture_tool_asset_movement()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $function$
declare v_type text; v_actor uuid;
begin
 if tg_op='INSERT' then
  insert into public.dbs_control_tool_asset_movements(company_id,scope_key,tool_asset_id,movement_type,to_employee_id,to_vehicle_label,to_status,to_condition,notes,actor_user_id,created_at)
  values(new.company_id,new.scope_key,new.id,case when new.employee_id is null then 'registered' else 'assigned' end,new.employee_id,new.vehicle_label,new.status,new.condition_label,new.notes,coalesce(new.created_by,new.updated_by),new.created_at);
  return new;
 end if;
 if old.employee_id is distinct from new.employee_id then
  if old.employee_id is null and new.employee_id is not null then v_type:='assigned';
  elsif new.employee_id is null and new.status='available' then v_type:='returned';
  elsif new.employee_id is null then v_type:='status_changed';
  else v_type:='transferred'; end if;
 elsif old.vehicle_label is distinct from new.vehicle_label then v_type:='vehicle_changed';
 elsif old.status is distinct from new.status then v_type:='status_changed';
 elsif old.condition_label is distinct from new.condition_label then v_type:='condition_changed';
 else return new;
 end if;
 insert into public.dbs_control_tool_asset_movements(company_id,scope_key,tool_asset_id,movement_type,from_employee_id,to_employee_id,from_vehicle_label,to_vehicle_label,from_status,to_status,from_condition,to_condition,notes,actor_user_id)
 values(new.company_id,new.scope_key,new.id,v_type,old.employee_id,new.employee_id,old.vehicle_label,new.vehicle_label,old.status,new.status,old.condition_label,new.condition_label,new.notes,coalesce(new.updated_by,new.created_by));
 return new;
end;
$function$;

create or replace function public.dbs_control_reject_tool_asset_movement_mutation()
returns trigger language plpgsql set search_path=public,pg_temp as $function$
begin raise exception 'DBS_TOOL_ASSET_MOVEMENT_IMMUTABLE' using errcode='55000'; end;
$function$;

drop trigger if exists dbs_control_tool_asset_movement_capture on public.dbs_control_tool_assets;
create trigger dbs_control_tool_asset_movement_capture after insert or update on public.dbs_control_tool_assets
for each row execute function public.dbs_control_capture_tool_asset_movement();
drop trigger if exists dbs_control_tool_asset_movements_immutable on public.dbs_control_tool_asset_movements;
create trigger dbs_control_tool_asset_movements_immutable before update or delete on public.dbs_control_tool_asset_movements
for each row execute function public.dbs_control_reject_tool_asset_movement_mutation();

revoke all on function public.dbs_control_capture_tool_asset_movement() from public,anon,authenticated;
revoke all on function public.dbs_control_reject_tool_asset_movement_mutation() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
