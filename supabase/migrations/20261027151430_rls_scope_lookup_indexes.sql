-- Additive indexes for collaborator RLS scope lookups.
-- No tables or rows are removed; the helper remains idempotent and stable.

CREATE INDEX IF NOT EXISTS idx_users_auth_status_active
  ON public.users (auth_id, status)
  WHERE status = 'ativo';

CREATE INDEX IF NOT EXISTS idx_rh_employees_dbs_scope_user_active
  ON public.rh_employees (ponto_portal_user_id, id)
  WHERE ponto_portal_user_id IS NOT NULL
    AND dbs_control_access_enabled = true
    AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_rh_employee_access_user_enabled_employee
  ON public.rh_employee_access (user_id, employee_id)
  WHERE access_enabled = true;

CREATE OR REPLACE FUNCTION private.dbs_my_employee_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
  SELECT e.id
  FROM public.rh_employees e
  WHERE e.ponto_portal_user_id = public.current_app_user_id()
    AND e.dbs_control_access_enabled = true
    AND e.is_active = true
  UNION
  SELECT e.id
  FROM public.rh_employee_access ea
  JOIN public.rh_employees e ON e.id = ea.employee_id
  WHERE ea.user_id = public.current_app_user_id()
    AND ea.access_enabled = true
    AND e.dbs_control_access_enabled = true
    AND e.is_active = true;
$function$;