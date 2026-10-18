-- DBS CONTROL: wrapper alias to maintain compatibility with v2 RPC name
-- This function delegates to the existing dbs_control_save_snapshot_safe implementation
create or replace function public.dbs_control_save_snapshot_safe_v2(p_payload jsonb)
returns table(state jsonb, state_version integer, updated_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select * from public.dbs_control_save_snapshot_safe(p_payload);
$$;

revoke all on function public.dbs_control_save_snapshot_safe_v2(jsonb) from public, anon, authenticated;
grant execute on function public.dbs_control_save_snapshot_safe_v2(jsonb) to service_role;

comment on function public.dbs_control_save_snapshot_safe_v2(jsonb) is
  'Compatibility wrapper: delegates to dbs_control_save_snapshot_safe to support clients calling the _v2 RPC name.';
