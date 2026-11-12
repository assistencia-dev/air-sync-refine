-- Trigger functions are database-internal implementation details, not API endpoints.
-- Existing triggers continue to fire; only direct calls from API roles are removed.
BEGIN;

REVOKE ALL ON FUNCTION public.dbs_control_fill_cost_center()
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.dbs_control_record_purchase_approval_history()
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.dbs_control_reject_inventory_movement_mutation()
  FROM PUBLIC, anon, authenticated;

COMMIT;