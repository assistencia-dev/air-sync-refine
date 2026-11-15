-- Additive RLS consolidation.
-- Existing data, tables and access intent are preserved; only overlapping
-- permissive policies are replaced by one explicit policy per action.

-- Re-runnable policy replacement guard. This only removes policies created by this
-- migration; it never removes tables or rows and keeps the migration additive.
DO $
DECLARE p record;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname LIKE 'hardening\\_%' ESCAPE '\\'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
  END LOOP;
END
$;

-- Auth/RLS init-plan stabilization for the policies that directly call auth.uid().
DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
        qual ILIKE '%auth.uid()%' OR with_check ILIKE '%auth.uid()%'
      )
  LOOP
    IF p.qual IS NOT NULL THEN
      EXECUTE format(
        'ALTER POLICY %I ON %I.%I USING (%s)',
        p.policyname, p.schemaname, p.tablename,
        replace(p.qual, 'auth.uid()', '(select auth.uid())')
      );
    END IF;
    IF p.with_check IS NOT NULL THEN
      EXECUTE format(
        'ALTER POLICY %I ON %I.%I WITH CHECK (%s)',
        p.policyname, p.schemaname, p.tablename,
        replace(p.with_check, 'auth.uid()', '(select auth.uid())')
      );
    END IF;
  END LOOP;
END
$$;

-- assets
DROP POLICY IF EXISTS assets_admin_all ON public.assets;
DROP POLICY IF EXISTS assets_member_read ON public.assets;
CREATE POLICY hardening_assets_select ON public.assets
  FOR SELECT TO authenticated
  USING ((select is_admin()) OR unit_id = (select current_unit_id()));
CREATE POLICY hardening_assets_insert ON public.assets
  FOR INSERT TO authenticated
  WITH CHECK ((select is_admin()));
CREATE POLICY hardening_assets_update ON public.assets
  FOR UPDATE TO authenticated
  USING ((select is_admin())) WITH CHECK ((select is_admin()));
CREATE POLICY hardening_assets_delete ON public.assets
  FOR DELETE TO authenticated
  USING ((select is_admin()));

-- companies
DROP POLICY IF EXISTS companies_admin_all ON public.companies;
DROP POLICY IF EXISTS companies_member_read ON public.companies;
CREATE POLICY hardening_companies_select ON public.companies
  FOR SELECT TO authenticated
  USING ((select is_admin()) OR (
    (select usuario_esta_ativo())
    AND id = (select u.company_id from public.users u where u.auth_id = (select auth.uid()) and u.status = 'ativo' limit 1)
  ));
CREATE POLICY hardening_companies_insert ON public.companies
  FOR INSERT TO authenticated
  WITH CHECK ((select is_admin()));
CREATE POLICY hardening_companies_update ON public.companies
  FOR UPDATE TO authenticated
  USING ((select is_admin())) WITH CHECK ((select is_admin()));
CREATE POLICY hardening_companies_delete ON public.companies
  FOR DELETE TO authenticated
  USING ((select is_admin()));

-- DBS Control master catalogs: administrator OR employee-scoped read.
DROP POLICY IF EXISTS dbs_clients_admin_all ON public.dbs_control_clients;
DROP POLICY IF EXISTS dbs_client_employee_select ON public.dbs_control_clients;
CREATE POLICY hardening_dbs_clients_select ON public.dbs_control_clients
  FOR SELECT TO authenticated
  USING (
    (select is_admin()) OR
    id IN (
      SELECT bc.client_id
      FROM public.dbs_control_base_clients bc
      JOIN public.rh_employees e ON e.dbs_control_base_id = bc.base_id
      WHERE e.id IN (SELECT private.dbs_my_employee_ids())
        AND e.dbs_control_can_issue_work_orders = true
    ) OR
    id IN (
      SELECT wo.client_id
      FROM public.dbs_control_work_orders wo
      WHERE wo.assigned_employee_id IN (SELECT private.dbs_my_employee_ids())
    )
  );
CREATE POLICY hardening_dbs_clients_insert ON public.dbs_control_clients
  FOR INSERT TO authenticated WITH CHECK ((select is_admin()));
CREATE POLICY hardening_dbs_clients_update ON public.dbs_control_clients
  FOR UPDATE TO authenticated USING ((select is_admin())) WITH CHECK ((select is_admin()));
