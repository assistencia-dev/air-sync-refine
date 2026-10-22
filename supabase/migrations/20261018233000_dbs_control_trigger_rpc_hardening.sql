-- Harden trigger-only SECURITY DEFINER functions found by Supabase Security Advisor.
-- Trigger execution continues to work; these functions must not be exposed as callable RPCs.
begin;

alter function public.protect_dbs_control_fieldcontrol_integration() set search_path = public;
revoke all on function public.protect_dbs_control_fieldcontrol_integration() from public, anon, authenticated;
grant execute on function public.protect_dbs_control_fieldcontrol_integration() to service_role;

revoke all on function public.ensure_dbs_control_work_order_protocol_unique() from public, anon, authenticated;
grant execute on function public.ensure_dbs_control_work_order_protocol_unique() to service_role;

commit;
