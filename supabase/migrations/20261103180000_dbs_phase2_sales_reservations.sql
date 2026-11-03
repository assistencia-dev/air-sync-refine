-- DBS Air | Fase 2A/2B: reserva de OS e venda avulsa de peças.
-- Aditiva: não altera snapshots, sincronização, Outbox operacional ou funções legadas.
begin;

create table if not exists public.dbs_control_inventory_outbox (
  id uuid primary key default gen_random_uuid(),
  scope_key text not null,
  idempotency_key text not null unique,
  aggregate_type text not null,
  aggregate_id uuid,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','processing','published','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  published_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index if not exists dbs_control_inventory_outbox_pending_idx
  on public.dbs_control_inventory_outbox(status,available_at,created_at);

create or replace function public.dbs_control_enqueue_inventory_outbox()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $
begin
  insert into public.dbs_control_inventory_outbox(
    scope_key,idempotency_key,aggregate_type,aggregate_id,event_type,payload
  ) values(
    new.scope_key,
    'movement:'||md5(new.scope_key||':'||new.idempotency_key),
    'inventory_part',new.part_id,'inventory.'||new.movement_type,to_jsonb(new)
  ) on conflict(idempotency_key) do nothing;
  return new;
end;
$;
drop trigger if exists trg_dbs_control_inventory_outbox on public.dbs_control_inventory_movements;
create trigger trg_dbs_control_inventory_outbox
after insert on public.dbs_control_inventory_movements
for each row execute function public.dbs_control_enqueue_inventory_outbox();

create table if not exists public.dbs_control_reservation_batches (
  id uuid primary key default gen_random_uuid(),
  scope_key text not null,
  company_id uuid references public.companies(id) on delete restrict,
  work_order_id uuid not null references public.dbs_control_work_orders(id) on delete restrict,
  idempotency_key text not null check (char_length(trim(idempotency_key)) between 8 and 240),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(scope_key,idempotency_key)
);

create table if not exists public.dbs_control_reservation_consumptions (
  id uuid primary key default gen_random_uuid(),
  scope_key text not null,
  work_order_id uuid not null references public.dbs_control_work_orders(id) on delete restrict,
  idempotency_key text not null check (char_length(trim(idempotency_key)) between 8 and 240),
  total_cost_cents bigint not null default 0 check (total_cost_cents >= 0),
  ledger_entry_id uuid references public.treasury_ledger_entries(id) on delete restrict,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(work_order_id),
  unique(scope_key,idempotency_key)
);

create table if not exists public.dbs_control_work_order_reservations (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.dbs_control_reservation_batches(id) on delete restrict,
  scope_key text not null,
  company_id uuid references public.companies(id) on delete restrict,
  work_order_id uuid not null references public.dbs_control_work_orders(id) on delete restrict,
  part_id uuid not null references public.dbs_control_parts(id) on delete restrict,
  quantity numeric(12,3) not null check (quantity > 0),
  unit_cost_cents integer not null check (unit_cost_cents >= 0),
  status text not null default 'reserved' check (status in ('reserved','consumed','released')),
  idempotency_key text not null check (char_length(trim(idempotency_key)) between 8 and 240),
  version bigint not null default 1 check (version > 0),
  created_by uuid references public.users(id) on delete set null,
  consumed_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(scope_key,idempotency_key)
);

create unique index if not exists dbs_control_reservation_active_work_order_part_uq
  on public.dbs_control_work_order_reservations(work_order_id,part_id)
  where status='reserved';
create index if not exists dbs_control_reservations_scope_status_idx
  on public.dbs_control_work_order_reservations(scope_key,status,created_at desc);
create index if not exists dbs_control_reservations_work_order_idx
  on public.dbs_control_work_order_reservations(work_order_id,created_at desc);

create table if not exists public.dbs_control_sales (
  id uuid primary key default gen_random_uuid(),
  scope_key text not null,
  company_id uuid references public.companies(id) on delete restrict,
  client_id uuid references public.dbs_control_clients(id) on delete restrict,
  sale_number text,
  status text not null default 'posted' check (status in ('posted','partially_paid','paid','cancelled')),
  total_cents bigint not null default 0 check (total_cents >= 0),
  cost_cents bigint not null default 0 check (cost_cents >= 0),
  received_cents bigint not null default 0 check (received_cents >= 0 and received_cents <= total_cents),
  revenue_entry_id uuid references public.treasury_ledger_entries(id) on delete restrict,
  cogs_entry_id uuid references public.treasury_ledger_entries(id) on delete restrict,
  idempotency_key text not null check (char_length(trim(idempotency_key)) between 8 and 240),
  created_by uuid references public.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(scope_key,idempotency_key)
);

create table if not exists public.dbs_control_sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.dbs_control_sales(id) on delete restrict,
  part_id uuid not null references public.dbs_control_parts(id) on delete restrict,
  quantity numeric(12,3) not null check (quantity > 0),
  unit_sale_cents integer not null check (unit_sale_cents > 0),
  unit_cost_cents integer not null check (unit_cost_cents >= 0),
  total_cents bigint not null check (total_cents > 0),
  cost_total_cents bigint not null check (cost_total_cents >= 0),
  created_at timestamptz not null default now(),
  unique(sale_id,part_id)
);