CREATE POLICY hardening_dbs_clients_delete ON public.dbs_control_clients
  FOR DELETE TO authenticated USING ((select is_admin()));

DROP POLICY IF EXISTS dbs_equipment_admin_all ON public.dbs_control_equipment;
DROP POLICY IF EXISTS dbs_equipment_employee_select ON public.dbs_control_equipment;
CREATE POLICY hardening_dbs_equipment_select ON public.dbs_control_equipment
  FOR SELECT TO authenticated
  USING (
    (select is_admin()) OR
    client_id IN (
      SELECT bc.client_id
      FROM public.dbs_control_base_clients bc
      JOIN public.rh_employees e ON e.dbs_control_base_id = bc.base_id
      WHERE e.id IN (SELECT private.dbs_my_employee_ids())
        AND e.dbs_control_can_issue_work_orders = true
    ) OR
    id IN (
      SELECT link.equipment_id
      FROM public.dbs_control_work_order_equipment link
      JOIN public.dbs_control_work_orders wo ON wo.id = link.work_order_id
      WHERE wo.assigned_employee_id IN (SELECT private.dbs_my_employee_ids())
    )
  );
CREATE POLICY hardening_dbs_equipment_insert ON public.dbs_control_equipment
  FOR INSERT TO authenticated WITH CHECK ((select is_admin()));
CREATE POLICY hardening_dbs_equipment_update ON public.dbs_control_equipment
  FOR UPDATE TO authenticated USING ((select is_admin())) WITH CHECK ((select is_admin()));
CREATE POLICY hardening_dbs_equipment_delete ON public.dbs_control_equipment
  FOR DELETE TO authenticated USING ((select is_admin()));

DROP POLICY IF EXISTS dbs_parts_admin_all ON public.dbs_control_parts;
DROP POLICY IF EXISTS dbs_parts_employee_select ON public.dbs_control_parts;
CREATE POLICY hardening_dbs_parts_select ON public.dbs_control_parts
  FOR SELECT TO authenticated
  USING (
    (select is_admin()) OR id IN (
      SELECT p.part_id
      FROM public.dbs_control_work_order_parts p
      JOIN public.dbs_control_work_orders wo ON wo.id = p.work_order_id
      WHERE wo.assigned_employee_id IN (
        SELECT e.id FROM public.rh_employees e
        WHERE e.ponto_portal_user_id = (select current_app_user_id())
          AND e.ponto_access_enabled = true
          AND e.dbs_control_access_enabled = true
          AND e.is_active = true
      )
    )
  );
CREATE POLICY hardening_dbs_parts_insert ON public.dbs_control_parts
  FOR INSERT TO authenticated WITH CHECK ((select is_admin()));
CREATE POLICY hardening_dbs_parts_update ON public.dbs_control_parts
  FOR UPDATE TO authenticated USING ((select is_admin())) WITH CHECK ((select is_admin()));
CREATE POLICY hardening_dbs_parts_delete ON public.dbs_control_parts
  FOR DELETE TO authenticated USING ((select is_admin()));

DROP POLICY IF EXISTS dbs_services_admin_all ON public.dbs_control_service_catalog;
DROP POLICY IF EXISTS dbs_service_employee_select ON public.dbs_control_service_catalog;
CREATE POLICY hardening_dbs_services_select ON public.dbs_control_service_catalog
  FOR SELECT TO authenticated
  USING (
    (select is_admin()) OR
    (
      status = 'ativo' AND EXISTS (
        SELECT 1 FROM public.rh_employees e
        WHERE e.id IN (SELECT private.dbs_my_employee_ids())
          AND e.dbs_control_can_issue_work_orders = true
      )
    ) OR id IN (
      SELECT s.service_id
      FROM public.dbs_control_work_order_services s
      JOIN public.dbs_control_work_orders wo ON wo.id = s.work_order_id
      WHERE wo.assigned_employee_id IN (SELECT private.dbs_my_employee_ids())
    )
  );
CREATE POLICY hardening_dbs_services_insert ON public.dbs_control_service_catalog
  FOR INSERT TO authenticated WITH CHECK ((select is_admin()));
CREATE POLICY hardening_dbs_services_update ON public.dbs_control_service_catalog
  FOR UPDATE TO authenticated USING ((select is_admin())) WITH CHECK ((select is_admin()));
