begin;

-- The operational reader pages by UUID. These partial indexes keep the
-- cursor path ordered without scanning cancelled/logically deleted OS.
create index if not exists idx_hardening_work_orders_active_id
  on public.dbs_control_work_orders (id)
  where deleted_at is null;

create index if not exists idx_hardening_work_orders_assignee_id
  on public.dbs_control_work_orders (assigned_employee_id, id)
  where deleted_at is null;

analyze public.dbs_control_work_orders;

commit;
