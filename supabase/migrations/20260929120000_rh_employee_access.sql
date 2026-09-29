-- DBS AIR · RH cadastro -> acesso
-- Migração aditiva: não remove nem altera registros existentes.
-- O vínculo novo passa a existir separado do cadastro para que o login do
-- colaborador não fique acoplado à configuração da Folha de Ponto.

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

-- Migra somente vínculos já existentes da Folha de Ponto.
-- Nenhum registro antigo é apagado.
INSERT INTO public.rh_employee_access (employee_id, user_id, access_enabled, login_identifier)
SELECT e.id, e.ponto_portal_user_id, e.ponto_access_enabled,
       COALESCE(u.username, u.email, u.cpf)
FROM public.rh_employees e
JOIN public.users u ON u.id = e.ponto_portal_user_id
WHERE e.ponto_portal_user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.rh_employee_access a WHERE a.employee_id = e.id
  );

COMMENT ON TABLE public.rh_employee_access IS
  'Vínculo único entre cadastro de funcionário e conta de acesso ao sistema. Legado de ponto permanece preservado durante a normalização.';
