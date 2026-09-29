-- Centraliza a identidade do funcionário sem apagar os registros legados.
-- Cada pessoa passa a ter um registro canônico; VT/VA continuam como configurações vinculadas.
alter table if exists public.rh_employees
  add column if not exists registry_employee_id uuid,
  add column if not exists benefit_configured boolean not null default true;

-- Primeiro cada registro aponta para si mesmo.
update public.rh_employees
set registry_employee_id = id
where registry_employee_id is null;

-- Consolida duplicidades antigas pelo mesmo nome/unidade, preservando o registro
-- com mais dados cadastrais como registro canônico.
with ranked as (
  select
    id,
    first_value(id) over (
      partition by lower(trim(full_name)), lower(trim(unit))
      order by
        (
          select count(*)
          from jsonb_object_keys(
            case
              when jsonb_typeof(coalesce(registration_data, '{}'::json)::jsonb) = 'object'
                then coalesce(registration_data, '{}'::json)::jsonb
              else '{}'::jsonb
            end
          )
        ) desc,
        created_at asc,
        id asc
    ) as canonical_id
  from public.rh_employees
)
update public.rh_employees e
set registry_employee_id = r.canonical_id
from ranked r
where e.id = r.id;

-- Registros criados pelo antigo cadastro central usavam R$ 0,01 como placeholder.
-- Eles continuam preservados, mas não aparecem como benefício configurado até o RH definir o valor real.
update public.rh_employees
set benefit_configured = false
where benefit_type = 'alimentacao'
  and fare_cents = 1
  and trips_per_day = 1
  and coalesce(registration_data::jsonb, '{}'::jsonb) <> '{}'::jsonb
  and registry_employee_id = id;

-- Move legacy point/login and ficha linkage to the canonical employee before the UI
-- stops exposing the duplicate benefit rows as employees.
with linked as (
  select
    registry_employee_id,
    max(case when coalesce(ponto_access_enabled, false) then 1 else 0 end) as has_access,
    max(ponto_portal_user_id::text)::uuid as portal_user_id,
    max(ficha_file_name) filter (where ficha_file_name is not null) as ficha_name,
    max(ficha_storage_path) filter (where ficha_storage_path is not null) as ficha_path
  from public.rh_employees
  where registry_employee_id is not null
  group by registry_employee_id
)
update public.rh_employees canonical
set
  ponto_access_enabled = case when linked.has_access = 1 then true else canonical.ponto_access_enabled end,
  ponto_portal_user_id = coalesce(linked.portal_user_id, canonical.ponto_portal_user_id),
  ficha_file_name = coalesce(canonical.ficha_file_name, linked.ficha_name),
  ficha_storage_path = coalesce(canonical.ficha_storage_path, linked.ficha_path)
from linked
where canonical.id = linked.registry_employee_id;

create index if not exists idx_rh_employees_registry_employee_id
  on public.rh_employees(registry_employee_id);

create index if not exists idx_rh_employees_benefit_lookup
  on public.rh_employees(registry_employee_id, benefit_type, is_active, benefit_configured);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'rh_employees_registry_employee_fk'
  ) then
    alter table public.rh_employees
      add constraint rh_employees_registry_employee_fk
      foreign key (registry_employee_id)
      references public.rh_employees(id)
      on delete restrict;
  end if;
end $$;

notify pgrst, 'reload schema';
