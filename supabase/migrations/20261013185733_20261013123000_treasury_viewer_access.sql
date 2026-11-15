-- Vínculo explícito entre a conta de acompanhamento e o proprietário do financeiro.
CREATE TABLE IF NOT EXISTS public.treasury_viewer_access (
  viewer_user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);
GRANT ALL ON public.treasury_viewer_access TO service_role;
ALTER TABLE public.treasury_viewer_access ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS treasury_viewer_access_no_direct_access ON public.treasury_viewer_access;
CREATE POLICY treasury_viewer_access_no_direct_access ON public.treasury_viewer_access
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
