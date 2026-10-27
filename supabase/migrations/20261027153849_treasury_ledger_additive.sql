begin;

create table if not exists public.treasury_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete restrict,
  scope_key text not null,
  code text not null,
  name text not null,
  account_type text not null
    check (account_type in ('asset','liability','equity','revenue','expense')),
  currency_code text not null default 'BRL'
    check (char_length(currency_code) = 3),
  is_active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scope_key, code)
);

create table if not exists public.treasury_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete restrict,
  scope_key text not null,
  competence_date date not null,
  document_date date,
  entry_type text not null default 'manual',
  status text not null default 'draft'
    check (status in ('draft','posted','void','reversed')),
  description text not null,
  source_module text not null default 'treasury',
  external_key text,
  idempotency_key text not null
    check (char_length(trim(idempotency_key)) between 8 and 200),
  reversed_entry_id uuid references public.treasury_ledger_entries(id) on delete restrict,
  created_by uuid references public.users(id) on delete set null,
  posted_by uuid references public.users(id) on delete set null,
  posted_at timestamptz,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scope_key, idempotency_key)
);

create unique index if not exists treasury_ledger_external_key_uq
  on public.treasury_ledger_entries(scope_key, external_key)
  where external_key is not null;

create table if not exists public.treasury_ledger_lines (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null
    references public.treasury_ledger_entries(id) on delete restrict,
  account_id uuid not null
    references public.treasury_accounts(id) on delete restrict,
  line_no integer not null,
  debit_cents bigint not null default 0 check (debit_cents >= 0),
  credit_cents bigint not null default 0 check (credit_cents >= 0),
  memo text,
  metadata jsonb not null default '{}'::jsonb,
  unique (entry_id, line_no),
  check ((debit_cents = 0) <> (credit_cents = 0))
);

create table if not exists public.treasury_ledger_outbox (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete restrict,
  scope_key text not null,
  entry_id uuid not null
    references public.treasury_ledger_entries(id) on delete restrict,
  event_type text not null,
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending','processing','published','failed','dead_letter')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  published_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (scope_key, idempotency_key)
);

create index if not exists treasury_accounts_scope_idx on public.treasury_accounts(scope_key, is_active);
create index if not exists treasury_entries_scope_date_idx on public.treasury_ledger_entries(scope_key, competence_date desc);
create index if not exists treasury_entries_status_idx on public.treasury_ledger_entries(scope_key, status, competence_date desc);
create index if not exists treasury_lines_entry_idx on public.treasury_ledger_lines(entry_id);
create index if not exists treasury_outbox_pending_idx on public.treasury_ledger_outbox(status, available_at, created_at);

create or replace function public.treasury_ledger_set_updated_at()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at = now();
  if tg_table_name = 'treasury_ledger_entries' then new.version = old.version + 1; end if;
  return new;
end; $$;

create or replace function public.treasury_assert_entry_balanced()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare total_debit bigint; total_credit bigint;
begin
  if new.status not in ('posted', 'reversed') then return new; end if;
  select coalesce(sum(debit_cents), 0), coalesce(sum(credit_cents), 0)
  into total_debit, total_credit from public.treasury_ledger_lines where entry_id = new.id;
  if total_debit = 0 or total_debit <> total_credit then
    raise exception 'TREASURY_ENTRY_NOT_BALANCED: entry %', new.id;
  end if;
  return new;
end; $$;

create or replace function public.treasury_block_posted_line_mutation()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare target_entry uuid;
begin
  target_entry := case when tg_op = 'DELETE' then old.entry_id else new.entry_id end;
  if exists (select 1 from public.treasury_ledger_entries where id = target_entry and status in ('posted', 'reversed')) then
    raise exception 'TREASURY_ENTRY_IMMUTABLE: entry %', target_entry;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end; $$;

create or replace function public.treasury_enqueue_posted_entry()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.status = 'posted' then
    insert into public.treasury_ledger_outbox (company_id, scope_key, entry_id, event_type, idempotency_key, payload)
    values (new.company_id, new.scope_key, new.id, 'treasury.ledger.posted', 'treasury-ledger:' || new.id::text, jsonb_build_object('entry_id', new.id, 'scope_key', new.scope_key, 'version', new.version))
    on conflict (scope_key, idempotency_key) do nothing;
  end if;
  return new;
end; $$;

drop trigger if exists treasury_accounts_updated_at on public.treasury_accounts;
create trigger treasury_accounts_updated_at before update on public.treasury_accounts for each row execute function public.treasury_ledger_set_updated_at();

drop trigger if exists treasury_entries_updated_at on public.treasury_ledger_entries;
create trigger treasury_entries_updated_at before update on public.treasury_ledger_entries for each row execute function public.treasury_ledger_set_updated_at();

