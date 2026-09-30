-- DBS AIR · Fundação RH / DP
-- Somente aditivo: não remove nem apaga registros existentes.
-- Cria a base normalizada para contratos, dependentes, documentos, jornadas e eventos.
-- O cadastro canônico continua sendo public.rh_employees.

CREATE TABLE IF NOT EXISTS public.rh_departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS rh_departments_name_uq
  ON public.rh_departments(lower(trim(name)));

CREATE TABLE IF NOT EXISTS public.rh_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text,
  cbo text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS rh_positions_name_uq
  ON public.rh_positions(lower(trim(name)));

CREATE TABLE IF NOT EXISTS public.rh_employee_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.rh_employees(id) ON DELETE RESTRICT,
  contract_type text NOT NULL DEFAULT 'CLT',
  admission_date date,
  termination_date date,
  department_id uuid REFERENCES public.rh_departments(id) ON DELETE SET NULL,
  position_id uuid REFERENCES public.rh_positions(id) ON DELETE SET NULL,
  salary_cents bigint,
  salary_effective_from date,
  work_regime text,
  weekly_hours numeric(6,2),
  work_shift text,
  notes text,
  is_current boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rh_employee_contracts_employee_idx
  ON public.rh_employee_contracts(employee_id, is_current);

CREATE TABLE IF NOT EXISTS public.rh_employee_dependents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.rh_employees(id) ON DELETE RESTRICT,
  full_name text NOT NULL,
  cpf text,
  birth_date date,
  relationship text,
  is_ir_dependent boolean NOT NULL DEFAULT false,
  is_health_dependent boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rh_employee_dependents_employee_idx
  ON public.rh_employee_dependents(employee_id, is_active);

CREATE TABLE IF NOT EXISTS public.rh_employee_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.rh_employees(id) ON DELETE RESTRICT,
  document_type text NOT NULL,
  file_name text,
  storage_path text,
  document_number text,
  issued_at date,
  expires_at date,
  status text NOT NULL DEFAULT 'ativo',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rh_employee_documents_employee_idx
  ON public.rh_employee_documents(employee_id, document_type);

CREATE INDEX IF NOT EXISTS rh_employee_documents_expiry_idx
  ON public.rh_employee_documents(expires_at)
  WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.rh_work_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  monday_start time, monday_end time,
  tuesday_start time, tuesday_end time,
  wednesday_start time, wednesday_end time,
  thursday_start time, thursday_end time,
  friday_start time, friday_end time,
  saturday_start time, saturday_end time,
  sunday_start time, sunday_end time,
  break_minutes integer NOT NULL DEFAULT 0,
  tolerance_minutes integer NOT NULL DEFAULT 5,
  weekly_hours numeric(6,2),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rh_employee_schedule_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.rh_employees(id) ON DELETE RESTRICT,
  schedule_id uuid NOT NULL REFERENCES public.rh_work_schedules(id) ON DELETE RESTRICT,
  starts_on date NOT NULL,
  ends_on date,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rh_employee_schedule_employee_idx
  ON public.rh_employee_schedule_assignments(employee_id, starts_on DESC);

CREATE TABLE IF NOT EXISTS public.rh_employee_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.rh_employees(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  event_date date NOT NULL DEFAULT current_date,
  status text NOT NULL DEFAULT 'registrado',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rh_employee_events_employee_idx
  ON public.rh_employee_events(employee_id, event_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS rh_employee_events_type_idx
  ON public.rh_employee_events(event_type, status);

-- Auditoria transversal do RH/DP.
CREATE TABLE IF NOT EXISTS public.rh_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES public.rh_employees(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rh_audit_log_employee_idx
  ON public.rh_audit_log(employee_id, created_at DESC);

CREATE INDEX IF NOT EXISTS rh_audit_log_entity_idx
  ON public.rh_audit_log(entity_type, entity_id, created_at DESC);

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'rh_departments',
    'rh_positions',
    'rh_employee_contracts',
    'rh_employee_dependents',
    'rh_employee_documents',
    'rh_work_schedules',
    'rh_employee_schedule_assignments',
    'rh_employee_events',
    'rh_audit_log'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', tbl);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', tbl);
  END LOOP;
END $$;

COMMENT ON TABLE public.rh_employees IS
  'Cadastro canônico de funcionários do DBS AIR. Demais módulos devem referenciar employee_id e não criar outro funcionário.';

COMMENT ON TABLE public.rh_employee_events IS
  'Linha de eventos funcionais do colaborador; usada como base para admissões, alterações, férias, afastamentos e desligamentos.';

COMMENT ON TABLE public.rh_audit_log IS
  'Auditoria transversal do RH/DP. Alterações relevantes devem registrar ator, estado anterior e estado posterior.';

NOTIFY pgrst, 'reload schema';