CREATE POLICY hardening_dbs_services_delete ON public.dbs_control_service_catalog
  FOR DELETE TO authenticated USING ((select is_admin()));

DROP POLICY IF EXISTS dbs_sites_admin_all ON public.dbs_control_sites;
DROP POLICY IF EXISTS dbs_site_employee_select ON public.dbs_control_sites;
CREATE POLICY hardening_dbs_sites_select ON public.dbs_control_sites
  FOR SELECT TO authenticated
  USING (
    (select is_admin()) OR
    client_id IN (
      SELECT bc.client_id
      FROM public.dbs_control_base_clients bc
      JOIN public.rh_employees e ON e.dbs_control_base_id = bc.base_id
      WHERE e.id IN (SELECT private.dbs_my_employee_ids())
        AND e.dbs_control_can_issue_work_orders = true
    ) OR
    id IN (
      SELECT wo.site_id
      FROM public.dbs_control_work_orders wo
      WHERE wo.assigned_employee_id IN (SELECT private.dbs_my_employee_ids())
    )
  );
CREATE POLICY hardening_dbs_sites_insert ON public.dbs_control_sites
  FOR INSERT TO authenticated WITH CHECK ((select is_admin()));
CREATE POLICY hardening_dbs_sites_update ON public.dbs_control_sites
  FOR UPDATE TO authenticated USING ((select is_admin())) WITH CHECK ((select is_admin()));
CREATE POLICY hardening_dbs_sites_delete ON public.dbs_control_sites
  FOR DELETE TO authenticated USING ((select is_admin()));

-- DBS Control work-order related rows.
DROP POLICY IF EXISTS dbs_os_attachments_admin_all ON public.dbs_control_work_order_attachments;
DROP POLICY IF EXISTS dbs_os_attachments_employee_insert ON public.dbs_control_work_order_attachments;
DROP POLICY IF EXISTS dbs_os_employee_attachments_select ON public.dbs_control_work_order_attachments;
CREATE POLICY hardening_dbs_os_attachments_select ON public.dbs_control_work_order_attachments
  FOR SELECT TO authenticated
  USING (
    (select is_admin()) OR work_order_id IN (
      SELECT wo.id FROM public.dbs_control_work_orders wo
      WHERE wo.assigned_employee_id IN (SELECT private.dbs_my_employee_ids())
    )
  );
CREATE POLICY hardening_dbs_os_attachments_insert ON public.dbs_control_work_order_attachments
  FOR INSERT TO authenticated
  WITH CHECK (
    (select is_admin()) OR (
      work_order_id IN (
        SELECT wo.id FROM public.dbs_control_work_orders wo
        WHERE wo.assigned_employee_id IN (
          SELECT e.id FROM public.rh_employees e
          WHERE e.ponto_portal_user_id = (select current_app_user_id())
            AND e.ponto_access_enabled = true
            AND e.dbs_control_access_enabled = true
            AND e.is_active = true
        )
      ) AND uploaded_by_user_id = (select current_app_user_id())
    )
  );
CREATE POLICY hardening_dbs_os_attachments_update ON public.dbs_control_work_order_attachments
  FOR UPDATE TO authenticated USING ((select is_admin())) WITH CHECK ((select is_admin()));
CREATE POLICY hardening_dbs_os_attachments_delete ON public.dbs_control_work_order_attachments
  FOR DELETE TO authenticated USING ((select is_admin()));

DROP POLICY IF EXISTS dbs_os_equipment_admin_all ON public.dbs_control_work_order_equipment;
DROP POLICY IF EXISTS dbs_os_employee_equipment_select ON public.dbs_control_work_order_equipment;
CREATE POLICY hardening_dbs_os_equipment_select ON public.dbs_control_work_order_equipment
  FOR SELECT TO authenticated
  USING (
    (select is_admin()) OR work_order_id IN (
      SELECT wo.id FROM public.dbs_control_work_orders wo
      WHERE wo.assigned_employee_id IN (SELECT private.dbs_my_employee_ids())
    )
  );
CREATE POLICY hardening_dbs_os_equipment_insert ON public.dbs_control_work_order_equipment
  FOR INSERT TO authenticated WITH CHECK ((select is_admin()));
CREATE POLICY hardening_dbs_os_equipment_update ON public.dbs_control_work_order_equipment
  FOR UPDATE TO authenticated USING ((select is_admin())) WITH CHECK ((select is_admin()));
