-- DBS TREASURY: persistência server-side com migração não destrutiva.
-- A tabela guarda o estado legado completo em JSONB para permitir migração incremental
-- sem quebrar a estrutura funcional atual do V10.
CREATE TABLE IF NOT EXISTS public.treasury_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_key text NOT NULL UNIQUE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  state jsonb NOT NULL,
  state_version integer NOT NULL DEFAULT 5,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS treasury_snapshots_company_idx
  ON public.treasury_snapshots(company_id);

GRANT SELECT, INSERT, UPDATE ON public.treasury_snapshots TO authenticated;
GRANT ALL ON public.treasury_snapshots TO service_role;

ALTER TABLE public.treasury_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS treasury_super_admin_select ON public.treasury_snapshots;
CREATE POLICY treasury_super_admin_select
  ON public.treasury_snapshots FOR SELECT TO authenticated
  USING (public.current_role_key() = 'SUPER_ADMIN');

DROP POLICY IF EXISTS treasury_super_admin_insert ON public.treasury_snapshots;
CREATE POLICY treasury_super_admin_insert
  ON public.treasury_snapshots FOR INSERT TO authenticated
  WITH CHECK (public.current_role_key() = 'SUPER_ADMIN');

DROP POLICY IF EXISTS treasury_super_admin_update ON public.treasury_snapshots;
CREATE POLICY treasury_super_admin_update
  ON public.treasury_snapshots FOR UPDATE TO authenticated
  USING (public.current_role_key() = 'SUPER_ADMIN')
  WITH CHECK (public.current_role_key() = 'SUPER_ADMIN');

CREATE OR REPLACE FUNCTION public.set_treasury_snapshot_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS treasury_snapshots_updated_at ON public.treasury_snapshots;
CREATE TRIGGER treasury_snapshots_updated_at
BEFORE UPDATE ON public.treasury_snapshots
FOR EACH ROW EXECUTE FUNCTION public.set_treasury_snapshot_updated_at();
