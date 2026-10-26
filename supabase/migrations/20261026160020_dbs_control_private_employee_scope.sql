-- Mantém o helper de escopo do colaborador fora do schema exposto pela API.
-- A autorização continua a mesma; apenas o caminho de leitura RLS deixa de
-- publicar uma função SECURITY DEFINER no endpoint /rpc.
begin;

create schema if not exists private;

create or replace function private.dbs_my_employee_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select e.id
  from public.rh_employees e
  where e.ponto_portal_user_id = public.current_app_user_id()
    and e.dbs_control_access_enabled = true
    and e.is_active = true
  union
  select e.id
  from public.rh_employee_access ea
  join public.rh_employees e on e.id = ea.employee_id
  where ea.user_id = public.current_app_user_id()
    and ea.access_enabled = true
    and e.dbs_control_access_enabled = true
    and e.is_active = true;
$$;

revoke all on function private.dbs_my_employee_ids() from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.dbs_my_employee_ids() to authenticated;
revoke all on function public.dbs_my_employee_ids() from public, anon, authenticated;

drop policy if exists dbs_os_employee_select on public.dbs_control_work_orders;
create policy dbs_os_employee_select on public.dbs_control_work_orders
  for select to authenticated
  using (assigned_employee_id in (select private.dbs_my_employee_ids()));

drop policy if exists dbs_os_employee_update on public.dbs_control_work_orders;
create policy dbs_os_employee_update on public.dbs_control_work_orders
  for update to authenticated
  using (assigned_employee_id in (select private.dbs_my_employee_ids()))
  with check (assigned_employee_id in (select private.dbs_my_employee_ids()));

drop policy if exists dbs_os_employee_equipment_select on public.dbs_control_work_order_equipment;
create policy dbs_os_employee_equipment_select on public.dbs_control_work_order_equipment
  for select to authenticated
  using (work_order_id in (select id from public.dbs_control_work_orders where assigned_employee_id in (select private.dbs_my_employee_ids())));

drop policy if exists dbs_os_employee_attachments_select on public.dbs_control_work_order_attachments;
create policy dbs_os_employee_attachments_select on public.dbs_control_work_order_attachments
  for select to authenticated
  using (work_order_id in (select id from public.dbs_control_work_orders where assigned_employee_id in (select private.dbs_my_employee_ids())));

drop policy if exists dbs_os_employee_events_select on public.dbs_control_work_order_events;
create policy dbs_os_employee_events_select on public.dbs_control_work_order_events
  for select to authenticated
  using (work_order_id in (select id from public.dbs_control_work_orders where assigned_employee_id in (select private.dbs_my_employee_ids())));

drop policy if exists dbs_client_employee_select on public.dbs_control_clients;
create policy dbs_client_employee_select on public.dbs_control_clients
  for select to authenticated
  using (
    id in (
      select bc.client_id
      from public.dbs_control_base_clients bc
      join public.rh_employees e on e.dbs_control_base_id = bc.base_id
      where e.id in (select private.dbs_my_employee_ids())
        and e.dbs_control_can_issue_work_orders = true
    )
    or id in (select client_id from public.dbs_control_work_orders where assigned_employee_id in (select private.dbs_my_employee_ids()))
  );

drop policy if exists dbs_site_employee_select on public.dbs_control_sites;
create policy dbs_site_employee_select on public.dbs_control_sites
  for select to authenticated
  using (
    client_id in (select client_id from public.dbs_control_base_clients bc join public.rh_employees e on e.dbs_control_base_id = bc.base_id where e.id in (select private.dbs_my_employee_ids()) and e.dbs_control_can_issue_work_orders = true)
    or id in (select site_id from public.dbs_control_work_orders where assigned_employee_id in (select private.dbs_my_employee_ids()))
  );

drop policy if exists dbs_equipment_employee_select on public.dbs_control_equipment;
create policy dbs_equipment_employee_select on public.dbs_control_equipment
  for select to authenticated
  using (
    client_id in (select client_id from public.dbs_control_base_clients bc join public.rh_employees e on e.dbs_control_base_id = bc.base_id where e.id in (select private.dbs_my_employee_ids()) and e.dbs_control_can_issue_work_orders = true)
    or id in (
      select link.equipment_id
      from public.dbs_control_work_order_equipment link
      join public.dbs_control_work_orders wo on wo.id = link.work_order_id
      where wo.assigned_employee_id in (select private.dbs_my_employee_ids())
    )
  );

drop policy if exists dbs_service_employee_select on public.dbs_control_service_catalog;
create policy dbs_service_employee_select on public.dbs_control_service_catalog
  for select to authenticated
  using (
    (status = 'ativo' and exists (select 1 from public.rh_employees e where e.id in (select private.dbs_my_employee_ids()) and e.dbs_control_can_issue_work_orders = true))
    or id in (
      select service_id from public.dbs_control_work_order_services
      where work_order_id in (select id from public.dbs_control_work_orders where assigned_employee_id in (select private.dbs_my_employee_ids()))
    )
  );

commit;