CREATE POLICY hardening_dbs_os_equipment_delete ON public.dbs_control_work_order_equipment
  FOR DELETE TO authenticated USING ((select is_admin()));

DROP POLICY IF EXISTS dbs_os_events_admin_all ON public.dbs_control_work_order_events;
DROP POLICY IF EXISTS dbs_os_employee_events_select ON public.dbs_control_work_order_events;
DROP POLICY IF EXISTS dbs_os_events_employee_insert ON public.dbs_control_work_order_events;
CREATE POLICY hardening_dbs_os_events_select ON public.dbs_control_work_order_events
  FOR SELECT TO authenticated
  USING (
    (select is_admin()) OR work_order_id IN (
      SELECT wo.id FROM public.dbs_control_work_orders wo
      WHERE wo.assigned_employee_id IN (SELECT private.dbs_my_employee_ids())
    )
  );
CREATE POLICY hardening_dbs_os_events_insert ON public.dbs_control_work_order_events
  FOR INSERT TO authenticated
  WITH CHECK (
    (select is_admin()) OR (
      work_order_id IN (
        SELECT wo.id FROM public.dbs_control_work_orders wo
        WHERE wo.assigned_employee_id IN (
          SELECT e.id FROM public.rh_employees e
          WHERE e.ponto_portal_user_id = (select current_app_user_id())
            AND e.ponto_access_enabled = true
            AND e.dbs_control_access_enabled = true
            AND e.is_active = true
        )
      ) AND actor_user_id = (select current_app_user_id())
    )
  );
CREATE POLICY hardening_dbs_os_events_update ON public.dbs_control_work_order_events
  FOR UPDATE TO authenticated USING ((select is_admin())) WITH CHECK ((select is_admin()));
CREATE POLICY hardening_dbs_os_events_delete ON public.dbs_control_work_order_events
  FOR DELETE TO authenticated USING ((select is_admin()));

DROP POLICY IF EXISTS dbs_os_parts_admin_all ON public.dbs_control_work_order_parts;
DROP POLICY IF EXISTS dbs_os_parts_employee_insert ON public.dbs_control_work_order_parts;
DROP POLICY IF EXISTS dbs_os_parts_employee_select ON public.dbs_control_work_order_parts;
CREATE POLICY hardening_dbs_os_parts_select ON public.dbs_control_work_order_parts
  FOR SELECT TO authenticated
  USING (
    (select is_admin()) OR work_order_id IN (
      SELECT wo.id FROM public.dbs_control_work_orders wo
      WHERE wo.assigned_employee_id IN (
        SELECT e.id FROM public.rh_employees e
        WHERE e.ponto_portal_user_id = (select current_app_user_id())
          AND e.ponto_access_enabled = true
          AND e.dbs_control_access_enabled = true
          AND e.is_active = true
      )
    )
  );
CREATE POLICY hardening_dbs_os_parts_insert ON public.dbs_control_work_order_parts
  FOR INSERT TO authenticated
  WITH CHECK (
    (select is_admin()) OR work_order_id IN (
      SELECT wo.id FROM public.dbs_control_work_orders wo
      WHERE wo.assigned_employee_id IN (
        SELECT e.id FROM public.rh_employees e
        WHERE e.ponto_portal_user_id = (select current_app_user_id())
          AND e.ponto_access_enabled = true
          AND e.dbs_control_access_enabled = true
          AND e.is_active = true
      )
    )
  );
CREATE POLICY hardening_dbs_os_parts_update ON public.dbs_control_work_order_parts
  FOR UPDATE TO authenticated USING ((select is_admin())) WITH CHECK ((select is_admin()));
CREATE POLICY hardening_dbs_os_parts_delete ON public.dbs_control_work_order_parts
  FOR DELETE TO authenticated USING ((select is_admin()));

DROP POLICY IF EXISTS dbs_os_services_admin_all ON public.dbs_control_work_order_services;
DROP POLICY IF EXISTS dbs_os_services_employee_insert ON public.dbs_control_work_order_services;
DROP POLICY IF EXISTS dbs_os_services_employee_select ON public.dbs_control_work_order_services;
CREATE POLICY hardening_dbs_os_services_select ON public.dbs_control_work_order_services
  FOR SELECT TO authenticated
  USING (
    (select is_admin()) OR work_order_id IN (
      SELECT wo.id FROM public.dbs_control_work_orders wo
      WHERE wo.assigned_employee_id IN (
        SELECT e.id FROM public.rh_employees e
        WHERE e.ponto_portal_user_id = (select current_app_user_id())
          AND e.ponto_access_enabled = true
          AND e.dbs_control_access_enabled = true
          AND e.is_active = true
      )
    )
  );
