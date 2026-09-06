CREATE TABLE public.rh_benefit_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('passagem','alimentacao')),
  employee_id uuid REFERENCES public.rh_employees(id),
  employee_name text NOT NULL,
  cpf text,
  rg text,
  birth_date date,
  filial text,
  travel_mode text,
  origin text,
  destination text,
  depart_at timestamptz,
  return_at timestamptz,
  reason text,
  carrier text,
  pnr text,
  estimated_cents integer NOT NULL DEFAULT 0,
  paid_cents integer NOT NULL DEFAULT 0,
  over_budget_reason text,
  ref_month text,
  days integer,
  daily_cents integer,
  total_cents integer,
  meal_type text,
  status text NOT NULL DEFAULT 'PENDENTE',
  is_deleted boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.rh_benefit_requests TO service_role;
ALTER TABLE public.rh_benefit_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rh_requests_no_direct_access" ON public.rh_benefit_requests FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE TRIGGER rh_benefit_requests_updated_at BEFORE UPDATE ON public.rh_benefit_requests FOR EACH ROW EXECUTE FUNCTION public.rh_set_updated_at();

CREATE TABLE public.rh_request_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.rh_benefit_requests(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_type text,
  file_size integer,
  storage_path text NOT NULL,
  uploaded_by uuid REFERENCES public.users(id),
  is_deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.rh_request_attachments TO service_role;
ALTER TABLE public.rh_request_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rh_request_attachments_no_direct_access" ON public.rh_request_attachments FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE TABLE public.rh_request_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.rh_benefit_requests(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.users(id),
  action text NOT NULL,
  status_from text,
  status_to text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.rh_request_audit TO service_role;
ALTER TABLE public.rh_request_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rh_request_audit_no_direct_access" ON public.rh_request_audit FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE INDEX rh_benefit_requests_kind_status_idx ON public.rh_benefit_requests (kind, status) WHERE is_deleted = false;
CREATE INDEX rh_request_attachments_request_idx ON public.rh_request_attachments (request_id);
CREATE INDEX rh_request_audit_request_idx ON public.rh_request_audit (request_id);