create table if not exists public.dbs_control_sale_settlements (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.dbs_control_sales(id) on delete restrict,
  scope_key text not null,
  amount_cents bigint not null check (amount_cents > 0),
  payment_method text not null check (payment_method in ('cash','pix','bank_transfer','card','other')),
  ledger_entry_id uuid references public.treasury_ledger_entries(id) on delete restrict,
  idempotency_key text not null check (char_length(trim(idempotency_key)) between 8 and 240),
  received_by uuid references public.users(id) on delete set null,
  received_at timestamptz not null default now(),
  unique(scope_key,idempotency_key)
);

create index if not exists dbs_control_sales_scope_created_idx
  on public.dbs_control_sales(scope_key,created_at desc);
create index if not exists dbs_control_sale_items_part_idx
  on public.dbs_control_sale_items(part_id,created_at desc);
create index if not exists dbs_control_sale_settlements_sale_idx
  on public.dbs_control_sale_settlements(sale_id,received_at desc);

alter table public.dbs_control_inventory_outbox enable row level security;
alter table public.dbs_control_reservation_batches enable row level security;
alter table public.dbs_control_reservation_consumptions enable row level security;
alter table public.dbs_control_work_order_reservations enable row level security;
alter table public.dbs_control_sales enable row level security;
alter table public.dbs_control_sale_items enable row level security;
alter table public.dbs_control_sale_settlements enable row level security;

revoke all on public.dbs_control_inventory_outbox,public.dbs_control_reservation_batches,public.dbs_control_reservation_consumptions,
  public.dbs_control_work_order_reservations,public.dbs_control_sales,
  public.dbs_control_sale_items,public.dbs_control_sale_settlements
  from public,anon,authenticated;
grant all on public.dbs_control_inventory_outbox,public.dbs_control_reservation_batches,public.dbs_control_reservation_consumptions,
  public.dbs_control_work_order_reservations,public.dbs_control_sales,
  public.dbs_control_sale_items,public.dbs_control_sale_settlements
  to service_role;