CREATE POLICY hardening_dbs_os_services_insert ON public.dbs_control_work_order_services
  FOR INSERT TO authenticated
  WITH CHECK (
    (select is_admin()) OR work_order_id IN (
      SELECT wo.id FROM public.dbs_control_work_orders wo
      WHERE wo.assigned_employee_id IN (
        SELECT e.id FROM public.rh_employees e
        WHERE e.ponto_portal_user_id = (select current_app_user_id())
          AND e.ponto_access_enabled = true
          AND e.dbs_control_access_enabled = true
          AND e.is_active = true
      )
    )
  );
CREATE POLICY hardening_dbs_os_services_update ON public.dbs_control_work_order_services
  FOR UPDATE TO authenticated USING ((select is_admin())) WITH CHECK ((select is_admin()));
CREATE POLICY hardening_dbs_os_services_delete ON public.dbs_control_work_order_services
  FOR DELETE TO authenticated USING ((select is_admin()));

-- RH and helpdesk tables.
DROP POLICY IF EXISTS rh_benefit_requests_admin_access ON public.rh_benefit_requests;
DROP POLICY IF EXISTS rh_benefit_requests_gestor_conta_view ON public.rh_benefit_requests;
DROP POLICY IF EXISTS rh_requests_no_direct_access ON public.rh_benefit_requests;
CREATE POLICY hardening_rh_benefit_requests_select ON public.rh_benefit_requests
  FOR SELECT TO authenticated
  USING (
    (select current_role_key()) = ANY (ARRAY['SUPER_ADMIN'::role_key,'ADMIN_OPERACIONAL'::role_key])
    OR (
      (select current_role_key()) = 'GESTOR_CONTA'::role_key
      AND employee_id IN (
        SELECT e.id FROM public.rh_employees e
        WHERE e.unit IN (
          SELECT u.name FROM public.units u
          WHERE u.company_id = (
            SELECT users.company_id FROM public.users
            WHERE users.auth_id = (select auth.uid())
          )
        )
      )
    )
  );
CREATE POLICY hardening_rh_benefit_requests_insert ON public.rh_benefit_requests
  FOR INSERT TO authenticated
  WITH CHECK ((select current_role_key()) = ANY (ARRAY['SUPER_ADMIN'::role_key,'ADMIN_OPERACIONAL'::role_key]));
CREATE POLICY hardening_rh_benefit_requests_update ON public.rh_benefit_requests
  FOR UPDATE TO authenticated
  USING ((select current_role_key()) = ANY (ARRAY['SUPER_ADMIN'::role_key,'ADMIN_OPERACIONAL'::role_key]))
  WITH CHECK ((select current_role_key()) = ANY (ARRAY['SUPER_ADMIN'::role_key,'ADMIN_OPERACIONAL'::role_key]));
CREATE POLICY hardening_rh_benefit_requests_delete ON public.rh_benefit_requests
  FOR DELETE TO authenticated
  USING ((select current_role_key()) = ANY (ARRAY['SUPER_ADMIN'::role_key,'ADMIN_OPERACIONAL'::role_key]));

DROP POLICY IF EXISTS rh_employees_admin_delete ON public.rh_employees;
DROP POLICY IF EXISTS rh_employees_admin_insert ON public.rh_employees;
DROP POLICY IF EXISTS rh_employees_admin_select ON public.rh_employees;
DROP POLICY IF EXISTS rh_employees_admin_update ON public.rh_employees;
DROP POLICY IF EXISTS rh_employees_gestor_conta_view ON public.rh_employees;
DROP POLICY IF EXISTS rh_employees_gestor_regional_access ON public.rh_employees;
DROP POLICY IF EXISTS rh_employees_no_direct_access ON public.rh_employees;
CREATE POLICY hardening_rh_employees_select ON public.rh_employees
  FOR SELECT TO authenticated
  USING (
    (select current_role_key()) = ANY (ARRAY['SUPER_ADMIN'::role_key,'ADMIN_OPERACIONAL'::role_key])
    OR (
      (select current_role_key()) = 'GESTOR_CONTA'::role_key
      AND unit IN (
        SELECT u.name FROM public.units u
        WHERE u.company_id = (
          SELECT users.company_id FROM public.users
          WHERE users.auth_id = (select auth.uid())
        )
      )
    )
    OR (
      (select current_role_key()) = 'GESTOR_REGIONAL'::role_key
      AND unit = (
        SELECT u.name FROM public.units u
        WHERE u.id = (
          SELECT users.unit_id FROM public.users
          WHERE users.auth_id = (select auth.uid())
        )
      )
    )
  );
