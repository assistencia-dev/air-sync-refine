begin;
revoke all on function public.dbs_control_archive_snapshot_revision() from public, anon, authenticated;
grant execute on function public.dbs_control_archive_snapshot_revision() to service_role;
commit;
