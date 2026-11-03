-- DBS Air | Fase 1: pedidos de compra e recebimento físico parcial.
-- Aditiva: preserva o fluxo legado, Ledger, Outbox e toda a sincronização.
begin;

create table if not exists public.dbs_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete restrict,
  scope_key text not null,
  supplier_name text not null,
  document_number text,
  order_date date not null default current_date,
  status text not null default 'pending'
    check (status in ('pending','partially_received','received','cancelled')),
  total_ordered_cents bigint not null default 0 check (total_ordered_cents >= 0),
  total_received_cents bigint not null default 0 check (total_received_cents >= 0),
  idempotency_key text not null check (char_length(trim(idempotency_key)) between 8 and 200),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(scope_key,idempotency_key)
);

create table if not exists public.dbs_purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.dbs_purchase_orders(id) on delete restrict,
  part_id uuid not null references public.dbs_control_parts(id) on delete restrict,
  line_no integer not null check (line_no > 0),
  quantity_ordered numeric(18,4) not null check (quantity_ordered > 0),
  quantity_received numeric(18,4) not null default 0
    check (quantity_received >= 0 and quantity_received <= quantity_ordered),
  unit_cost_cents integer not null check (unit_cost_cents >= 0),
  total_ordered_cents bigint not null check (total_ordered_cents >= 0),
  total_received_cents bigint not null default 0 check (total_received_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(purchase_order_id,line_no)
);

create index if not exists dbs_purchase_order_items_part_idx
  on public.dbs_purchase_order_items(part_id,purchase_order_id);

create table if not exists public.dbs_inventory_receipts (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.dbs_purchase_orders(id) on delete restrict,
  company_id uuid references public.companies(id) on delete restrict,
  scope_key text not null,
  receipt_number text,
  received_at timestamptz not null default now(),
  total_cents bigint not null default 0 check (total_cents >= 0),
  ledger_entry_id uuid references public.treasury_ledger_entries(id) on delete restrict,
  idempotency_key text not null check (char_length(trim(idempotency_key)) between 8 and 200),
  received_by uuid references public.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(scope_key,idempotency_key)
);

create table if not exists public.dbs_inventory_receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.dbs_inventory_receipts(id) on delete restrict,
  purchase_order_item_id uuid not null references public.dbs_purchase_order_items(id) on delete restrict,
  part_id uuid not null references public.dbs_control_parts(id) on delete restrict,
  quantity_received numeric(18,4) not null check (quantity_received > 0),
  unit_cost_cents integer not null check (unit_cost_cents >= 0),
  total_cents bigint not null check (total_cents >= 0),
  stock_balance_after numeric(18,4) not null check (stock_balance_after >= 0),
  weighted_average_cost_cents integer not null check (weighted_average_cost_cents >= 0),
  created_at timestamptz not null default now(),
  unique(receipt_id,purchase_order_item_id)
);

create index if not exists dbs_inventory_receipts_order_idx
  on public.dbs_inventory_receipts(purchase_order_id,received_at desc);
create index if not exists dbs_inventory_receipt_items_part_idx
  on public.dbs_inventory_receipt_items(part_id,created_at desc);

alter table public.dbs_purchase_orders enable row level security;
alter table public.dbs_purchase_order_items enable row level security;
alter table public.dbs_inventory_receipts enable row level security;
alter table public.dbs_inventory_receipt_items enable row level security;

revoke all on public.dbs_purchase_orders,public.dbs_purchase_order_items,
  public.dbs_inventory_receipts,public.dbs_inventory_receipt_items
  from public,anon,authenticated;
grant all on public.dbs_purchase_orders,public.dbs_purchase_order_items,
  public.dbs_inventory_receipts,public.dbs_inventory_receipt_items to service_role;

