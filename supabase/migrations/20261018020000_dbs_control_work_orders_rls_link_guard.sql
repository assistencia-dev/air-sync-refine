-- Mantém as políticas canônicas existentes e inclui o vínculo RH alternativo com flags ativas.
-- Evita políticas permissivas duplicadas e não abre acesso a colaborador desabilitado.
begin;

drop policy if exists "dbs_control_work_orders_read_admin_or_assigned" on public.dbs_control_work_orders;
drop policy if exists "dbs_control_work_orders_insert_admin" on public.dbs_control_work_orders;
drop policy if exists "dbs_control_work_orders_update_admin_or_assigned" on public.dbs_control_work_orders;

create or replace function public.dbs_my_employee_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select e.id
  from public.rh_employees e
  where e.ponto_portal_user_id = public.current_app_user_id()
    and e.ponto_access_enabled = true
    and e.dbs_control_access_enabled = true
    and e.is_active = true
  union
  select e.id
  from public.rh_employee_access ea
  join public.rh_employees e on e.id = ea.employee_id
  where ea.user_id = public.current_app_user_id()
    and ea.access_enabled = true
    and e.ponto_access_enabled = true
    and e.dbs_control_access_enabled = true
    and e.is_active = true;
$$;

revoke all on function public.dbs_my_employee_ids() from public;
grant execute on function public.dbs_my_employee_ids() to authenticated;

commit;
