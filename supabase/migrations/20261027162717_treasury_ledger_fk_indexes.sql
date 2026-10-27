begin;

-- New relational Treasury FKs must be indexed for deletes/updates on parent
-- rows and for the ledger/outbox joins. This is additive and data-preserving.
create index if not exists treasury_accounts_company_fk_idx
  on public.treasury_accounts(company_id);
create index if not exists treasury_accounts_created_by_fk_idx
  on public.treasury_accounts(created_by);
create index if not exists treasury_entries_company_fk_idx
  on public.treasury_ledger_entries(company_id);
create index if not exists treasury_entries_created_by_fk_idx
  on public.treasury_ledger_entries(created_by);
create index if not exists treasury_entries_posted_by_fk_idx
  on public.treasury_ledger_entries(posted_by);
create index if not exists treasury_entries_reversed_entry_fk_idx
  on public.treasury_ledger_entries(reversed_entry_id);
create index if not exists treasury_lines_account_fk_idx
  on public.treasury_ledger_lines(account_id);
create index if not exists treasury_outbox_company_fk_idx
  on public.treasury_ledger_outbox(company_id);
create index if not exists treasury_outbox_entry_fk_idx
  on public.treasury_ledger_outbox(entry_id);

analyze public.treasury_accounts;
analyze public.treasury_ledger_entries;
analyze public.treasury_ledger_lines;
analyze public.treasury_ledger_outbox;

commit;
