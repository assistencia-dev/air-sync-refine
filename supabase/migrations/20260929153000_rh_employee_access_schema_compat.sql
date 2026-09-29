-- DBS AIR · compatibilidade do schema RH
-- A aplicação atual usa users + rh_employees.ponto_portal_user_id.
-- Esta migração é deliberadamente aditiva: garante que instalações que
-- ainda não aplicaram a migração anterior tenham a tabela legado disponível
-- para versões antigas do frontend sem interromper o RH.
CREATE TABLE IF NOT EXISTS public.rh_employee_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL UNIQUE REFERENCES public.rh_employees(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  access_enabled boolean NOT NULL DEFAULT true,
  login_identifier text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rh_employee_access_user_idx
  ON public.rh_employee_access(user_id);

CREATE INDEX IF NOT EXISTS rh_employee_access_enabled_idx
  ON public.rh_employee_access(access_enabled);

ALTER TABLE public.rh_employee_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rh_employee_access_no_direct_access ON public.rh_employee_access;
CREATE POLICY rh_employee_access_no_direct_access
  ON public.rh_employee_access
  FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);

GRANT SELECT, INSERT, UPDATE ON public.rh_employee_access TO authenticated;
GRANT ALL ON public.rh_employee_access TO service_role;

DROP TRIGGER IF EXISTS rh_employee_access_updated_at ON public.rh_employee_access;
CREATE TRIGGER rh_employee_access_updated_at
  BEFORE UPDATE ON public.rh_employee_access
  FOR EACH ROW EXECUTE FUNCTION public.rh_set_updated_at();

NOTIFY pgrst, 'reload schema';
