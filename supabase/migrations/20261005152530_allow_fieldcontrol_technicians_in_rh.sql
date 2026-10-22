alter table public.rh_employees
  drop constraint if exists rh_employees_benefit_type_check;

alter table public.rh_employees
  add constraint rh_employees_benefit_type_check
  check (benefit_type = any (array['passagem'::text,'alimentacao'::text,'fieldcontrol'::text]));

alter table public.rh_employees
  drop constraint if exists rh_employees_fare_cents_check;

alter table public.rh_employees
  add constraint rh_employees_fare_cents_check
  check (fare_cents > 0 or benefit_type = 'fieldcontrol');

create unique index if not exists uq_rh_employees_source_system_key
  on public.rh_employees(source_system, source_key)
  where source_system is not null and source_key is not null;

select pg_notify('pgrst','reload schema');
