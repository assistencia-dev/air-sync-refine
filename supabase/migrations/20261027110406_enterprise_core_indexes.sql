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
CREATE INDEX IF NOT EXISTS idx_hardening_work_order_events_order_created
  ON public.dbs_control_work_order_events (work_order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hardening_work_order_attachments_order_created
  ON public.dbs_control_work_order_attachments (work_order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hardening_ponto_employee_date
  ON public.rh_ponto_records (employee_id, work_date, punch_type);