create or replace function public.dbs_control_reserve_work_order_parts(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_actor uuid := nullif(p_payload->>'actor_user_id','')::uuid;
  v_work_order uuid := nullif(p_payload->>'work_order_id','')::uuid;
  v_key text := nullif(btrim(p_payload->>'idempotency_key'),'');
  v_items jsonb := p_payload->'items';
  v_scope record;
  v_batch public.dbs_control_reservation_batches%rowtype;
  v_part record;
  v_item jsonb;
  v_qty numeric(12,3);
  v_available numeric(12,3);
  v_reservation uuid;
  v_count integer := 0;
  v_result jsonb := '[]'::jsonb;
begin
  if v_actor is null or not public.dbs_control_is_admin_actor(v_actor) then
    raise exception 'DBS_RESERVATION_FORBIDDEN' using errcode='42501';
  end if;
  if v_work_order is null or v_key is null or char_length(v_key) not between 8 and 240
     or jsonb_typeof(v_items) is distinct from 'array' or jsonb_array_length(v_items)=0 then
    raise exception 'DBS_RESERVATION_INPUT_INVALID' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(v_items) e(value)
    where jsonb_typeof(e.value)<>'object'
      or nullif(e.value->>'part_id','') is null
      or nullif(e.value->>'quantity','') is null
      or nullif(e.value->>'quantity','')::numeric<=0)
    or (select count(distinct nullif(e.value->>'part_id','')::uuid) from jsonb_array_elements(v_items) e(value))
       <> (select count(distinct p.id) from jsonb_array_elements(v_items) e(value)
           join public.dbs_control_parts p on p.id=nullif(e.value->>'part_id','')::uuid) then
    raise exception 'DBS_RESERVATION_ITEM_REFERENCE_INVALID' using errcode='22023';
  end if;
  select * into v_scope from public.dbs_control_inventory_scope_for_work_order(v_work_order);
  if not found then raise exception 'DBS_OS_NOT_FOUND' using errcode='23503'; end if;
  if not exists(select 1 from public.dbs_control_work_orders where id=v_work_order and deleted_at is null) then
    raise exception 'DBS_OS_UNAVAILABLE' using errcode='23514';
  end if;
  if exists(select 1 from public.dbs_control_work_orders where id=v_work_order
    and lower(coalesce(status,'')) in
      ('concluida','concluída','concluida com pendencia','concluída com pendência',
       'completed','complete','cancelada','cancelado','cancelled')) then
    raise exception 'DBS_OS_RESERVATION_STATUS_LOCKED' using errcode='23514';
  end if;
  if not exists(select 1 from public.users where id=v_actor and status='ativo'
      and (company_id is null or v_scope.company_id is null or company_id=v_scope.company_id)) then
    raise exception 'DBS_RESERVATION_SCOPE_MISMATCH' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_scope.scope_key||':reserve:'||v_key,0));
  select * into v_batch from public.dbs_control_reservation_batches
    where scope_key=v_scope.scope_key and idempotency_key=v_key for update;
  if found then
    if v_batch.work_order_id<>v_work_order then
      raise exception 'DBS_RESERVATION_IDEMPOTENCY_CONFLICT' using errcode='23505';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('reservation_id',r.id,'part_id',r.part_id,
      'quantity',r.quantity,'status',r.status) order by r.part_id),'[]'::jsonb)
      into v_result from public.dbs_control_work_order_reservations r where r.batch_id=v_batch.id;
    return jsonb_build_object('ok',true,'replayed',true,'batch_id',v_batch.id,'reservations',v_result);
  end if;

  -- Normaliza duplicatas e bloqueia peças em ordem determinística.
  for v_part in
    select p.id,p.stock_quantity,p.reserved_quantity,p.cost_cents,p.status,
      sum(x.qty)::numeric(12,3) as requested_qty
    from (
      select nullif(value->>'part_id','')::uuid as part_id,
        nullif(value->>'quantity','')::numeric(12,3) as qty
      from jsonb_array_elements(v_items)
    ) x join public.dbs_control_parts p on p.id=x.part_id
    group by p.id,p.stock_quantity,p.reserved_quantity,p.cost_cents,p.status
    order by p.id
  loop
    if v_part.status<>'ativo' or v_part.requested_qty<=0 then
      raise exception 'DBS_RESERVATION_PART_INVALID' using errcode='22023';
    end if;
    perform 1 from public.dbs_control_parts where id=v_part.id for update;
    v_available:=coalesce(v_part.stock_quantity,0)-coalesce(v_part.reserved_quantity,0);
    if v_available<v_part.requested_qty then
      raise exception 'DBS_RESERVATION_STOCK_INSUFFICIENT' using errcode='23514';
    end if;
  end loop;

  insert into public.dbs_control_reservation_batches(scope_key,company_id,work_order_id,idempotency_key,created_by)
  values(v_scope.scope_key,v_scope.company_id,v_work_order,v_key,v_actor) returning * into v_batch;

  for v_item in
    select jsonb_build_object('part_id',part_id,'quantity',sum(qty))
    from (
      select nullif(value->>'part_id','')::uuid as part_id,
        nullif(value->>'quantity','')::numeric(12,3) as qty
      from jsonb_array_elements(v_items)
    ) q group by part_id order by part_id
  loop
    v_qty:=(v_item->>'quantity')::numeric(12,3);
    select * into v_part from public.dbs_control_parts
      where id=(v_item->>'part_id')::uuid for update;
    if v_part.status<>'ativo' or v_qty<=0 or
      coalesce(v_part.stock_quantity,0)-coalesce(v_part.reserved_quantity,0)<v_qty then
      raise exception 'DBS_RESERVATION_STOCK_CHANGED' using errcode='23514';
    end if;
    update public.dbs_control_parts set reserved_quantity=reserved_quantity+v_qty,
      version=version+1,updated_at=now() where id=v_part.id;
    insert into public.dbs_control_work_order_reservations(
      batch_id,scope_key,company_id,work_order_id,part_id,quantity,unit_cost_cents,
      idempotency_key,created_by
    ) values(v_batch.id,v_scope.scope_key,v_scope.company_id,v_work_order,v_part.id,v_qty,
      coalesce(v_part.cost_cents,0),left(v_key,180)||':part:'||v_part.id::text,v_actor)
    returning id into v_reservation;
    insert into public.dbs_control_inventory_movements(
      company_id,scope_key,part_id,movement_type,quantity_delta,unit_cost_cents,
      balance_after,work_order_id,idempotency_key,created_by,metadata
    ) values(v_scope.company_id,v_scope.scope_key,v_part.id,'reserve',-v_qty,
      coalesce(v_part.cost_cents,0),coalesce(v_part.stock_quantity,0),v_work_order,
      left(v_key,170)||':reserve-move:'||v_part.id::text,v_actor,
      jsonb_build_object('reservation_id',v_reservation,'batch_id',v_batch.id));
    v_result:=v_result||jsonb_build_array(jsonb_build_object(
      'reservation_id',v_reservation,'part_id',v_part.id,'quantity',v_qty,'status','reserved'));
    v_count:=v_count+1;
  end loop;
  if v_count=0 then raise exception 'DBS_RESERVATION_ITEMS_INVALID' using errcode='22023'; end if;
  return jsonb_build_object('ok',true,'replayed',false,'batch_id',v_batch.id,'reservations',v_result);
end;
$$;

