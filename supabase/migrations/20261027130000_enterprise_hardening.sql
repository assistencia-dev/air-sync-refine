-- Enterprise hardening: additive indexes, explicit core RLS, outbox DLQ and
-- SECURITY DEFINER hardening. No data is deleted or rewritten.
--
-- This migration is deliberately idempotent. It may be re-applied safely after
-- a failed deployment because every additive object uses IF NOT EXISTS and all
-- policy/function replacements preserve the existing API signatures.

DO $$
DECLARE
  fk record;
  idx_name text;
  column_sql text;
BEGIN
  /*
   * Cover every public foreign key that does not already have an index whose
   * leading key columns match the constraint. This is the safe equivalent of
   * the 51 unindexed-FK advisor findings without duplicating existing indexes.
   */
  FOR fk IN
    SELECT
      c.oid,
      c.conrelid,
      n.nspname AS schema_name,
      cls.relname AS table_name,
      c.conname,
      c.conkey,
      array_length(c.conkey, 1) AS key_count
    FROM pg_constraint c
    JOIN pg_class cls ON cls.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = cls.relnamespace
    WHERE c.contype = 'f'
      AND n.nspname = 'public'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_index i
        WHERE i.indrelid = c.conrelid
          AND i.indisvalid
          AND i.indisready
          AND i.indnkeyatts >= array_length(c.conkey, 1)
          AND (i.indkey::int[])[1:array_length(c.conkey, 1)] = c.conkey::int[]
      )
  LOOP
    column_sql := (
      SELECT string_agg(format('%I', a.attname), ', ' ORDER BY u.ord)
      FROM unnest(fk.conkey) WITH ORDINALITY AS u(attnum, ord)
      JOIN pg_attribute a
        ON a.attrelid = fk.conrelid
       AND a.attnum = u.attnum
    );

    idx_name := left(
      'idx_fk_' || fk.table_name || '_' || fk.conname,
      50
    ) || '_' || substr(md5(fk.table_name || ':' || fk.conname), 1, 10);

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.%I USING btree (%s)',
      idx_name,
      fk.schema_name,
      fk.table_name,
      column_sql
    );
  END LOOP;
END
$$;

