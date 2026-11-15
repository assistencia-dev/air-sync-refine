
-- 1) Function: is current user active
CREATE OR REPLACE FUNCTION public.usuario_esta_ativo()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT COALESCE(status,'ativo') = 'ativo' FROM public.users WHERE auth_id = auth.uid() LIMIT 1 $$;

-- 2) users: allow SUPER_ADMIN to update status (RLS already enabled)
DROP POLICY IF EXISTS super_admin_manages_users ON public.users;
CREATE POLICY super_admin_manages_users ON public.users
  FOR UPDATE TO authenticated
  USING (public.current_role_key() = 'SUPER_ADMIN')
  WITH CHECK (public.current_role_key() = 'SUPER_ADMIN');

GRANT UPDATE ON public.users TO authenticated;

-- 3) tickets policies: require active user
DROP POLICY IF EXISTS tickets_own_select ON public.tickets;
CREATE POLICY tickets_own_select ON public.tickets
  FOR SELECT TO authenticated
  USING (
    public.usuario_esta_ativo()
    AND (
      created_by_user_id = public.current_app_user_id()
      OR (public.current_is_unit_manager() AND unit_id = public.current_unit_id())
    )
  );

DROP POLICY IF EXISTS tickets_own_insert ON public.tickets;
CREATE POLICY tickets_own_insert ON public.tickets
  FOR INSERT TO authenticated
  WITH CHECK (
    public.usuario_esta_ativo()
    AND created_by_user_id = public.current_app_user_id()
  );

-- 4) audit_log
CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES public.users(id),
  action text NOT NULL,
  target_user_id uuid REFERENCES public.users(id),
  metadata_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_log_admin_read ON public.audit_log;
CREATE POLICY audit_log_admin_read ON public.audit_log
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS audit_log_admin_insert ON public.audit_log;
CREATE POLICY audit_log_admin_insert ON public.audit_log
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());

-- 5) ticket_timeline
CREATE TABLE IF NOT EXISTS public.ticket_timeline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  author_user_id uuid REFERENCES public.users(id),
  role_label text,
  note_text text,
  status_change text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.ticket_timeline TO authenticated;
GRANT ALL ON public.ticket_timeline TO service_role;
ALTER TABLE public.ticket_timeline ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS timeline_select ON public.ticket_timeline;
CREATE POLICY timeline_select ON public.ticket_timeline
  FOR SELECT TO authenticated
  USING (
    public.usuario_esta_ativo()
    AND (
      public.is_admin()
      OR ticket_id IN (
        SELECT id FROM public.tickets
        WHERE created_by_user_id = public.current_app_user_id()
           OR (public.current_is_unit_manager() AND unit_id = public.current_unit_id())
      )
    )
  );

DROP POLICY IF EXISTS timeline_insert ON public.ticket_timeline;
CREATE POLICY timeline_insert ON public.ticket_timeline
  FOR INSERT TO authenticated
  WITH CHECK (
    public.usuario_esta_ativo()
    AND author_user_id = public.current_app_user_id()
    AND (
      public.is_admin()
      OR ticket_id IN (
        SELECT id FROM public.tickets WHERE created_by_user_id = public.current_app_user_id()
      )
    )
  );
