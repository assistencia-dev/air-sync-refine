-- Explicit RPC grants: avoid relying on PUBLIC privilege inheritance.
REVOKE EXECUTE ON FUNCTION public.current_app_user_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.current_role_key() FROM anon;
REVOKE EXECUTE ON FUNCTION public.current_unit_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.current_is_unit_manager() FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon;
REVOKE EXECUTE ON FUNCTION public.usuario_esta_ativo() FROM anon;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon, authenticated;