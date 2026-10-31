-- DBS CONTROL: ponte relacional entre compras, estoque, OS e Financeiro.
--
-- Migração 100% aditiva. Nenhuma tabela operacional é removida, nenhum
-- snapshot é sobrescrito e os registros legados continuam disponíveis para
-- leitura/reconciliação. Novas entradas passam a usar movimentos imutáveis,
-- idempotência, Ledger de dupla entrada e Outbox na mesma transação.

begin;

create table if not exists public.dbs_control_purchases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete restrict,
  scope_key text not null,
  supplier_name text not null,
  document_number text,
  purchase_date date not null default current_date,
  status text not null default 'received'
    check (status in ('draft','received','cancelled')),
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid','partial','paid')),
  total_cents bigint not null default 0 check (total_cents >= 0),
  ledger_entry_id uuid references public.treasury_ledger_entries(id) on delete restrict,
  idempotency_key text not null
    check (char_length(trim(idempotency_key)) between 8 and 240),
  legacy_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  received_by uuid references public.users(id) on delete set null,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scope_key, idempotency_key)
);

create unique index if not exists dbs_control_purchases_legacy_key_uq
  on public.dbs_control_purchases(scope_key, legacy_key)
  where legacy_key is not null;

create table if not exists public.dbs_control_purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null
    references public.dbs_control_purchases(id) on delete restrict,
  part_id uuid not null
    references public.dbs_control_parts(id) on delete restrict,
  line_no integer not null,
  quantity numeric not null check (quantity > 0),
  unit_cost_cents integer not null check (unit_cost_cents >= 0),
  total_cents bigint not null check (total_cents >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (purchase_id, line_no)
);

create index if not exists dbs_control_purchase_items_part_idx
  on public.dbs_control_purchase_items(part_id, created_at desc);

create table if not exists public.dbs_control_inventory_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete restrict,
  scope_key text not null,
  part_id uuid not null
    references public.dbs_control_parts(id) on delete restrict,
  movement_type text not null
    check (movement_type in ('receipt','reserve','release','consume','return','adjustment','reversal')),
  quantity_delta numeric not null check (quantity_delta <> 0),
  unit_cost_cents integer not null default 0 check (unit_cost_cents >= 0),
  balance_after numeric not null default 0 check (balance_after >= 0),
  purchase_id uuid references public.dbs_control_purchases(id) on delete restrict,
  purchase_item_id uuid references public.dbs_control_purchase_items(id) on delete restrict,
  work_order_id uuid references public.dbs_control_work_orders(id) on delete restrict,
  work_order_part_id uuid references public.dbs_control_work_order_parts(id) on delete set null,
  idempotency_key text not null
    check (char_length(trim(idempotency_key)) between 8 and 240),
  created_by uuid references public.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (scope_key, idempotency_key)
);

create index if not exists dbs_control_inventory_movements_part_idx
  on public.dbs_control_inventory_movements(scope_key, part_id, created_at desc);
create index if not exists dbs_control_inventory_movements_work_order_idx
  on public.dbs_control_inventory_movements(work_order_id, created_at desc)
  where work_order_id is not null;
create index if not exists dbs_control_inventory_movements_purchase_idx
  on public.dbs_control_inventory_movements(purchase_id, created_at desc)
  where purchase_id is not null;

create table if not exists public.dbs_control_work_order_financials (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null
    references public.dbs_control_work_orders(id) on delete restrict,
  company_id uuid references public.companies(id) on delete restrict,
  scope_key text not null,
  revenue_cents bigint not null default 0 check (revenue_cents >= 0),
  parts_cost_cents bigint not null default 0 check (parts_cost_cents >= 0),
  revenue_entry_id uuid references public.treasury_ledger_entries(id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending','posted','reversed')),
  metadata jsonb not null default '{}'::jsonb,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (work_order_id)
);

create index if not exists dbs_control_work_order_financials_scope_idx
  on public.dbs_control_work_order_financials(scope_key, status, updated_at desc);

alter table public.dbs_control_parts
  add column if not exists reserved_quantity numeric not null default 0;
alter table public.dbs_control_parts
  add column if not exists version bigint not null default 1;
alter table public.dbs_control_work_order_parts
  add column if not exists cost_cents integer not null default 0;
alter table public.dbs_control_work_order_parts
  add column if not exists consumption_status text not null default 'consumed';
alter table public.dbs_control_work_order_parts
  add column if not exists idempotency_key text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'dbs_control_parts_reserved_quantity_check'
      and conrelid = 'public.dbs_control_parts'::regclass
  ) then
    alter table public.dbs_control_parts
      add constraint dbs_control_parts_reserved_quantity_check
      check (reserved_quantity >= 0 and reserved_quantity <= stock_quantity);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'dbs_control_work_order_parts_cost_check'
      and conrelid = 'public.dbs_control_work_order_parts'::regclass
  ) then
    alter table public.dbs_control_work_order_parts
      add constraint dbs_control_work_order_parts_cost_check
      check (cost_cents >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'dbs_control_work_order_parts_consumption_status_check'
      and conrelid = 'public.dbs_control_work_order_parts'::regclass
  ) then
    alter table public.dbs_control_work_order_parts
      add constraint dbs_control_work_order_parts_consumption_status_check
      check (consumption_status in ('reserved','consumed','released','returned'));
  end if;
