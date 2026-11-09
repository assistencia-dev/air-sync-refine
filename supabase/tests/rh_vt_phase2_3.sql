-- Integration test for RH VT Phase 2 + Treasury Phase 3.
-- Runs ONLY against the disposable local Supabase started by GitHub Actions.
-- No production URL, secrets, or external Supabase project are used.
\set ON_ERROR_STOP on

begin;

do $$
declare
  v_company uuid;
  v_auth uuid := gen_random_uuid();
  v_actor uuid;
  v_employee uuid;
  v_topup uuid;
  v_count_before bigint;
  v_count_after bigint;
  v_revision integer;
  v_net bigint;
  v_report record;
  v_post jsonb;
  v_reverse jsonb;
  v_original uuid;
  v_reversal uuid;
  v_lines jsonb;
  v_key text := 'CI-RH-VT-' || gen_random_uuid()::text;
  v_today date := current_date;
begin
  raise notice 'TEST 0/8 — fixture local: iniciando';
  insert into public.companies(legal_name, trade_name)
  values ('Empresa Teste CI RH VT', 'CI RH VT')
  returning id into v_company;

  insert into public.users(auth_id, username, full_name, email, role_key, company_id)
  values (v_auth, 'ci-rh-vt-' || replace(v_auth::text,'-',''), 'Usuário CI RH VT',
          'ci-rh-vt-' || v_auth::text || '@example.invalid', 'SUPER_ADMIN', v_company)
  returning id into v_actor;

  insert into public.rh_employees(benefit_type, full_name, unit, fare_cents, trips_per_day,
                                  registry_employee_id, company_id)
  values ('passagem', 'Funcionário CI VT', 'Unidade CI', 500, 2, null, v_company)
  returning id into v_employee;

  update public.rh_employees set registry_employee_id=id where id=v_employee;
  raise notice 'PASS 0/8 — fixture local criado: company %, employee %, actor %', v_company, v_employee, v_actor;

  raise notice 'TEST 1/8 — criar recarga via RPC de lote';
  select id into v_topup
  from public.rh_vt_create_topups_batch(
    jsonb_build_array(jsonb_build_object(
      'employee_id',v_employee,
      'company_id',v_company,
      'paid_at',v_today,
      'amount_cents',10000,
      'cost_center','CI',
      'idempotency_key',v_key,
      'treasury_idempotency_key',v_key || ':TREASURY'
    )), v_actor
  );
  if v_topup is null then raise exception 'FAIL: create não retornou recarga'; end if;
  if (select count(*) from public.rh_vt_topups where id=v_topup) <> 1 then
    raise exception 'FAIL: create não persistiu exatamente 1 recarga';
  end if;
  raise notice 'PASS 1/8 — criar: topup %, valor 10000 cents', v_topup;

  raise notice 'TEST 2/8 — reenvio da mesma client_key/idempotency_key';
  select count(*) into v_count_before from public.rh_vt_topups where idempotency_key=v_key;
  perform * from public.rh_vt_create_topups_batch(
    jsonb_build_array(jsonb_build_object(
      'employee_id',v_employee,'company_id',v_company,'paid_at',v_today,
      'amount_cents',10000,'cost_center','CI',
      'idempotency_key',v_key,'treasury_idempotency_key',v_key || ':TREASURY'
    )), v_actor
  );
  select count(*) into v_count_after from public.rh_vt_topups where idempotency_key=v_key;
  if v_count_after-v_count_before <> 0 then
    raise exception 'FAIL: replay inseriu % linhas', v_count_after-v_count_before;
  end if;
  raise notice 'PASS 2/8 — reenvio: 0 novas inserções';

  raise notice 'TEST 3/8 — editar: estorno + novo lançamento, revision esperado 2';
  update public.rh_vt_topups
     set amount_cents=12000, paid_at=v_today, change_reason='Ajuste de teste CI',
         last_operation_key=v_key || ':EDIT:1', updated_by=v_actor
   where id=v_topup;
  select financial_revision into v_revision from public.rh_vt_topups where id=v_topup;
  if v_revision <> 2 then
    raise exception 'FAIL: financial_revision esperado 2, recebido %', v_revision;
  end if;
  if (select count(*) from public.rh_vt_financial_events
       where topup_id=v_topup and event_type='edit_reversal') <> 1 then
    raise exception 'FAIL: estorno da edição não registrado exatamente uma vez';
  end if;
  if (select count(*) from public.rh_vt_financial_events
       where topup_id=v_topup and event_type='edit_approved') <> 1 then
    raise exception 'FAIL: novo lançamento da edição não registrado exatamente uma vez';
  end if;
  raise notice 'PASS 3/8 — editar: revision %, estorno + nova criação presentes', v_revision;

  raise notice 'TEST 4/8 — cancelar: estorno integral e soma líquida zero';
  update public.rh_vt_topups
     set status='cancelada', cancel_reason='Cancelamento de teste CI',
         cancelled_by=v_actor, cancelled_at=now(),
         last_operation_key=v_key || ':CANCEL', updated_by=v_actor
   where id=v_topup;
  select coalesce(sum(l.debit_cents-l.credit_cents),0) into v_net
    from public.rh_vt_financial_events fe
    join public.treasury_ledger_lines l on l.entry_id=fe.ledger_entry_id
    join public.treasury_accounts a on a.id=l.account_id
   where fe.topup_id=v_topup and a.code='3.1.02.01';
  if v_net <> 0 then raise exception 'FAIL: saldo líquido da despesa após cancelamento = %', v_net; end if;
  raise notice 'PASS 4/8 — cancelar: soma líquida da conta 3.1.02.01 = 0';

  raise notice 'TEST 5/8 — delete físico de auditoria deve falhar';
  begin
    delete from public.rh_vt_topup_audit where topup_id=v_topup;
    raise exception 'FAIL: delete físico da auditoria foi permitido';
  exception when others then
    if sqlerrm = 'FAIL: delete físico da auditoria foi permitido' then raise; end if;
    raise notice 'PASS 5/8 — delete físico bloqueado: %', sqlerrm;
  end;

  raise notice 'TEST 6/8 — conciliação RH x Treasury sem diferença';
  select * into v_report
    from public.rh_vt_financial_report(date_trunc('month',v_today)::date,
      (date_trunc('month',v_today)+interval '1 month')::date, v_company)
   where employee_id=v_employee;
  if not found then raise exception 'FAIL: relatório de conciliação não retornou funcionário'; end if;
  if v_report.difference_cents <> 0 or v_report.divergence then
    raise exception 'FAIL: conciliação diferença %, divergence %',
      v_report.difference_cents, v_report.divergence;
  end if;
  raise notice 'PASS 6/8 — conciliação: RH %, Treasury %, diferença %',
    v_report.rh_total_cents, v_report.treasury_total_cents, v_report.difference_cents;

  raise notice 'TEST 7/8 — Treasury: RPC real post_treasury_ledger_entry + contas aprovadas';
  v_lines := jsonb_build_array(
    jsonb_build_object('account_code','3.1.02.01','account_name','Despesas com Vale-Transporte',
      'account_type','expense','debit_cents',7000,'credit_cents',0,'memo','Teste direto RPC'),
    jsonb_build_object('account_code','2.1.02.01','account_name','Vale-Transporte a Pagar',
      'account_type','liability','debit_cents',0,'credit_cents',7000,'memo','Teste direto RPC')
  );
  v_post := public.post_treasury_ledger_entry(
    'company:'||v_company::text,v_company,v_today,v_today,'ci_vt_test',
    'Teste direto RPC Treasury',v_key||':DIRECT',v_key||':DIRECT',v_actor,
    'posted',jsonb_build_object('source_module','ci_test','employee_id',v_employee),v_lines
  );
  v_original := (v_post->>'entry_id')::uuid;
  if v_original is null then raise exception 'FAIL: RPC real não retornou entry_id'; end if;
  if (select count(*) from public.treasury_ledger_lines l
      join public.treasury_accounts a on a.id=l.account_id
      where l.entry_id=v_original and
       ((a.code='3.1.02.01' and l.debit_cents=7000) or
        (a.code='2.1.02.01' and l.credit_cents=7000))) <> 2 then
    raise exception 'FAIL: linhas/contas do lançamento direto incorretas';
  end if;
  raise notice 'PASS 7/8 — RPC real post_treasury_ledger_entry: entry %, contas 3.1.02.01 / 2.1.02.01', v_original;

  raise notice 'TEST 8/8 — estorno direto Treasury pela mesma RPC real';
  v_lines := jsonb_build_array(
    jsonb_build_object('account_code','3.1.02.01','account_name','Despesas com Vale-Transporte',
      'account_type','expense','debit_cents',0,'credit_cents',7000,'memo','Estorno teste direto'),
    jsonb_build_object('account_code','2.1.02.01','account_name','Vale-Transporte a Pagar',
      'account_type','liability','debit_cents',7000,'credit_cents',0,'memo','Estorno teste direto')
  );
  v_reverse := public.post_treasury_ledger_entry(
    'company:'||v_company::text,v_company,v_today,v_today,'ci_vt_test_reversal',
    'Estorno teste direto Treasury',v_key||':DIRECT:REV',v_key||':DIRECT:REV',v_actor,
    'posted',jsonb_build_object('source_module','ci_test','reversal_of',v_original),v_lines
  );
  v_reversal := (v_reverse->>'entry_id')::uuid;
  if v_reversal is null then raise exception 'FAIL: RPC real não retornou entry_id do estorno'; end if;
  if (select coalesce(sum(l.debit_cents-l.credit_cents),0)
      from public.treasury_ledger_lines l join public.treasury_accounts a on a.id=l.account_id
      where l.entry_id in (v_original,v_reversal) and a.code='3.1.02.01') <> 0 then
    raise exception 'FAIL: estorno direto não zerou a conta de despesa';
  end if;
  raise notice 'PASS 8/8 — estorno direto Treasury: entry %, soma líquida 0', v_reversal;

  raise notice 'RESULTADO FINAL: 8/8 testes passaram.';
end;
$$;

rollback;
