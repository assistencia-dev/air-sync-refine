-- DBS CONTROL: keep the authoritative sync cursor keyset indexed even for
-- soft-deleted rows. The cursor endpoint must observe deletions as changes,
-- so the existing partial active-row index cannot satisfy this order.

begin;

create index if not exists dbs_control_work_orders_updated_at_id_idx
  on public.dbs_control_work_orders (updated_at desc nulls last, id desc);

analyze public.dbs_control_work_orders;
notify pgrst, 'reload schema';

commit;
