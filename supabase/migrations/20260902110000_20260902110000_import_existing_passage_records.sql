-- Importação não destrutiva dos registros atualmente existentes no Vale Passagem.
-- Não remove nem atualiza registros existentes; usa chaves estáveis de origem.

alter table public.rh_employees
  add column if not exists source_system text,
  add column if not exists source_key text;

create unique index if not exists rh_employees_source_key_uq
  on public.rh_employees (source_system, source_key)
  where source_key is not null;
