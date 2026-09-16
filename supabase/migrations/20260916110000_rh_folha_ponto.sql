-- DBS AIR · Folha de Ponto
-- Migração exclusivamente aditiva: não remove nem substitui dados existentes.

ALTER TABLE public.rh_employees
  ADD COLUMN IF NOT EXISTS ponto_access_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ponto_portal_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ponto_base_lat numeric(10,7),
  ADD COLUMN IF NOT EXISTS ponto_base_lng numeric(10,7),
  ADD COLUMN IF NOT EXISTS ponto_raio_m integer NOT NULL DEFAULT 150,
  ADD COLUMN IF NOT EXISTS ponto_entrada_prevista time,
  ADD COLUMN IF NOT EXISTS ponto_saida_prevista time,
  ADD COLUMN IF NOT EXISTS ponto_almoco_inicio_previsto time,
  ADD COLUMN IF NOT EXISTS ponto_almoco_fim_previsto time;

CREATE INDEX IF NOT EXISTS rh_employees_ponto_user_idx
  ON public.rh_employees(ponto_portal_user_id);

CREATE TABLE IF NOT EXISTS public.rh_ponto_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.rh_employees(id) ON DELETE RESTRICT,
  work_date date NOT NULL,
  punch_type text NOT NULL CHECK (punch_type IN ('entrada','almoco_saida','almoco_retorno','saida')),
  punched_at timestamptz NOT NULL DEFAULT now(),
  latitude numeric(10,7),
  longitude numeric(10,7),
  gps_accuracy_m numeric(10,2),
  distance_m numeric(10,2),
  inside_radius boolean,
  photo_data text,
  note text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rh_ponto_records_employee_date_idx
  ON public.rh_ponto_records(employee_id, work_date, punched_at);

CREATE TABLE IF NOT EXISTS public.rh_ponto_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES public.rh_employees(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rh_ponto_audit_employee_idx
  ON public.rh_ponto_audit(employee_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.rh_ponto_records TO authenticated;
GRANT SELECT ON public.rh_ponto_audit TO authenticated;
GRANT ALL ON public.rh_ponto_records TO service_role;
GRANT ALL ON public.rh_ponto_audit TO service_role;
ALTER TABLE public.rh_ponto_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_ponto_audit ENABLE ROW LEVEL SECURITY;

-- As policies usam as mesmas funções RBAC já adotadas pelo projeto.
CREATE POLICY rh_ponto_records_self_select ON public.rh_ponto_records
  FOR SELECT TO authenticated
  USING (
    employee_id IN (
      SELECT e.id FROM public.rh_employees e
      WHERE e.ponto_portal_user_id = (
        SELECT u.id FROM public.users u WHERE u.auth_id = auth.uid()
      )
      AND e.ponto_access_enabled = true
    )
    OR public.current_role_key() IN ('SUPER_ADMIN', 'ADMIN_OPERACIONAL')
  );

CREATE POLICY rh_ponto_records_self_insert ON public.rh_ponto_records
  FOR INSERT TO authenticated
  WITH CHECK (
    employee_id IN (
      SELECT e.id FROM public.rh_employees e
      WHERE e.ponto_portal_user_id = (
        SELECT u.id FROM public.users u WHERE u.auth_id = auth.uid()
      )
      AND e.ponto_access_enabled = true
    )
    OR public.current_role_key() IN ('SUPER_ADMIN', 'ADMIN_OPERACIONAL')
  );

CREATE POLICY rh_ponto_records_admin_update ON public.rh_ponto_records
  FOR UPDATE TO authenticated
  USING (public.current_role_key() IN ('SUPER_ADMIN', 'ADMIN_OPERACIONAL'))
  WITH CHECK (public.current_role_key() IN ('SUPER_ADMIN', 'ADMIN_OPERACIONAL'));

CREATE POLICY rh_ponto_audit_admin_select ON public.rh_ponto_audit
  FOR SELECT TO authenticated
  USING (public.current_role_key() IN ('SUPER_ADMIN', 'ADMIN_OPERACIONAL'));

CREATE POLICY rh_ponto_audit_admin_insert ON public.rh_ponto_audit
  FOR INSERT TO authenticated
  WITH CHECK (public.current_role_key() IN ('SUPER_ADMIN', 'ADMIN_OPERACIONAL'));
