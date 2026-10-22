begin;

-- Trigger functions run through PostgreSQL triggers, not as public RPC endpoints.
alter function public.ensure_dbs_control_work_order_protocol_unique()
  set search_path = pg_catalog;
revoke all on function public.ensure_dbs_control_work_order_protocol_unique()
  from public, anon, authenticated;
grant execute on function public.ensure_dbs_control_work_order_protocol_unique()
  to service_role;

-- The integration guard must not be callable through the Data API and must use
-- a fixed search_path when checking key protection and deletion rules.
alter function public.protect_dbs_control_fieldcontrol_integration()
  set search_path = pg_catalog;
revoke all on function public.protect_dbs_control_fieldcontrol_integration()
  from public, anon, authenticated;
grant execute on function public.protect_dbs_control_fieldcontrol_integration()
  to service_role;

commit;
