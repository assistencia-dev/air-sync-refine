-- DBS Control / Treasury: enforce the server bridge as the only write path.
-- This migration is additive and changes privileges only; it never deletes or
-- rewrites operational data.

begin;

-- Ledger commands are accepted by post_treasury_ledger_entry through the
-- authenticated server bridge. Do not expose table-level writes to browser
-- roles, even when an RLS policy is accidentally broadened in the future.
revoke all privileges on table
  public.treasury_accounts,
  public.treasury_ledger_entries,
  public.treasury_ledger_lines,
  public.treasury_ledger_outbox
from anon, authenticated;

grant all privileges on table
  public.treasury_accounts,
  public.treasury_ledger_entries,
  public.treasury_ledger_lines,
  public.treasury_ledger_outbox
to service_role;

-- Legacy snapshots remain available for administrative read/reconciliation,
-- but cannot become a second write source of truth from the browser.
revoke all privileges on table public.treasury_snapshots from anon;
revoke insert, update, delete, truncate, references, trigger
on table public.treasury_snapshots from authenticated;
grant select on table public.treasury_snapshots to authenticated;
grant all privileges on table public.treasury_snapshots to service_role;

revoke all privileges on table public.dbs_control_snapshots from anon;
revoke insert, update, delete, truncate, references, trigger
on table public.dbs_control_snapshots from authenticated;
grant select on table public.dbs_control_snapshots to authenticated;
grant all privileges on table public.dbs_control_snapshots to service_role;

comment on table public.treasury_snapshots is
  'Legacy read-only compatibility cache. New financial writes use the relational ledger bridge.';

comment on table public.dbs_control_snapshots is
  'Legacy read-only compatibility cache. New DBS Control writes use relational deltas and outbox events.';

commit;
