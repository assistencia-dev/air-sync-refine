-- DBS CONTROL: políticas complementares do modo colaborador.
-- Somente complementa a migração do núcleo; não altera nem apaga dados.

CREATE POLICY dbs_client_employee_select ON public.dbs_control_clients FOR SELECT TO authenticated
  USING (
    id IN (
      SELECT client_id FROM public.dbs_control_work_orders
      WHERE assigned_employee_id IN (
        SELECT id FROM public.rh_employees
        WHERE ponto_portal_user_id = public.current_app_user_id()
          AND ponto_access_enabled = true
          AND dbs_control_access_enabled = true
          AND is_active = true
      )
    )
  );

CREATE POLICY dbs_site_employee_select ON public.dbs_control_sites FOR SELECT TO authenticated
  USING (
    id IN (
      SELECT site_id FROM public.dbs_control_work_orders
      WHERE assigned_employee_id IN (
        SELECT id FROM public.rh_employees
        WHERE ponto_portal_user_id = public.current_app_user_id()
          AND ponto_access_enabled = true
          AND dbs_control_access_enabled = true
          AND is_active = true
      )
    )
  );

CREATE POLICY dbs_equipment_employee_select ON public.dbs_control_equipment FOR SELECT TO authenticated
  USING (
    id IN (
      SELECT link.equipment_id
      FROM public.dbs_control_work_order_equipment link
      JOIN public.dbs_control_work_orders wo ON wo.id = link.work_order_id
      WHERE wo.assigned_employee_id IN (
        SELECT id FROM public.rh_employees
        WHERE ponto_portal_user_id = public.current_app_user_id()
          AND ponto_access_enabled = true
          AND dbs_control_access_enabled = true
          AND is_active = true
      )
    )
  );

CREATE POLICY dbs_service_employee_select ON public.dbs_control_service_catalog FOR SELECT TO authenticated
  USING (
    id IN (
      SELECT service_id FROM public.dbs_control_work_order_services
      WHERE work_order_id IN (
        SELECT id FROM public.dbs_control_work_orders
        WHERE assigned_employee_id IN (
          SELECT id FROM public.rh_employees
          WHERE ponto_portal_user_id = public.current_app_user_id()
            AND ponto_access_enabled = true
            AND dbs_control_access_enabled = true
            AND is_active = true
        )
      )
    )
  );

CREATE POLICY dbs_parts_employee_select ON public.dbs_control_parts FOR SELECT TO authenticated
  USING (
    id IN (
      SELECT part_id FROM public.dbs_control_work_order_parts
      WHERE work_order_id IN (
        SELECT id FROM public.dbs_control_work_orders
        WHERE assigned_employee_id IN (
          SELECT id FROM public.rh_employees
          WHERE ponto_portal_user_id = public.current_app_user_id()
            AND ponto_access_enabled = true
            AND dbs_control_access_enabled = true
            AND is_active = true
        )
      )
    )
  );

CREATE POLICY dbs_os_parts_employee_select ON public.dbs_control_work_order_parts FOR SELECT TO authenticated
  USING (
    work_order_id IN (
      SELECT id FROM public.dbs_control_work_orders
      WHERE assigned_employee_id IN (
        SELECT id FROM public.rh_employees
        WHERE ponto_portal_user_id = public.current_app_user_id()
          AND ponto_access_enabled = true
          AND dbs_control_access_enabled = true
          AND is_active = true
      )
    )
  );

CREATE POLICY dbs_os_parts_employee_insert ON public.dbs_control_work_order_parts FOR INSERT TO authenticated
  WITH CHECK (
    work_order_id IN (
      SELECT id FROM public.dbs_control_work_orders
      WHERE assigned_employee_id IN (
        SELECT id FROM public.rh_employees
        WHERE ponto_portal_user_id = public.current_app_user_id()
          AND ponto_access_enabled = true
          AND dbs_control_access_enabled = true
          AND is_active = true
      )
    )
  );

CREATE POLICY dbs_os_services_employee_select ON public.dbs_control_work_order_services FOR SELECT TO authenticated
  USING (
    work_order_id IN (
      SELECT id FROM public.dbs_control_work_orders
      WHERE assigned_employee_id IN (
        SELECT id FROM public.rh_employees
        WHERE ponto_portal_user_id = public.current_app_user_id()
          AND ponto_access_enabled = true
          AND dbs_control_access_enabled = true
          AND is_active = true
      )
    )
  );

CREATE POLICY dbs_os_services_employee_insert ON public.dbs_control_work_order_services FOR INSERT TO authenticated
  WITH CHECK (
    work_order_id IN (
      SELECT id FROM public.dbs_control_work_orders
      WHERE assigned_employee_id IN (
        SELECT id FROM public.rh_employees
        WHERE ponto_portal_user_id = public.current_app_user_id()
          AND ponto_access_enabled = true
          AND dbs_control_access_enabled = true
          AND is_active = true
      )
    )
  );

CREATE POLICY dbs_os_events_employee_insert ON public.dbs_control_work_order_events FOR INSERT TO authenticated
  WITH CHECK (
    work_order_id IN (
      SELECT id FROM public.dbs_control_work_orders
      WHERE assigned_employee_id IN (
        SELECT id FROM public.rh_employees
        WHERE ponto_portal_user_id = public.current_app_user_id()
          AND ponto_access_enabled = true
          AND dbs_control_access_enabled = true
          AND is_active = true
      )
    )
    AND actor_user_id = public.current_app_user_id()
  );

CREATE POLICY dbs_os_attachments_employee_insert ON public.dbs_control_work_order_attachments FOR INSERT TO authenticated
  WITH CHECK (
    work_order_id IN (
      SELECT id FROM public.dbs_control_work_orders
      WHERE assigned_employee_id IN (
        SELECT id FROM public.rh_employees
        WHERE ponto_portal_user_id = public.current_app_user_id()
          AND ponto_access_enabled = true
          AND dbs_control_access_enabled = true
          AND is_active = true
      )
    )
    AND uploaded_by_user_id = public.current_app_user_id()
  );