create or replace function public.dbs_control_release_work_order_reservation(
  p_reservation_id uuid,p_actor_user_id uuid,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_r public.dbs_control_work_order_reservations%rowtype;
  v_part public.dbs_control_parts%rowtype;
  v_actor_company uuid;
  v_key text:=nullif(btrim(p_idempotency_key),'');
begin
  if p_actor_user_id is null or not public.dbs_control_is_admin_actor(p_actor_user_id) then
    raise exception 'DBS_RESERVATION_FORBIDDEN' using errcode='42501';
  end if;
  if v_key is null or char_length(v_key) not between 8 and 240 then
    raise exception 'DBS_RESERVATION_IDEMPOTENCY_REQUIRED' using errcode='22023';
  end if;
  select * into v_r from public.dbs_control_work_order_reservations
    where id=p_reservation_id for update;
  if not found then raise exception 'DBS_RESERVATION_NOT_FOUND' using errcode='23503'; end if;
  select company_id into v_actor_company from public.users where id=p_actor_user_id and status='ativo';
  if v_actor_company is not null and v_actor_company is distinct from v_r.company_id then
    raise exception 'DBS_RESERVATION_SCOPE_MISMATCH' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_r.scope_key||':release:'||v_key,0));
  if exists(select 1 from public.dbs_control_inventory_movements
    where scope_key=v_r.scope_key and idempotency_key=v_key
      and coalesce(metadata->>'reservation_id','')<>v_r.id::text) then
    raise exception 'DBS_RESERVATION_RELEASE_IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;
  if exists(select 1 from public.dbs_control_inventory_movements
    where scope_key=v_r.scope_key and idempotency_key=v_key
      and metadata->>'reservation_id'=v_r.id::text) then
    return jsonb_build_object('ok',true,'replayed',true,'reservation_id',v_r.id,'status',v_r.status);
  end if;
  if v_r.status<>'reserved' then
    return jsonb_build_object('ok',true,'replayed',true,'reservation_id',v_r.id,'status',v_r.status);
  end if;
  select * into v_part from public.dbs_control_parts where id=v_r.part_id for update;
  if v_part.reserved_quantity<v_r.quantity then
    raise exception 'DBS_RESERVATION_BALANCE_INCONSISTENT' using errcode='23514';
  end if;
  update public.dbs_control_parts set reserved_quantity=reserved_quantity-v_r.quantity,
    version=version+1,updated_at=now() where id=v_part.id;
  update public.dbs_control_work_order_reservations set status='released',
    released_at=now(),version=version+1,updated_at=now() where id=v_r.id;
  insert into public.dbs_control_inventory_movements(
    company_id,scope_key,part_id,movement_type,quantity_delta,unit_cost_cents,
    balance_after,work_order_id,idempotency_key,created_by,metadata
  ) values(v_r.company_id,v_r.scope_key,v_r.part_id,'release',v_r.quantity,
    v_r.unit_cost_cents,v_part.stock_quantity,v_r.work_order_id,v_key,p_actor_user_id,
    jsonb_build_object('reservation_id',v_r.id));
  return jsonb_build_object('ok',true,'replayed',false,'reservation_id',v_r.id,'status','released');
end;
$$;

create or replace function public.dbs_control_consume_work_order_reservations(
  p_work_order_id uuid,p_actor_user_id uuid,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_scope record;
  v_r record;
  v_part public.dbs_control_parts%rowtype;
  v_actor_company uuid;
  v_key text:=nullif(btrim(p_idempotency_key),'');
  v_total_cost bigint:=0;
  v_ledger jsonb;
  v_ledger_id uuid;
  v_result jsonb:='[]'::jsonb;
  v_consumption public.dbs_control_reservation_consumptions%rowtype;
  v_consumed_count integer:=0;
begin
  if p_actor_user_id is null then
    raise exception 'DBS_RESERVATION_FORBIDDEN' using errcode='42501';
  end if;
  if v_key is null or char_length(v_key) not between 8 and 240 then
    raise exception 'DBS_RESERVATION_IDEMPOTENCY_REQUIRED' using errcode='22023';
  end if;
  select * into v_scope from public.dbs_control_inventory_scope_for_work_order(p_work_order_id);
  if not found then raise exception 'DBS_OS_NOT_FOUND' using errcode='23503'; end if;
  if not public.dbs_control_is_admin_actor(p_actor_user_id) and not exists (
    select 1
    from public.users u
    join public.dbs_control_work_orders wo on wo.id=p_work_order_id
    left join public.rh_employee_access ea on ea.user_id=u.id and ea.access_enabled=true
    left join public.rh_employees re on re.ponto_portal_user_id=u.id and re.dbs_control_access_enabled=true and re.is_active=true
    where u.id=p_actor_user_id and u.status='ativo' and u.role_key::text='COLABORADOR'
      and wo.assigned_employee_id=coalesce(ea.employee_id,re.id)
      and coalesce(u.company_id,wo.company_id)=wo.company_id
  ) then
    raise exception 'DBS_RESERVATION_FORBIDDEN' using errcode='42501';
  end if;
  select company_id into v_actor_company from public.users where id=p_actor_user_id and status='ativo';
  if v_actor_company is not null and v_actor_company is distinct from v_scope.company_id then
    raise exception 'DBS_RESERVATION_SCOPE_MISMATCH' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_scope.scope_key||':consume-reservations:'||p_work_order_id::text,0));
  select * into v_consumption from public.dbs_control_reservation_consumptions
    where work_order_id=p_work_order_id for update;
  if found then
    if v_consumption.idempotency_key<>v_key then
      return jsonb_build_object('ok',true,'replayed',true,'work_order_id',p_work_order_id,
        'cost_cents',v_consumption.total_cost_cents,'ledger_entry_id',v_consumption.ledger_entry_id);
    end if;
    return jsonb_build_object('ok',true,'replayed',true,'work_order_id',p_work_order_id,
      'cost_cents',v_consumption.total_cost_cents,'ledger_entry_id',v_consumption.ledger_entry_id);
  end if;
  for v_r in select * from public.dbs_control_work_order_reservations
    where work_order_id=p_work_order_id and status='reserved' order by part_id,id for update
  loop
    select * into v_part from public.dbs_control_parts where id=v_r.part_id for update;
    if v_part.stock_quantity<v_r.quantity or v_part.reserved_quantity<v_r.quantity then
      raise exception 'DBS_RESERVATION_BALANCE_INCONSISTENT' using errcode='23514';
    end if;
    update public.dbs_control_parts set stock_quantity=stock_quantity-v_r.quantity,
      reserved_quantity=reserved_quantity-v_r.quantity,version=version+1,updated_at=now()
      where id=v_part.id;
    update public.dbs_control_work_order_reservations set status='consumed',
      consumed_at=now(),version=version+1,updated_at=now() where id=v_r.id;
    insert into public.dbs_control_inventory_movements(
      company_id,scope_key,part_id,movement_type,quantity_delta,unit_cost_cents,
      balance_after,work_order_id,idempotency_key,created_by,metadata
    ) values(v_r.company_id,v_r.scope_key,v_r.part_id,'consume',-v_r.quantity,
      v_r.unit_cost_cents,v_part.stock_quantity-v_r.quantity,p_work_order_id,
      left(v_key,160)||':consume:'||v_r.id::text,p_actor_user_id,
      jsonb_build_object('reservation_id',v_r.id,'source','reserved_work_order_parts'));
    v_total_cost:=v_total_cost+round(v_r.quantity*v_r.unit_cost_cents)::bigint;
    v_result:=v_result||jsonb_build_array(jsonb_build_object('reservation_id',v_r.id,'status','consumed'));
    v_consumed_count:=v_consumed_count+1;
  end loop;
  if v_consumed_count=0 then
    return jsonb_build_object('ok',true,'replayed',false,'work_order_id',p_work_order_id,
      'cost_cents',0,'reservations',v_result);
  end if;
  if v_total_cost>0 then
    v_ledger:=public.post_treasury_ledger_entry(
      v_scope.scope_key,v_scope.company_id,current_date,current_date,
      'work_order_reserved_parts_cogs','Consumo de peças reservadas · OS '||p_work_order_id::text,
      left(v_key,150)||':'||md5(v_scope.scope_key||':'||v_key||':cogs'),'work-order-reserved-cogs:'||p_work_order_id::text||':'||v_key,
      p_actor_user_id,'posted',
      jsonb_build_object('source','dbs_control_work_order_reservations','work_order_id',p_work_order_id),
      jsonb_build_array(
        jsonb_build_object('account_code','5.1.01','account_name','Custo de peças aplicadas','account_type','expense','debit_cents',v_total_cost,'credit_cents',0),
        jsonb_build_object('account_code','1.1.03','account_name','Estoque de peças','account_type','asset','debit_cents',0,'credit_cents',v_total_cost)
      )
    );
    v_ledger_id:=nullif(v_ledger->>'entry_id','')::uuid;
  end if;
  insert into public.dbs_control_reservation_consumptions(
    scope_key,work_order_id,idempotency_key,total_cost_cents,ledger_entry_id,created_by
  ) values(v_scope.scope_key,p_work_order_id,v_key,v_total_cost,v_ledger_id,p_actor_user_id);

  insert into public.dbs_control_work_order_financials(work_order_id,company_id,scope_key,parts_cost_cents)
  values(p_work_order_id,v_scope.company_id,v_scope.scope_key,v_total_cost)
  on conflict(work_order_id) do update set
    parts_cost_cents=dbs_control_work_order_financials.parts_cost_cents+excluded.parts_cost_cents,
    updated_at=now(),version=dbs_control_work_order_financials.version+1;
  return jsonb_build_object('ok',true,'replayed',false,'work_order_id',p_work_order_id,
    'cost_cents',v_total_cost,'ledger_entry_id',v_ledger_id,'reservations',v_result);