drop trigger if exists treasury_entry_balance_check on public.treasury_ledger_entries;
create constraint trigger treasury_entry_balance_check after insert or update on public.treasury_ledger_entries deferrable initially deferred for each row execute function public.treasury_assert_entry_balanced();

drop trigger if exists treasury_posted_line_guard on public.treasury_ledger_lines;
create trigger treasury_posted_line_guard before insert or update or delete on public.treasury_ledger_lines for each row execute function public.treasury_block_posted_line_mutation();

drop trigger if exists treasury_posted_outbox on public.treasury_ledger_entries;
create trigger treasury_posted_outbox after insert or update of status on public.treasury_ledger_entries for each row when (new.status = 'posted') execute function public.treasury_enqueue_posted_entry();

alter table public.treasury_accounts enable row level security;
alter table public.treasury_ledger_entries enable row level security;
alter table public.treasury_ledger_lines enable row level security;
alter table public.treasury_ledger_outbox enable row level security;

grant select, insert, update, delete on public.treasury_accounts, public.treasury_ledger_entries, public.treasury_ledger_lines to authenticated;
grant select on public.treasury_ledger_outbox to authenticated;
grant all on public.treasury_accounts, public.treasury_ledger_entries, public.treasury_ledger_lines, public.treasury_ledger_outbox to service_role;

drop policy if exists treasury_accounts_select on public.treasury_accounts;
create policy treasury_accounts_select on public.treasury_accounts for select to authenticated using (public.current_role_key() = 'SUPER_ADMIN');
drop policy if exists treasury_accounts_insert on public.treasury_accounts;
create policy treasury_accounts_insert on public.treasury_accounts for insert to authenticated with check (public.current_role_key() = 'SUPER_ADMIN');
drop policy if exists treasury_accounts_update on public.treasury_accounts;
create policy treasury_accounts_update on public.treasury_accounts for update to authenticated using (public.current_role_key() = 'SUPER_ADMIN') with check (public.current_role_key() = 'SUPER_ADMIN');
drop policy if exists treasury_accounts_delete on public.treasury_accounts;
create policy treasury_accounts_delete on public.treasury_accounts for delete to authenticated using (public.current_role_key() = 'SUPER_ADMIN');

drop policy if exists treasury_entries_select on public.treasury_ledger_entries;
create policy treasury_entries_select on public.treasury_ledger_entries for select to authenticated using (public.current_role_key() = 'SUPER_ADMIN');
drop policy if exists treasury_entries_insert on public.treasury_ledger_entries;
create policy treasury_entries_insert on public.treasury_ledger_entries for insert to authenticated with check (public.current_role_key() = 'SUPER_ADMIN');
drop policy if exists treasury_entries_update on public.treasury_ledger_entries;
create policy treasury_entries_update on public.treasury_ledger_entries for update to authenticated using (public.current_role_key() = 'SUPER_ADMIN') with check (public.current_role_key() = 'SUPER_ADMIN');
drop policy if exists treasury_entries_delete on public.treasury_ledger_entries;
create policy treasury_entries_delete on public.treasury_ledger_entries for delete to authenticated using (public.current_role_key() = 'SUPER_ADMIN');

drop policy if exists treasury_lines_select on public.treasury_ledger_lines;
create policy treasury_lines_select on public.treasury_ledger_lines for select to authenticated using (public.current_role_key() = 'SUPER_ADMIN');
drop policy if exists treasury_lines_insert on public.treasury_ledger_lines;
create policy treasury_lines_insert on public.treasury_ledger_lines for insert to authenticated with check (public.current_role_key() = 'SUPER_ADMIN');
drop policy if exists treasury_lines_update on public.treasury_ledger_lines;
create policy treasury_lines_update on public.treasury_ledger_lines for update to authenticated using (public.current_role_key() = 'SUPER_ADMIN') with check (public.current_role_key() = 'SUPER_ADMIN');
drop policy if exists treasury_lines_delete on public.treasury_ledger_lines;
create policy treasury_lines_delete on public.treasury_ledger_lines for delete to authenticated using (public.current_role_key() = 'SUPER_ADMIN');

drop policy if exists treasury_outbox_select on public.treasury_ledger_outbox;
create policy treasury_outbox_select on public.treasury_ledger_outbox for select to authenticated using (public.current_role_key() = 'SUPER_ADMIN');

revoke all on function public.treasury_ledger_set_updated_at() from public;
revoke all on function public.treasury_assert_entry_balanced() from public;
revoke all on function public.treasury_block_posted_line_mutation() from public;
revoke all on function public.treasury_enqueue_posted_entry() from public;

grant execute on function public.treasury_ledger_set_updated_at() to service_role;
grant execute on function public.treasury_assert_entry_balanced() to service_role;
grant execute on function public.treasury_block_posted_line_mutation() to service_role;
grant execute on function public.treasury_enqueue_posted_entry() to service_role;

notify pgrst, 'reload schema';

commit;