CREATE POLICY hardening_rh_employees_insert ON public.rh_employees
  FOR INSERT TO authenticated
  WITH CHECK (
    (select current_role_key()) = ANY (ARRAY['SUPER_ADMIN'::role_key,'ADMIN_OPERACIONAL'::role_key])
    OR (
      (select current_role_key()) = 'GESTOR_REGIONAL'::role_key
      AND unit = (
        SELECT u.name FROM public.units u
        WHERE u.id = (
          SELECT users.unit_id FROM public.users
          WHERE users.auth_id = (select auth.uid())
        )
      )
    )
  );
CREATE POLICY hardening_rh_employees_update ON public.rh_employees
  FOR UPDATE TO authenticated
  USING (
    (select current_role_key()) = ANY (ARRAY['SUPER_ADMIN'::role_key,'ADMIN_OPERACIONAL'::role_key])
    OR (
      (select current_role_key()) = 'GESTOR_REGIONAL'::role_key
      AND unit = (
        SELECT u.name FROM public.units u
        WHERE u.id = (
          SELECT users.unit_id FROM public.users
          WHERE users.auth_id = (select auth.uid())
        )
      )
    )
  )
  WITH CHECK (
    (select current_role_key()) = ANY (ARRAY['SUPER_ADMIN'::role_key,'ADMIN_OPERACIONAL'::role_key])
    OR (
      (select current_role_key()) = 'GESTOR_REGIONAL'::role_key
      AND unit = (
        SELECT u.name FROM public.units u
        WHERE u.id = (
          SELECT users.unit_id FROM public.users
          WHERE users.auth_id = (select auth.uid())
        )
      )
    )
  );
CREATE POLICY hardening_rh_employees_delete ON public.rh_employees
  FOR DELETE TO authenticated
  USING (
    (select current_role_key()) = ANY (ARRAY['SUPER_ADMIN'::role_key,'ADMIN_OPERACIONAL'::role_key])
    OR (
      (select current_role_key()) = 'GESTOR_REGIONAL'::role_key
      AND unit = (
        SELECT u.name FROM public.units u
        WHERE u.id = (
          SELECT users.unit_id FROM public.users
          WHERE users.auth_id = (select auth.uid())
        )
      )
    )
  );

DROP POLICY IF EXISTS rh_request_audit_no_direct_access ON public.rh_request_audit;
DROP POLICY IF EXISTS rh_request_audit_view ON public.rh_request_audit;
CREATE POLICY hardening_rh_request_audit_select ON public.rh_request_audit
  FOR SELECT TO authenticated
  USING ((select current_role_key()) = ANY (ARRAY[
    'SUPER_ADMIN'::role_key,'ADMIN_OPERACIONAL'::role_key,
    'GESTOR_CONTA'::role_key,'GESTOR_REGIONAL'::role_key
  ]));

DROP POLICY IF EXISTS rh_topups_admin_access ON public.rh_topups;
DROP POLICY IF EXISTS rh_topups_no_direct_access ON public.rh_topups;
CREATE POLICY hardening_rh_topups_select ON public.rh_topups
  FOR SELECT TO authenticated
  USING ((select current_role_key()) = ANY (ARRAY['SUPER_ADMIN'::role_key,'ADMIN_OPERACIONAL'::role_key]));
CREATE POLICY hardening_rh_topups_insert ON public.rh_topups
  FOR INSERT TO authenticated
  WITH CHECK ((select current_role_key()) = ANY (ARRAY['SUPER_ADMIN'::role_key,'ADMIN_OPERACIONAL'::role_key]));
