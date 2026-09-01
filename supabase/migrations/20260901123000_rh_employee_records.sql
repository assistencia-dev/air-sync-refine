alter table public.rh_employees
  add column if not exists registration_data jsonb not null default '{}'::jsonb,
  add column if not exists ficha_file_name text,
  add column if not exists ficha_storage_path text;

insert into storage.buckets (id, name, public)
values ('rh-files', 'rh-files', false)
on conflict (id) do update set public = false;

create policy rh_files_native_select
on storage.objects for select to authenticated
using (bucket_id = 'rh-files' and public.is_admin());

create policy rh_files_native_insert
on storage.objects for insert to authenticated
with check (bucket_id = 'rh-files' and public.is_admin());

create policy rh_files_native_delete
on storage.objects for delete to authenticated
using (bucket_id = 'rh-files' and public.is_admin());
