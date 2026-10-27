-- Additive performance indexes and formal DBS Control status catalog.
-- No data is deleted or rewritten.

DO $$
DECLARE
  fk record;
  idx_name text;
  column_sql text;
BEGIN
  FOR fk IN
    SELECT c.oid, c.conrelid, n.nspname AS schema_name, cls.relname AS table_name,
           c.conname, c.conkey
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
      JOIN pg_attribute a ON a.attrelid = fk.conrelid AND a.attnum = u.attnum
    );
    idx_name := left('idx_fk_' || fk.table_name || '_' || fk.conname, 50)
      || '_' || substr(md5(fk.table_name || ':' || fk.conname), 1, 10);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.%I USING btree (%s)',
      idx_name, fk.schema_name, fk.table_name, column_sql
    );
  END LOOP;
END
$$;

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
  label = excluded.label, is_terminal = excluded.is_terminal,
  sort_order = excluded.sort_order, is_active = true;
DROP POLICY IF EXISTS dbs_control_work_order_status_catalog_read ON public.dbs_control_work_order_status_catalog;
DROP POLICY IF EXISTS dbs_control_work_order_status_catalog_service ON public.dbs_control_work_order_status_catalog;
CREATE POLICY dbs_control_work_order_status_catalog_read
  ON public.dbs_control_work_order_status_catalog FOR SELECT TO authenticated
  USING (is_active = true);
CREATE POLICY dbs_control_work_order_status_catalog_service
  ON public.dbs_control_work_order_status_catalog FOR ALL TO service_role
  USING (true) WITH CHECK (true);
GRANT SELECT ON public.dbs_control_work_order_status_catalog TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dbs_control_work_order_status_catalog TO service_role;
ANALYZE public.dbs_control_work_orders;
ANALYZE public.dbs_control_outbox;
ANALYZE public.dbs_control_sync_commands;
ANALYZE public.dbs_control_work_order_events;
ANALYZE public.dbs_control_work_order_attachments;
ANALYZE public.rh_ponto_records;