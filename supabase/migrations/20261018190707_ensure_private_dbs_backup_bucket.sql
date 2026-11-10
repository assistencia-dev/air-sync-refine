-- Ensure the automated backup destination exists and is private.
begin;
insert into storage.buckets (id, name, public)
values ('db-backups', 'db-backups', false)
on conflict (id) do update set public = false;
commit;
