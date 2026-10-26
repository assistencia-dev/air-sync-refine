-- Índices das relações mais acessadas na hidratação e políticas explícitas
-- para as tabelas internas. Aditivo: nenhum registro é removido.
begin;

create index if not exists dbs_control_work_order_equipment_order_idx
  on public.dbs_control_work_order_equipment(work_order_id);
create index if not exists dbs_control_work_order_equipment_equipment_idx
  on public.dbs_control_work_order_equipment(equipment_id);
create index if not exists dbs_control_work_order_parts_order_idx
  on public.dbs_control_work_order_parts(work_order_id);
create index if not exists dbs_control_work_order_parts_part_idx
  on public.dbs_control_work_order_parts(part_id);
create index if not exists dbs_control_work_order_services_order_idx
  on public.dbs_control_work_order_services(work_order_id);
create index if not exists dbs_control_work_order_services_service_idx
  on public.dbs_control_work_order_services(service_id);
create index if not exists dbs_control_work_order_events_order_idx
  on public.dbs_control_work_order_events(work_order_id, created_at desc);
create index if not exists dbs_control_base_clients_base_idx
  on public.dbs_control_base_clients(base_id, client_id);
create index if not exists dbs_control_base_clients_client_idx
  on public.dbs_control_base_clients(client_id, base_id);
create index if not exists rh_time_adjustments_employee_date_status_idx
  on public.rh_time_adjustments(employee_id, reference_date desc, status);

alter table public.dbs_control_snapshot_history enable row level security;
drop policy if exists dbs_control_snapshot_history_service_only on public.dbs_control_snapshot_history;
create policy dbs_control_snapshot_history_service_only
  on public.dbs_control_snapshot_history for all to service_role
  using (true) with check (true);

alter table public.dbs_control_sync_metrics enable row level security;
drop policy if exists dbs_control_sync_metrics_service_only on public.dbs_control_sync_metrics;
create policy dbs_control_sync_metrics_service_only
  on public.dbs_control_sync_metrics for all to service_role
  using (true) with check (true);

commit;

