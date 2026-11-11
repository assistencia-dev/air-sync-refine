-- Migration A: remove operational access to acquisition costs.
-- Additive and data-preserving. Server-side service_role access is retained.
BEGIN;

REVOKE SELECT ON TABLE public.dbs_control_parts FROM anon, authenticated;
REVOKE SELECT (cost_cents) ON TABLE public.dbs_control_parts FROM anon, authenticated;

GRANT SELECT (
  id, sku, name, description, stock_quantity, reserved_quantity,
  sale_cents, status, created_at, updated_at, version
) ON TABLE public.dbs_control_parts TO authenticated;

REVOKE SELECT ON TABLE public.dbs_control_work_order_parts FROM anon, authenticated;
REVOKE SELECT (cost_cents) ON TABLE public.dbs_control_work_order_parts FROM anon, authenticated;

GRANT SELECT (
  id, work_order_id, part_id, quantity, unit_cents,
  created_at, consumption_status, idempotency_key
) ON TABLE public.dbs_control_work_order_parts TO authenticated;

CREATE OR REPLACE VIEW public.dbs_control_parts_operational_v1
WITH (security_invoker = true)
AS
SELECT
  id, sku, name, description, stock_quantity, reserved_quantity,
  sale_cents, status, created_at, updated_at, version
FROM public.dbs_control_parts;

REVOKE ALL ON public.dbs_control_parts_operational_v1 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.dbs_control_parts_operational_v1 TO authenticated;

CREATE OR REPLACE VIEW public.dbs_control_work_order_parts_operational_v1
WITH (security_invoker = true)
AS
SELECT
  id, work_order_id, part_id, quantity, unit_cents,
  created_at, consumption_status, idempotency_key
FROM public.dbs_control_work_order_parts;

REVOKE ALL ON public.dbs_control_work_order_parts_operational_v1 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.dbs_control_work_order_parts_operational_v1 TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
