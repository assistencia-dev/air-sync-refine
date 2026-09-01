insert into storage.buckets (id, name, public)
values ('ticket-files', 'ticket-files', false)
on conflict (id) do update set public = false;

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
      select 1
      from public.tickets t
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
