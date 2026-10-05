-- Integração FieldControl para o DBS CONTROL.
-- ADITIVA: não remove nem altera os dados operacionais existentes.

CREATE TABLE IF NOT EXISTS public.dbs_control_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'fieldcontrol' CHECK (provider = 'fieldcontrol'),
  api_key text NOT NULL,
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','inativo')),
  last_test_at timestamptz,
  last_sync_at timestamptz,
  last_sync_status text,
  last_sync_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, provider)
);

CREATE TABLE IF NOT EXISTS public.dbs_control_external_refs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'fieldcontrol',
  entity_type text NOT NULL,
  external_id text NOT NULL,
  local_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, provider, entity_type, external_id)
);

CREATE TABLE IF NOT EXISTS public.dbs_control_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'fieldcontrol',
  mode text NOT NULL CHECK (mode IN ('preview','apply')),
  status text NOT NULL CHECK (status IN ('running','success','partial','error')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_dbs_control_external_refs_local ON public.dbs_control_external_refs(local_id);
CREATE INDEX IF NOT EXISTS idx_dbs_control_sync_runs_company ON public.dbs_control_sync_runs(company_id, started_at DESC);

ALTER TABLE public.dbs_control_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dbs_control_external_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dbs_control_sync_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dbs_control_integrations_admin_all ON public.dbs_control_integrations;
CREATE POLICY dbs_control_integrations_admin_all ON public.dbs_control_integrations FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS dbs_control_external_refs_admin_all ON public.dbs_control_external_refs;
CREATE POLICY dbs_control_external_refs_admin_all ON public.dbs_control_external_refs FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS dbs_control_sync_runs_admin_all ON public.dbs_control_sync_runs;
CREATE POLICY dbs_control_sync_runs_admin_all ON public.dbs_control_sync_runs FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

REVOKE ALL ON public.dbs_control_integrations FROM anon;
REVOKE ALL ON public.dbs_control_external_refs FROM anon;
REVOKE ALL ON public.dbs_control_sync_runs FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dbs_control_integrations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dbs_control_external_refs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dbs_control_sync_runs TO authenticated;
GRANT ALL ON public.dbs_control_integrations TO service_role;
GRANT ALL ON public.dbs_control_external_refs TO service_role;
GRANT ALL ON public.dbs_control_sync_runs TO service_role;