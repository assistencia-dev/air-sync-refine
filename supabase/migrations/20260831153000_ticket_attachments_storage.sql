-- Anexos de chamados: somente aditivo; não altera nem remove dados existentes.
ALTER TABLE public.ticket_attachments
  ADD COLUMN IF NOT EXISTS file_name text,
  ADD COLUMN IF NOT EXISTS file_size bigint,
  ADD COLUMN IF NOT EXISTS storage_path text,
  ADD COLUMN IF NOT EXISTS uploaded_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL;

UPDATE public.ticket_attachments
SET storage_path = file_url,
    file_name = COALESCE(file_name, 'anexo')
WHERE storage_path IS NULL;

INSERT INTO storage.buckets (id, name, public)
VALUES ('ticket-attachments', 'ticket-attachments', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY ticket_attachment_objects_select ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'ticket-attachments'
  AND (
    public.is_admin()
    OR (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.tickets
      WHERE created_by_user_id = public.current_app_user_id()
    )
  )
);

CREATE POLICY ticket_attachment_objects_insert ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'ticket-attachments'
  AND (
    public.is_admin()
    OR (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.tickets
      WHERE created_by_user_id = public.current_app_user_id()
    )
  )
);

CREATE POLICY ticket_attachment_objects_delete ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'ticket-attachments'
  AND public.is_admin()
);

CREATE INDEX IF NOT EXISTS ticket_attachments_ticket_idx ON public.ticket_attachments(ticket_id);
CREATE INDEX IF NOT EXISTS ticket_attachments_storage_path_idx ON public.ticket_attachments(storage_path);