end;
$$;

create or replace function public.dbs_control_create_part_sale(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_actor uuid:=nullif(p_payload->>'actor_user_id','')::uuid;
  v_company uuid:=nullif(p_payload->>'company_id','')::uuid;
  v_scope text:=nullif(btrim(p_payload->>'scope_key'),'');
  v_client uuid:=nullif(p_payload->>'client_id','')::uuid;
  v_key text:=nullif(btrim(p_payload->>'idempotency_key'),'');
  v_items jsonb:=p_payload->'items';
  v_existing public.dbs_control_sales%rowtype;
  v_sale public.dbs_control_sales%rowtype;
  v_part record;
  v_item jsonb;
  v_qty numeric(12,3);
  v_sale_unit integer;
  v_line bigint;
  v_cost bigint;
  v_total bigint:=0;
  v_total_cost bigint:=0;
  v_ledger jsonb;
  v_revenue_entry uuid;
  v_cogs_entry uuid;
  v_count integer:=0;
begin
  if v_actor is null or not public.dbs_control_is_admin_actor(v_actor) then
    raise exception 'DBS_SALE_FORBIDDEN' using errcode='42501';
  end if;
  if v_key is null or char_length(v_key) not between 8 and 240 or
     jsonb_typeof(v_items) is distinct from 'array' or jsonb_array_length(v_items)=0 then
    raise exception 'DBS_SALE_INPUT_INVALID' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(v_items) e(value)
    where jsonb_typeof(e.value)<>'object'
      or nullif(e.value->>'part_id','') is null
      or nullif(e.value->>'quantity','') is null
      or nullif(e.value->>'quantity','')::numeric<=0)
    or (select count(distinct nullif(e.value->>'part_id','')::uuid) from jsonb_array_elements(v_items) e(value))
       <> (select count(distinct p.id) from jsonb_array_elements(v_items) e(value)
           join public.dbs_control_parts p on p.id=nullif(e.value->>'part_id','')::uuid) then
    raise exception 'DBS_SALE_ITEM_REFERENCE_INVALID' using errcode='22023';
  end if;
  select company_id into v_company from public.users where id=v_actor and status='ativo';
  if nullif(p_payload->>'company_id','') is not null
     and nullif(p_payload->>'company_id','')::uuid is distinct from v_company then
    raise exception 'DBS_SALE_COMPANY_SCOPE_MISMATCH' using errcode='42501';
  end if;
  v_scope:=case when v_company is not null then 'company:'||v_company::text else 'user:'||v_actor::text end;
  if nullif(p_payload->>'scope_key','') is not null
     and nullif(p_payload->>'scope_key','') is distinct from v_scope then
    raise exception 'DBS_SALE_SCOPE_MISMATCH' using errcode='42501';
  end if;
  if v_client is not null and not exists(select 1 from public.dbs_control_clients where id=v_client and status='ativo') then
    raise exception 'DBS_SALE_CLIENT_INVALID' using errcode='23503';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_scope||':sale:'||v_key,0));
  select * into v_existing from public.dbs_control_sales where scope_key=v_scope and idempotency_key=v_key for update;
  if found then return jsonb_build_object('ok',true,'replayed',true,'sale_id',v_existing.id,
    'total_cents',v_existing.total_cents,'cost_cents',v_existing.cost_cents,'status',v_existing.status); end if;

  -- Bloqueia o catálogo em ordem de UUID e valida somente estoque livre.
  for v_part in
    select p.id,p.stock_quantity,p.reserved_quantity,p.cost_cents,p.sale_cents,p.status,
      sum(x.qty)::numeric(12,3) requested_qty,
      max(x.price_cents) requested_price
    from (
      select nullif(value->>'part_id','')::uuid part_id,
        nullif(value->>'quantity','')::numeric(12,3) qty,
        nullif(value->>'unit_sale_cents','')::integer price_cents
      from jsonb_array_elements(v_items)
    ) x join public.dbs_control_parts p on p.id=x.part_id
    group by p.id,p.stock_quantity,p.reserved_quantity,p.cost_cents,p.sale_cents,p.status
    order by p.id
  loop
    perform 1 from public.dbs_control_parts where id=v_part.id for update;
    if v_part.status<>'ativo' or v_part.requested_qty<=0 or
      v_part.stock_quantity-v_part.reserved_quantity<v_part.requested_qty then
      raise exception 'DBS_SALE_STOCK_INSUFFICIENT_OR_PART_INVALID' using errcode='23514';
    end if;
    if coalesce(v_part.requested_price,v_part.sale_cents,0)<=0 then
      raise exception 'DBS_SALE_PRICE_REQUIRED' using errcode='22023';
    end if;
  end loop;

  insert into public.dbs_control_sales(scope_key,company_id,client_id,idempotency_key,created_by,metadata)
  values(v_scope,v_company,v_client,v_key,v_actor,coalesce(p_payload->'metadata','{}'::jsonb))
  returning * into v_sale;

  for v_item in
    select jsonb_build_object('part_id',part_id,'quantity',sum(qty),
      'unit_sale_cents',max(price_cents))
    from (
      select nullif(value->>'part_id','')::uuid part_id,
        nullif(value->>'quantity','')::numeric(12,3) qty,
        nullif(value->>'unit_sale_cents','')::integer price_cents
      from jsonb_array_elements(v_items)
    ) q group by part_id order by part_id
  loop
    v_qty:=(v_item->>'quantity')::numeric(12,3);
    select * into v_part from public.dbs_control_parts
      where id=(v_item->>'part_id')::uuid for update;
    v_sale_unit:=coalesce(nullif(v_item->>'unit_sale_cents','')::integer,v_part.sale_cents);
    if v_sale_unit<=0 or v_part.stock_quantity-v_part.reserved_quantity<v_qty then
      raise exception 'DBS_SALE_STOCK_CHANGED' using errcode='23514';
    end if;
    v_line:=round(v_qty*v_sale_unit)::bigint;
    v_cost:=round(v_qty*coalesce(v_part.cost_cents,0))::bigint;
    update public.dbs_control_parts set stock_quantity=stock_quantity-v_qty,
      version=version+1,updated_at=now() where id=v_part.id;
    insert into public.dbs_control_sale_items(sale_id,part_id,quantity,unit_sale_cents,
      unit_cost_cents,total_cents,cost_total_cents)
    values(v_sale.id,v_part.id,v_qty,v_sale_unit,coalesce(v_part.cost_cents,0),v_line,v_cost);
    insert into public.dbs_control_inventory_movements(company_id,scope_key,part_id,movement_type,
      quantity_delta,unit_cost_cents,balance_after,idempotency_key,created_by,metadata)
    values(v_company,v_scope,v_part.id,'consume',-v_qty,coalesce(v_part.cost_cents,0),
      v_part.stock_quantity-v_qty,left(v_key,180)||':sale:'||v_part.id::text,v_actor,
      jsonb_build_object('sale_id',v_sale.id,'source','counter_sale'));
    v_total:=v_total+v_line;
    v_total_cost:=v_total_cost+v_cost;
    v_count:=v_count+1;
  end loop;
  if v_count=0 or v_total<=0 then raise exception 'DBS_SALE_TOTAL_INVALID' using errcode='22023'; end if;

  v_ledger:=public.post_treasury_ledger_entry(
    v_scope,v_company,current_date,current_date,'part_sale_revenue','Venda avulsa de peças · '||v_sale.id::text,
    left(v_key,150)||':'||md5(v_scope||':'||v_key||':revenue'),'part-sale-revenue:'||v_sale.id::text,v_actor,'posted',
    jsonb_build_object('source','dbs_control_sales','sale_id',v_sale.id),
    jsonb_build_array(
      jsonb_build_object('account_code','1.1.02','account_name','Contas a receber','account_type','asset','debit_cents',v_total,'credit_cents',0),
      jsonb_build_object('account_code','4.1.02','account_name','Receita de venda de peças','account_type','revenue','debit_cents',0,'credit_cents',v_total)
    )
  );
  v_revenue_entry:=nullif(v_ledger->>'entry_id','')::uuid;
  if v_total_cost>0 then
    v_ledger:=public.post_treasury_ledger_entry(
      v_scope,v_company,current_date,current_date,'part_sale_cogs','Custo das peças vendidas · '||v_sale.id::text,
      left(v_key||':cogs',200),'part-sale-cogs:'||v_sale.id::text,v_actor,'posted',
      jsonb_build_object('source','dbs_control_sales','sale_id',v_sale.id),
      jsonb_build_array(
        jsonb_build_object('account_code','5.1.01','account_name','Custo de peças vendidas','account_type','expense','debit_cents',v_total_cost,'credit_cents',0),
        jsonb_build_object('account_code','1.1.03','account_name','Estoque de peças','account_type','asset','debit_cents',0,'credit_cents',v_total_cost)
      )
    );
    v_cogs_entry:=nullif(v_ledger->>'entry_id','')::uuid;
  end if;
  update public.dbs_control_sales set total_cents=v_total,cost_cents=v_total_cost,
    revenue_entry_id=v_revenue_entry,cogs_entry_id=v_cogs_entry,updated_at=now()
    where id=v_sale.id;
  return jsonb_build_object('ok',true,'replayed',false,'sale_id',v_sale.id,
    'total_cents',v_total,'cost_cents',v_total_cost,'revenue_entry_id',v_revenue_entry,
    'cogs_entry_id',v_cogs_entry,'status','posted');
