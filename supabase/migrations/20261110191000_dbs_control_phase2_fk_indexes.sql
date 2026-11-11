-- Cover foreign keys flagged by the Supabase performance advisor.
-- Additive only: creates FK indexes transactionally; no application rows are rewritten.
begin;

create index if not exists dbs_control_reservation_batches_company_fk_idx
  on public.dbs_control_reservation_batches(company_id);
create index if not exists dbs_control_reservation_batches_created_by_fk_idx
  on public.dbs_control_reservation_batches(created_by);
create index if not exists dbs_control_reservation_batches_work_order_fk_idx
  on public.dbs_control_reservation_batches(work_order_id);

create index if not exists dbs_control_reservation_consumptions_created_by_fk_idx
  on public.dbs_control_reservation_consumptions(created_by);
create index if not exists dbs_control_reservation_consumptions_ledger_entry_fk_idx
  on public.dbs_control_reservation_consumptions(ledger_entry_id);

create index if not exists dbs_control_sale_settlements_ledger_entry_fk_idx
  on public.dbs_control_sale_settlements(ledger_entry_id);
create index if not exists dbs_control_sale_settlements_received_by_fk_idx
  on public.dbs_control_sale_settlements(received_by);

create index if not exists dbs_control_sales_client_fk_idx
  on public.dbs_control_sales(client_id);
create index if not exists dbs_control_sales_cogs_entry_fk_idx
  on public.dbs_control_sales(cogs_entry_id);
create index if not exists dbs_control_sales_company_fk_idx
  on public.dbs_control_sales(company_id);
create index if not exists dbs_control_sales_created_by_fk_idx
  on public.dbs_control_sales(created_by);
create index if not exists dbs_control_sales_revenue_entry_fk_idx
  on public.dbs_control_sales(revenue_entry_id);

create index if not exists dbs_control_work_order_reservations_batch_fk_idx
  on public.dbs_control_work_order_reservations(batch_id);
create index if not exists dbs_control_work_order_reservations_company_fk_idx
  on public.dbs_control_work_order_reservations(company_id);
create index if not exists dbs_control_work_order_reservations_created_by_fk_idx
  on public.dbs_control_work_order_reservations(created_by);
create index if not exists dbs_control_work_order_reservations_part_fk_idx
  on public.dbs_control_work_order_reservations(part_id);

commit;
