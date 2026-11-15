-- DBS CONTROL: núcleo persistente do módulo de ordens de serviço.
-- Migração ADITIVA: não apaga, altera ou migra registros existentes.
-- O HTML/protótipo continua sem dados fictícios; estas tabelas começam vazias.

CREATE TABLE IF NOT EXISTS public.dbs_control_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name text NOT NULL,
  trade_name text,
  cnpj text,
  logo_storage_path text,
  phone text,
  email text,
  notes text,
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','inativo')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dbs_control_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.dbs_control_clients(id) ON DELETE RESTRICT,
  name text NOT NULL,
  address_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  contact_name text,
  contact_phone text,
  contact_email text,
  notes text,
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','inativo')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dbs_control_equipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.dbs_control_clients(id) ON DELETE RESTRICT,
  site_id uuid REFERENCES public.dbs_control_sites(id) ON DELETE RESTRICT,
  tag_code text,
  equipment_type text,
  brand text,
  model text,
  serial_number text,
  capacity text,
  environment text,
  installation_date date,
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','inativo','baixado')),
  technical_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dbs_control_service_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  estimated_hours numeric(8,2),
  table_value_cents integer,
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','inativo')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dbs_control_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text UNIQUE,
  name text NOT NULL,
  description text,
  stock_quantity numeric(12,3) NOT NULL DEFAULT 0,
  cost_cents integer,
  sale_cents integer,
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','inativo')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dbs_control_work_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol text UNIQUE NOT NULL,
  client_id uuid NOT NULL REFERENCES public.dbs_control_clients(id) ON DELETE RESTRICT,
  site_id uuid REFERENCES public.dbs_control_sites(id) ON DELETE RESTRICT,
  assigned_employee_id uuid REFERENCES public.rh_employees(id) ON DELETE RESTRICT,
  created_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  service_id uuid REFERENCES public.dbs_control_service_catalog(id) ON DELETE SET NULL,
  type text NOT NULL DEFAULT 'corretiva',
  priority text NOT NULL DEFAULT 'normal',
  status text NOT NULL DEFAULT 'aberta',
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  sla_deadline timestamptz,
  description text,
  technical_opinion text,
  observation text,
  latitude numeric,
  longitude numeric,
  signature_name text,
  signature_data text,
  total_cents integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dbs_control_work_order_equipment (
  work_order_id uuid NOT NULL REFERENCES public.dbs_control_work_orders(id) ON DELETE CASCADE,
  equipment_id uuid NOT NULL REFERENCES public.dbs_control_equipment(id) ON DELETE RESTRICT,
  PRIMARY KEY (work_order_id, equipment_id)
);