end;
$$;

create or replace function public.dbs_control_settle_part_sale(
  p_sale_id uuid,p_actor_user_id uuid,p_amount_cents bigint,p_payment_method text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_sale public.dbs_control_sales%rowtype;
  v_actor_company uuid;
  v_key text:=nullif(btrim(p_idempotency_key),'');
  v_ledger jsonb;
  v_entry uuid;
  v_received bigint;
begin
  if p_actor_user_id is null or not public.dbs_control_is_admin_actor(p_actor_user_id) then
    raise exception 'DBS_SALE_SETTLEMENT_FORBIDDEN' using errcode='42501';
  end if;
  if v_key is null or char_length(v_key) not between 8 and 240 or p_amount_cents<=0 or
    (p_payment_method is null or p_payment_method not in ('cash','pix','bank_transfer','card','other')) then
    raise exception 'DBS_SALE_SETTLEMENT_INPUT_INVALID' using errcode='22023';
  end if;
  select * into v_sale from public.dbs_control_sales where id=p_sale_id for update;
  if not found then raise exception 'DBS_SALE_NOT_FOUND' using errcode='23503'; end if;
  select company_id into v_actor_company from public.users where id=p_actor_user_id and status='ativo';
  if v_actor_company is not null and v_actor_company is distinct from v_sale.company_id then
    raise exception 'DBS_SALE_SCOPE_MISMATCH' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_sale.scope_key||':sale-settlement:'||v_key,0));
  if exists(select 1 from public.dbs_control_sale_settlements
      where scope_key=v_sale.scope_key and idempotency_key=v_key and sale_id<>v_sale.id) then
    raise exception 'DBS_SALE_SETTLEMENT_IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;
  if exists(select 1 from public.dbs_control_sale_settlements where scope_key=v_sale.scope_key and idempotency_key=v_key) then
    return jsonb_build_object('ok',true,'replayed',true,'sale_id',v_sale.id,
      'received_cents',v_sale.received_cents,'status',v_sale.status);
  end if;
  if v_sale.status='cancelled' or v_sale.received_cents+p_amount_cents>v_sale.total_cents then
    raise exception 'DBS_SALE_SETTLEMENT_EXCEEDS_OPEN_BALANCE' using errcode='23514';
  end if;
  v_ledger:=public.post_treasury_ledger_entry(
    v_sale.scope_key,v_sale.company_id,current_date,current_date,'part_sale_settlement',
    'Recebimento de venda avulsa · '||v_sale.id::text,left(v_key,150)||':'||md5(v_sale.scope_key||':'||v_key||':settlement'),
    'part-sale-settlement:'||v_sale.id::text||':'||md5(v_sale.scope_key||':'||v_key),p_actor_user_id,'posted',
    jsonb_build_object('source','dbs_control_sale_settlements','sale_id',v_sale.id,'payment_method',p_payment_method),
    jsonb_build_array(
      jsonb_build_object('account_code','1.1.01','account_name','Caixa e bancos','account_type','asset','debit_cents',p_amount_cents,'credit_cents',0),
      jsonb_build_object('account_code','1.1.02','account_name','Contas a receber','account_type','asset','debit_cents',0,'credit_cents',p_amount_cents)
    )
  );
  v_entry:=nullif(v_ledger->>'entry_id','')::uuid;
  insert into public.dbs_control_sale_settlements(sale_id,scope_key,amount_cents,payment_method,ledger_entry_id,idempotency_key,received_by)
  values(v_sale.id,v_sale.scope_key,p_amount_cents,p_payment_method,v_entry,v_key,p_actor_user_id);
  insert into public.dbs_control_inventory_outbox(
    scope_key,idempotency_key,aggregate_type,aggregate_id,event_type,payload
  ) values(
    v_sale.scope_key,'sale-settlement:'||md5(v_sale.scope_key||':'||v_key),
    'part_sale',v_sale.id,'part_sale.settled',
    jsonb_build_object('sale_id',v_sale.id,'amount_cents',p_amount_cents,
      'payment_method',p_payment_method,'ledger_entry_id',v_entry)
  ) on conflict(idempotency_key) do nothing;
  v_received:=v_sale.received_cents+p_amount_cents;
  update public.dbs_control_sales set received_cents=v_received,
    status=case when v_received=v_sale.total_cents then 'paid' else 'partially_paid' end,
    version=version+1,updated_at=now() where id=v_sale.id;
  return jsonb_build_object('ok',true,'replayed',false,'sale_id',v_sale.id,
    'received_cents',v_received,'open_cents',v_sale.total_cents-v_received,
    'ledger_entry_id',v_entry,'status',case when v_received=v_sale.total_cents then 'paid' else 'partially_paid' end);
