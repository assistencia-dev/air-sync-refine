-- DBS AIR · RH · vínculo entre solicitação de vale e lançamento financeiro
-- Aditivo e idempotente: não remove dados.
alter table if exists public.rh_employee_advances
  add column if not exists source_request_id uuid references public.rh_employee_requests(id) on delete set null;
create unique index if not exists rh_employee_advances_source_request_uq
  on public.rh_employee_advances(source_request_id)
  where source_request_id is not null;
notify pgrst, 'reload schema';