CREATE TABLE IF NOT EXISTS public.dbs_control_work_order_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL REFERENCES public.dbs_control_work_orders(id) ON DELETE CASCADE,
  part_id uuid NOT NULL REFERENCES public.dbs_control_parts(id) ON DELETE RESTRICT,
  quantity numeric(12,3) NOT NULL CHECK (quantity > 0),
  unit_cents integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dbs_control_work_order_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL REFERENCES public.dbs_control_work_orders(id) ON DELETE CASCADE,
  service_id uuid REFERENCES public.dbs_control_service_catalog(id) ON DELETE RESTRICT,
  description text,
  quantity numeric(12,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_cents integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dbs_control_work_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL REFERENCES public.dbs_control_work_orders(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  old_status text,
  new_status text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dbs_control_work_order_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL REFERENCES public.dbs_control_work_orders(id) ON DELETE CASCADE,
  uploaded_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  file_type text,
  attachment_type text NOT NULL DEFAULT 'evidencia',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dbs_clients_status ON public.dbs_control_clients(status);
CREATE INDEX IF NOT EXISTS idx_dbs_sites_client ON public.dbs_control_sites(client_id);
CREATE INDEX IF NOT EXISTS idx_dbs_equipment_client ON public.dbs_control_equipment(client_id);
CREATE INDEX IF NOT EXISTS idx_dbs_equipment_site ON public.dbs_control_equipment(site_id);
CREATE INDEX IF NOT EXISTS idx_dbs_equipment_tag ON public.dbs_control_equipment(tag_code);
CREATE INDEX IF NOT EXISTS idx_dbs_os_client ON public.dbs_control_work_orders(client_id);
CREATE INDEX IF NOT EXISTS idx_dbs_os_site ON public.dbs_control_work_orders(site_id);
CREATE INDEX IF NOT EXISTS idx_dbs_os_employee ON public.dbs_control_work_orders(assigned_employee_id);
CREATE INDEX IF NOT EXISTS idx_dbs_os_status ON public.dbs_control_work_orders(status);
CREATE INDEX IF NOT EXISTS idx_dbs_os_priority ON public.dbs_control_work_orders(priority);
CREATE INDEX IF NOT EXISTS idx_dbs_os_sla ON public.dbs_control_work_orders(sla_deadline);
CREATE INDEX IF NOT EXISTS idx_dbs_os_created_at ON public.dbs_control_work_orders(created_at);
CREATE INDEX IF NOT EXISTS idx_dbs_os_equipment_equipment ON public.dbs_control_work_order_equipment(equipment_id);
CREATE INDEX IF NOT EXISTS idx_dbs_os_events_os ON public.dbs_control_work_order_events(work_order_id);

-- RLS: tabelas expostas permanecem protegidas.
ALTER TABLE public.dbs_control_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dbs_control_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dbs_control_equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dbs_control_service_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dbs_control_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dbs_control_work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dbs_control_work_order_equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dbs_control_work_order_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dbs_control_work_order_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dbs_control_work_order_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dbs_control_work_order_attachments ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dbs_control_clients TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dbs_control_sites TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dbs_control_equipment TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dbs_control_service_catalog TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dbs_control_parts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dbs_control_work_orders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dbs_control_work_order_equipment TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dbs_control_work_order_parts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dbs_control_work_order_services TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dbs_control_work_order_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dbs_control_work_order_attachments TO authenticated;

GRANT ALL ON public.dbs_control_clients TO service_role;
GRANT ALL ON public.dbs_control_sites TO service_role;
GRANT ALL ON public.dbs_control_equipment TO service_role;
GRANT ALL ON public.dbs_control_service_catalog TO service_role;
GRANT ALL ON public.dbs_control_parts TO service_role;
GRANT ALL ON public.dbs_control_work_orders TO service_role;
GRANT ALL ON public.dbs_control_work_order_equipment TO service_role;
GRANT ALL ON public.dbs_control_work_order_parts TO service_role;
GRANT ALL ON public.dbs_control_work_order_services TO service_role;
GRANT ALL ON public.dbs_control_work_order_events TO service_role;
GRANT ALL ON public.dbs_control_work_order_attachments TO service_role;

-- Administradores têm gestão completa.
CREATE POLICY dbs_clients_admin_all ON public.dbs_control_clients FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY dbs_sites_admin_all ON public.dbs_control_sites FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY dbs_equipment_admin_all ON public.dbs_control_equipment FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY dbs_services_admin_all ON public.dbs_control_service_catalog FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY dbs_parts_admin_all ON public.dbs_control_parts FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY dbs_os_admin_all ON public.dbs_control_work_orders FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY dbs_os_equipment_admin_all ON public.dbs_control_work_order_equipment FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY dbs_os_parts_admin_all ON public.dbs_control_work_order_parts FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY dbs_os_services_admin_all ON public.dbs_control_work_order_services FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY dbs_os_events_admin_all ON public.dbs_control_work_order_events FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY dbs_os_attachments_admin_all ON public.dbs_control_work_order_attachments FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Colaborador: só enxerga OS atribuída a ele e seus equipamentos vinculados.
CREATE POLICY dbs_os_employee_select ON public.dbs_control_work_orders FOR SELECT TO authenticated
  USING (
    assigned_employee_id IN (
      SELECT id FROM public.rh_employees
      WHERE ponto_portal_user_id = public.current_app_user_id()
        AND ponto_access_enabled = true
        AND dbs_control_access_enabled = true
        AND is_active = true
    )
  );

CREATE POLICY dbs_os_employee_update ON public.dbs_control_work_orders FOR UPDATE TO authenticated
  USING (
    assigned_employee_id IN (
      SELECT id FROM public.rh_employees
      WHERE ponto_portal_user_id = public.current_app_user_id()
        AND ponto_access_enabled = true
        AND dbs_control_access_enabled = true
        AND is_active = true
    )
  )
  WITH CHECK (
    assigned_employee_id IN (
      SELECT id FROM public.rh_employees
      WHERE ponto_portal_user_id = public.current_app_user_id()
        AND ponto_access_enabled = true
        AND dbs_control_access_enabled = true
        AND is_active = true
    )
  );

CREATE POLICY dbs_os_employee_equipment_select ON public.dbs_control_work_order_equipment FOR SELECT TO authenticated
  USING (
    work_order_id IN (
      SELECT id FROM public.dbs_control_work_orders
      WHERE assigned_employee_id IN (
        SELECT id FROM public.rh_employees
        WHERE ponto_portal_user_id = public.current_app_user_id()
          AND ponto_access_enabled = true
          AND dbs_control_access_enabled = true
          AND is_active = true
      )
    )
  );

CREATE POLICY dbs_os_employee_attachments_select ON public.dbs_control_work_order_attachments FOR SELECT TO authenticated
  USING (
    work_order_id IN (
      SELECT id FROM public.dbs_control_work_orders
      WHERE assigned_employee_id IN (
        SELECT id FROM public.rh_employees
        WHERE ponto_portal_user_id = public.current_app_user_id()
          AND ponto_access_enabled = true
          AND dbs_control_access_enabled = true
          AND is_active = true
      )
    )
  );

CREATE POLICY dbs_os_employee_events_select ON public.dbs_control_work_order_events FOR SELECT TO authenticated
  USING (
    work_order_id IN (
      SELECT id FROM public.dbs_control_work_orders
      WHERE assigned_employee_id IN (
        SELECT id FROM public.rh_employees
        WHERE ponto_portal_user_id = public.current_app_user_id()
          AND ponto_access_enabled = true
          AND dbs_control_access_enabled = true
          AND is_active = true
      )
    )
  );

-- Nenhuma linha é inserida por esta migração: o CONTROL começa vazio.
