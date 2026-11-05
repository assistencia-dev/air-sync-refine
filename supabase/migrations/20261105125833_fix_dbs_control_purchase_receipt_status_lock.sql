create or replace function public.dbs_control_receive_registered_purchase(
  p_purchase_id uuid,
  p_actor_user_id uuid,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_purchase public.dbs_control_purchases%rowtype;
  v_actor_company uuid;
  v_key text := nullif(btrim(p_idempotency_key),'');
  v_item record;
  v_stock numeric;
  v_new_stock numeric;
  v_old_cost integer;
  v_new_cost integer;
  v_part_status text;
  v_total bigint := 0;
  v_ledger jsonb;
  v_ledger_id uuid;
  v_movement_count integer := 0;
begin
  if p_actor_user_id is null or not public.dbs_control_is_admin_actor(p_actor_user_id) then
    raise exception 'DBS_PURCHASE_RECEIVE_FORBIDDEN' using errcode='42501';
  end if;
  if p_purchase_id is null or v_key is null or char_length(v_key) not between 8 and 240 then
    raise exception 'DBS_PURCHASE_RECEIVE_INPUT_INVALID' using errcode='22023';
  end if;
  select company_id into v_actor_company from public.users where id=p_actor_user_id and status='ativo';
  select * into v_purchase from public.dbs_control_purchases where id=p_purchase_id for update;
  if not found then raise exception 'DBS_PURCHASE_NOT_FOUND' using errcode='23503'; end if;
  if v_actor_company is not null and v_actor_company is distinct from v_purchase.company_id then
    raise exception 'DBS_PURCHASE_SCOPE_MISMATCH' using errcode='42501';
  end if;
  if v_purchase.status='cancelled' then raise exception 'DBS_PURCHASE_CANCELLED' using errcode='23514'; end if;
  if v_purchase.status='received' then
    return jsonb_build_object('ok',true,'replayed',true,'purchase_id',p_purchase_id,
      'status','received','total_cents',v_purchase.total_cents,
      'ledger_entry_id',v_purchase.ledger_entry_id,'receipt_ledger_entry_id',v_purchase.receipt_ledger_entry_id);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_purchase.scope_key||':purchase-receive:'||p_purchase_id::text,0));
  select coalesce(sum(total_cents),0)::bigint into v_total
    from public.dbs_control_purchase_items where purchase_id=p_purchase_id;
  for v_item in
    select pi.part_id,sum(pi.quantity)::numeric as quantity,
      round(sum(pi.quantity*pi.unit_cost_cents)/nullif(sum(pi.quantity),0))::integer as unit_cost_cents
    from public.dbs_control_purchase_items pi where pi.purchase_id=p_purchase_id
    group by pi.part_id order by pi.part_id
  loop
    select stock_quantity,cost_cents,status into v_stock,v_old_cost,v_part_status
      from public.dbs_control_parts where id=v_item.part_id for update;
    if not found then raise exception 'DBS_PART_NOT_FOUND: peça % não existe.',v_item.part_id using errcode='23503'; end if;
    if v_part_status<>'ativo' then
      raise exception 'DBS_PART_INACTIVE: ative a peça % antes do recebimento.',v_item.part_id using errcode='23514';
    end if;
    v_new_stock:=coalesce(v_stock,0)+v_item.quantity;
    v_new_cost:=case when v_new_stock>0
      then round(((coalesce(v_stock,0)*coalesce(v_old_cost,0))+(v_item.quantity*v_item.unit_cost_cents))/v_new_stock)::integer
      else v_item.unit_cost_cents end;
    update public.dbs_control_parts set stock_quantity=v_new_stock,cost_cents=v_new_cost,
      version=version+1,updated_at=now() where id=v_item.part_id;
    insert into public.dbs_control_inventory_movements(
      company_id,scope_key,part_id,movement_type,quantity_delta,unit_cost_cents,balance_after,
      purchase_id,idempotency_key,created_by,metadata
    ) values(
      v_purchase.company_id,v_purchase.scope_key,v_item.part_id,'receipt',v_item.quantity,
      v_item.unit_cost_cents,v_new_stock,p_purchase_id,
      left('purchase:'||p_purchase_id::text||':receipt:'||v_item.part_id::text,240),
      p_actor_user_id,jsonb_build_object('source','purchase_receive','purchase_id',p_purchase_id,'receipt_request',v_key)
    ) on conflict(scope_key,idempotency_key) do nothing;
    v_movement_count:=v_movement_count+1;
  end loop;
  if v_movement_count=0 then raise exception 'DBS_PURCHASE_ITEMS_EMPTY' using errcode='22023'; end if;
  if v_total<=0 or v_total<>v_purchase.total_cents then
    raise exception 'DBS_PURCHASE_TOTAL_MISMATCH: total dos itens difere do total registrado.' using errcode='23514';
  end if;
  v_ledger:=public.post_treasury_ledger_entry(
    v_purchase.scope_key,v_purchase.company_id,current_date,current_date,
    'inventory_receipt','Recebimento de estoque · '||v_purchase.supplier_name,
    left('purchase-receipt:'||p_purchase_id::text,200),'purchase-inventory-receipt:'||p_purchase_id::text,
    p_actor_user_id,'posted',jsonb_build_object('source','dbs_control_purchase_receipt','purchase_id',p_purchase_id),
    jsonb_build_array(
      jsonb_build_object('account_code','1.1.03','account_name','Estoque de peças','account_type','asset','debit_cents',v_purchase.total_cents,'credit_cents',0,'memo','Recebimento físico'),
      jsonb_build_object('account_code','1.1.04','account_name','Estoque em trânsito','account_type','asset','debit_cents',0,'credit_cents',v_purchase.total_cents,'memo','Baixa do estoque em trânsito')
    )
  );
  v_ledger_id:=nullif(v_ledger->>'entry_id','')::uuid;
  if v_ledger_id is null then raise exception 'DBS_PURCHASE_RECEIPT_LEDGER_FAILED' using errcode='23514'; end if;
  update public.dbs_control_purchases set status='received',received_by=p_actor_user_id,
    receipt_ledger_entry_id=v_ledger_id,version=version+1,updated_at=now() where id=p_purchase_id;
  insert into public.dbs_control_outbox(
    idempotency_key,company_id,aggregate_type,aggregate_id,event_type,aggregate_version,payload
  ) values(
    left('purchase:received:'||v_purchase.scope_key||':'||p_purchase_id::text,240),
    v_purchase.company_id,'purchase',p_purchase_id,'inventory.purchase.received',v_purchase.version+1,
    jsonb_build_object('purchase_id',p_purchase_id,'scope_key',v_purchase.scope_key,'total_cents',v_purchase.total_cents)
  ) on conflict(idempotency_key) do nothing;
  return jsonb_build_object('ok',true,'replayed',false,'purchase_id',p_purchase_id,
    'status','received','total_cents',v_purchase.total_cents,'ledger_entry_id',v_purchase.ledger_entry_id,
    'receipt_ledger_entry_id',v_ledger_id,'movement_count',v_movement_count);
end;
$$;
revoke all on function public.dbs_control_receive_registered_purchase(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.dbs_control_receive_registered_purchase(uuid,uuid,text) to service_role;
