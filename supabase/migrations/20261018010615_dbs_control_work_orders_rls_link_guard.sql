-- Consolida as políticas existentes de OS sem criar permissões permissivas duplicadas.
-- Admins mantêm acesso pela política dbs_os_admin_all; técnicos dependem de vínculo ativo.
begin;

drop policy if exists "dbs_control_work_orders_read_admin_or_assigned" on public.dbs_control_work_orders;
drop policy if exists "dbs_control_work_orders_insert_admin" on public.dbs_control_work_orders;
drop policy if exists "dbs_control_work_orders_update_admin_or_assigned" on public.dbs_control_work_orders;

drop policy if exists "dbs_os_employee_select" on public.dbs_control_work_orders;
create policy "dbs_os_employee_select" on public.dbs_control_work_orders
for select to authenticated using (
  assigned_employee_id in (
    select e.id from public.rh_employees e
    where e.ponto_portal_user_id = public.current_app_user_id()
      and e.ponto_access_enabled = true
      and e.dbs_control_access_enabled = true
      and e.is_active = true
  )
  or assigned_employee_id in (
    select ea.employee_id
    from public.rh_employee_access ea
    join public.rh_employees e on e.id = ea.employee_id
    where ea.user_id = public.current_app_user_id()
      and ea.access_enabled = true
      and e.ponto_access_enabled = true
      and e.dbs_control_access_enabled = true
      and e.is_active = true
  )
);

drop policy if exists "dbs_os_employee_update" on public.dbs_control_work_orders;
create policy "dbs_os_employee_update" on public.dbs_control_work_orders
for update to authenticated using (
  assigned_employee_id in (
    select e.id from public.rh_employees e
    where e.ponto_portal_user_id = public.current_app_user_id()
      and e.ponto_access_enabled = true
      and e.dbs_control_access_enabled = true
      and e.is_active = true
  )
  or assigned_employee_id in (
    select ea.employee_id
    from public.rh_employee_access ea
    join public.rh_employees e on e.id = ea.employee_id
    where ea.user_id = public.current_app_user_id()
      and ea.access_enabled = true
      and e.ponto_access_enabled = true
      and e.dbs_control_access_enabled = true
      and e.is_active = true
  )
)
with check (
  assigned_employee_id in (
    select e.id from public.rh_employees e
    where e.ponto_portal_user_id = public.current_app_user_id()
      and e.ponto_access_enabled = true
      and e.dbs_control_access_enabled = true
      and e.is_active = true
  )
  or assigned_employee_id in (
    select ea.employee_id
    from public.rh_employee_access ea
    join public.rh_employees e on e.id = ea.employee_id
    where ea.user_id = public.current_app_user_id()
      and ea.access_enabled = true
      and e.ponto_access_enabled = true
      and e.dbs_control_access_enabled = true
      and e.is_active = true
  )
);

commit;
