-- Cover foreign keys introduced by purchase settlement.
create index if not exists dbs_control_purchase_payments_created_by_fk_idx
  on public.dbs_control_purchase_payments(created_by);
create index if not exists dbs_control_purchase_payments_ledger_entry_fk_idx
  on public.dbs_control_purchase_payments(ledger_entry_id);
