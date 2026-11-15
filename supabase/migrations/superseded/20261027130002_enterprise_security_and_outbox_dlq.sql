-- Additive security/RLS hardening and persistent Outbox dead-letter queue.

CREATE TABLE IF NOT EXISTS public.dbs_control_outbox_dlq (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_id uuid NOT NULL REFERENCES public.dbs_control_outbox(id),
  idempotency_key text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid,
  event_type text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  failed_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dbs_control_outbox_dlq_outbox_unique UNIQUE (outbox_id)
);
ALTER TABLE public.dbs_control_outbox_dlq ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dbs_control_outbox_dlq_service_only ON public.dbs_control_outbox_dlq;
CREATE POLICY dbs_control_outbox_dlq_service_only
  ON public.dbs_control_outbox_dlq FOR ALL TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.dbs_control_outbox_dlq FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.dbs_control_outbox_dlq TO service_role;
CREATE INDEX IF NOT EXISTS idx_dbs_control_outbox_dlq_failed_at
  ON public.dbs_control_outbox_dlq (failed_at DESC);
CREATE INDEX IF NOT EXISTS idx_dbs_control_outbox_dlq_aggregate
  ON public.dbs_control_outbox_dlq (aggregate_type, aggregate_id);

DROP POLICY IF EXISTS dbs_control_integrations_admin_all ON public.dbs_control_integrations;
DROP POLICY IF EXISTS dbs_control_integrations_service_only ON public.dbs_control_integrations;
CREATE POLICY dbs_control_integrations_service_only
  ON public.dbs_control_integrations FOR ALL TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.dbs_control_integrations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dbs_control_integrations TO service_role;

DROP POLICY IF EXISTS dbs_os_admin_all ON public.dbs_control_work_orders;
DROP POLICY IF EXISTS dbs_os_admin_select ON public.dbs_control_work_orders;
DROP POLICY IF EXISTS dbs_os_admin_insert ON public.dbs_control_work_orders;
DROP POLICY IF EXISTS dbs_os_admin_update ON public.dbs_control_work_orders;
DROP POLICY IF EXISTS dbs_os_admin_delete ON public.dbs_control_work_orders;
DROP POLICY IF EXISTS dbs_os_select ON public.dbs_control_work_orders;
DROP POLICY IF EXISTS dbs_os_employee_select ON public.dbs_control_work_orders;
DROP POLICY IF EXISTS dbs_os_employee_update ON public.dbs_control_work_orders;
CREATE POLICY dbs_os_select
  ON public.dbs_control_work_orders FOR SELECT TO authenticated
  USING (
    (SELECT is_admin())
    OR (
      deleted_at IS NULL
      AND lower(coalesce(status, '')) NOT IN ('cancelada', 'cancelado')
      AND assigned_employee_id IN (SELECT private.dbs_my_employee_ids())
    )
  );
CREATE POLICY dbs_os_admin_insert
  ON public.dbs_control_work_orders FOR INSERT TO authenticated
  WITH CHECK ((SELECT is_admin()));
CREATE POLICY dbs_os_update
  ON public.dbs_control_work_orders FOR UPDATE TO authenticated
  USING (
    (SELECT is_admin())
    OR (
      deleted_at IS NULL
      AND lower(coalesce(status, '')) NOT IN ('cancelada', 'cancelado')
      AND assigned_employee_id IN (SELECT private.dbs_my_employee_ids())
    )
  )
  WITH CHECK (
    (SELECT is_admin())
    OR (
      deleted_at IS NULL
      AND lower(coalesce(status, '')) NOT IN ('cancelada', 'cancelado')
      AND assigned_employee_id IN (SELECT private.dbs_my_employee_ids())
    )
  );
CREATE POLICY dbs_os_admin_delete
  ON public.dbs_control_work_orders FOR DELETE TO authenticated
  USING ((SELECT is_admin()));

ALTER POLICY rh_employees_gestor_conta_view ON public.rh_employees TO authenticated;
ALTER POLICY rh_employees_gestor_regional_access ON public.rh_employees TO authenticated;
DROP POLICY IF EXISTS rh_employees_admin_access ON public.rh_employees;
CREATE POLICY rh_employees_admin_select
  ON public.rh_employees FOR SELECT TO authenticated
  USING ((SELECT current_role_key()) = ANY (ARRAY['SUPER_ADMIN'::role_key, 'ADMIN_OPERACIONAL'::role_key]));
CREATE POLICY rh_employees_admin_insert
  ON public.rh_employees FOR INSERT TO authenticated
  WITH CHECK ((SELECT current_role_key()) = ANY (ARRAY['SUPER_ADMIN'::role_key, 'ADMIN_OPERACIONAL'::role_key]));
CREATE POLICY rh_employees_admin_update
  ON public.rh_employees FOR UPDATE TO authenticated
  USING ((SELECT current_role_key()) = ANY (ARRAY['SUPER_ADMIN'::role_key, 'ADMIN_OPERACIONAL'::role_key]))
  WITH CHECK ((SELECT current_role_key()) = ANY (ARRAY['SUPER_ADMIN'::role_key, 'ADMIN_OPERACIONAL'::role_key]));
CREATE POLICY rh_employees_admin_delete
  ON public.rh_employees FOR DELETE TO authenticated
  USING ((SELECT current_role_key()) = ANY (ARRAY['SUPER_ADMIN'::role_key, 'ADMIN_OPERACIONAL'::role_key]));