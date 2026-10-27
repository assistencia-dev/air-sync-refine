begin;

-- The legacy snapshot remains available for read-only recovery/history. New
-- financial writes use this relational metadata and the transactional RPC.
alter table public.treasury_ledger_entries
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists treasury_entries_source_lookup_idx
  on public.treasury_ledger_entries(scope_key, source_module, status, competence_date desc);

create or replace function public.post_treasury_ledger_entry(
  p_scope_key text,
  p_company_id uuid,
  p_competence_date date,
  p_document_date date,
  p_entry_type text,
  p_description text,
  p_idempotency_key text,
  p_external_key text,
  p_created_by uuid,
  p_status text,
  p_metadata jsonb,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entry_id uuid;
  v_outbox_id uuid;
  v_existing_status text;
  v_line jsonb;
  v_account_id uuid;
  v_line_no integer := 0;
  v_total_debit bigint := 0;
  v_total_credit bigint := 0;
  v_debit bigint;
  v_credit bigint;
  v_account_code text;
  v_account_name text;
  v_account_type text;
  v_memo text;
  v_metadata jsonb;
begin
  if nullif(trim(p_scope_key), '') is null then
    raise exception 'TREASURY_SCOPE_REQUIRED';
  end if;
  if p_competence_date is null then
    raise exception 'TREASURY_COMPETENCE_DATE_REQUIRED';
  end if;
  if nullif(trim(p_description), '') is null then
    raise exception 'TREASURY_DESCRIPTION_REQUIRED';
  end if;
  if nullif(trim(p_idempotency_key), '') is null
     or char_length(trim(p_idempotency_key)) not between 8 and 200 then
    raise exception 'TREASURY_IDEMPOTENCY_KEY_INVALID';
  end if;
  if p_status not in ('draft', 'posted') then
    raise exception 'TREASURY_STATUS_INVALID';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception 'TREASURY_LINES_REQUIRED';
  end if;

  -- Serializes retries/concurrent submissions for the same business command.
  perform pg_advisory_xact_lock(hashtextextended(p_scope_key || ':' || p_idempotency_key, 0));

  select e.id, e.status
    into v_entry_id, v_existing_status
    from public.treasury_ledger_entries e
   where e.scope_key = p_scope_key
     and e.idempotency_key = p_idempotency_key;

  if v_entry_id is not null then
    select o.id into v_outbox_id
      from public.treasury_ledger_outbox o
     where o.entry_id = v_entry_id
     order by o.created_at desc
     limit 1;
    return jsonb_build_object(
      'entry_id', v_entry_id,
      'outbox_id', v_outbox_id,
      'status', v_existing_status,
      'idempotency_key', p_idempotency_key,
      'replayed', true
    );
  end if;

  -- Validate the entire double-entry payload before creating any row.
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_debit := coalesce(nullif(v_line->>'debit_cents', '')::bigint, 0);
    v_credit := coalesce(nullif(v_line->>'credit_cents', '')::bigint, 0);
    v_account_code := nullif(trim(v_line->>'account_code'), '');
    v_account_name := nullif(trim(v_line->>'account_name'), '');
    v_account_type := nullif(trim(v_line->>'account_type'), '');
    if v_account_code is null or v_account_name is null or v_account_type not in ('asset','liability','equity','revenue','expense') then
      raise exception 'TREASURY_ACCOUNT_PAYLOAD_INVALID';
    end if;
    if v_debit < 0 or v_credit < 0 or (v_debit = 0) = (v_credit = 0) then
      raise exception 'TREASURY_LINE_AMOUNT_INVALID';
    end if;
    v_total_debit := v_total_debit + v_debit;
    v_total_credit := v_total_credit + v_credit;
  end loop;
  if v_total_debit = 0 or v_total_debit <> v_total_credit then
    raise exception 'TREASURY_ENTRY_NOT_BALANCED';
  end if;

  insert into public.treasury_ledger_entries (
    company_id, scope_key, competence_date, document_date, entry_type,
    status, description, source_module, external_key, idempotency_key,
    created_by, posted_by, posted_at, metadata
  ) values (
    p_company_id, p_scope_key, p_competence_date, p_document_date,
    coalesce(nullif(trim(p_entry_type), ''), 'manual'),
    case when p_status = 'posted' then 'draft' else p_status end,
    trim(p_description), 'treasury', nullif(trim(p_external_key), ''),
    trim(p_idempotency_key), p_created_by,
    null,
    null,
    coalesce(p_metadata, '{}'::jsonb)
  ) returning id into v_entry_id;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_line_no := v_line_no + 1;
    v_debit := coalesce(nullif(v_line->>'debit_cents', '')::bigint, 0);
    v_credit := coalesce(nullif(v_line->>'credit_cents', '')::bigint, 0);
    v_account_code := trim(v_line->>'account_code');
    v_account_name := trim(v_line->>'account_name');
    v_account_type := trim(v_line->>'account_type');
    v_memo := nullif(v_line->>'memo', '');
    v_metadata := case when jsonb_typeof(v_line->'metadata') = 'object' then v_line->'metadata' else '{}'::jsonb end;

    insert into public.treasury_accounts (
      company_id, scope_key, code, name, account_type, created_by
    ) values (
      p_company_id, p_scope_key, v_account_code, v_account_name, v_account_type, p_created_by
    ) on conflict (scope_key, code) do update set updated_at = now()
    returning id into v_account_id;

    insert into public.treasury_ledger_lines (
      entry_id, account_id, line_no, debit_cents, credit_cents, memo, metadata
    ) values (
      v_entry_id, v_account_id, v_line_no, v_debit, v_credit, v_memo, v_metadata
    );
  end loop;

  if p_status = 'posted' then
    update public.treasury_ledger_entries
       set status = 'posted', posted_by = p_created_by, posted_at = now()
     where id = v_entry_id;
  end if;

  select o.id into v_outbox_id
    from public.treasury_ledger_outbox o
   where o.entry_id = v_entry_id
   order by o.created_at desc
   limit 1;

  return jsonb_build_object(
    'entry_id', v_entry_id,
    'outbox_id', v_outbox_id,
    'status', p_status,
    'idempotency_key', p_idempotency_key,
    'replayed', false
  );
end;
$$;

revoke all on function public.post_treasury_ledger_entry(text, uuid, date, date, text, text, text, text, uuid, text, jsonb, jsonb) from public;
grant execute on function public.post_treasury_ledger_entry(text, uuid, date, date, text, text, text, text, uuid, text, jsonb, jsonb) to service_role;

notify pgrst, 'reload schema';
commit;
