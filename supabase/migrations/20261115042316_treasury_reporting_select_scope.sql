-- Grant read-only access to Ledger reporting tables, scoped by the authenticated Treasury owner.
-- SUPER_ADMIN reads its own company scope; FINANCEIRO_LEITURA reads only its enabled linked owner scope.

create or replace function private.dbs_my_treasury_scope_keys()
returns setof text
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select case
    when u.company_id is not null then 'company:' || u.company_id::text
    else 'user:' || u.id::text
  end
  from public.users u
  where u.id = public.current_app_user_id()
    and u.status = 'ativo'
    and u.role_key = 'SUPER_ADMIN'::public.role_key

  union

  select case
    when owner.company_id is not null then 'company:' || owner.company_id::text
    else 'user:' || owner.id::text
  end
  from public.users viewer
  join public.treasury_viewer_access access
    on access.viewer_user_id = viewer.id
   and access.enabled = true
  join public.users owner
    on owner.id = access.owner_user_id
   and owner.status = 'ativo'
  where viewer.id = public.current_app_user_id()
    and viewer.status = 'ativo'
    and viewer.role_key = 'FINANCEIRO_LEITURA'::public.role_key;
$function$;

revoke all on function private.dbs_my_treasury_scope_keys() from public, anon;
grant execute on function private.dbs_my_treasury_scope_keys() to authenticated;

grant select on public.treasury_ledger_entries to authenticated;
grant select on public.treasury_ledger_lines to authenticated;
grant select on public.treasury_accounts to authenticated;

drop policy if exists treasury_entries_select on public.treasury_ledger_entries;
create policy treasury_entries_select on public.treasury_ledger_entries
for select to authenticated
using (
  scope_key in (select private.dbs_my_treasury_scope_keys())
);

drop policy if exists treasury_lines_select on public.treasury_ledger_lines;
create policy treasury_lines_select on public.treasury_ledger_lines
for select to authenticated
using (
  exists (
    select 1
    from public.treasury_ledger_entries e
    where e.id = entry_id
      and e.scope_key in (select private.dbs_my_treasury_scope_keys())
  )
);

drop policy if exists treasury_accounts_select on public.treasury_accounts;
create policy treasury_accounts_select on public.treasury_accounts
for select to authenticated
using (
  scope_key in (select private.dbs_my_treasury_scope_keys())
);
