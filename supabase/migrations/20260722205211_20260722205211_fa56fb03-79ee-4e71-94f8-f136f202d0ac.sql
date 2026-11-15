
-- Enum de papéis
CREATE TYPE public.role_key AS ENUM ('SUPER_ADMIN','ADMIN_OPERACIONAL','GESTOR_CONTA','GESTOR_REGIONAL','CLIENTE_PF');

-- Empresas / Redes
CREATE TABLE public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name text NOT NULL,
  trade_name text,
  cnpj_matriz text UNIQUE,
  account_type text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.companies TO authenticated;
GRANT ALL ON public.companies TO service_role;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

-- Unidades / Filiais
CREATE TABLE public.units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  cnpj text,
  address_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.units TO authenticated;
GRANT ALL ON public.units TO service_role;
ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;

-- Usuários da aplicação (auth.users é gerenciado; profile fica aqui)
CREATE TABLE public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id uuid UNIQUE NOT NULL,
  username text UNIQUE,
  full_name text,
  email text UNIQUE,
  cpf text,
  role_key public.role_key NOT NULL DEFAULT 'CLIENTE_PF',
  unit_id uuid REFERENCES public.units(id) ON DELETE SET NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  is_unit_manager boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'ativo',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.users TO authenticated;
GRANT ALL ON public.users TO service_role;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE INDEX users_auth_id_idx ON public.users(auth_id);
CREATE INDEX users_username_lower_idx ON public.users(lower(username));
CREATE INDEX users_email_lower_idx ON public.users(lower(email));
CREATE INDEX users_cpf_idx ON public.users(cpf);
CREATE INDEX users_unit_idx ON public.users(unit_id);

-- Ativos / equipamentos
CREATE TABLE public.assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid REFERENCES public.units(id) ON DELETE CASCADE,
  tag_code text,
  asset_type text,
  brand_model text,
  btu_capacity integer,
  status text NOT NULL DEFAULT 'ativo',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assets TO authenticated;
GRANT ALL ON public.assets TO service_role;
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;

-- Sequência para protocolo
CREATE SEQUENCE public.ticket_protocol_seq START 1000;

-- Chamados
CREATE TABLE public.tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_number text UNIQUE NOT NULL DEFAULT ('DBS-' || to_char(now(),'YYYY') || '-' || lpad(nextval('public.ticket_protocol_seq')::text, 5, '0')),
  unit_id uuid REFERENCES public.units(id) ON DELETE SET NULL,
  asset_id uuid REFERENCES public.assets(id) ON DELETE SET NULL,
  occurrence_type text NOT NULL,
  description text NOT NULL,
  priority text NOT NULL DEFAULT 'normal',
  status text NOT NULL DEFAULT 'aberto',
  sla_deadline timestamptz,
  created_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  assigned_technician_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tickets TO authenticated;
GRANT ALL ON public.tickets TO service_role;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
CREATE INDEX tickets_created_by_idx ON public.tickets(created_by_user_id);
CREATE INDEX tickets_unit_idx ON public.tickets(unit_id);
CREATE INDEX tickets_status_idx ON public.tickets(status);

-- Anexos
CREATE TABLE public.ticket_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  file_url text NOT NULL,
  file_type text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ticket_attachments TO authenticated;
GRANT ALL ON public.ticket_attachments TO service_role;
ALTER TABLE public.ticket_attachments ENABLE ROW LEVEL SECURITY;

-- Helper: obtém o id/registro do public.users para o auth.uid() corrente
CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT id FROM public.users WHERE auth_id = auth.uid() LIMIT 1 $$;

CREATE OR REPLACE FUNCTION public.current_role_key()
RETURNS public.role_key
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT role_key FROM public.users WHERE auth_id = auth.uid() LIMIT 1 $$;

CREATE OR REPLACE FUNCTION public.current_unit_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT unit_id FROM public.users WHERE auth_id = auth.uid() LIMIT 1 $$;

CREATE OR REPLACE FUNCTION public.current_is_unit_manager()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT COALESCE(is_unit_manager,false) FROM public.users WHERE auth_id = auth.uid() LIMIT 1 $$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.current_role_key() IN ('SUPER_ADMIN','ADMIN_OPERACIONAL') $$;

-- POLICIES ---------------------------------------------------------------

-- users: cada usuário lê seu próprio registro; admins leem todos
CREATE POLICY users_self_select ON public.users FOR SELECT TO authenticated
  USING (auth_id = auth.uid() OR public.is_admin());

-- companies
CREATE POLICY companies_admin_all ON public.companies FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY companies_member_read ON public.companies FOR SELECT TO authenticated
  USING (id = (SELECT company_id FROM public.users WHERE auth_id = auth.uid() LIMIT 1));

-- units
CREATE POLICY units_admin_all ON public.units FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY units_member_read ON public.units FOR SELECT TO authenticated
  USING (id = public.current_unit_id() OR company_id = (SELECT company_id FROM public.users WHERE auth_id = auth.uid() LIMIT 1));

-- assets
CREATE POLICY assets_admin_all ON public.assets FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY assets_member_read ON public.assets FOR SELECT TO authenticated
  USING (unit_id = public.current_unit_id());

-- tickets
CREATE POLICY tickets_admin_all ON public.tickets FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY tickets_own_select ON public.tickets FOR SELECT TO authenticated
  USING (
    created_by_user_id = public.current_app_user_id()
    OR (public.current_is_unit_manager() AND unit_id = public.current_unit_id())
  );

CREATE POLICY tickets_own_insert ON public.tickets FOR INSERT TO authenticated
  WITH CHECK (created_by_user_id = public.current_app_user_id());

-- ticket_attachments
CREATE POLICY attachments_admin_all ON public.ticket_attachments FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY attachments_owner_select ON public.ticket_attachments FOR SELECT TO authenticated
  USING (ticket_id IN (SELECT id FROM public.tickets WHERE created_by_user_id = public.current_app_user_id()));

CREATE POLICY attachments_owner_insert ON public.ticket_attachments FOR INSERT TO authenticated
  WITH CHECK (ticket_id IN (SELECT id FROM public.tickets WHERE created_by_user_id = public.current_app_user_id()));
