CREATE TABLE IF NOT EXISTS public.rh_employee_advances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.rh_employees(id) ON DELETE RESTRICT,
  advance_type text NOT NULL DEFAULT 'VALE' CHECK (advance_type IN ('VALE','ADIANTAMENTO','OUTRO')),
  description text NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  competence date NOT NULL,
  authorized boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'programado' CHECK (status IN ('programado','descontado','cancelado')),
  notes text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rh_employee_advances_employee_competence_idx ON public.rh_employee_advances(employee_id, competence, status);
CREATE INDEX IF NOT EXISTS rh_employee_advances_competence_idx ON public.rh_employee_advances(competence, status, authorized);
GRANT ALL ON public.rh_employee_advances TO service_role;
GRANT SELECT ON public.rh_employee_advances TO authenticated;
ALTER TABLE public.rh_employee_advances ENABLE ROW LEVEL SECURITY;
CREATE POLICY rh_employee_advances_admin_select ON public.rh_employee_advances FOR SELECT TO authenticated USING (public.is_admin());
CREATE TRIGGER rh_employee_advances_updated_at BEFORE UPDATE ON public.rh_employee_advances FOR EACH ROW EXECUTE FUNCTION public.rh_set_updated_at();