-- Índice aditivo para o FK usado na hidratação e conciliação de compras.
create index if not exists dbs_control_purchase_items_purchase_idx
  on public.dbs_control_purchase_items(purchase_id, line_no);

analyze public.dbs_control_purchase_items;
