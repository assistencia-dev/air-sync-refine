-- Fase 2+3: integração real RH VT + DBS TREASURY em Supabase local.
-- O job inicia banco descartável. A transação é revertida ao final.
\set ON_ERROR_STOP on
begin;

do $$
declare
  v_company uuid;
  v_auth uuid := gen_random_uuid();
  v_actor uuid;
  v_employee uuid;
  v_topup public.rh_vt_topups;
  v_result public.rh_vt_topups;
  v_key text := 'CI-RH-VT-' || gen_random_uuid()::text;
  v_before bigint;
  v_after bigint;
  v_event_before bigint;
  v_event_after bigint;
  v_audit_before bigint;
  v_revision integer;
  v_report record;
  v_direct jsonb;
  v_direct_reversal jsonb;
  v_lines jsonb;
  v_direct_id uuid;
  v_direct_reversal_id uuid;
  v_net bigint;
  v_month date := date_trunc('month',current_date)::date;
begin
  raise notice 'TEST 0 — fixtures exclusivamente no PostgreSQL local';
  insert into public.companies(legal_name,trade_name)
  values ('CI RH VT','CI RH VT') returning id into v_company;
  insert into public.users(auth_id,username,full_name,email,role_key,company_id)
  values (v_auth,'ci-'||replace(v_auth::text,'-',''),'CI RH VT',
          'ci-'||v_auth::text||'@example.invalid','SUPER_ADMIN',v_company)
  returning id into v_actor;
  insert into public.rh_employees(benefit_type,full_name,unit,fare_cents,trips_per_day)
  values ('passagem','Funcionário de Teste CI','Unidade CI',500,2)
  returning id into v_employee;
  update public.rh_employees set registry_employee_id=id where id=v_employee;
  raise notice 'PASS 0 — company %, actor %, employee %',v_company,v_actor,v_employee;

  raise notice 'TEST 1 — criar recarga pelo RPC rh_vt_create_topups_batch';
  select * into v_topup
  from public.rh_vt_create_topups_batch(
    jsonb_build_array(jsonb_build_object(
      'employee_id',v_employee,'company_id',v_company,'paid_at',current_date,
      'amount_cents',10000,'cost_center','CI',
      'idempotency_key',v_key,'treasury_idempotency_key',v_key||':TREASURY'
    )),v_actor
  );
  if v_topup.id is null or v_topup.financial_entry_id is null then
    raise exception 'FAIL TEST 1: recarga ou lançamento financeiro não criado';
  end if;
  if (select count(*) from public.rh_vt_financial_events where topup_id=v_topup.id and event_type='approved') <> 1 then
    raise exception 'FAIL TEST 1: evento approved não foi criado exatamente uma vez';
  end if;
  raise notice 'PASS 1 — criada recarga %, financial_entry_id %',v_topup.id,v_topup.financial_entry_id;

  raise notice 'TEST 2 — reenvio da mesma idempotency_key: zero inserções';
  select count(*) into v_before from public.rh_vt_topups where idempotency_key=v_key;
  select * into v_result
  from public.rh_vt_create_topups_batch(
    jsonb_build_array(jsonb_build_object(
      'employee_id',v_employee,'company_id',v_company,'paid_at',current_date,
      'amount_cents',10000,'cost_center','CI',
      'idempotency_key',v_key,'treasury_idempotency_key',v_key||':TREASURY'
    )),v_actor
  );
  select count(*) into v_after from public.rh_vt_topups where idempotency_key=v_key;
  if v_after-v_before <> 0 then raise exception 'FAIL TEST 2: % novas linhas',v_after-v_before; end if;
  raise notice 'PASS 2 — antes %, depois %, novas inserções %',v_before,v_after,v_after-v_before;

  raise notice 'TEST 3 — edição: financial_revision inicia em 0 e primeira edição incrementa para 1';
  select count(*) into v_event_before from public.rh_vt_financial_events where topup_id=v_topup.id;
  select count(*) into v_audit_before from public.rh_vt_topup_audit where topup_id=v_topup.id;
  select * into v_result from public.rh_vt_update_topup(
    v_topup.id,12000,current_date,'CI',null,'Ajuste CI',v_key||':EDIT:1',v_actor
  );
  select financial_revision into v_revision from public.rh_vt_topups where id=v_topup.id;
  select count(*) into v_event_after from public.rh_vt_financial_events where topup_id=v_topup.id;
  if v_revision <> 1 then raise exception 'FAIL TEST 3: revision esperado 1 após primeira edição, recebido %',v_revision; end if;
  if (select count(*) from public.rh_vt_financial_events where topup_id=v_topup.id and event_type='edit_reversal' and revision=1) <> 1
     or (select count(*) from public.rh_vt_financial_events where topup_id=v_topup.id and event_type='edit_approved' and revision=1) <> 1 then
    raise exception 'FAIL TEST 3: esperado exatamente 1 estorno e 1 novo lançamento';
  end if;
  if (select count(distinct idempotency_key) from public.rh_vt_financial_events where topup_id=v_topup.id and revision=1) <> 2 then
    raise exception 'FAIL TEST 3: chaves de idempotência do estorno e novo lançamento não são distintas';
  end if;
  raise notice 'PASS 3 — financial_revision %, eventos novos %, estorno=1, novo=1, chaves distintas',v_revision,v_event_after-v_event_before;

  raise notice 'TEST 3B — reenviar a mesma edição: nenhum evento novo';
  select count(*) into v_event_before from public.rh_vt_financial_events where topup_id=v_topup.id;
  select count(*) into v_audit_before from public.rh_vt_topup_audit where topup_id=v_topup.id;
  perform public.rh_vt_update_topup(
    v_topup.id,12000,current_date,'CI',null,'Ajuste CI',v_key||':EDIT:1',v_actor
  );
  select count(*) into v_event_after from public.rh_vt_financial_events where topup_id=v_topup.id;
  if v_event_after-v_event_before <> 0 then raise exception 'FAIL TEST 3B: replay criou % eventos',v_event_after-v_event_before; end if;
  if (select count(*) from public.rh_vt_topup_audit where topup_id=v_topup.id)-v_audit_before <> 0 then
    raise exception 'FAIL TEST 3B: replay criou auditoria nova';
  end if;
  raise notice 'PASS 3B — replay da edição: 0 novos eventos e 0 novas auditorias';

  raise notice 'TEST 4 — cancelar: estorno da despesa e soma líquida zero';
  perform public.rh_vt_cancel_topup(v_topup.id,'Cancelamento CI',v_key||':CANCEL',v_actor);
  select coalesce(sum(l.debit_cents-l.credit_cents),0) into v_net
  from public.rh_vt_financial_events fe
  join public.treasury_ledger_lines l on l.entry_id=fe.ledger_entry_id
  join public.treasury_accounts a on a.id=l.account_id
  where fe.topup_id=v_topup.id and a.code='3.1.02.01';
  if v_net <> 0 then raise exception 'FAIL TEST 4: soma líquida após cancelamento = %',v_net; end if;
  raise notice 'PASS 4 — soma líquida da despesa VT após cancelamento = %',v_net;

  raise notice 'TEST 5 — exclusão física da auditoria deve falhar';
  begin
    delete from public.rh_vt_topup_audit where topup_id=v_topup.id;
    raise exception 'DELETE_WAS_ALLOWED';
  exception when others then
    if sqlerrm='DELETE_WAS_ALLOWED' then raise exception 'FAIL TEST 5: delete físico foi permitido'; end if;
    raise notice 'PASS 5 — delete bloqueado pelo trigger: %',sqlerrm;
  end;

  raise notice 'TEST 6 — conciliação sem divergência pelo rh_vt_financial_report';
  select * into v_report from public.rh_vt_financial_report(v_month,(v_month+interval '1 month')::date,v_company)
  where employee_id=v_employee;
  if not found then raise exception 'FAIL TEST 6: relatório não retornou funcionário'; end if;
  if v_report.difference_cents<>0 or v_report.divergence then
    raise exception 'FAIL TEST 6: diferença %, divergence %',v_report.difference_cents,v_report.divergence;
  end if;
  raise notice 'PASS 6 — RH %, Treasury %, diferença %, divergence %',
    v_report.rh_total_cents,v_report.treasury_total_cents,v_report.difference_cents,v_report.divergence;

  raise notice 'TEST 7 — conciliação negativa: inserir despesa adicional via RPC real e exigir divergence=true';
  v_lines:=jsonb_build_array(
    jsonb_build_object('account_code','3.1.02.01','account_name','Despesas com Vale-Transporte','account_type','expense','debit_cents',123,'credit_cents',0,'memo','Divergência CI'),
    jsonb_build_object('account_code','2.1.02.01','account_name','Vale-Transporte a Pagar','account_type','liability','debit_cents',0,'credit_cents',123,'memo','Divergência CI')
  );
  v_direct:=public.post_treasury_ledger_entry(
    'company:'||v_company::text,v_company,v_month,current_date,'ci_divergence',
    'Lançamento extra para teste negativo',v_key||':DIVERGENCE',v_key||':DIVERGENCE',v_actor,
    'posted',jsonb_build_object('source_module','rh','source_type','vale_transporte','employee_id',v_employee,'ci_negative_test',true),v_lines
  );
  update public.treasury_ledger_entries
  set source_module='rh',metadata=metadata||jsonb_build_object('source_type','vale_transporte','employee_id',v_employee)
  where id=(v_direct->>'entry_id')::uuid;
  select * into v_report from public.rh_vt_financial_report(v_month,(v_month+interval '1 month')::date,v_company)
  where employee_id=v_employee;
  if not found or not v_report.divergence or v_report.difference_cents=0 then
    raise exception 'FAIL TEST 7: relatório não sinalizou divergência artificial';
  end if;
  raise notice 'PASS 7 — relatório sinalizou divergência: RH %, Treasury %, diferença %, divergence %',
    v_report.rh_total_cents,v_report.treasury_total_cents,v_report.difference_cents,v_report.divergence;

  raise notice 'TEST 8 — RPC real post_treasury_ledger_entry com contas VT aprovadas';
  v_lines:=jsonb_build_array(
    jsonb_build_object('account_code','3.1.02.01','account_name','Despesas com Vale-Transporte','account_type','expense','debit_cents',7000,'credit_cents',0,'memo','Teste direto RPC'),
    jsonb_build_object('account_code','2.1.02.01','account_name','Vale-Transporte a Pagar','account_type','liability','debit_cents',0,'credit_cents',7000,'memo','Teste direto RPC')
  );
  v_direct:=public.post_treasury_ledger_entry(
    'company:'||v_company::text,v_company,v_month,current_date,'ci_vt_test',
    'Teste direto RPC Treasury',v_key||':DIRECT',v_key||':DIRECT',v_actor,
    'posted',jsonb_build_object('source_module','ci_test'),v_lines
  );
  v_direct_id:=(v_direct->>'entry_id')::uuid;
  if v_direct_id is null then raise exception 'FAIL TEST 8: RPC real não retornou entry_id'; end if;
  if (select count(*) from public.treasury_ledger_lines l join public.treasury_accounts a on a.id=l.account_id
      where l.entry_id=v_direct_id and ((a.code='3.1.02.01' and l.debit_cents=7000) or (a.code='2.1.02.01' and l.credit_cents=7000)))<>2 then
    raise exception 'FAIL TEST 8: contas ou valores do lançamento incorretos';
  end if;
  raise notice 'PASS 8 — RPC real post_treasury_ledger_entry: entry %, contas 3.1.02.01 / 2.1.02.01',v_direct_id;

  raise notice 'TEST 9 — estorno pela mesma RPC real';
  v_lines:=jsonb_build_array(
    jsonb_build_object('account_code','3.1.02.01','account_name','Despesas com Vale-Transporte','account_type','expense','debit_cents',0,'credit_cents',7000,'memo','Estorno CI'),
    jsonb_build_object('account_code','2.1.02.01','account_name','Vale-Transporte a Pagar','account_type','liability','debit_cents',7000,'credit_cents',0,'memo','Estorno CI')
  );
  v_direct_reversal:=public.post_treasury_ledger_entry(
    'company:'||v_company::text,v_company,v_month,current_date,'ci_vt_test_reversal',
    'Estorno direto Treasury',v_key||':DIRECT:REV',v_key||':DIRECT:REV',v_actor,
    'posted',jsonb_build_object('source_module','ci_test','reversal_of',v_direct_id),v_lines
  );
  v_direct_reversal_id:=(v_direct_reversal->>'entry_id')::uuid;
  select coalesce(sum(l.debit_cents-l.credit_cents),0) into v_net
  from public.treasury_ledger_lines l join public.treasury_accounts a on a.id=l.account_id
  where l.entry_id in (v_direct_id,v_direct_reversal_id) and a.code='3.1.02.01';
  if v_net<>0 then raise exception 'FAIL TEST 9: estorno direto não zerou a conta, líquido %',v_net; end if;
  raise notice 'PASS 9 — estorno via RPC real: entry %, soma líquida %',v_direct_reversal_id,v_net;

  raise notice 'RESULTADO: 10 verificações passaram.';
end;
$$;

rollback;
