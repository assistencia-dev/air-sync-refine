ALTER TABLE public.ticket_attachments
  ADD COLUMN IF NOT EXISTS file_name text,
  ADD COLUMN IF NOT EXISTS file_size integer,
  ADD COLUMN IF NOT EXISTS storage_path text,
  ADD COLUMN IF NOT EXISTS uploaded_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS uploader_role text;

GRANT SELECT, INSERT ON public.ticket_attachments TO authenticated;
GRANT ALL ON public.ticket_attachments TO service_role;

DROP POLICY IF EXISTS attachments_owner_select ON public.ticket_attachments;
CREATE POLICY attachments_owner_select ON public.ticket_attachments
  FOR SELECT TO authenticated
  USING (
    public.usuario_esta_ativo() AND ticket_id IN (
      SELECT t.id FROM public.tickets t
      WHERE t.created_by_user_id = public.current_app_user_id()
         OR (public.current_is_unit_manager() AND t.unit_id = public.current_unit_id())
    )
  );

DROP POLICY IF EXISTS attachments_owner_insert ON public.ticket_attachments;
CREATE POLICY attachments_owner_insert ON public.ticket_attachments
  FOR INSERT TO authenticated
  WITH CHECK (
    public.usuario_esta_ativo() AND ticket_id IN (
      SELECT t.id FROM public.tickets t
      WHERE t.created_by_user_id = public.current_app_user_id()
    )
  );