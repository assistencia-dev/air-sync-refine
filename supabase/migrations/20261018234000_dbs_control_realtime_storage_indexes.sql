-- DBS CONTROL · Fase 1: Realtime, Storage privado e índices operacionais.
-- A migração é aditiva: não remove nem reescreve OS existentes.

CREATE INDEX IF NOT EXISTS idx_dbs_control_work_orders_status
  ON public.dbs_control_work_orders (status);

CREATE INDEX IF NOT EXISTS idx_dbs_control_work_orders_assigned_employee
  ON public.dbs_control_work_orders (assigned_employee_id);

CREATE INDEX IF NOT EXISTS idx_dbs_control_work_orders_created_at
  ON public.dbs_control_work_orders (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dbs_control_work_orders_assignee_status_created
  ON public.dbs_control_work_orders (assigned_employee_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dbs_control_work_order_events_order_created
  ON public.dbs_control_work_order_events (work_order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dbs_control_work_order_attachments_order_created
  ON public.dbs_control_work_order_attachments (work_order_id, created_at DESC);

-- Fotos e assinaturas são privados; leitura ocorre por URL assinada emitida no servidor.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'dbs-control-os',
  'dbs-control-os',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- O cliente recebe apenas eventos autorizados pela configuração/RLS existente.
-- A aplicação refaz uma leitura autenticada do snapshot após cada evento.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'dbs_control_snapshots'
  ) THEN
    ALTER PUBLICATION supabase_realtime
      ADD TABLE public.dbs_control_snapshots;
  END IF;
END
$$;
