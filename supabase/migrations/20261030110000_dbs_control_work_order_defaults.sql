-- Additive guard for relational OS creation.
--
-- jsonb_populate_record() materializes omitted fields as NULL instead of
-- applying a column default.  The canonical work-order table requires
-- execution_checklist to be non-null, so a new OS issued by a collaborator
-- could reach the transactional RPC and then fail with a raw 23502 error.
-- This trigger keeps the existing schema and rows intact, fills the required
-- value for inserts, and never erases an existing checklist on updates.

begin;

create or replace function public.dbs_control_work_order_defaults()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.execution_checklist is null then
    new.execution_checklist := case
      when tg_op = 'UPDATE' then old.execution_checklist
      else '{}'::jsonb
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_dbs_control_work_order_defaults
  on public.dbs_control_work_orders;
create trigger trg_dbs_control_work_order_defaults
before insert or update on public.dbs_control_work_orders
for each row execute function public.dbs_control_work_order_defaults();

revoke all on function public.dbs_control_work_order_defaults() from public, anon, authenticated;
grant execute on function public.dbs_control_work_order_defaults() to service_role;

commit;
