-- Índices aditivos para as FKs do circuito de estoque/Financeiro.
-- Não remove nem reordena índices existentes; reduz custo de UPDATE/DELETE
-- concorrentes e mantém as consultas de auditoria index-only quando possível.

begin;

create index if not exists dbs_control_purchases_company_fk_idx
  on public.dbs_control_purchases(company_id);
create index if not exists dbs_control_purchases_ledger_entry_fk_idx
  on public.dbs_control_purchases(ledger_entry_id);
create index if not exists dbs_control_purchases_created_by_fk_idx
  on public.dbs_control_purchases(created_by);
create index if not exists dbs_control_purchases_received_by_fk_idx
  on public.dbs_control_purchases(received_by);

create index if not exists dbs_control_inventory_movements_company_fk_idx
  on public.dbs_control_inventory_movements(company_id);
create index if not exists dbs_control_inventory_movements_created_by_fk_idx
  on public.dbs_control_inventory_movements(created_by);
create index if not exists dbs_control_inventory_movements_part_fk_idx
  on public.dbs_control_inventory_movements(part_id);
create index if not exists dbs_control_inventory_movements_purchase_item_fk_idx
  on public.dbs_control_inventory_movements(purchase_item_id);
create index if not exists dbs_control_inventory_movements_work_order_part_fk_idx
  on public.dbs_control_inventory_movements(work_order_part_id);

create index if not exists dbs_control_work_order_financials_company_fk_idx
  on public.dbs_control_work_order_financials(company_id);
create index if not exists dbs_control_work_order_financials_revenue_entry_fk_idx
  on public.dbs_control_work_order_financials(revenue_entry_id);
create index if not exists dbs_control_work_order_financials_reversal_entry_fk_idx
  on public.dbs_control_work_order_financials(revenue_reversal_entry_id);

analyze public.dbs_control_purchases;
analyze public.dbs_control_purchase_items;
analyze public.dbs_control_inventory_movements;
analyze public.dbs_control_work_order_financials;

commit;
