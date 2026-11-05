-- Two-phase purchase lifecycle: registering creates Accounts Payable;
-- receiving posts one inventory receipt and reclassifies in-transit stock.
-- Existing one-step receive RPC remains for backwards compatibility.

begin;

alter table public.dbs_control_purchases
  add column if not exists receipt_ledger_entry_id uuid
    references public.treasury_ledger_entries(id) on delete restrict;

create index if not exists dbs_control_purchases_receipt_ledger_fk_idx
  on public.dbs_control_purchases(receipt_ledger_entry_id);

create or replace function public.dbs_control_register_purchase(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := nullif(p_payload->>'actor_user_id','')::uuid;
  v_actor_company uuid;
  v_company uuid := nullif(p_payload->>'company_id','')::uuid;
  v_scope text := nullif(btrim(p_payload->>'scope_key'),'');
  v_key text := nullif(btrim(p_payload->>'idempotency_key'),'');
  v_legacy_key text := nullif(btrim(p_payload->>'legacy_key'),'');
  v_supplier text := nullif(btrim(p_payload->>'supplier_name'),'');
  v_document text := nullif(btrim(p_payload->>'document_number'),'');
  v_date date := coalesce(nullif(p_payload->>'purchase_date','')::date,current_date);
  v_items jsonb := p_payload->'items';
  v_existing public.dbs_control_purchases%rowtype;
  v_purchase uuid;
  v_item jsonb;
  v_part uuid;
  v_qty numeric;
  v_unit_cost integer;
  v_line_total bigint;
  v_line integer := 0;
  v_total bigint := 0;
  v_part_status text;
  v_ledger jsonb;
  v_ledger_id uuid;
begin
  if v_actor is null or not public.dbs_control_is_admin_actor(v_actor) then
    raise exception 'DBS_PURCHASE_REGISTER_FORBIDDEN' using errcode='42501';
  end if;
  if v_key is null or char_length(v_key) not between 8 and 240 then
    raise exception 'DBS_PURCHASE_IDEMPOTENCY_REQUIRED' using errcode='22023';
  end if;
  if v_supplier is null then
    raise exception 'DBS_PURCHASE_SUPPLIER_REQUIRED' using errcode='22023';
  end if;
  if jsonb_typeof(v_items) is distinct from 'array' or jsonb_array_length(v_items)=0 then
    raise exception 'DBS_PURCHASE_ITEMS_REQUIRED' using errcode='22023';
  end if;

  select company_id into v_actor_company
    from public.users where id=v_actor and status='ativo';
  if v_actor_company is not null and v_company is not null and v_actor_company is distinct from v_company then
    raise exception 'DBS_PURCHASE_COMPANY_MISMATCH' using errcode='42501';
  end if;
  v_company := coalesce(v_company,v_actor_company);
  v_scope := coalesce(v_scope,case when v_company is not null then 'company:'||v_company::text else 'user:'||v_actor::text end);

  perform pg_advisory_xact_lock(hashtextextended(v_scope||':purchase-register:'||v_key,0));
  select * into v_existing from public.dbs_control_purchases
   where scope_key=v_scope and idempotency_key=v_key for update;
  if found then
    return jsonb_build_object('ok',true,'replayed',true,'purchase_id',v_existing.id,
      'status',v_existing.status,'total_cents',v_existing.total_cents,
      'ledger_entry_id',v_existing.ledger_entry_id,'idempotency_key',v_existing.idempotency_key);
  end if;
  if v_legacy_key is not null then
    select * into v_existing from public.dbs_control_purchases
     where scope_key=v_scope and legacy_key=v_legacy_key for update;
    if found then
      return jsonb_build_object('ok',true,'replayed',true,'purchase_id',v_existing.id,
        'status',v_existing.status,'total_cents',v_existing.total_cents,
        'ledger_entry_id',v_existing.ledger_entry_id,'idempotency_key',v_existing.idempotency_key);
    end if;
  end if;

  insert into public.dbs_control_purchases(
    company_id,scope_key,supplier_name,document_number,purchase_date,
    status,payment_status,idempotency_key,legacy_key,created_by
  ) values(
    v_company,v_scope,v_supplier,v_document,v_date,
    'draft','unpaid',v_key,v_legacy_key,v_actor
  ) returning id into v_purchase;

  for v_item in select value from jsonb_array_elements(v_items) as item(value)
  loop
    v_part := nullif(coalesce(v_item->>'part_id',v_item->>'id'),'')::uuid;
    v_qty := coalesce(nullif(coalesce(v_item->>'quantity',v_item->>'qtd'),'')::numeric,0);
    v_unit_cost := greatest(coalesce(nullif(coalesce(v_item->>'unit_cost_cents',v_item->>'unit_cost'),'')::numeric,0),0)::integer;
    if v_part is null or v_qty<=0 then
      raise exception 'DBS_PURCHASE_ITEM_INVALID: informe peça e quantidade positiva.' using errcode='22023';
    end if;
    select status into v_part_status from public.dbs_control_parts where id=v_part;
    if not found then
      raise exception 'DBS_PART_NOT_FOUND: peça % não existe no catálogo.',v_part using errcode='23503';
    end if;
    if v_part_status<>'ativo' then
      raise exception 'DBS_PART_INACTIVE: ative a peça no catálogo antes de registrar a compra.' using errcode='23514';
    end if;
    v_line := v_line+1;
    v_line_total := round(v_qty*v_unit_cost)::bigint;
    v_total := v_total+v_line_total;
    insert into public.dbs_control_purchase_items(
      purchase_id,part_id,line_no,quantity,unit_cost_cents,total_cents
    ) values(v_purchase,v_part,v_line,v_qty,v_unit_cost,v_line_total);
  end loop;

  if v_total<=0 then
    raise exception 'DBS_PURCHASE_TOTAL_INVALID: valor total precisa ser maior que zero.' using errcode='22023';
  end if;

  v_ledger := public.post_treasury_ledger_entry(
    v_scope,v_company,v_date,v_date,
    'purchase_registered','Compra registrada · '||v_supplier,
    left(v_key||':payable',200),'purchase-payable:'||v_purchase::text,
    v_actor,'posted',
    jsonb_build_object('source','dbs_control_purchase','purchase_id',v_purchase,'status','draft'),
    jsonb_build_array(
      jsonb_build_object('account_code','1.1.04','account_name','Estoque em trânsito',
        'account_type','asset','debit_cents',v_total,'credit_cents',0,'memo','Compra registrada aguardando recebimento'),
      jsonb_build_object('account_code','2.1.01','account_name','Fornecedores',
        'account_type','liability','debit_cents',0,'credit_cents',v_total,'memo','Contas a pagar da compra')
    )
  );
  v_ledger_id := nullif(v_ledger->>'entry_id','')::uuid;
  if v_ledger_id is null then
    raise exception 'DBS_PURCHASE_PAYABLE_LEDGER_FAILED' using errcode='23514';
  end if;

  update public.dbs_control_purchases
     set total_cents=v_total,ledger_entry_id=v_ledger_id,updated_at=now()
   where id=v_purchase;

  insert into public.dbs_control_outbox(
    idempotency_key,company_id,aggregate_type,aggregate_id,event_type,aggregate_version,payload
  ) values(
    left('purchase:registered:'||v_scope||':'||v_key,240),
    v_company,'purchase',v_purchase,'purchase.registered',1,
    jsonb_build_object('purchase_id',v_purchase,'scope_key',v_scope,'total_cents',v_total)
  ) on conflict(idempotency_key) do nothing;

  return jsonb_build_object('ok',true,'replayed',false,'purchase_id',v_purchase,
    'status','draft','total_cents',v_total,'ledger_entry_id',v_ledger_id,'idempotency_key',v_key);
end;
$$;

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
  select company_id into v_actor_company
    from public.users where id=p_actor_user_id and status='ativo';
  select * into v_purchase from public.dbs_control_purchases
   where id=p_purchase_id for update;
  if not found then
    raise exception 'DBS_PURCHASE_NOT_FOUND' using errcode='23503';
  end if;
  if v_actor_company is not null and v_actor_company is distinct from v_purchase.company_id then
    raise exception 'DBS_PURCHASE_SCOPE_MISMATCH' using errcode='42501';
  end if;
  if v_purchase.status='cancelled' then
    raise exception 'DBS_PURCHASE_CANCELLED' using errcode='23514';
  end if;
  if v_purchase.status='received' then
    return jsonb_build_object('ok',true,'replayed',true,'purchase_id',p_purchase_id,
      'status','received','total_cents',v_purchase.total_cents,
      'ledger_entry_id',v_purchase.ledger_entry_id,
      'receipt_ledger_entry_id',v_purchase.receipt_ledger_entry_id);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_purchase.scope_key||':purchase-receive:'||p_purchase_id::text,0));

  select coalesce(sum(total_cents),0)::bigint into v_total
    from public.dbs_control_purchase_items where purchase_id=p_purchase_id;

  for v_item in
    select pi.part_id,
           sum(pi.quantity)::numeric as quantity,
           round(sum(pi.quantity*pi.unit_cost_cents)/nullif(sum(pi.quantity),0))::integer as unit_cost_cents
      from public.dbs_control_purchase_items pi
     where pi.purchase_id=p_purchase_id
     group by pi.part_id
     order by pi.part_id
  loop
    select stock_quantity,cost_cents,status
      into v_stock,v_old_cost,v_part_status
      from public.dbs_control_parts
     where id=v_item.part_id
     for update;
    if not found then
      raise exception 'DBS_PART_NOT_FOUND: peça % não existe.',v_item.part_id using errcode='23503';
    end if;
    if v_part_status<>'ativo' then
      raise exception 'DBS_PART_INACTIVE: ative a peça % antes do recebimento.',v_item.part_id using errcode='23514';
    end if;
    v_new_stock := coalesce(v_stock,0)+v_item.quantity;
    v_new_cost := case when v_new_stock>0
      then round(((coalesce(v_stock,0)*coalesce(v_old_cost,0))+(v_item.quantity*v_item.unit_cost_cents))/v_new_stock)::integer
      else v_item.unit_cost_cents end;
    update public.dbs_control_parts
       set stock_quantity=v_new_stock,cost_cents=v_new_cost,version=version+1,updated_at=now()
     where id=v_item.part_id;
    insert into public.dbs_control_inventory_movements(
      company_id,scope_key,part_id,movement_type,quantity_delta,unit_cost_cents,
      balance_after,purchase_id,idempotency_key,created_by,metadata
    ) values(
      v_purchase.company_id,v_purchase.scope_key,v_item.part_id,'receipt',v_item.quantity,
      v_item.unit_cost_cents,v_new_stock,p_purchase_id,
      left('purchase:'||p_purchase_id::text||':receipt:'||v_item.part_id::text,240),
      p_actor_user_id,jsonb_build_object('source','purchase_receive','purchase_id',p_purchase_id,'receipt_request',v_key)
    ) on conflict(scope_key,idempotency_key) do nothing;
    v_movement_count := v_movement_count+1;
  end loop;
  if v_movement_count=0 then
    raise exception 'DBS_PURCHASE_ITEMS_EMPTY: compra sem itens para receber.' using errcode='22023';
  end if;
  if v_total<=0 or v_total<>v_purchase.total_cents then
    raise exception 'DBS_PURCHASE_TOTAL_MISMATCH: total dos itens difere do total registrado.' using errcode='23514';
  end if;
  v_ledger := public.post_treasury_ledger_entry(
    v_purchase.scope_key,v_purchase.company_id,current_date,current_date,
    'inventory_receipt','Recebimento de estoque · '||v_purchase.supplier_name,
    left('purchase-receipt:'||p_purchase_id::text,200),
    'purchase-inventory-receipt:'||p_purchase_id::text,
    p_actor_user_id,'posted',
    jsonb_build_object('source','dbs_control_purchase_receipt','purchase_id',p_purchase_id),
    jsonb_build_array(
      jsonb_build_object('account_code','1.1.03','account_name','Estoque de peças',
        'account_type','asset','debit_cents',v_purchase.total_cents,'credit_cents',0,'memo','Recebimento físico'),
      jsonb_build_object('account_code','1.1.04','account_name','Estoque em trânsito',
        'account_type','asset','debit_cents',0,'credit_cents',v_purchase.total_cents,'memo','Baixa do estoque em trânsito')
    )
  );
  v_ledger_id := nullif(v_ledger->>'entry_id','')::uuid;
  if v_ledger_id is null then
    raise exception 'DBS_PURCHASE_RECEIPT_LEDGER_FAILED' using errcode='23514';
  end if;
  update public.dbs_control_purchases
     set status='received',received_by=p_actor_user_id,receipt_ledger_entry_id=v_ledger_id,
         version=version+1,updated_at=now()
   where id=p_purchase_id;
  insert into public.dbs_control_outbox(
    idempotency_key,company_id,aggregate_type,aggregate_id,event_type,aggregate_version,payload
  ) values(
    left('purchase:received:'||v_purchase.scope_key||':'||p_purchase_id::text,240),
    v_purchase.company_id,'purchase',p_purchase_id,'inventory.purchase.received',v_purchase.version+1,
    jsonb_build_object('purchase_id',p_purchase_id,'scope_key',v_purchase.scope_key,'total_cents',v_purchase.total_cents)
  ) on conflict(idempotency_key) do nothing;
  return jsonb_build_object('ok',true,'replayed',false,'purchase_id',p_purchase_id,
    'status','received','total_cents',v_purchase.total_cents,
    'ledger_entry_id',v_purchase.ledger_entry_id,'receipt_ledger_entry_id',v_ledger_id,
    'movement_count',v_movement_count);
end;
$$;

revoke all on function public.dbs_control_register_purchase(jsonb) from public,anon,authenticated;
grant execute on function public.dbs_control_register_purchase(jsonb) to service_role;
revoke all on function public.dbs_control_receive_registered_purchase(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.dbs_control_receive_registered_purchase(uuid,uuid,text) to service_role;

commit;
