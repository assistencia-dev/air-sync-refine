-- Internal SECURITY DEFINER implementations stay outside the public Data API.
-- Public functions remain compatibility wrappers for existing RLS policies.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.current_app_user_id_internal()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO pg_catalog
AS $function$
  SELECT u.id
  FROM public.users AS u
  WHERE u.auth_id = auth.uid() AND u.status = 'ativo'
  LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION private.current_role_key_internal()
RETURNS public.role_key LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO pg_catalog
AS $function$
  SELECT u.role_key
  FROM public.users AS u
  WHERE u.auth_id = auth.uid() AND u.status = 'ativo'
  LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION private.current_unit_id_internal()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO pg_catalog
AS $function$
  SELECT u.unit_id
  FROM public.users AS u
  WHERE u.auth_id = auth.uid() AND u.status = 'ativo'
  LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION private.current_is_unit_manager_internal()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO pg_catalog
AS $function$
  SELECT COALESCE(u.is_unit_manager, false)
  FROM public.users AS u
  WHERE u.auth_id = auth.uid() AND u.status = 'ativo'
  LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION private.usuario_esta_ativo_internal()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO pg_catalog
AS $function$
  SELECT COALESCE((
    SELECT u.status = 'ativo'
    FROM public.users AS u
    WHERE u.auth_id = auth.uid()
    LIMIT 1
  ), false)
$function$;

CREATE OR REPLACE FUNCTION private.is_admin_internal()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO pg_catalog
AS $function$
  SELECT COALESCE(
    private.current_role_key_internal() = ANY (
      ARRAY['SUPER_ADMIN'::public.role_key, 'ADMIN_OPERACIONAL'::public.role_key]
    ),
    false
  )
$function$;

REVOKE EXECUTE ON FUNCTION private.current_app_user_id_internal() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.current_role_key_internal() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.current_unit_id_internal() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.current_is_unit_manager_internal() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.usuario_esta_ativo_internal() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.is_admin_internal() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.current_app_user_id_internal() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.current_role_key_internal() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.current_unit_id_internal() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.current_is_unit_manager_internal() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.usuario_esta_ativo_internal() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_admin_internal() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO pg_catalog
AS $function$ SELECT private.current_app_user_id_internal() $function$;

CREATE OR REPLACE FUNCTION public.current_role_key()
RETURNS public.role_key LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO pg_catalog
AS $function$ SELECT private.current_role_key_internal() $function$;

CREATE OR REPLACE FUNCTION public.current_unit_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO pg_catalog
AS $function$ SELECT private.current_unit_id_internal() $function$;

CREATE OR REPLACE FUNCTION public.current_is_unit_manager()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO pg_catalog
AS $function$ SELECT private.current_is_unit_manager_internal() $function$;

CREATE OR REPLACE FUNCTION public.usuario_esta_ativo()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO pg_catalog
AS $function$ SELECT private.usuario_esta_ativo_internal() $function$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO pg_catalog
AS $function$ SELECT private.is_admin_internal() $function$;

REVOKE EXECUTE ON FUNCTION public.current_app_user_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_role_key() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_unit_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_is_unit_manager() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.usuario_esta_ativo() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_app_user_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_role_key() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_unit_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_is_unit_manager() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.usuario_esta_ativo() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
