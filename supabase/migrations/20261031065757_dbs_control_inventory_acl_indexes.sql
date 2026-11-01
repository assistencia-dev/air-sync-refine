-- DBS CONTROL: explicit ACL/RLS for the relational inventory bridge.
--
-- This migration is additive and intentionally keeps the bridge server-only.
-- The application reaches these tables through SECURITY DEFINER RPCs executed
-- by service_role; authenticated/anon clients must not read financial or stock
-- rows directly. Explicit service_role policies remove the RLS "enabled without
-- policy" ambiguity without widening access to collaborators.

begin;

create index if not exists dbs_control_inventory_commands_actor_user_id_idx
  on public.dbs_control_inventory_commands(actor_user_id)
  where actor_user_id is not null;

alter table public.dbs_control_inventory_commands enable row level security;
alter table public.dbs_control_inventory_movements enable row level security;
alter table public.dbs_control_purchase_items enable row level security;
alter table public.dbs_control_purchases enable row level security;
alter table public.dbs_control_work_order_financials enable row level security;

revoke all on public.dbs_control_inventory_commands from public, anon, authenticated;
revoke all on public.dbs_control_inventory_movements from public, anon, authenticated;
revoke all on public.dbs_control_purchase_items from public, anon, authenticated;
revoke all on public.dbs_control_purchases from public, anon, authenticated;
revoke all on public.dbs_control_work_order_financials from public, anon, authenticated;

grant select, insert, update, delete, references, trigger
  on public.dbs_control_inventory_commands to service_role;
grant select, insert, update, delete, references, trigger
  on public.dbs_control_inventory_movements to service_role;
grant select, insert, update, delete, references, trigger
  on public.dbs_control_purchase_items to service_role;
grant select, insert, update, delete, references, trigger
  on public.dbs_control_purchases to service_role;
grant select, insert, update, delete, references, trigger
  on public.dbs_control_work_order_financials to service_role;

drop policy if exists dbs_inventory_commands_service_select on public.dbs_control_inventory_commands;
drop policy if exists dbs_inventory_commands_service_insert on public.dbs_control_inventory_commands;
drop policy if exists dbs_inventory_commands_service_update on public.dbs_control_inventory_commands;
drop policy if exists dbs_inventory_commands_service_delete on public.dbs_control_inventory_commands;
create policy dbs_inventory_commands_service_select
  on public.dbs_control_inventory_commands for select to service_role using (true);
create policy dbs_inventory_commands_service_insert
  on public.dbs_control_inventory_commands for insert to service_role with check (true);
create policy dbs_inventory_commands_service_update
  on public.dbs_control_inventory_commands for update to service_role using (true) with check (true);
create policy dbs_inventory_commands_service_delete
  on public.dbs_control_inventory_commands for delete to service_role using (true);

drop policy if exists dbs_inventory_movements_service_select on public.dbs_control_inventory_movements;
drop policy if exists dbs_inventory_movements_service_insert on public.dbs_control_inventory_movements;
drop policy if exists dbs_inventory_movements_service_update on public.dbs_control_inventory_movements;
drop policy if exists dbs_inventory_movements_service_delete on public.dbs_control_inventory_movements;
create policy dbs_inventory_movements_service_select
  on public.dbs_control_inventory_movements for select to service_role using (true);
create policy dbs_inventory_movements_service_insert
  on public.dbs_control_inventory_movements for insert to service_role with check (true);
create policy dbs_inventory_movements_service_update
  on public.dbs_control_inventory_movements for update to service_role using (true) with check (true);
create policy dbs_inventory_movements_service_delete
  on public.dbs_control_inventory_movements for delete to service_role using (true);

drop policy if exists dbs_purchase_items_service_select on public.dbs_control_purchase_items;
drop policy if exists dbs_purchase_items_service_insert on public.dbs_control_purchase_items;
drop policy if exists dbs_purchase_items_service_update on public.dbs_control_purchase_items;
drop policy if exists dbs_purchase_items_service_delete on public.dbs_control_purchase_items;
create policy dbs_purchase_items_service_select
  on public.dbs_control_purchase_items for select to service_role using (true);
create policy dbs_purchase_items_service_insert
  on public.dbs_control_purchase_items for insert to service_role with check (true);
create policy dbs_purchase_items_service_update
  on public.dbs_control_purchase_items for update to service_role using (true) with check (true);
create policy dbs_purchase_items_service_delete
  on public.dbs_control_purchase_items for delete to service_role using (true);

drop policy if exists dbs_purchases_service_select on public.dbs_control_purchases;
drop policy if exists dbs_purchases_service_insert on public.dbs_control_purchases;
drop policy if exists dbs_purchases_service_update on public.dbs_control_purchases;
drop policy if exists dbs_purchases_service_delete on public.dbs_control_purchases;
create policy dbs_purchases_service_select
  on public.dbs_control_purchases for select to service_role using (true);
create policy dbs_purchases_service_insert
  on public.dbs_control_purchases for insert to service_role with check (true);
create policy dbs_purchases_service_update
  on public.dbs_control_purchases for update to service_role using (true) with check (true);
create policy dbs_purchases_service_delete
  on public.dbs_control_purchases for delete to service_role using (true);

drop policy if exists dbs_work_order_financials_service_select on public.dbs_control_work_order_financials;
drop policy if exists dbs_work_order_financials_service_insert on public.dbs_control_work_order_financials;
drop policy if exists dbs_work_order_financials_service_update on public.dbs_control_work_order_financials;
drop policy if exists dbs_work_order_financials_service_delete on public.dbs_control_work_order_financials;
create policy dbs_work_order_financials_service_select
  on public.dbs_control_work_order_financials for select to service_role using (true);
create policy dbs_work_order_financials_service_insert
  on public.dbs_control_work_order_financials for insert to service_role with check (true);
create policy dbs_work_order_financials_service_update
  on public.dbs_control_work_order_financials for update to service_role using (true) with check (true);
create policy dbs_work_order_financials_service_delete
  on public.dbs_control_work_order_financials for delete to service_role using (true);

analyze public.dbs_control_inventory_commands;
analyze public.dbs_control_inventory_movements;
analyze public.dbs_control_purchase_items;
analyze public.dbs_control_purchases;
analyze public.dbs_control_work_order_financials;

notify pgrst, 'reload schema';
commit;
