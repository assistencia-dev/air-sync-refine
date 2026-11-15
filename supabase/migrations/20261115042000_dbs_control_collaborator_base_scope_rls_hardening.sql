-- Additive RLS hardening: enforce the RH collaborator's active base/company scope
-- on direct PostgREST reads and writes tied to work orders. Existing data is untouched.

create or replace function private.dbs_my_can_access_client(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select exists (
    select 1
    from public.rh_employees e
    join public.dbs_control_bases b on b.id = e.dbs_control_base_id
    join public.dbs_control_base_clients bc
      on bc.base_id = b.id
     and bc.client_id = p_client_id
    join public.users u on u.id = public.current_app_user_id()
    where e.id in (select private.dbs_my_employee_ids())
      and e.dbs_control_can_issue_work_orders = true
      and lower(coalesce(b.status, '')) = 'ativo'
      and b.company_id = u.company_id
  );
$function$;

create or replace function private.dbs_my_can_access_work_order(
  p_assigned_employee_id uuid,
  p_client_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select exists (
    select 1
    from public.rh_employees e
    where e.id = p_assigned_employee_id
      and e.id in (select private.dbs_my_employee_ids())
      and (
        e.dbs_control_base_id is null
        or exists (
          select 1
          from public.dbs_control_bases b
          join public.users u on u.id = public.current_app_user_id()
          join public.dbs_control_base_clients bc
            on bc.base_id = b.id
           and bc.client_id = p_client_id
          where b.id = e.dbs_control_base_id
            and lower(coalesce(b.status, '')) = 'ativo'
            and b.company_id = u.company_id
        )
      )
  );
$function$;

revoke all on function private.dbs_my_can_access_client(uuid) from public, anon;
revoke all on function private.dbs_my_can_access_work_order(uuid, uuid) from public, anon;
grant execute on function private.dbs_my_can_access_client(uuid) to authenticated;
grant execute on function private.dbs_my_can_access_work_order(uuid, uuid) to authenticated;

drop policy if exists dbs_os_select on public.dbs_control_work_orders;
create policy dbs_os_select on public.dbs_control_work_orders
for select to authenticated
using (
  (select public.is_admin())
  or (
    deleted_at is null
    and lower(coalesce(status, '')) not in ('cancelada', 'cancelado')
    and private.dbs_my_can_access_work_order(assigned_employee_id, client_id)
  )
);

drop policy if exists dbs_os_update on public.dbs_control_work_orders;
create policy dbs_os_update on public.dbs_control_work_orders
for update to authenticated
using (
  (select public.is_admin())
  or (
    deleted_at is null
    and lower(coalesce(status, '')) not in ('cancelada', 'cancelado')
    and private.dbs_my_can_access_work_order(assigned_employee_id, client_id)
  )
)
with check (
  (select public.is_admin())
  or (
    deleted_at is null
    and lower(coalesce(status, '')) not in ('cancelada', 'cancelado')
    and private.dbs_my_can_access_work_order(assigned_employee_id, client_id)
  )
);

drop policy if exists hardening_dbs_clients_select on public.dbs_control_clients;
create policy hardening_dbs_clients_select on public.dbs_control_clients
for select to authenticated
using (
  (select public.is_admin())
  or private.dbs_my_can_access_client(id)
  or exists (
    select 1
    from public.dbs_control_work_orders wo
    where wo.client_id = id
      and private.dbs_my_can_access_work_order(wo.assigned_employee_id, wo.client_id)
  )
);

drop policy if exists hardening_dbs_sites_select on public.dbs_control_sites;
create policy hardening_dbs_sites_select on public.dbs_control_sites
for select to authenticated
using (
  (select public.is_admin())
  or private.dbs_my_can_access_client(client_id)
  or exists (
    select 1
    from public.dbs_control_work_orders wo
    where wo.site_id = id
      and private.dbs_my_can_access_work_order(wo.assigned_employee_id, wo.client_id)
  )
);

drop policy if exists hardening_dbs_equipment_select on public.dbs_control_equipment;
create policy hardening_dbs_equipment_select on public.dbs_control_equipment
for select to authenticated
using (
  (select public.is_admin())
  or private.dbs_my_can_access_client(client_id)
  or exists (
    select 1
    from public.dbs_control_work_order_equipment link
    join public.dbs_control_work_orders wo on wo.id = link.work_order_id
    where link.equipment_id = id
      and private.dbs_my_can_access_work_order(wo.assigned_employee_id, wo.client_id)
  )
);

drop policy if exists hardening_dbs_services_select on public.dbs_control_service_catalog;
create policy hardening_dbs_services_select on public.dbs_control_service_catalog
for select to authenticated
using (
  (select public.is_admin())
  or (
    status = 'ativo'
    and exists (
      select 1
      from public.rh_employees e
      where e.id in (select private.dbs_my_employee_ids())
        and e.dbs_control_can_issue_work_orders = true
    )
  )
  or exists (
    select 1
    from public.dbs_control_work_order_services link
    join public.dbs_control_work_orders wo on wo.id = link.work_order_id
    where link.service_id = id
      and private.dbs_my_can_access_work_order(wo.assigned_employee_id, wo.client_id)
  )
);

drop policy if exists hardening_dbs_os_attachments_select on public.dbs_control_work_order_attachments;
create policy hardening_dbs_os_attachments_select on public.dbs_control_work_order_attachments
for select to authenticated
using (
  (select public.is_admin())
  or exists (
    select 1
    from public.dbs_control_work_orders wo
    where wo.id = work_order_id
      and private.dbs_my_can_access_work_order(wo.assigned_employee_id, wo.client_id)
  )
);

drop policy if exists hardening_dbs_os_attachments_insert on public.dbs_control_work_order_attachments;
create policy hardening_dbs_os_attachments_insert on public.dbs_control_work_order_attachments
for insert to authenticated
with check (
  (select public.is_admin())
  or (
    uploaded_by_user_id = public.current_app_user_id()
    and exists (
      select 1
      from public.dbs_control_work_orders wo
      join public.rh_employees e on e.id = wo.assigned_employee_id
      where wo.id = work_order_id
        and private.dbs_my_can_access_work_order(wo.assigned_employee_id, wo.client_id)
        and e.ponto_portal_user_id = public.current_app_user_id()
        and e.ponto_access_enabled = true
        and e.dbs_control_access_enabled = true
        and e.is_active = true
    )
  )
);

drop policy if exists hardening_dbs_os_equipment_select on public.dbs_control_work_order_equipment;
create policy hardening_dbs_os_equipment_select on public.dbs_control_work_order_equipment
for select to authenticated
using (
  (select public.is_admin())
  or exists (
    select 1
    from public.dbs_control_work_orders wo
    where wo.id = work_order_id
      and private.dbs_my_can_access_work_order(wo.assigned_employee_id, wo.client_id)
  )
);

drop policy if exists hardening_dbs_os_events_select on public.dbs_control_work_order_events;
create policy hardening_dbs_os_events_select on public.dbs_control_work_order_events
for select to authenticated
using (
  (select public.is_admin())
  or exists (
    select 1
    from public.dbs_control_work_orders wo
    where wo.id = work_order_id
      and private.dbs_my_can_access_work_order(wo.assigned_employee_id, wo.client_id)
  )
);

drop policy if exists hardening_dbs_os_events_insert on public.dbs_control_work_order_events;
create policy hardening_dbs_os_events_insert on public.dbs_control_work_order_events
for insert to authenticated
with check (
  (select public.is_admin())
  or (
    actor_user_id = public.current_app_user_id()
    and exists (
      select 1
      from public.dbs_control_work_orders wo
      join public.rh_employees e on e.id = wo.assigned_employee_id
      where wo.id = work_order_id
        and private.dbs_my_can_access_work_order(wo.assigned_employee_id, wo.client_id)
        and e.ponto_portal_user_id = public.current_app_user_id()
        and e.ponto_access_enabled = true
        and e.dbs_control_access_enabled = true
        and e.is_active = true
    )
  )
);

drop policy if exists hardening_dbs_parts_select on public.dbs_control_parts;
create policy hardening_dbs_parts_select on public.dbs_control_parts
for select to authenticated
using (
  (select public.is_admin())
  or exists (
    select 1
    from public.dbs_control_work_order_parts link
    join public.dbs_control_work_orders wo on wo.id = link.work_order_id
    join public.rh_employees e on e.id = wo.assigned_employee_id
    where link.part_id = id
      and private.dbs_my_can_access_work_order(wo.assigned_employee_id, wo.client_id)
      and e.ponto_portal_user_id = public.current_app_user_id()
      and e.ponto_access_enabled = true
      and e.dbs_control_access_enabled = true
      and e.is_active = true
  )
);

drop policy if exists hardening_dbs_os_parts_select on public.dbs_control_work_order_parts;
create policy hardening_dbs_os_parts_select on public.dbs_control_work_order_parts
for select to authenticated
using (
  (select public.is_admin())
  or exists (
    select 1
    from public.dbs_control_work_orders wo
    join public.rh_employees e on e.id = wo.assigned_employee_id
    where wo.id = work_order_id
      and private.dbs_my_can_access_work_order(wo.assigned_employee_id, wo.client_id)
      and e.ponto_portal_user_id = public.current_app_user_id()
      and e.ponto_access_enabled = true
      and e.dbs_control_access_enabled = true
      and e.is_active = true
  )
);

drop policy if exists hardening_dbs_os_parts_insert on public.dbs_control_work_order_parts;
create policy hardening_dbs_os_parts_insert on public.dbs_control_work_order_parts
for insert to authenticated
with check (
  (select public.is_admin())
  or exists (
    select 1
    from public.dbs_control_work_orders wo
    join public.rh_employees e on e.id = wo.assigned_employee_id
    where wo.id = work_order_id
      and private.dbs_my_can_access_work_order(wo.assigned_employee_id, wo.client_id)
      and e.ponto_portal_user_id = public.current_app_user_id()
      and e.ponto_access_enabled = true
      and e.dbs_control_access_enabled = true
      and e.is_active = true
  )
);

drop policy if exists hardening_dbs_os_services_select on public.dbs_control_work_order_services;
create policy hardening_dbs_os_services_select on public.dbs_control_work_order_services
for select to authenticated
using (
  (select public.is_admin())
  or exists (
    select 1
    from public.dbs_control_work_orders wo
    join public.rh_employees e on e.id = wo.assigned_employee_id
    where wo.id = work_order_id
      and private.dbs_my_can_access_work_order(wo.assigned_employee_id, wo.client_id)
      and e.ponto_portal_user_id = public.current_app_user_id()
      and e.ponto_access_enabled = true
      and e.dbs_control_access_enabled = true
      and e.is_active = true
  )
);

drop policy if exists hardening_dbs_os_services_insert on public.dbs_control_work_order_services;
create policy hardening_dbs_os_services_insert on public.dbs_control_work_order_services
for insert to authenticated
with check (
  (select public.is_admin())
  or exists (
    select 1
    from public.dbs_control_work_orders wo
    join public.rh_employees e on e.id = wo.assigned_employee_id
    where wo.id = work_order_id
      and private.dbs_my_can_access_work_order(wo.assigned_employee_id, wo.client_id)
      and e.ponto_portal_user_id = public.current_app_user_id()
      and e.ponto_access_enabled = true
      and e.dbs_control_access_enabled = true
      and e.is_active = true
  )
);
