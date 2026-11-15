create table if not exists public.rh_employees (
  id uuid primary key default gen_random_uuid(),
  benefit_type text not null check (benefit_type in ('passagem', 'alimentacao')),
  full_name text not null,
  unit text not null,
  fare_cents integer not null check (fare_cents > 0),
  trips_per_day integer not null default 1 check (trips_per_day between 1 and 12),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rh_employees_type_active_name_idx on public.rh_employees (benefit_type, is_active, full_name);

create table if not exists public.rh_topups (
  id uuid primary key default gen_random_uuid(),
  benefit_type text not null check (benefit_type in ('passagem', 'alimentacao')),
  employee_id uuid not null references public.rh_employees(id),
  amount_cents integer not null check (amount_cents > 0),
  paid_at date not null,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

create index if not exists rh_topups_type_paid_idx on public.rh_topups (benefit_type, paid_at desc);
alter table public.rh_employees enable row level security;
alter table public.rh_topups enable row level security;

create or replace function public.rh_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists rh_employees_updated_at on public.rh_employees;
create trigger rh_employees_updated_at before update on public.rh_employees for each row execute function public.rh_set_updated_at();

create policy rh_employees_no_direct_access on public.rh_employees for all to authenticated using (false) with check (false);
create policy rh_topups_no_direct_access on public.rh_topups for all to authenticated using (false) with check (false);