CREATE POLICY hardening_rh_topups_update ON public.rh_topups
  FOR UPDATE TO authenticated
  USING ((select current_role_key()) = ANY (ARRAY['SUPER_ADMIN'::role_key,'ADMIN_OPERACIONAL'::role_key]))
  WITH CHECK ((select current_role_key()) = ANY (ARRAY['SUPER_ADMIN'::role_key,'ADMIN_OPERACIONAL'::role_key]));
CREATE POLICY hardening_rh_topups_delete ON public.rh_topups
  FOR DELETE TO authenticated
  USING ((select current_role_key()) = ANY (ARRAY['SUPER_ADMIN'::role_key,'ADMIN_OPERACIONAL'::role_key]));

DROP POLICY IF EXISTS attachments_admin_all ON public.ticket_attachments;
DROP POLICY IF EXISTS attachments_owner_insert ON public.ticket_attachments;
DROP POLICY IF EXISTS attachments_owner_select ON public.ticket_attachments;
CREATE POLICY hardening_ticket_attachments_select ON public.ticket_attachments
  FOR SELECT TO authenticated
  USING (
    (select is_admin()) OR (
      (select usuario_esta_ativo()) AND ticket_id IN (
        SELECT t.id FROM public.tickets t
        WHERE t.created_by_user_id = (select current_app_user_id())
           OR ((select current_is_unit_manager()) AND t.unit_id = (select current_unit_id()))
      )
    )
  );
CREATE POLICY hardening_ticket_attachments_insert ON public.ticket_attachments
  FOR INSERT TO authenticated
  WITH CHECK (
    (select is_admin()) OR (
      (select usuario_esta_ativo()) AND ticket_id IN (
        SELECT t.id FROM public.tickets t
        WHERE t.created_by_user_id = (select current_app_user_id())
      )
    )
  );
CREATE POLICY hardening_ticket_attachments_update ON public.ticket_attachments
  FOR UPDATE TO authenticated USING ((select is_admin())) WITH CHECK ((select is_admin()));
CREATE POLICY hardening_ticket_attachments_delete ON public.ticket_attachments
  FOR DELETE TO authenticated USING ((select is_admin()));

DROP POLICY IF EXISTS tickets_admin_all ON public.tickets;
DROP POLICY IF EXISTS tickets_own_insert ON public.tickets;
DROP POLICY IF EXISTS tickets_own_select ON public.tickets;
CREATE POLICY hardening_tickets_select ON public.tickets
  FOR SELECT TO authenticated
  USING (
    (select is_admin()) OR (
      (select usuario_esta_ativo()) AND (
        created_by_user_id = (select current_app_user_id())
        OR ((select current_is_unit_manager()) AND unit_id = (select current_unit_id()))
      )
    )
  );
CREATE POLICY hardening_tickets_insert ON public.tickets
  FOR INSERT TO authenticated
  WITH CHECK ((select is_admin()) OR (
    (select usuario_esta_ativo()) AND created_by_user_id = (select current_app_user_id())
  ));
CREATE POLICY hardening_tickets_update ON public.tickets
  FOR UPDATE TO authenticated
  USING ((select is_admin())) WITH CHECK ((select is_admin()));
CREATE POLICY hardening_tickets_delete ON public.tickets
  FOR DELETE TO authenticated USING ((select is_admin()));

DROP POLICY IF EXISTS units_admin_all ON public.units;
DROP POLICY IF EXISTS units_member_read ON public.units;
CREATE POLICY hardening_units_select ON public.units
  FOR SELECT TO authenticated
  USING (
    (select is_admin()) OR (
      (select usuario_esta_ativo()) AND (
        id = (select current_unit_id())
        OR company_id = (
          SELECT u.company_id FROM public.users u
          WHERE u.auth_id = (select auth.uid()) AND u.status = 'ativo'
          LIMIT 1
        )
      )
    )
  );
CREATE POLICY hardening_units_insert ON public.units
  FOR INSERT TO authenticated WITH CHECK ((select is_admin()));
CREATE POLICY hardening_units_update ON public.units
  FOR UPDATE TO authenticated USING ((select is_admin())) WITH CHECK ((select is_admin()));
CREATE POLICY hardening_units_delete ON public.units
  FOR DELETE TO authenticated USING ((select is_admin()));

-- Current role/active-user helpers already use transaction-stable subqueries
-- in the rebuilt policies above. No table rows were changed.