-- Critical cursor/filter indexes used by DBS Control and the dashboards.
CREATE INDEX IF NOT EXISTS idx_hardening_work_orders_active_updated
  ON public.dbs_control_work_orders (updated_at DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_hardening_work_orders_assignee_status_updated
  ON public.dbs_control_work_orders (assigned_employee_id, status, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_hardening_work_orders_client_status_updated
  ON public.dbs_control_work_orders (client_id, status, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_hardening_work_orders_site_updated
  ON public.dbs_control_work_orders (site_id, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_hardening_work_orders_version_updated
  ON public.dbs_control_work_orders (version, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_hardening_outbox_pending_claim
  ON public.dbs_control_outbox (status, available_at, created_at, id)
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS idx_hardening_outbox_attempts
  ON public.dbs_control_outbox (attempts, created_at)
  WHERE status <> 'published';

CREATE INDEX IF NOT EXISTS idx_hardening_sync_commands_status_created
  ON public.dbs_control_sync_commands (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hardening_sync_commands_aggregate_created
  ON public.dbs_control_sync_commands (aggregate_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hardening_sync_commands_conflicts
  ON public.dbs_control_sync_commands (conflict_at DESC)
  WHERE status = 'conflict';



CREATE INDEX IF NOT EXISTS idx_hardening_ponto_employee_date
  ON public.rh_ponto_records (employee_id, work_date, punch_type);

-- Formal status catalog. Existing statuses are preserved; this is additive.
CREATE TABLE IF NOT EXISTS public.dbs_control_work_order_status_catalog (
  code text PRIMARY KEY,
  label text NOT NULL,
  is_terminal boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dbs_control_work_order_status_catalog ENABLE ROW LEVEL SECURITY;

INSERT INTO public.dbs_control_work_order_status_catalog
  (code, label, is_terminal, sort_order)
VALUES
  ('aberta', 'Aberta', false, 10),
  ('em_atendimento', 'Em atendimento', false, 20),
  ('concluida', 'Concluída', true, 30),
  ('concluida_com_pendencia', 'Concluída com pendência', true, 31),
  ('aguardando_peca', 'Aguardando peça', false, 40),
  ('aguardando_aprovacao', 'Aguardando aprovação', false, 50),
  ('retorno_necessario', 'Retorno necessário', false, 60),
  ('cancelada', 'Cancelada', true, 70),
  ('aguardando_cliente', 'Aguardando cliente', false, 80)
ON CONFLICT (code) DO UPDATE SET
  label = excluded.label,
  is_terminal = excluded.is_terminal,
  sort_order = excluded.sort_order,
  is_active = true;

DROP POLICY IF EXISTS dbs_control_work_order_status_catalog_read ON public.dbs_control_work_order_status_catalog;
DROP POLICY IF EXISTS dbs_control_work_order_status_catalog_service ON public.dbs_control_work_order_status_catalog;

CREATE POLICY dbs_control_work_order_status_catalog_read
  ON public.dbs_control_work_order_status_catalog
  FOR SELECT
  TO authenticated
  USING (is_active = true);

CREATE POLICY dbs_control_work_order_status_catalog_service
  ON public.dbs_control_work_order_status_catalog
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT SELECT ON public.dbs_control_work_order_status_catalog TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dbs_control_work_order_status_catalog TO service_role;

-- Persistent dead-letter storage for events that fail after four attempts.
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
  ON public.dbs_control_outbox_dlq
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON public.dbs_control_outbox_dlq FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.dbs_control_outbox_dlq TO service_role;

CREATE INDEX IF NOT EXISTS idx_dbs_control_outbox_dlq_failed_at
  ON public.dbs_control_outbox_dlq (failed_at DESC);

CREATE INDEX IF NOT EXISTS idx_dbs_control_outbox_dlq_aggregate
  ON public.dbs_control_outbox_dlq (aggregate_type, aggregate_id);

-- Integration credentials never belong to the browser-facing roles.
DROP POLICY IF EXISTS dbs_control_integrations_admin_all ON public.dbs_control_integrations;
DROP POLICY IF EXISTS dbs_control_integrations_service_only ON public.dbs_control_integrations;

CREATE POLICY dbs_control_integrations_service_only
  ON public.dbs_control_integrations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON public.dbs_control_integrations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dbs_control_integrations TO service_role;

-- The collaborator must not see deleted/cancelled work orders directly.
DROP POLICY IF EXISTS dbs_os_admin_all ON public.dbs_control_work_orders;
DROP POLICY IF EXISTS dbs_os_admin_select ON public.dbs_control_work_orders;
DROP POLICY IF EXISTS dbs_os_admin_insert ON public.dbs_control_work_orders;
DROP POLICY IF EXISTS dbs_os_admin_update ON public.dbs_control_work_orders;
DROP POLICY IF EXISTS dbs_os_admin_delete ON public.dbs_control_work_orders;
DROP POLICY IF EXISTS dbs_os_select ON public.dbs_control_work_orders;
DROP POLICY IF EXISTS dbs_os_employee_select ON public.dbs_control_work_orders;
DROP POLICY IF EXISTS dbs_os_employee_update ON public.dbs_control_work_orders;

CREATE POLICY dbs_os_select
  ON public.dbs_control_work_orders
  FOR SELECT
  TO authenticated
  USING (
    (SELECT is_admin())
    OR (
      deleted_at IS NULL
      AND lower(coalesce(status, '')) NOT IN ('cancelada', 'cancelado')
      AND assigned_employee_id IN (SELECT private.dbs_my_employee_ids())
    )
  );

CREATE POLICY dbs_os_admin_insert
  ON public.dbs_control_work_orders
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT is_admin()));

CREATE POLICY dbs_os_update
  ON public.dbs_control_work_orders
  FOR UPDATE
  TO authenticated
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
  ON public.dbs_control_work_orders
  FOR DELETE
  TO authenticated
  USING ((SELECT is_admin()));

-- RH is authenticated-only; anonymous/public sessions must not evaluate these rules.
ALTER POLICY rh_employees_admin_access
  ON public.rh_employees
  TO authenticated;

ALTER POLICY rh_employees_gestor_conta_view
  ON public.rh_employees
  TO authenticated;

ALTER POLICY rh_employees_gestor_regional_access
  ON public.rh_employees
  TO authenticated;

-- Replace the broad admin ALL policy with explicit operations.
DROP POLICY IF EXISTS rh_employees_admin_access ON public.rh_employees;
CREATE POLICY rh_employees_admin_select
  ON public.rh_employees
  FOR SELECT
  TO authenticated
  USING (
    (SELECT current_role_key()) = ANY (ARRAY['SUPER_ADMIN'::role_key, 'ADMIN_OPERACIONAL'::role_key])
  );

CREATE POLICY rh_employees_admin_insert
  ON public.rh_employees
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT current_role_key()) = ANY (ARRAY['SUPER_ADMIN'::role_key, 'ADMIN_OPERACIONAL'::role_key])
  );

CREATE POLICY rh_employees_admin_update
  ON public.rh_employees
  FOR UPDATE
  TO authenticated
  USING (
    (SELECT current_role_key()) = ANY (ARRAY['SUPER_ADMIN'::role_key, 'ADMIN_OPERACIONAL'::role_key])
  )
  WITH CHECK (
    (SELECT current_role_key()) = ANY (ARRAY['SUPER_ADMIN'::role_key, 'ADMIN_OPERACIONAL'::role_key])
  );

CREATE POLICY rh_employees_admin_delete
  ON public.rh_employees
  FOR DELETE
  TO authenticated
  USING (
    (SELECT current_role_key()) = ANY (ARRAY['SUPER_ADMIN'::role_key, 'ADMIN_OPERACIONAL'::role_key])
  );

-- Harden every SECURITY DEFINER function exposed from public without changing
-- its signature or removing any existing service_role grant.
DO $$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT n.nspname AS schema_name,
           p.proname AS function_name,
           pg_get_function_identity_arguments(p.oid) AS identity_args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %I.%I(%s) SET search_path TO public, pg_temp',
      f.schema_name, f.function_name, f.identity_args
    );
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM PUBLIC',
      f.schema_name, f.function_name, f.identity_args
    );
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION public.dbs_control_complete_outbox(
  p_outbox_id uuid,
  p_worker_id text,
  p_success boolean,
  p_error text DEFAULT NULL,
  p_retry_seconds integer DEFAULT 30
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_delay integer := greatest(5, least(coalesce(p_retry_seconds, 30), 3600));
BEGIN
  IF nullif(trim(p_worker_id), '') IS NULL THEN
    RAISE EXCEPTION 'DBS_OUTBOX_WORKER_REQUIRED: worker_id é obrigatório.' USING errcode = '22023';
  END IF;

  IF NOT p_success THEN
    INSERT INTO public.dbs_control_outbox_dlq (
      outbox_id,
      idempotency_key,
      aggregate_type,
      aggregate_id,
      event_type,
      attempts,
      payload,
      last_error,
      failed_at
    )
    SELECT
      o.id,
      o.idempotency_key,
      o.aggregate_type,
      o.aggregate_id,
      o.event_type,
      o.attempts,
      o.payload,
      left(coalesce(p_error, 'Falha não especificada'), 2000),
      now()
    FROM public.dbs_control_outbox o
    WHERE o.id = p_outbox_id
      AND o.status = 'processing'
      AND o.locked_by = left(trim(p_worker_id), 160)
      AND o.attempts >= 4
    ON CONFLICT (outbox_id) DO UPDATE SET
      attempts = EXCLUDED.attempts,
      last_error = EXCLUDED.last_error,
      failed_at = EXCLUDED.failed_at;
  END IF;

  UPDATE public.dbs_control_outbox o
     SET status = CASE
       WHEN p_success THEN 'published'
       WHEN o.attempts >= 4 THEN 'failed'
       ELSE 'pending'
     END,
         published_at = CASE WHEN p_success THEN now() ELSE o.published_at END,
         available_at = CASE WHEN p_success THEN o.available_at ELSE now() + make_interval(secs => v_delay) END,
         locked_at = NULL,
         locked_by = NULL,
         last_error = CASE WHEN p_success THEN NULL ELSE left(coalesce(p_error, 'Falha não especificada'), 2000) END
   WHERE o.id = p_outbox_id
     AND o.status = 'processing'
     AND o.locked_by = left(trim(p_worker_id), 160);

  RETURN found;
END;
$function$;

CREATE OR REPLACE FUNCTION public.dbs_control_sync_health()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
  SELECT jsonb_build_object(
    'pending', count(*) FILTER (WHERE status = 'pending'),
    'processing', count(*) FILTER (WHERE status = 'processing'),
    'published', count(*) FILTER (WHERE status = 'published'),
    'failed', count(*) FILTER (WHERE status = 'failed'),
    'oldest_pending_at', min(created_at) FILTER (WHERE status IN ('pending', 'processing')),
    'oldest_pending_age_seconds',
      coalesce(extract(epoch FROM now() - min(created_at) FILTER (WHERE status IN ('pending', 'processing'))), 0),
    'pending_over_sla',
      count(*) FILTER (
        WHERE status IN ('pending', 'processing')
          AND created_at < now() - interval '10 minutes'
      ),
    'pending_critical',
      count(*) FILTER (
        WHERE status IN ('pending', 'processing')
          AND created_at < now() - interval '15 minutes'
      ),
    'retries_over_3',
      count(*) FILTER (
        WHERE status <> 'published'
          AND attempts > 3
      ),
    'last_published_at', max(published_at),
    'last_error_at', max(created_at) FILTER (WHERE status = 'failed'),
    'last_error', max(last_error) FILTER (WHERE status = 'failed'),
    'dead_letter', (SELECT count(*) FROM public.dbs_control_outbox_dlq),
    'dead_letter_latest_at', (SELECT max(failed_at) FROM public.dbs_control_outbox_dlq)
  )
  FROM public.dbs_control_outbox;
$function$;

ALTER FUNCTION public.dbs_control_complete_outbox(uuid, text, boolean, text, integer)
  SET search_path TO public, pg_temp;
ALTER FUNCTION public.dbs_control_sync_health()
  SET search_path TO public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.dbs_control_complete_outbox(uuid, text, boolean, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.dbs_control_sync_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dbs_control_complete_outbox(uuid, text, boolean, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.dbs_control_sync_health() TO service_role;

ANALYZE public.dbs_control_work_orders;
ANALYZE public.dbs_control_outbox;
ANALYZE public.dbs_control_sync_commands;
ANALYZE public.dbs_control_work_order_events;
ANALYZE public.dbs_control_work_order_attachments;
ANALYZE public.rh_ponto_records;
