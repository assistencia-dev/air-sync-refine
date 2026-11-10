-- DBS AIR: hardening adicional do backend Supabase.
REVOKE EXECUTE ON FUNCTION public.current_app_user_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_app_user_id() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.current_role_key() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_role_key() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.current_unit_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_unit_id() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.current_is_unit_manager() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_is_unit_manager() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.usuario_esta_ativo() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.usuario_esta_ativo() TO authenticated;
-- Some installations created this helper manually; harden it only when present.
DO $do$
BEGIN
  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO service_role';
  END IF;
END
$do$;
ALTER FUNCTION public.set_treasury_snapshot_updated_at() SET search_path = public;
CREATE POLICY project_authenticated_select
  ON public.project FOR SELECT TO authenticated USING (true);
