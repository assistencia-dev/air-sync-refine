-- Block stale sessions for accounts that have been deactivated.
-- These helpers are SECURITY DEFINER to avoid users-table RLS recursion in policies;
-- restrict name resolution and qualify every non-system object.
CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog
AS $function$
  SELECT u.id
  FROM public.users AS u
  WHERE u.auth_id = auth.uid()
    AND u.status = 'ativo'
  LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.current_role_key()
RETURNS public.role_key
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog
AS $function$
  SELECT u.role_key
  FROM public.users AS u
  WHERE u.auth_id = auth.uid()
    AND u.status = 'ativo'
  LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.current_unit_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog
AS $function$
  SELECT u.unit_id
  FROM public.users AS u
  WHERE u.auth_id = auth.uid()
    AND u.status = 'ativo'
  LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.current_is_unit_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog
AS $function$
  SELECT COALESCE(u.is_unit_manager, false)
  FROM public.users AS u
  WHERE u.auth_id = auth.uid()
    AND u.status = 'ativo'
  LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.usuario_esta_ativo()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog
AS $function$
  SELECT COALESCE((
    SELECT u.status = 'ativo'
    FROM public.users AS u
    WHERE u.auth_id = auth.uid()
    LIMIT 1
  ), false)
$function$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog
AS $function$
  SELECT COALESCE(
    public.current_role_key() = ANY (
      ARRAY['SUPER_ADMIN'::public.role_key, 'ADMIN_OPERACIONAL'::public.role_key]
    ),
    false
  )
$function$;

-- Company and unit metadata must not remain visible to a disabled session.
DROP POLICY IF EXISTS companies_member_read ON public.companies;
CREATE POLICY companies_member_read
ON public.companies
FOR SELECT TO authenticated
USING (
  public.usuario_esta_ativo()
  AND id = (
    SELECT u.company_id
    FROM public.users AS u
    WHERE u.auth_id = auth.uid()
      AND u.status = 'ativo'
    LIMIT 1
  )
);

DROP POLICY IF EXISTS units_member_read ON public.units;
CREATE POLICY units_member_read
ON public.units
FOR SELECT TO authenticated
USING (
  public.usuario_esta_ativo()
  AND (
    id = public.current_unit_id()
    OR company_id = (
      SELECT u.company_id
      FROM public.users AS u
      WHERE u.auth_id = auth.uid()
        AND u.status = 'ativo'
      LIMIT 1
    )
  )
);

-- The original role subqueries below bypassed the central active-user helper.
DROP POLICY IF EXISTS rh_ponto_audit_admin_insert ON public.rh_ponto_audit;
CREATE POLICY rh_ponto_audit_admin_insert
ON public.rh_ponto_audit
FOR INSERT TO authenticated
WITH CHECK (
  public.usuario_esta_ativo()
  AND (
    SELECT u.role_key
    FROM public.users AS u
    WHERE u.auth_id = auth.uid()
      AND u.status = 'ativo'
    LIMIT 1
  ) = ANY (ARRAY['SUPER_ADMIN'::public.role_key, 'ADMIN_OPERACIONAL'::public.role_key])
);

DROP POLICY IF EXISTS rh_ponto_audit_admin_select ON public.rh_ponto_audit;
CREATE POLICY rh_ponto_audit_admin_select
ON public.rh_ponto_audit
FOR SELECT TO authenticated
USING (
  public.usuario_esta_ativo()
  AND (
    SELECT u.role_key
    FROM public.users AS u
    WHERE u.auth_id = auth.uid()
      AND u.status = 'ativo'
    LIMIT 1
  ) = ANY (ARRAY['SUPER_ADMIN'::public.role_key, 'ADMIN_OPERACIONAL'::public.role_key])
);

DROP POLICY IF EXISTS rh_ponto_records_admin_update ON public.rh_ponto_records;
CREATE POLICY rh_ponto_records_admin_update
ON public.rh_ponto_records
FOR UPDATE TO authenticated
USING (
  public.usuario_esta_ativo()
  AND (
    SELECT u.role_key
    FROM public.users AS u
    WHERE u.auth_id = auth.uid()
      AND u.status = 'ativo'
    LIMIT 1
  ) = ANY (ARRAY['SUPER_ADMIN'::public.role_key, 'ADMIN_OPERACIONAL'::public.role_key])
)
WITH CHECK (
  public.usuario_esta_ativo()
  AND (
    SELECT u.role_key
    FROM public.users AS u
    WHERE u.auth_id = auth.uid()
      AND u.status = 'ativo'
    LIMIT 1
  ) = ANY (ARRAY['SUPER_ADMIN'::public.role_key, 'ADMIN_OPERACIONAL'::public.role_key])
);

DROP POLICY IF EXISTS rh_ponto_records_self_insert ON public.rh_ponto_records;
CREATE POLICY rh_ponto_records_self_insert
ON public.rh_ponto_records
FOR INSERT TO authenticated
WITH CHECK (
  public.usuario_esta_ativo()
  AND (
    employee_id IN (
      SELECT e.id
      FROM public.rh_employees AS e
      WHERE e.ponto_portal_user_id = public.current_app_user_id()
        AND e.ponto_access_enabled = true
    )
    OR (
      SELECT u.role_key
      FROM public.users AS u
      WHERE u.auth_id = auth.uid()
        AND u.status = 'ativo'
      LIMIT 1
    ) = ANY (ARRAY['SUPER_ADMIN'::public.role_key, 'ADMIN_OPERACIONAL'::public.role_key])
  )
);

DROP POLICY IF EXISTS rh_ponto_records_self_select ON public.rh_ponto_records;
CREATE POLICY rh_ponto_records_self_select
ON public.rh_ponto_records
FOR SELECT TO authenticated
USING (
  public.usuario_esta_ativo()
  AND (
    employee_id IN (
      SELECT e.id
      FROM public.rh_employees AS e
      WHERE e.ponto_portal_user_id = public.current_app_user_id()
        AND e.ponto_access_enabled = true
    )
    OR (
      SELECT u.role_key
      FROM public.users AS u
      WHERE u.auth_id = auth.uid()
        AND u.status = 'ativo'
      LIMIT 1
    ) = ANY (ARRAY['SUPER_ADMIN'::public.role_key, 'ADMIN_OPERACIONAL'::public.role_key])
  )
);

-- A deactivated user can no longer read their own app-profile row via the Data API.
DROP POLICY IF EXISTS users_self_select ON public.users;
CREATE POLICY users_self_select
ON public.users
FOR SELECT TO authenticated
USING (
  (auth_id = auth.uid() AND public.usuario_esta_ativo())
  OR public.is_admin()
);
