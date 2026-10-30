-- Remove the residual MAINTAIN privilege from browser roles on legacy caches.
-- The caches remain readable for administrative reconciliation; all writes and
-- maintenance operations stay behind the service-role bridge.

begin;

revoke maintain on table
  public.treasury_snapshots,
  public.dbs_control_snapshots
from anon, authenticated;

grant select on table
  public.treasury_snapshots,
  public.dbs_control_snapshots
to authenticated;

grant all privileges on table
  public.treasury_snapshots,
  public.dbs_control_snapshots
to service_role;

commit;
