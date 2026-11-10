-- Índices das chaves estrangeiras usadas pelo caminho de sincronização e pela
-- auditoria de OS. Complementa índices compostos sem alterar dados existentes.
begin;

create index if not exists idx_dbs_control_outbox_aggregate_id
  on public.dbs_control_outbox(aggregate_id);
create index if not exists idx_dbs_control_sync_commands_aggregate_id
  on public.dbs_control_sync_commands(aggregate_id);
create index if not exists idx_dbs_control_work_orders_created_by
  on public.dbs_control_work_orders(created_by_user_id);
create index if not exists idx_dbs_control_work_orders_service
  on public.dbs_control_work_orders(service_id);
create index if not exists idx_dbs_control_work_order_events_actor
  on public.dbs_control_work_order_events(actor_user_id);
create index if not exists idx_dbs_control_work_order_parts_part
  on public.dbs_control_work_order_parts(part_id);
create index if not exists idx_dbs_control_work_order_services_service
  on public.dbs_control_work_order_services(service_id);
create index if not exists idx_dbs_control_work_order_attachments_work_order
  on public.dbs_control_work_order_attachments(work_order_id);
create index if not exists idx_dbs_control_work_order_attachments_uploader
  on public.dbs_control_work_order_attachments(uploaded_by_user_id);
create index if not exists idx_dbs_control_snapshots_company
  on public.dbs_control_snapshots(company_id);
create index if not exists idx_dbs_control_snapshots_owner
  on public.dbs_control_snapshots(owner_user_id);
create index if not exists idx_dbs_control_snapshots_updated_by
  on public.dbs_control_snapshots(updated_by);

commit;