end;
$$;

create index if not exists dbs_control_parts_status_stock_idx
  on public.dbs_control_parts(status, stock_quantity, updated_at desc);
create index if not exists dbs_control_work_order_parts_lookup_idx
  on public.dbs_control_work_order_parts(work_order_id, part_id);

create or replace function public.dbs_control_inventory_scope_for_work_order(p_work_order_id uuid)
returns table(scope_key text, company_id uuid, owner_user_id uuid)
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    case
      when u.company_id is not null then 'company:' || u.company_id::text
      when w.created_by_user_id is not null then 'user:' || w.created_by_user_id::text
      else 'work_order:' || w.id::text
    end as scope_key,
    u.company_id,
    w.created_by_user_id
  from public.dbs_control_work_orders w
  left join public.users u on u.id = w.created_by_user_id
  where w.id = p_work_order_id;
$$;

create or replace function public.dbs_control_is_admin_actor(p_actor uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.users u
    where u.id = p_actor
      and u.status = 'ativo'
      and u.role_key in ('SUPER_ADMIN','ADMIN_OPERACIONAL','GESTOR_CONTA','GESTOR_REGIONAL')
  );
$$;

create or replace function public.dbs_control_receive_purchase(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := nullif(p_payload->>'actor_user_id', '')::uuid;
  v_actor_company uuid;
  v_company_id uuid := nullif(p_payload->>'company_id', '')::uuid;
  v_scope_key text := nullif(btrim(p_payload->>'scope_key'), '');
  v_key text := nullif(btrim(p_payload->>'idempotency_key'), '');
  v_legacy_key text := nullif(btrim(p_payload->>'legacy_key'), '');
  v_supplier text := nullif(btrim(p_payload->>'supplier_name'), '');
  v_document text := nullif(btrim(p_payload->>'document_number'), '');
  v_purchase_date date := coalesce(nullif(p_payload->>'purchase_date', '')::date, current_date);
  v_payment_status text := coalesce(nullif(lower(btrim(p_payload->>'payment_status')), ''), 'unpaid');
  v_items jsonb := p_payload->'items';
  v_existing public.dbs_control_purchases%rowtype;
  v_purchase_id uuid;
  v_item jsonb;
  v_part_id uuid;
  v_item_id uuid;
  v_qty numeric;
  v_unit_cost integer;
  v_line_total bigint;
  v_line_no integer := 0;
  v_total bigint := 0;
  v_stock numeric;
  v_new_stock numeric;
  v_old_cost integer;
  v_new_cost integer;
  v_part_status text;
  v_ledger jsonb;
  v_ledger_id uuid;
  v_outbox_key text;
begin
  if v_actor is null or not public.dbs_control_is_admin_actor(v_actor) then
    raise exception 'DBS_INVENTORY_PERMISSION: somente a administração pode registrar compras.' using errcode = '42501';
  end if;
  if v_key is null or char_length(v_key) not between 8 and 240 then
    raise exception 'DBS_INVENTORY_IDEMPOTENCY_REQUIRED: idempotency_key inválida.' using errcode = '22023';
  end if;
  if v_supplier is null then
    raise exception 'DBS_PURCHASE_SUPPLIER_REQUIRED: fornecedor é obrigatório.' using errcode = '22023';
  end if;
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    raise exception 'DBS_PURCHASE_ITEMS_REQUIRED: informe pelo menos uma peça.' using errcode = '22023';
  end if;
  if v_payment_status not in ('unpaid','partial','paid') then
    raise exception 'DBS_PURCHASE_PAYMENT_STATUS_INVALID: situação de pagamento inválida.' using errcode = '22023';
  end if;

  select u.company_id into v_actor_company
  from public.users u
  where u.id = v_actor and u.status = 'ativo';
  if v_actor_company is not null and v_company_id is not null and v_actor_company is distinct from v_company_id then
    raise exception 'DBS_INVENTORY_COMPANY_MISMATCH: empresa do usuário e da compra são diferentes.' using errcode = '42501';
  end if;
  v_company_id := coalesce(v_company_id, v_actor_company);
  v_scope_key := coalesce(v_scope_key, case when v_company_id is not null then 'company:' || v_company_id::text else 'user:' || v_actor::text end);

  perform pg_advisory_xact_lock(hashtextextended(v_scope_key || ':' || v_key, 0));

  select p.* into v_existing
  from public.dbs_control_purchases p
  where p.scope_key = v_scope_key and p.idempotency_key = v_key
  for update;
  if found then
    return jsonb_build_object(
      'ok', true, 'replayed', true, 'purchase_id', v_existing.id,
      'total_cents', v_existing.total_cents, 'status', v_existing.status,
      'idempotency_key', v_key
    );
  end if;
  if v_legacy_key is not null and exists (
    select 1 from public.dbs_control_purchases p
    where p.scope_key = v_scope_key and p.legacy_key = v_legacy_key
  ) then
    select p.* into v_existing
    from public.dbs_control_purchases p
    where p.scope_key = v_scope_key and p.legacy_key = v_legacy_key
    for update;
    return jsonb_build_object(
      'ok', true, 'replayed', true, 'purchase_id', v_existing.id,
      'total_cents', v_existing.total_cents, 'status', v_existing.status,
      'idempotency_key', v_existing.idempotency_key
    );
  end if;

  insert into public.dbs_control_purchases (
    company_id, scope_key, supplier_name, document_number, purchase_date,
    status, payment_status, idempotency_key, legacy_key, created_by, received_by
  ) values (
    v_company_id, v_scope_key, v_supplier, v_document, v_purchase_date,
    'received', v_payment_status, v_key, v_legacy_key, v_actor, v_actor
  ) returning id into v_purchase_id;

  -- As peças são bloqueadas sempre na mesma ordem lógica do payload agrupado,
  -- evitando deadlocks quando duas compras chegam simultaneamente.
  for v_item in
    select jsonb_build_object(
      'part_id', part_id,
      'quantity', sum(quantity),
      'unit_cost_cents', max(unit_cost_cents)
    )
    from (
      select
        nullif(coalesce(value->>'part_id', value->>'id'), '')::uuid as part_id,
        greatest(coalesce(nullif(coalesce(value->>'quantity', value->>'qtd'), '')::numeric, 0), 0) as quantity,
        greatest(coalesce(nullif(coalesce(value->>'unit_cost_cents', value->>'unit_cost'), '')::numeric, 0), 0)::integer as unit_cost_cents
      from jsonb_array_elements(v_items) as item(value)
    ) normalized
    where part_id is not null and quantity > 0
    group by part_id
    order by part_id
  loop
    v_part_id := (v_item->>'part_id')::uuid;
    v_qty := (v_item->>'quantity')::numeric;
    v_unit_cost := greatest(coalesce((v_item->>'unit_cost_cents')::integer, 0), 0);

    select p.stock_quantity, p.cost_cents, p.status
      into v_stock, v_old_cost, v_part_status
    from public.dbs_control_parts p
    where p.id = v_part_id
    for update;
    if not found then
      raise exception 'DBS_PART_NOT_FOUND: peça % não existe no catálogo relacional.', v_part_id using errcode = '23503';
    end if;
    if v_part_status <> 'ativo' then
      raise exception 'DBS_PART_INACTIVE: a peça selecionada está inativa.' using errcode = '23514';
    end if;

    v_new_stock := coalesce(v_stock, 0) + v_qty;
    v_new_cost := case
      when v_new_stock > 0 then round(((coalesce(v_stock, 0) * coalesce(v_old_cost, 0)) + (v_qty * v_unit_cost)) / v_new_stock)::integer
      else v_unit_cost
    end;
    v_line_no := v_line_no + 1;
    v_line_total := round(v_qty * v_unit_cost)::bigint;
    v_total := v_total + v_line_total;

    insert into public.dbs_control_purchase_items (
      purchase_id, part_id, line_no, quantity, unit_cost_cents, total_cents
    ) values (
      v_purchase_id, v_part_id, v_line_no, v_qty, v_unit_cost, v_line_total
    ) returning id into v_item_id;

    update public.dbs_control_parts
       set stock_quantity = v_new_stock,
           cost_cents = v_new_cost,
           version = version + 1,
           updated_at = now()
     where id = v_part_id;

    insert into public.dbs_control_inventory_movements (
      company_id, scope_key, part_id, movement_type, quantity_delta,
      unit_cost_cents, balance_after, purchase_id, purchase_item_id,
      idempotency_key, created_by, metadata
    ) values (
      v_company_id, v_scope_key, v_part_id, 'receipt', v_qty,
      v_unit_cost, v_new_stock, v_purchase_id, v_item_id,
      left(v_key || ':receipt:' || v_part_id::text, 240), v_actor,
      jsonb_build_object('source', 'purchase', 'purchase_id', v_purchase_id)
    ) on conflict (scope_key, idempotency_key) do nothing;
  end loop;

  if v_total <= 0 then
    raise exception 'DBS_PURCHASE_TOTAL_INVALID: o valor total da compra precisa ser maior que zero.' using errcode = '22023';
  end if;

  v_ledger := public.post_treasury_ledger_entry(
    v_scope_key, v_company_id, v_purchase_date, v_purchase_date,
    'inventory_receipt', 'Entrada de estoque · ' || v_supplier,
    left(v_key || ':ledger', 200), 'purchase:' || v_purchase_id::text,
    v_actor, 'posted',
    jsonb_build_object('source', 'dbs_control_purchase', 'purchase_id', v_purchase_id),
    jsonb_build_array(
      jsonb_build_object(
        'account_code', '1.1.03', 'account_name', 'Estoque de peças',
        'account_type', 'asset', 'debit_cents', v_total, 'credit_cents', 0,
        'memo', 'Entrada de peças'
      ),
      jsonb_build_object(
        'account_code', case when v_payment_status = 'paid' then '1.1.01' else '2.1.01' end,
        'account_name', case when v_payment_status = 'paid' then 'Caixa e bancos' else 'Fornecedores' end,
        'account_type', case when v_payment_status = 'paid' then 'asset' else 'liability' end,
        'debit_cents', 0, 'credit_cents', v_total,
        'memo', case when v_payment_status = 'paid' then 'Compra paga' else 'Compra a pagar' end
      )
    )
  );
  v_ledger_id := nullif(v_ledger->>'entry_id', '')::uuid;

  update public.dbs_control_purchases
     set total_cents = v_total, ledger_entry_id = v_ledger_id, updated_at = now()
   where id = v_purchase_id;

  v_outbox_key := left('inventory:purchase:' || v_scope_key || ':' || v_key, 240);
  insert into public.dbs_control_outbox (
    idempotency_key, company_id, aggregate_type, aggregate_id,
    event_type, aggregate_version, payload
  ) values (
    v_outbox_key, v_company_id, 'purchase', null,
    'inventory.purchase.received', 1,
    jsonb_build_object('purchase_id', v_purchase_id, 'scope_key', v_scope_key, 'total_cents', v_total)
  ) on conflict (idempotency_key) do nothing;

  return jsonb_build_object(
    'ok', true, 'replayed', false, 'purchase_id', v_purchase_id,
    'total_cents', v_total, 'ledger_entry_id', v_ledger_id,
    'idempotency_key', v_key
  );
end;
$$;

create or replace function public.dbs_control_upsert_part(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := nullif(p_payload->>'actor_user_id', '')::uuid;
  v_id uuid := nullif(p_payload->>'id', '')::uuid;
  v_sku text := nullif(btrim(p_payload->>'sku'), '');
  v_name text := nullif(btrim(coalesce(p_payload->>'name', p_payload->>'nome')), '');
  v_description text := coalesce(p_payload->>'description', p_payload->>'descricao', '');
  v_cost integer := greatest(coalesce(nullif(coalesce(p_payload->>'cost_cents', p_payload->>'custo'), '')::numeric, 0), 0)::integer;
  v_sale integer := greatest(coalesce(nullif(coalesce(p_payload->>'sale_cents', p_payload->>'venda'), '')::numeric, 0), 0)::integer;
  v_status text := coalesce(nullif(lower(btrim(p_payload->>'status')), ''), 'ativo');
  v_key text := nullif(btrim(p_payload->>'idempotency_key'), '');
  v_scope_key text := nullif(btrim(p_payload->>'scope_key'), '');
  v_company_id uuid := nullif(p_payload->>'company_id', '')::uuid;
  v_existing public.dbs_control_parts%rowtype;
begin
  if v_actor is null or not public.dbs_control_is_admin_actor(v_actor) then
    raise exception 'DBS_INVENTORY_PERMISSION: somente a administração pode alterar o catálogo de peças.' using errcode = '42501';
  end if;
  if v_sku is null or v_name is null then
    raise exception 'DBS_PART_REQUIRED: SKU e nome da peça são obrigatórios.' using errcode = '22023';
  end if;
  if v_status not in ('ativo','inativo') then
    raise exception 'DBS_PART_STATUS_INVALID: status da peça inválido.' using errcode = '22023';
  end if;
  if v_key is null then v_key := 'part-upsert:' || coalesce(v_id::text, v_sku) || ':' || gen_random_uuid()::text; end if;
  select p.* into v_existing
  from public.dbs_control_parts p
  where (v_id is not null and p.id = v_id) or p.sku = v_sku
  order by (case when v_id is not null and p.id = v_id then 0 else 1 end)
  limit 1
  for update;

  if found then
    update public.dbs_control_parts
       set sku = v_sku, name = v_name, description = v_description,
           cost_cents = v_cost, sale_cents = v_sale, status = v_status,
           version = version + 1, updated_at = now()
     where id = v_existing.id
     returning * into v_existing;
  else
    insert into public.dbs_control_parts (id, sku, name, description, stock_quantity, cost_cents, sale_cents, status)
    values (coalesce(v_id, gen_random_uuid()), v_sku, v_name, v_description, 0, v_cost, v_sale, v_status)
    returning * into v_existing;
  end if;

  return jsonb_build_object(
    'ok', true, 'part_id', v_existing.id, 'sku', v_existing.sku,
    'stock_quantity', v_existing.stock_quantity, 'cost_cents', v_existing.cost_cents,
    'sale_cents', v_existing.sale_cents, 'version', v_existing.version,
    'idempotency_key', v_key
  );
end;
$$;

-- A lista de peças da OS continua sendo a intenção final da OS, mas agora cada
-- variação gera um movimento imutável e um custo contábil compensado no Ledger.
create or replace function public.dbs_control_apply_work_order_parts_in_tx(
  p_work_order_id uuid,
  p_parts jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item jsonb;
  v_existing record;
  v_part_id uuid;
  v_new_quantity numeric;
  v_old_quantity numeric;
  v_delta numeric;
  v_stock numeric;
  v_new_stock numeric;
  v_unit_cents integer;
  v_cost_cents integer;
  v_key text := nullif(current_setting('app.dbs_control_idempotency_key', true), '');
  v_actor uuid;
  v_scope text;
  v_company uuid;
  v_owner uuid;
  v_total_cost_delta numeric := 0;
  v_move_key text;
  v_ledger jsonb;
  v_financial_scope record;
begin
  if p_parts is null then return; end if;
  if jsonb_typeof(p_parts) <> 'array' then
    raise exception 'DBS_OS_PARTS_INVALID: peças da OS devem ser uma lista.' using errcode = '22023';
  end if;
  if v_key is null then v_key := 'parts-direct:' || gen_random_uuid()::text; end if;

  select sc.actor_user_id into v_actor
  from public.dbs_control_sync_commands sc
  where sc.idempotency_key = v_key;
  select s.scope_key, s.company_id, s.owner_user_id
    into v_financial_scope
  from public.dbs_control_inventory_scope_for_work_order(p_work_order_id) s;
  if not found then
    raise exception 'DBS_OS_NOT_FOUND: OS não encontrada para aplicar peças.' using errcode = '23503';
  end if;
  v_scope := v_financial_scope.scope_key;
  v_company := v_financial_scope.company_id;
  v_owner := coalesce(v_actor, v_financial_scope.owner_user_id);

  -- Remoções devolvem a quantidade ao estoque e geram uma reversão de custo.
  for v_existing in
    select p.id, p.part_id, p.quantity, coalesce(p.cost_cents, 0) as cost_cents
    from public.dbs_control_work_order_parts p
    where p.work_order_id = p_work_order_id
    for update
  loop
    if not exists (
      select 1
      from jsonb_array_elements(p_parts) incoming(value)
      where nullif(coalesce(incoming.value->>'part_id', incoming.value->>'id'), '')::uuid = v_existing.part_id
        and greatest(coalesce(nullif(coalesce(incoming.value->>'quantity', incoming.value->>'qtd'), '')::numeric, 0), 0) > 0
    ) then
      select p.stock_quantity, p.cost_cents into v_stock, v_cost_cents
      from public.dbs_control_parts p where p.id = v_existing.part_id for update;
      if not found then raise exception 'DBS_OS_PART_NOT_FOUND: peça não existe no catálogo relacional.' using errcode = '23503'; end if;
      v_new_stock := coalesce(v_stock, 0) + v_existing.quantity;
      update public.dbs_control_parts set stock_quantity = v_new_stock, version = version + 1, updated_at = now() where id = v_existing.part_id;
      v_move_key := left(v_key || ':return:' || v_existing.part_id::text, 240);
      if not exists (select 1 from public.dbs_control_inventory_movements where scope_key = v_scope and idempotency_key = v_move_key) then
        insert into public.dbs_control_inventory_movements (
          company_id, scope_key, part_id, movement_type, quantity_delta,
          unit_cost_cents, balance_after, work_order_id, work_order_part_id,
          idempotency_key, created_by, metadata
        ) values (
          v_company, v_scope, v_existing.part_id, 'return', v_existing.quantity,
          coalesce(v_existing.cost_cents, v_cost_cents, 0), v_new_stock,
          p_work_order_id, v_existing.id, v_move_key, v_owner,
          jsonb_build_object('source', 'work_order_parts_reconciliation')
        );
        v_total_cost_delta := v_total_cost_delta - (v_existing.quantity * coalesce(v_existing.cost_cents, v_cost_cents, 0));
      end if;
      delete from public.dbs_control_work_order_parts where id = v_existing.id;
    end if;
  end loop;

  -- Duplicatas no payload são agregadas antes do lock e da baixa.
  for v_item in
    select jsonb_build_object(
      'part_id', part_id,
      'quantity', sum(quantity),
      'unit_cents', max(unit_cents)
    )
    from (
      select
        nullif(coalesce(value->>'part_id', value->>'id'), '')::uuid as part_id,
        greatest(coalesce(nullif(coalesce(value->>'quantity', value->>'qtd'), '')::numeric, 0), 0) as quantity,
        nullif(coalesce(value->>'unit_cents', value->>'venda'), '')::numeric::integer as unit_cents
      from jsonb_array_elements(p_parts) as item(value)
    ) normalized
    where part_id is not null
    group by part_id
    order by part_id
  loop
    v_part_id := (v_item->>'part_id')::uuid;
    v_new_quantity := greatest(coalesce((v_item->>'quantity')::numeric, 0), 0);
    select p.id, p.quantity, coalesce(p.cost_cents, 0) as cost_cents
      into v_existing
    from public.dbs_control_work_order_parts p
    where p.work_order_id = p_work_order_id and p.part_id = v_part_id
    order by p.created_at, p.id
    limit 1
    for update;
    v_old_quantity := coalesce(v_existing.quantity, 0);
    v_delta := v_new_quantity - v_old_quantity;

    select p.stock_quantity, p.cost_cents into v_stock, v_cost_cents
    from public.dbs_control_parts p where p.id = v_part_id for update;
    if not found then raise exception 'DBS_OS_PART_NOT_FOUND: peça não existe no catálogo relacional.' using errcode = '23503'; end if;
    if v_delta > coalesce(v_stock, 0) then raise exception 'DBS_OS_STOCK_INSUFFICIENT: estoque insuficiente para a peça indicada.' using errcode = '23514'; end if;

    v_unit_cents := coalesce((v_item->>'unit_cents')::integer, 0);
    v_new_stock := coalesce(v_stock, 0) - v_delta;
    if v_delta <> 0 then
      update public.dbs_control_parts set stock_quantity = v_new_stock, version = version + 1, updated_at = now() where id = v_part_id;
      v_move_key := left(v_key || ':' || case when v_delta > 0 then 'consume' else 'return' end || ':' || v_part_id::text, 240);
      if not exists (select 1 from public.dbs_control_inventory_movements where scope_key = v_scope and idempotency_key = v_move_key) then
        insert into public.dbs_control_inventory_movements (
          company_id, scope_key, part_id, movement_type, quantity_delta,
          unit_cost_cents, balance_after, work_order_id, work_order_part_id,
          idempotency_key, created_by, metadata
        ) values (
          v_company, v_scope, v_part_id,
          case when v_delta > 0 then 'consume' else 'return' end,
          -v_delta, coalesce(v_cost_cents, 0), v_new_stock,
          p_work_order_id, v_existing.id, v_move_key, v_owner,
          jsonb_build_object('source', 'work_order_parts_delta', 'quantity_delta', v_delta)
        );
        v_total_cost_delta := v_total_cost_delta + (v_delta * coalesce(v_cost_cents, 0));
      end if;
    end if;

    if v_new_quantity <= 0 then
      if v_existing.id is not null then delete from public.dbs_control_work_order_parts where id = v_existing.id; end if;
    elsif v_existing.id is not null then
      update public.dbs_control_work_order_parts
         set quantity = v_new_quantity, unit_cents = v_unit_cents,
             cost_cents = coalesce(v_existing.cost_cents, v_cost_cents, 0),
             consumption_status = 'consumed', idempotency_key = v_key
       where id = v_existing.id;
    else
      insert into public.dbs_control_work_order_parts (
        work_order_id, part_id, quantity, unit_cents, cost_cents,
        consumption_status, idempotency_key
      ) values (
        p_work_order_id, v_part_id, v_new_quantity, v_unit_cents,
        coalesce(v_cost_cents, 0), 'consumed', v_key
      );
    end if;
  end loop;

  if v_total_cost_delta <> 0 and v_owner is not null then
    v_ledger := public.post_treasury_ledger_entry(
      v_scope, v_company, current_date, current_date,
      case when v_total_cost_delta > 0 then 'work_order_parts_consumed' else 'work_order_parts_returned' end,
      case when v_total_cost_delta > 0 then 'Consumo de peças · OS ' || p_work_order_id::text else 'Devolução de peças · OS ' || p_work_order_id::text end,
      left(v_key || ':cogs', 200), 'work-order-parts:' || p_work_order_id::text || ':' || v_key,
      v_owner, 'posted',
      jsonb_build_object('source', 'dbs_control_work_order_parts', 'work_order_id', p_work_order_id),
      case when v_total_cost_delta > 0 then
        jsonb_build_array(
          jsonb_build_object('account_code','5.1.01','account_name','Custo de peças aplicadas','account_type','expense','debit_cents',round(v_total_cost_delta)::bigint,'credit_cents',0),
          jsonb_build_object('account_code','1.1.03','account_name','Estoque de peças','account_type','asset','debit_cents',0,'credit_cents',round(v_total_cost_delta)::bigint)
        )
      else
        jsonb_build_array(
          jsonb_build_object('account_code','1.1.03','account_name','Estoque de peças','account_type','asset','debit_cents',round(abs(v_total_cost_delta))::bigint,'credit_cents',0),
          jsonb_build_object('account_code','5.1.01','account_name','Custo de peças aplicadas','account_type','expense','debit_cents',0,'credit_cents',round(abs(v_total_cost_delta))::bigint)
        )
      end
    );
  end if;

  insert into public.dbs_control_work_order_financials (work_order_id, company_id, scope_key, parts_cost_cents)
  select p_work_order_id, v_company, v_scope,
         greatest(0, round(coalesce(sum(case when m.movement_type = 'consume' then -m.quantity_delta * m.unit_cost_cents else 0 end), 0))::bigint)
  from public.dbs_control_inventory_movements m
  where m.work_order_id = p_work_order_id
  on conflict (work_order_id) do update set
    parts_cost_cents = excluded.parts_cost_cents,
    updated_at = now(),
    version = public.dbs_control_work_order_financials.version + 1;
end;
$$;

create or replace function public.dbs_control_post_work_order_revenue()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text := lower(trim(coalesce(new.status, '')));
  v_completed boolean := v_status in ('concluida','concluída','concluido','concluído','concluida_com_pendencia','concluída_com_pendência','completed','complete');
  v_scope record;
  v_actor uuid;
  v_financial public.dbs_control_work_order_financials%rowtype;
  v_ledger jsonb;
  v_revenue bigint := greatest(coalesce(new.total_cents, 0), 0);
begin
  if not v_completed or v_revenue <= 0 then return new; end if;
  select sc.actor_user_id into v_actor
  from public.dbs_control_sync_commands sc
  where sc.idempotency_key = nullif(current_setting('app.dbs_control_idempotency_key', true), '');
  select * into v_scope from public.dbs_control_inventory_scope_for_work_order(new.id);
  if not found then return new; end if;
  v_actor := coalesce(v_actor, v_scope.owner_user_id);
  if v_actor is null then return new; end if;

  select f.* into v_financial
  from public.dbs_control_work_order_financials f
  where f.work_order_id = new.id
  for update;
  if found and v_financial.revenue_entry_id is not null then return new; end if;

  v_ledger := public.post_treasury_ledger_entry(
    v_scope.scope_key, v_scope.company_id, current_date, current_date,
    'work_order_revenue', 'Receita de serviço · ' || coalesce(new.protocol, new.protocolo, new.id::text),
    left('work-order:revenue:' || new.id::text, 200), 'work-order-revenue:' || new.id::text,
    v_actor, 'posted',
    jsonb_build_object('source', 'dbs_control_work_order', 'work_order_id', new.id, 'protocol', coalesce(new.protocol, new.protocolo)),
    jsonb_build_array(
      jsonb_build_object('account_code','1.1.02','account_name','Contas a receber','account_type','asset','debit_cents',v_revenue,'credit_cents',0),
      jsonb_build_object('account_code','4.1.01','account_name','Receita de serviços','account_type','revenue','debit_cents',0,'credit_cents',v_revenue)
    )
  );

  insert into public.dbs_control_work_order_financials (
    work_order_id, company_id, scope_key, revenue_cents, revenue_entry_id, status
  ) values (
    new.id, v_scope.company_id, v_scope.scope_key, v_revenue,
    nullif(v_ledger->>'entry_id', '')::uuid, 'posted'
  )
  on conflict (work_order_id) do update set
    revenue_cents = excluded.revenue_cents,
    revenue_entry_id = excluded.revenue_entry_id,
    status = 'posted',
    updated_at = now(),
    version = public.dbs_control_work_order_financials.version + 1;
  return new;
end;
$$;

drop trigger if exists trg_dbs_control_work_order_revenue on public.dbs_control_work_orders;
create trigger trg_dbs_control_work_order_revenue
after insert or update of status, total_cents on public.dbs_control_work_orders
for each row execute function public.dbs_control_post_work_order_revenue();

create or replace function public.dbs_control_inventory_health()
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'parts', (select count(*) from public.dbs_control_parts where status = 'ativo'),
    'stock_quantity', (select coalesce(sum(stock_quantity), 0) from public.dbs_control_parts where status = 'ativo'),
    'reserved_quantity', (select coalesce(sum(reserved_quantity), 0) from public.dbs_control_parts where status = 'ativo'),
    'purchases', (select count(*) from public.dbs_control_purchases),
    'movements', (select count(*) from public.dbs_control_inventory_movements),
    'pending_outbox', (select count(*) from public.dbs_control_outbox where status = 'pending' and aggregate_type = 'purchase')
  );
$$;

alter table public.dbs_control_purchases enable row level security;
alter table public.dbs_control_purchase_items enable row level security;
alter table public.dbs_control_inventory_movements enable row level security;
alter table public.dbs_control_work_order_financials enable row level security;

revoke all on public.dbs_control_purchases, public.dbs_control_purchase_items,
  public.dbs_control_inventory_movements, public.dbs_control_work_order_financials
  from public, anon, authenticated;
grant all on public.dbs_control_purchases, public.dbs_control_purchase_items,
  public.dbs_control_inventory_movements, public.dbs_control_work_order_financials
  to service_role;

revoke all on function public.dbs_control_inventory_scope_for_work_order(uuid) from public, anon, authenticated;
revoke all on function public.dbs_control_is_admin_actor(uuid) from public, anon, authenticated;
revoke all on function public.dbs_control_receive_purchase(jsonb) from public, anon, authenticated;
revoke all on function public.dbs_control_upsert_part(jsonb) from public, anon, authenticated;
revoke all on function public.dbs_control_apply_work_order_parts_in_tx(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.dbs_control_post_work_order_revenue() from public, anon, authenticated;
revoke all on function public.dbs_control_inventory_health() from public, anon, authenticated;
grant execute on function public.dbs_control_inventory_scope_for_work_order(uuid) to service_role;
grant execute on function public.dbs_control_is_admin_actor(uuid) to service_role;
grant execute on function public.dbs_control_receive_purchase(jsonb) to service_role;
grant execute on function public.dbs_control_upsert_part(jsonb) to service_role;
grant execute on function public.dbs_control_apply_work_order_parts_in_tx(uuid, jsonb) to service_role;
grant execute on function public.dbs_control_post_work_order_revenue() to service_role;
grant execute on function public.dbs_control_inventory_health() to service_role;

comment on table public.dbs_control_inventory_movements is
  'Livro imutável de entradas, consumos, devoluções e ajustes do estoque do DBS CONTROL.';
comment on table public.dbs_control_work_order_financials is
  'Conciliação financeira por OS: receita, custo de peças e lançamentos do Ledger.';

notify pgrst, 'reload schema';
commit;
