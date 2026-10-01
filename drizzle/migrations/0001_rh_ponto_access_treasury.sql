ALTER TABLE public.rh_employees
  ADD COLUMN IF NOT EXISTS ponto_access_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ponto_portal_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ponto_base_lat numeric(10,7),
  ADD COLUMN IF NOT EXISTS ponto_base_lng numeric(10,7),
  ADD COLUMN IF NOT EXISTS ponto_raio_m integer NOT NULL DEFAULT 150,
  ADD COLUMN IF NOT EXISTS ponto_entrada_prevista time,
  ADD COLUMN IF NOT EXISTS ponto_saida_prevista time,
  ADD COLUMN IF NOT EXISTS ponto_almoco_inicio_previsto time,
  ADD COLUMN IF NOT EXISTS ponto_almoco_fim_previsto time,
  ADD COLUMN IF NOT EXISTS registry_employee_id uuid REFERENCES public.rh_employees(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS benefit_configured boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS dbs_control_access_enabled boolean NOT NULL DEFAULT false;

UPDATE public.rh_employees SET registry_employee_id = id WHERE registry_employee_id IS NULL;
CREATE INDEX IF NOT EXISTS rh_employees_ponto_user_idx ON public.rh_employees(ponto_portal_user_id);
CREATE INDEX IF NOT EXISTS idx_rh_employees_registry_employee_id ON public.rh_employees(registry_employee_id);
CREATE INDEX IF NOT EXISTS idx_rh_employees_benefit_lookup ON public.rh_employees(registry_employee_id, benefit_type, is_active, benefit_configured);

CREATE TABLE IF NOT EXISTS public.rh_ponto_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid NOT NULL REFERENCES public.rh_employees(id) ON DELETE RESTRICT,
  work_date date NOT NULL, punch_type text NOT NULL CHECK (punch_type IN ('entrada','almoco_saida','almoco_retorno','saida')),
  punched_at timestamptz NOT NULL DEFAULT now(), latitude numeric(10,7), longitude numeric(10,7), gps_accuracy_m numeric(10,2),
  distance_m numeric(10,2), inside_radius boolean, photo_data text, note text, created_by uuid REFERENCES public.users(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rh_ponto_records_employee_date_idx ON public.rh_ponto_records(employee_id, work_date, punched_at);
CREATE TABLE IF NOT EXISTS public.rh_ponto_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid REFERENCES public.rh_employees(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL, action text NOT NULL, details jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.rh_ponto_records TO authenticated;
GRANT SELECT ON public.rh_ponto_audit TO authenticated;
GRANT ALL ON public.rh_ponto_records TO service_role;
GRANT ALL ON public.rh_ponto_audit TO service_role;
ALTER TABLE public.rh_ponto_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_ponto_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY rh_ponto_records_self_select ON public.rh_ponto_records FOR SELECT TO authenticated USING (
  employee_id IN (SELECT e.id FROM public.rh_employees e WHERE e.ponto_portal_user_id = public.current_app_user_id() AND e.ponto_access_enabled = true) OR public.is_admin());
CREATE POLICY rh_ponto_records_self_insert ON public.rh_ponto_records FOR INSERT TO authenticated WITH CHECK (
  employee_id IN (SELECT e.id FROM public.rh_employees e WHERE e.ponto_portal_user_id = public.current_app_user_id() AND e.ponto_access_enabled = true) OR public.is_admin());
CREATE POLICY rh_ponto_records_admin_update ON public.rh_ponto_records FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY rh_ponto_audit_admin_select ON public.rh_ponto_audit FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY rh_ponto_audit_admin_insert ON public.rh_ponto_audit FOR INSERT TO authenticated WITH CHECK (public.is_admin());

CREATE TABLE IF NOT EXISTS public.treasury_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), scope_key text NOT NULL UNIQUE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  state jsonb NOT NULL, state_version integer NOT NULL DEFAULT 5,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.treasury_snapshots TO authenticated;
GRANT ALL ON public.treasury_snapshots TO service_role;
ALTER TABLE public.treasury_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY treasury_super_admin_select ON public.treasury_snapshots FOR SELECT TO authenticated USING (public.current_role_key() = 'SUPER_ADMIN');
CREATE POLICY treasury_super_admin_insert ON public.treasury_snapshots FOR INSERT TO authenticated WITH CHECK (public.current_role_key() = 'SUPER_ADMIN');
CREATE POLICY treasury_super_admin_update ON public.treasury_snapshots FOR UPDATE TO authenticated USING (public.current_role_key() = 'SUPER_ADMIN') WITH CHECK (public.current_role_key() = 'SUPER_ADMIN');
CREATE TRIGGER treasury_snapshots_updated_at BEFORE UPDATE ON public.treasury_snapshots FOR EACH ROW EXECUTE FUNCTION public.rh_set_updated_at();

CREATE TABLE IF NOT EXISTS public.rh_employee_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL UNIQUE REFERENCES public.rh_employees(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  access_enabled boolean NOT NULL DEFAULT true, login_identifier text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rh_employee_access_user_idx ON public.rh_employee_access(user_id);
GRANT SELECT, INSERT, UPDATE ON public.rh_employee_access TO authenticated;
GRANT ALL ON public.rh_employee_access TO service_role;
ALTER TABLE public.rh_employee_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY rh_employee_access_no_direct_access ON public.rh_employee_access FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE TRIGGER rh_employee_access_updated_at BEFORE UPDATE ON public.rh_employee_access FOR EACH ROW EXECUTE FUNCTION public.rh_set_updated_at();