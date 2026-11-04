-- ===== 20260724115342 =====
CREATE OR REPLACE FUNCTION public.usuario_esta_ativo()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT COALESCE(status,'ativo') = 'ativo' FROM public.users WHERE auth_id = auth.uid() LIMIT 1 $$;

DROP POLICY IF EXISTS super_admin_manages_users ON public.users;
CREATE POLICY super_admin_manages_users ON public.users
  FOR UPDATE TO authenticated
  USING (public.current_role_key() = 'SUPER_ADMIN')
  WITH CHECK (public.current_role_key() = 'SUPER_ADMIN');

GRANT UPDATE ON public.users TO authenticated;

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
      OR ticket_id IN (SELECT id FROM public.tickets WHERE created_by_user_id = public.current_app_user_id())
    )
  );

-- ===== 20260831120000 =====
ALTER TABLE public.tickets REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'tickets'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tickets;
  END IF;
EXCEPTION WHEN undefined_object THEN
  NULL;
END $$;

-- ===== 20260901120000 =====
create policy ticket_files_staff_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'ticket-files'
  and public.is_admin()
  and (storage.foldername(name))[1] in (select id::text from public.tickets)
);

create policy ticket_files_authorized_select
on storage.objects for select to authenticated
using (
  bucket_id = 'ticket-files'
  and (
    public.is_admin()
    or exists (
      select 1 from public.tickets t
      where t.id::text = (storage.foldername(name))[1]
        and (
          t.created_by_user_id = public.current_app_user_id()
          or (public.current_is_unit_manager() and t.unit_id = public.current_unit_id())
        )
    )
  )
);

create policy ticket_files_staff_delete
on storage.objects for delete to authenticated
using (bucket_id = 'ticket-files' and public.is_admin());

-- ===== 20260901123000 =====
alter table public.rh_employees
  add column if not exists registration_data jsonb not null default '{}'::jsonb,
  add column if not exists ficha_file_name text,
  add column if not exists ficha_storage_path text;

create policy rh_files_native_select
on storage.objects for select to authenticated
using (bucket_id = 'rh-files' and public.is_admin());

create policy rh_files_native_insert
on storage.objects for insert to authenticated
with check (bucket_id = 'rh-files' and public.is_admin());

create policy rh_files_native_delete
on storage.objects for delete to authenticated
using (bucket_id = 'rh-files' and public.is_admin());

-- ===== 20260929074800 =====
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

CREATE INDEX IF NOT EXISTS treasury_snapshots_company_idx ON public.treasury_snapshots(company_id);

GRANT SELECT, INSERT, UPDATE ON public.treasury_snapshots TO authenticated;
GRANT ALL ON public.treasury_snapshots TO service_role;

ALTER TABLE public.treasury_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS treasury_super_admin_select ON public.treasury_snapshots;
CREATE POLICY treasury_super_admin_select ON public.treasury_snapshots FOR SELECT TO authenticated
  USING (public.current_role_key() = 'SUPER_ADMIN');

DROP POLICY IF EXISTS treasury_super_admin_insert ON public.treasury_snapshots;
CREATE POLICY treasury_super_admin_insert ON public.treasury_snapshots FOR INSERT TO authenticated
  WITH CHECK (public.current_role_key() = 'SUPER_ADMIN');

DROP POLICY IF EXISTS treasury_super_admin_update ON public.treasury_snapshots;
CREATE POLICY treasury_super_admin_update ON public.treasury_snapshots FOR UPDATE TO authenticated
  USING (public.current_role_key() = 'SUPER_ADMIN')
  WITH CHECK (public.current_role_key() = 'SUPER_ADMIN');

CREATE OR REPLACE FUNCTION public.set_treasury_snapshot_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS treasury_snapshots_updated_at ON public.treasury_snapshots;
CREATE TRIGGER treasury_snapshots_updated_at
BEFORE UPDATE ON public.treasury_snapshots
FOR EACH ROW EXECUTE FUNCTION public.set_treasury_snapshot_updated_at();

-- ===== 20260929120000 =====
ALTER TABLE public.rh_employees
  ADD COLUMN IF NOT EXISTS ponto_access_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ponto_portal_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ponto_base_lat numeric,
  ADD COLUMN IF NOT EXISTS ponto_base_lng numeric,
  ADD COLUMN IF NOT EXISTS ponto_raio_m integer NOT NULL DEFAULT 150,
  ADD COLUMN IF NOT EXISTS ponto_entrada_prevista time,
  ADD COLUMN IF NOT EXISTS ponto_saida_prevista time,
  ADD COLUMN IF NOT EXISTS ponto_almoco_inicio_previsto time,
  ADD COLUMN IF NOT EXISTS ponto_almoco_fim_previsto time;

CREATE INDEX IF NOT EXISTS idx_rh_employees_ponto_portal_user
  ON public.rh_employees (ponto_portal_user_id)
  WHERE ponto_portal_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.rh_employee_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL UNIQUE REFERENCES public.rh_employees(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  access_enabled boolean NOT NULL DEFAULT true,
  login_identifier text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rh_employee_access_user_idx ON public.rh_employee_access(user_id);
CREATE INDEX IF NOT EXISTS rh_employee_access_enabled_idx ON public.rh_employee_access(access_enabled);

ALTER TABLE public.rh_employee_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rh_employee_access_no_direct_access ON public.rh_employee_access;
CREATE POLICY rh_employee_access_no_direct_access ON public.rh_employee_access
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

GRANT SELECT, INSERT, UPDATE ON public.rh_employee_access TO authenticated;
GRANT ALL ON public.rh_employee_access TO service_role;

DROP TRIGGER IF EXISTS rh_employee_access_updated_at ON public.rh_employee_access;
CREATE TRIGGER rh_employee_access_updated_at
  BEFORE UPDATE ON public.rh_employee_access
  FOR EACH ROW EXECUTE FUNCTION public.rh_set_updated_at();

INSERT INTO public.rh_employee_access (employee_id, user_id, access_enabled, login_identifier)
SELECT e.id, e.ponto_portal_user_id, e.ponto_access_enabled,
       COALESCE(u.username, u.email, u.cpf)
FROM public.rh_employees e
JOIN public.users u ON u.id = e.ponto_portal_user_id
WHERE e.ponto_portal_user_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.rh_employee_access a WHERE a.employee_id = e.id);