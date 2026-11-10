-- Higienização aditiva: mantém apenas os índices equivalentes já existentes e
-- explicita a política service_role do manifesto. Nenhum dado é removido.
begin;

drop index if exists public.dbs_control_base_clients_client_idx;
drop index if exists public.dbs_control_work_order_equipment_equipment_idx;
drop index if exists public.dbs_control_work_order_parts_part_idx;
drop index if exists public.dbs_control_work_order_services_service_idx;

alter table public.dbs_control_backup_manifests enable row level security;
drop policy if exists dbs_control_backup_manifests_service_only on public.dbs_control_backup_manifests;
create policy dbs_control_backup_manifests_service_only
  on public.dbs_control_backup_manifests for all to service_role
  using (true) with check (true);

commit;