create or replace function public.dbs_process_purchase_receipt(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor uuid := nullif(p_payload->>'actor_user_id','')::uuid;
  v_order_id uuid := nullif(p_payload->>'purchase_order_id','')::uuid;
  v_key text := nullif(btrim(p_payload->>'idempotency_key'),'');
  v_items jsonb := p_payload->'items';
  v_order public.dbs_purchase_orders%rowtype;
  v_existing public.dbs_inventory_receipts%rowtype;
  v_company uuid;
  v_supplier text;
  v_item jsonb;
  v_order_item public.dbs_purchase_order_items%rowtype;
  v_part public.dbs_control_parts%rowtype;
  v_receipt_id uuid;
  v_receipt_item_id uuid;
  v_qty numeric(18,4);
  v_line_cents bigint;
  v_total bigint := 0;
  v_new_stock numeric(18,4);
  v_new_cost integer;
  v_ledger jsonb;
  v_ledger_id uuid;
  v_received_all boolean;
  v_received_any boolean;
  v_item_count integer := 0;
begin
  if v_actor is null or not public.dbs_control_is_admin_actor(v_actor) then
    raise exception 'DBS_PURCHASE_RECEIPT_FORBIDDEN' using errcode='42501';
  end if;
  if v_order_id is null or v_key is null or char_length(v_key) not between 8 and 200 then
    raise exception 'DBS_PURCHASE_RECEIPT_INPUT_INVALID' using errcode='22023';
  end if;
  if jsonb_typeof(v_items)<>'array' or jsonb_array_length(v_items)=0 then
    raise exception 'DBS_PURCHASE_RECEIPT_ITEMS_REQUIRED' using errcode='22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_items) payload(value)
     where jsonb_typeof(payload.value)<>'object'
        or nullif(payload.value->>'purchase_order_item_id','') is null
        or nullif(payload.value->>'quantity_received','') is null
  ) or jsonb_array_length(v_items) <> (
    select count(*) from jsonb_array_elements(v_items) payload(value)
    join public.dbs_purchase_order_items poi
      on poi.id=nullif(payload.value->>'purchase_order_item_id','')::uuid
     and poi.purchase_order_id=v_order_id
  ) then
    raise exception 'DBS_PURCHASE_RECEIPT_ITEM_REFERENCE_INVALID' using errcode='22023';
  end if;

  select company_id into v_company from public.users
   where id=v_actor and status='ativo';
  perform pg_advisory_xact_lock(hashtextextended('purchase-receipt:'||v_order_id::text||':'||v_key,0));

  select * into v_order from public.dbs_purchase_orders
   where id=v_order_id for update;
  if not found then raise exception 'DBS_PURCHASE_ORDER_NOT_FOUND' using errcode='23503'; end if;
  if v_order.status='cancelled' then raise exception 'DBS_PURCHASE_ORDER_CANCELLED' using errcode='23514'; end if;
  if v_company is not null and v_order.company_id is distinct from v_company then
    raise exception 'DBS_PURCHASE_COMPANY_SCOPE_MISMATCH' using errcode='42501';
  end if;

  select * into v_existing from public.dbs_inventory_receipts
   where scope_key=v_order.scope_key and idempotency_key=v_key;
  if found then
    return jsonb_build_object('ok',true,'replayed',true,'receipt_id',v_existing.id,
      'purchase_order_id',v_order_id,'total_cents',v_existing.total_cents,
      'ledger_entry_id',v_existing.ledger_entry_id,'status',v_order.status);
  end if;

  insert into public.dbs_inventory_receipts(
    purchase_order_id,company_id,scope_key,receipt_number,idempotency_key,received_by,metadata
  ) values (
    v_order.id,v_order.company_id,v_order.scope_key,
    nullif(btrim(p_payload->>'receipt_number'),''),v_key,v_actor,
    jsonb_build_object('source','purchase_order_receipt')
  ) returning id into v_receipt_id;

  -- Ordem estável de bloqueio: pedido -> itens -> peças por UUID.
  for v_item in
    select payload.value
      from jsonb_array_elements(v_items) payload(value)
      join public.dbs_purchase_order_items poi
        on poi.id=nullif(payload.value->>'purchase_order_item_id','')::uuid
       and poi.purchase_order_id=v_order_id
     order by poi.part_id,poi.id
  loop
    select * into v_order_item from public.dbs_purchase_order_items
     where id=nullif(v_item->>'purchase_order_item_id','')::uuid
       and purchase_order_id=v_order_id for update;
    if not found then raise exception 'DBS_PURCHASE_ORDER_ITEM_NOT_FOUND' using errcode='23503'; end if;
    v_qty := nullif(v_item->>'quantity_received','')::numeric;
    if v_qty is null or v_qty<=0 or v_order_item.quantity_received+v_qty>v_order_item.quantity_ordered then
      raise exception 'DBS_PURCHASE_RECEIPT_QUANTITY_INVALID' using errcode='22023';
    end if;

    select * into v_part from public.dbs_control_parts
     where id=v_order_item.part_id for update;
    if not found or v_part.status<>'ativo' then
      raise exception 'DBS_PURCHASE_RECEIPT_PART_UNAVAILABLE' using errcode='23514';
    end if;

    v_new_stock := coalesce(v_part.stock_quantity,0)+v_qty;
    v_new_cost := case when v_new_stock>0 then
      round(((coalesce(v_part.stock_quantity,0)*coalesce(v_part.cost_cents,0))+
        (v_qty*v_order_item.unit_cost_cents))/v_new_stock)::integer
      else v_order_item.unit_cost_cents end;
    v_line_cents := round(v_qty*v_order_item.unit_cost_cents)::bigint;
    v_total := v_total+v_line_cents;
    v_item_count := v_item_count+1;

    update public.dbs_control_parts set stock_quantity=v_new_stock,cost_cents=v_new_cost,
      version=version+1,updated_at=now() where id=v_part.id;
    update public.dbs_purchase_order_items set quantity_received=quantity_received+v_qty,
      total_received_cents=total_received_cents+v_line_cents,updated_at=now() where id=v_order_item.id;

    insert into public.dbs_inventory_receipt_items(
      receipt_id,purchase_order_item_id,part_id,quantity_received,unit_cost_cents,total_cents,
      stock_balance_after,weighted_average_cost_cents
    ) values(v_receipt_id,v_order_item.id,v_part.id,v_qty,v_order_item.unit_cost_cents,
      v_line_cents,v_new_stock,v_new_cost) returning id into v_receipt_item_id;

    insert into public.dbs_control_inventory_movements(
      company_id,scope_key,part_id,movement_type,quantity_delta,unit_cost_cents,balance_after,
      idempotency_key,created_by,metadata
    ) values(
      v_order.company_id,v_order.scope_key,v_part.id,'receipt',v_qty,v_order_item.unit_cost_cents,
      v_new_stock,left(v_key||':receipt:'||v_receipt_item_id::text,240),v_actor,
      jsonb_build_object('purchase_order_id',v_order_id,'receipt_id',v_receipt_id)
    );
  end loop;

  if v_item_count=0 or v_total<=0 then
    raise exception 'DBS_PURCHASE_RECEIPT_VALUE_INVALID' using errcode='22023';
  end if;

  v_ledger := public.post_treasury_ledger_entry(
    v_order.scope_key,v_order.company_id,current_date,current_date,
    'purchase_inventory_receipt','Recebimento de compra · '||v_order.supplier_name,
    left(v_key||':ledger',200),'purchase-receipt:'||v_receipt_id::text,
    v_actor,'posted',
    jsonb_build_object('source','dbs_inventory_receipts','receipt_id',v_receipt_id,'purchase_order_id',v_order_id),
    jsonb_build_array(
      jsonb_build_object('account_code','1.1.03','account_name','Estoque de peças',
        'account_type','asset','debit_cents',v_total,'credit_cents',0),
      jsonb_build_object('account_code','2.1.01','account_name','Fornecedores',
        'account_type','liability','debit_cents',0,'credit_cents',v_total)
    )
  );
  v_ledger_id := nullif(v_ledger->>'entry_id','')::uuid;

  update public.dbs_inventory_receipts set total_cents=v_total,ledger_entry_id=v_ledger_id
   where id=v_receipt_id;

  select bool_and(quantity_received=quantity_ordered),
         bool_or(quantity_received>0)
    into v_received_all,v_received_any
    from public.dbs_purchase_order_items where purchase_order_id=v_order_id;
  update public.dbs_purchase_orders set
    status=case when v_received_all then 'received' when v_received_any then 'partially_received' else 'pending' end,
    total_received_cents=(select coalesce(sum(total_received_cents),0) from public.dbs_purchase_order_items where purchase_order_id=v_order_id),
    version=version+1,updated_at=now()
   where id=v_order_id;

  -- Esta fase não escreve no Outbox nem altera a infraestrutura de sincronização.

  return jsonb_build_object('ok',true,'replayed',false,'receipt_id',v_receipt_id,
    'purchase_order_id',v_order_id,'received_value_cents',v_total,'ledger_entry_id',v_ledger_id,
    'status',(select status from public.dbs_purchase_orders where id=v_order_id));
end;
$$;

revoke all on function public.dbs_process_purchase_receipt(jsonb) from public,anon,authenticated;
grant execute on function public.dbs_process_purchase_receipt(jsonb) to service_role;

comment on table public.dbs_purchase_orders is
  'Pedido de compra separado do recebimento físico; não altera estoque nem Ledger até receber.';
comment on table public.dbs_inventory_receipts is
  'Cabeçalho imutável de recebimento físico parcial/total e seu lançamento de estoque/fornecedores.';
comment on function public.dbs_process_purchase_receipt(jsonb) is
  'Recebe quantidades físicas sob lock transacional, recalcula CMP e contabiliza estoque contra fornecedores.';

notify pgrst,'reload schema';
commit;