end;
$$;

revoke all on function public.dbs_control_enqueue_inventory_outbox() from public,anon,authenticated;
revoke all on function public.dbs_control_reserve_work_order_parts(jsonb) from public,anon,authenticated;
revoke all on function public.dbs_control_release_work_order_reservation(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.dbs_control_consume_work_order_reservations(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.dbs_control_create_part_sale(jsonb) from public,anon,authenticated;
revoke all on function public.dbs_control_settle_part_sale(uuid,uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function public.dbs_control_reserve_work_order_parts(jsonb) to service_role;
grant execute on function public.dbs_control_release_work_order_reservation(uuid,uuid,text) to service_role;
grant execute on function public.dbs_control_consume_work_order_reservations(uuid,uuid,text) to service_role;
grant execute on function public.dbs_control_create_part_sale(jsonb) to service_role;
grant execute on function public.dbs_control_settle_part_sale(uuid,uuid,bigint,text,text) to service_role;

comment on table public.dbs_control_work_order_reservations is
  'Reservas auditáveis de peças por OS; não reduzem estoque físico até o consumo.';
comment on table public.dbs_control_sales is
  'Vendas avulsas de peças; receita e COGS são reconhecidos na venda, recebimentos são liquidações separadas.';
comment on function public.dbs_control_create_part_sale(jsonb) is
  'Baixa estoque livre, registra receita a receber e COGS em Ledger de dupla entrada na mesma transação.';
notify pgrst,'reload schema';

-- Wrapper atômico do delta de OS: quando há reserva, omite o consumo legado
-- de peças e consome a reserva na mesma transação que conclui a OS.
create or replace function public.dbs_control_apply_work_order_delta_with_reservations(p_payload jsonb)
returns table(ok boolean,status text,work_order_id uuid,protocol text,version bigint,command_id uuid,idempotency_key text,error_code text,error_message text,changed_at timestamptz)
language plpgsql security definer set search_path=public,pg_temp as $
declare
  v_payload jsonb:=p_payload;
  v_order_id uuid;
  v_status text:=lower(btrim(coalesce(p_payload->'patch'->>'status','')));
  v_key text:=nullif(btrim(p_payload->>'idempotency_key'),'');
  v_actor uuid:=nullif(p_payload->>'actor_user_id','')::uuid;
  v_has_reservations boolean:=false;
  v_delta record;
  v_consumption jsonb;
begin
  if nullif(p_payload->>'work_order_id','') is not null then
    v_order_id:=(p_payload->>'work_order_id')::uuid;
  else
    select id into v_order_id from public.dbs_control_work_orders
      where protocol=nullif(btrim(coalesce(p_payload->>'protocol',p_payload->>'protocolo')),'')
      limit 1;
  end if;

  if v_order_id is not null and v_status in
    ('concluida','concluída','concluido','concluído','completed','complete','finalizada','finalizado') then
    perform pg_advisory_xact_lock(hashtextextended('dbs-os-reservation-finalize:'||v_order_id::text,0));
    select exists(select 1 from public.dbs_control_work_order_reservations
      where work_order_id=v_order_id and status='reserved') into v_has_reservations;
    if v_has_reservations then
      v_payload:=v_payload-'parts';
    end if;
  end if;

  select * into v_delta from public.dbs_control_apply_work_order_delta(v_payload);
  if v_delta.ok and v_has_reservations then
    v_consumption:=public.dbs_control_consume_work_order_reservations(
      v_delta.work_order_id,v_actor,left(v_key,190)||':reserved-parts-consume');
    if coalesce((v_consumption->>'ok')::boolean,false) is not true then
      raise exception 'DBS_RESERVATION_CONSUMPTION_FAILED' using errcode='23514';
    end if;
  end if;
  return query select v_delta.ok,v_delta.status,v_delta.work_order_id,v_delta.protocol,
    v_delta.version,v_delta.command_id,v_delta.idempotency_key,v_delta.error_code,
    v_delta.error_message,v_delta.changed_at;
end;
$;

revoke all on function public.dbs_control_apply_work_order_delta_with_reservations(jsonb) from public,anon,authenticated;
grant execute on function public.dbs_control_apply_work_order_delta_with_reservations(jsonb) to service_role;

commit;
