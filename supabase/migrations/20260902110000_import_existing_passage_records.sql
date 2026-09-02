-- Importação não destrutiva dos registros atualmente existentes no Vale Passagem.
-- Não remove nem atualiza registros existentes; usa chaves estáveis de origem.

alter table public.rh_employees
  add column if not exists source_system text,
  add column if not exists source_key text;

create unique index if not exists rh_employees_source_key_uq
  on public.rh_employees (source_system, source_key)
  where source_key is not null;

insert into public.rh_employees (
  id, benefit_type, full_name, unit, fare_cents, trips_per_day,
  is_active, source_system, source_key
)
select
  '2e8900f1-1e5d-4fbd-87ab-000000000001'::uuid,
  'passagem', 'JORGE', 'IBEMEC', 940, 2,
  true, 'vale_passagem', 'employee:jorge:ibemec'
where not exists (
  select 1 from public.rh_employees
  where source_system = 'vale_passagem'
    and source_key = 'employee:jorge:ibemec'
);

insert into public.rh_employees (
  id, benefit_type, full_name, unit, fare_cents, trips_per_day,
  is_active, source_system, source_key
)
select
  '2e8900f1-1e5d-4fbd-87ab-000000000002'::uuid,
  'passagem', 'VITOR', 'IBMEC', 940, 2,
  true, 'vale_passagem', 'employee:vitor:ibmec'
where not exists (
  select 1 from public.rh_employees
  where source_system = 'vale_passagem'
    and source_key = 'employee:vitor:ibmec'
);

insert into public.rh_topups (
  id, benefit_type, employee_id, amount_cents, paid_at
)
select
  '3f4c2d11-9cb6-4cc5-a001-000000000001'::uuid,
  'passagem', e.id, 18800, date '2026-08-31'
from public.rh_employees e
where e.source_system = 'vale_passagem'
  and e.source_key = 'employee:jorge:ibemec'
  and not exists (
    select 1 from public.rh_topups t
    where t.id = '3f4c2d11-9cb6-4cc5-a001-000000000001'::uuid
  );

insert into public.rh_topups (
  id, benefit_type, employee_id, amount_cents, paid_at
)
select
  '3f4c2d11-9cb6-4cc5-a001-000000000002'::uuid,
  'passagem', e.id, 18800, date '2026-08-24'
from public.rh_employees e
where e.source_system = 'vale_passagem'
  and e.source_key = 'employee:vitor:ibmec'
  and not exists (
    select 1 from public.rh_topups t
    where t.id = '3f4c2d11-9cb6-4cc5-a001-000000000002'::uuid
  );
