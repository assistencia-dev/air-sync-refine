-- DBS Air frontend relational integration: suppliers, units, cost centers and measured gas.
-- Additive only. Existing rows and snapshots remain unchanged.
BEGIN;

CREATE TABLE IF NOT EXISTS public.dbs_control_cost_centers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE RESTRICT,
  scope_key text NOT NULL CHECK (char_length(btrim(scope_key)) BETWEEN 3 AND 240),
  code text NOT NULL CHECK (char_length(btrim(code)) BETWEEN 1 AND 40),
  normalized_code text GENERATED ALWAYS AS (upper(btrim(code))) STORED,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 180),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(scope_key,normalized_code),
  UNIQUE(scope_key,id)
);
CREATE INDEX IF NOT EXISTS dbs_control_cost_centers_scope_status_idx
  ON public.dbs_control_cost_centers(scope_key,status,normalized_code);
ALTER TABLE public.dbs_control_cost_centers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dbs_control_cost_centers FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.dbs_control_cost_centers TO service_role;

ALTER TABLE public.dbs_control_parts
  ADD COLUMN IF NOT EXISTS supplier_id uuid,
  ADD COLUMN IF NOT EXISTS measure_unit_id uuid;
ALTER TABLE public.dbs_control_purchases ADD COLUMN IF NOT EXISTS supplier_id uuid;
ALTER TABLE public.dbs_control_purchases ADD COLUMN IF NOT EXISTS cost_center_id uuid;
ALTER TABLE public.dbs_control_purchase_items ADD COLUMN IF NOT EXISTS cost_center_id uuid;
ALTER TABLE public.dbs_control_purchase_receipts ADD COLUMN IF NOT EXISTS cost_center_id uuid;
ALTER TABLE public.dbs_control_purchase_receipt_items ADD COLUMN IF NOT EXISTS cost_center_id uuid;
ALTER TABLE public.dbs_control_inventory_movements ADD COLUMN IF NOT EXISTS cost_center_id uuid;
ALTER TABLE public.dbs_control_quotes ADD COLUMN IF NOT EXISTS cost_center_id uuid;
ALTER TABLE public.dbs_control_work_orders ADD COLUMN IF NOT EXISTS cost_center_id uuid;
ALTER TABLE public.dbs_control_work_order_financials ADD COLUMN IF NOT EXISTS cost_center_id uuid;
ALTER TABLE public.dbs_control_work_order_parts ADD COLUMN IF NOT EXISTS cost_center_id uuid;
ALTER TABLE public.dbs_control_work_order_reservations ADD COLUMN IF NOT EXISTS cost_center_id uuid;
ALTER TABLE public.dbs_control_reservation_consumptions ADD COLUMN IF NOT EXISTS cost_center_id uuid;
ALTER TABLE public.dbs_control_car_stock ADD COLUMN IF NOT EXISTS cost_center_id uuid;
ALTER TABLE public.dbs_control_car_stock_consumptions ADD COLUMN IF NOT EXISTS cost_center_id uuid;
ALTER TABLE public.dbs_control_gas_usage ADD COLUMN IF NOT EXISTS cost_center_id uuid;
ALTER TABLE public.treasury_ledger_entries ADD COLUMN IF NOT EXISTS cost_center_id uuid;
ALTER TABLE public.treasury_ledger_lines ADD COLUMN IF NOT EXISTS cost_center_id uuid;

ALTER TABLE public.dbs_control_gas_cylinders
  ADD COLUMN IF NOT EXISTS tare_weight_kg numeric(12,3),
  ADD COLUMN IF NOT EXISTS initial_gross_weight_kg numeric(12,3),
  ADD COLUMN IF NOT EXISTS current_gross_weight_kg numeric(12,3),
  ADD COLUMN IF NOT EXISTS cost_per_kg_cents integer;
ALTER TABLE public.dbs_control_gas_usage
  ADD COLUMN IF NOT EXISTS gross_weight_before_kg numeric(12,3),
  ADD COLUMN IF NOT EXISTS gross_weight_after_kg numeric(12,3),
  ADD COLUMN IF NOT EXISTS gas_consumed_kg numeric(12,3),
  ADD COLUMN IF NOT EXISTS cost_per_kg_cents integer,
  ADD COLUMN IF NOT EXISTS total_cost_cents bigint,
  ADD COLUMN IF NOT EXISTS ledger_entry_id uuid;

DO $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='dbs_control_purchases_supplier_id_fkey') THEN
    ALTER TABLE public.dbs_control_purchases ADD CONSTRAINT dbs_control_purchases_supplier_id_fkey
      FOREIGN KEY(supplier_id) REFERENCES public.dbs_control_suppliers(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='dbs_control_purchases_cost_center_id_fkey') THEN
    ALTER TABLE public.dbs_control_purchases ADD CONSTRAINT dbs_control_purchases_cost_center_id_fkey
      FOREIGN KEY(cost_center_id) REFERENCES public.dbs_control_cost_centers(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='dbs_control_parts_supplier_id_fkey') THEN
    ALTER TABLE public.dbs_control_parts ADD CONSTRAINT dbs_control_parts_supplier_id_fkey
      FOREIGN KEY(supplier_id) REFERENCES public.dbs_control_suppliers(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='dbs_control_parts_measure_unit_id_fkey') THEN
    ALTER TABLE public.dbs_control_parts ADD CONSTRAINT dbs_control_parts_measure_unit_id_fkey
      FOREIGN KEY(measure_unit_id) REFERENCES public.dbs_control_measure_units(id) ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'dbs_control_purchase_items','dbs_control_purchase_receipts','dbs_control_purchase_receipt_items',
    'dbs_control_inventory_movements','dbs_control_quotes','dbs_control_work_orders',
    'dbs_control_work_order_parts','dbs_control_work_order_reservations',
    'dbs_control_reservation_consumptions','dbs_control_work_order_financials',
    'dbs_control_car_stock','dbs_control_car_stock_consumptions',
    'dbs_control_gas_usage','treasury_ledger_entries','treasury_ledger_lines'
  ] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname=t||'_cost_center_id_fkey') THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY(cost_center_id) REFERENCES public.dbs_control_cost_centers(id) ON DELETE RESTRICT',t,t||'_cost_center_id_fkey');
    END IF;
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS dbs_control_purchases_cost_center_idx ON public.dbs_control_purchases(scope_key,cost_center_id,purchase_date DESC);
CREATE INDEX IF NOT EXISTS dbs_control_inventory_movements_cost_center_idx ON public.dbs_control_inventory_movements(scope_key,cost_center_id,created_at DESC);
CREATE INDEX IF NOT EXISTS treasury_ledger_entries_cost_center_idx ON public.treasury_ledger_entries(scope_key,cost_center_id,competence_date DESC);

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
  v_existing public.dbs_control_parts%rowtype;
  v_has_movements boolean := false;
  v_supplier_id uuid := nullif(p_payload->>'supplier_id','')::uuid;
  v_measure_unit_id uuid := nullif(p_payload->>'measure_unit_id','')::uuid;
  v_scope text := nullif(btrim(p_payload->>'scope_key'),'');
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
  if coalesce((p_payload->>'require_master_data')::boolean,false) then
    if v_supplier_id is null or v_measure_unit_id is null or v_scope is null then
      raise exception 'DBS_PART_MASTER_DATA_REQUIRED: selecione fornecedor e unidade de medida.' using errcode='22023';
    end if;
    if not exists(select 1 from public.dbs_control_suppliers s
      where s.id=v_supplier_id and s.scope_key=v_scope and s.status='active') then
      raise exception 'DBS_PART_SUPPLIER_INVALID: fornecedor inexistente ou inativo.' using errcode='23503';
    end if;
    if not exists(select 1 from public.dbs_control_measure_units u
      where u.id=v_measure_unit_id and u.scope_key=v_scope and u.status='active') then
      raise exception 'DBS_PART_MEASURE_UNIT_INVALID: unidade inexistente ou inativa.' using errcode='23503';
    end if;
  end if;

  select p.* into v_existing
  from public.dbs_control_parts p
  where (v_id is not null and p.id = v_id) or p.sku = v_sku
  order by (case when v_id is not null and p.id = v_id then 0 else 1 end)
  limit 1
  for update;

  if found then
    v_supplier_id := coalesce(v_supplier_id,v_existing.supplier_id);
    v_measure_unit_id := coalesce(v_measure_unit_id,v_existing.measure_unit_id);
    select exists (
      select 1 from public.dbs_control_inventory_movements m where m.part_id = v_existing.id
    ) into v_has_movements;
    update public.dbs_control_parts
       set sku = v_sku,
           name = v_name,
           description = v_description,
           cost_cents = case
             when coalesce(v_existing.stock_quantity, 0) = 0 and not v_has_movements then v_cost
             else v_existing.cost_cents
           end,
           sale_cents = v_sale,
           supplier_id = v_supplier_id,
           measure_unit_id = v_measure_unit_id,
           status = v_status,
           version = version + 1,
           updated_at = now()
     where id = v_existing.id
     returning * into v_existing;
  else
    insert into public.dbs_control_parts (id, sku, name, description, stock_quantity, cost_cents, sale_cents, supplier_id, measure_unit_id, status)
    values (coalesce(v_id, gen_random_uuid()), v_sku, v_name, v_description, 0, v_cost, v_sale, v_supplier_id, v_measure_unit_id, v_status)
    returning * into v_existing;
  end if;

  return jsonb_build_object(
    'ok', true, 'part_id', v_existing.id, 'sku', v_existing.sku,
    'stock_quantity', v_existing.stock_quantity, 'cost_cents', v_existing.cost_cents,
    'sale_cents', v_existing.sale_cents, 'supplier_id',v_existing.supplier_id,'measure_unit_id',v_existing.measure_unit_id, 'version', v_existing.version,
    'idempotency_key', v_key
  );
end;
$$;

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
  v_supplier_id uuid := nullif(p_payload->>'supplier_id','')::uuid;
  v_cost_center_id uuid := nullif(p_payload->>'cost_center_id','')::uuid;
  v_document text := nullif(btrim(p_payload->>'document_number'),'');
  v_date date := coalesce(nullif(p_payload->>'purchase_date','')::date,current_date);
  v_items jsonb := p_payload->'items';
  v_existing public.dbs_control_purchases%rowtype;
  v_purchase uuid;
  v_item jsonb;
  v_part uuid;
  v_qty numeric;
  v_unit_cost integer;
  v_purchase_unit_cost integer;
  v_purchase_qty numeric;
  v_factor numeric(24,10);
  v_purchase_unit_id uuid;
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
  if v_supplier_id is null or v_cost_center_id is null then
    raise exception 'DBS_PURCHASE_SUPPLIER_AND_COST_CENTER_REQUIRED' using errcode='22023';
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
  select s.name into v_supplier from public.dbs_control_suppliers s
   where s.id=v_supplier_id and s.scope_key=v_scope and s.status='active';
  if v_supplier is null then raise exception 'DBS_PURCHASE_SUPPLIER_INVALID' using errcode='23503'; end if;
  if not exists(select 1 from public.dbs_control_cost_centers cc
    where cc.id=v_cost_center_id and cc.scope_key=v_scope and cc.status='active') then
    raise exception 'DBS_PURCHASE_COST_CENTER_INVALID' using errcode='23503';
  end if;

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
    company_id,scope_key,supplier_name,supplier_id,cost_center_id,document_number,purchase_date,
    status,payment_status,idempotency_key,legacy_key,created_by
  ) values(
    v_company,v_scope,v_supplier,v_supplier_id,v_cost_center_id,v_document,v_date,
    'draft','unpaid',v_key,v_legacy_key,v_actor
  ) returning id into v_purchase;

  for v_item in select value from jsonb_array_elements(v_items) as item(value)
  loop
    v_part := nullif(coalesce(v_item->>'part_id',v_item->>'id'),'')::uuid;
    v_purchase_qty := coalesce(nullif(coalesce(v_item->>'purchase_quantity',v_item->>'quantity',v_item->>'qtd'),'')::numeric,0);
    v_factor := coalesce(nullif(v_item->>'conversion_factor','')::numeric,1);
    v_purchase_unit_id := nullif(v_item->>'purchase_unit_id','')::uuid;
    v_qty := coalesce(nullif(v_item->>'base_quantity','')::numeric,v_purchase_qty*v_factor);
    v_purchase_unit_cost := greatest(round(coalesce(nullif(coalesce(v_item->>'unit_cost_cents',v_item->>'unit_cost'),'')::numeric,0))::integer,0);
    v_unit_cost := greatest(round(v_purchase_unit_cost/greatest(v_factor,0.0000000001))::integer,0);
    if v_part is null or v_purchase_qty<=0 or v_qty<=0 or v_factor<=0 or v_purchase_unit_cost<=0 then
      raise exception 'DBS_PURCHASE_ITEM_INVALID: informe peça, quantidade e conversão positiva.' using errcode='22023';
    end if;
    if v_purchase_unit_id is null then
      raise exception 'DBS_PURCHASE_UNIT_REQUIRED: selecione a unidade usada na compra.' using errcode='22023';
    end if;
    if not exists(select 1 from public.dbs_control_purchase_items pi where pi.purchase_id=v_purchase and pi.part_id=v_part) then
      if not exists(select 1 from public.dbs_control_parts p where p.id=v_part and p.measure_unit_id is not null) then
        raise exception 'DBS_PURCHASE_PART_BASE_UNIT_REQUIRED' using errcode='23514';
      end if;
    end if;
    select status into v_part_status from public.dbs_control_parts where id=v_part;
    if not found then
      raise exception 'DBS_PART_NOT_FOUND: peça % não existe no catálogo.',v_part using errcode='23503';
    end if;
    if v_part_status<>'ativo' then
      raise exception 'DBS_PART_INACTIVE: ative a peça no catálogo antes de registrar a compra.' using errcode='23514';
    end if;
    v_line := v_line+1;
    v_line_total := round(v_purchase_qty*v_purchase_unit_cost)::bigint;
    v_total := v_total+v_line_total;
    insert into public.dbs_control_purchase_items(
      purchase_id,part_id,line_no,quantity,unit_cost_cents,total_cents,
      purchase_unit_id,conversion_factor,base_quantity,metadata
    ) values(v_purchase,v_part,v_line,v_qty,v_unit_cost,v_line_total,
      v_purchase_unit_id,v_factor,v_qty,
      jsonb_build_object('purchase_quantity',v_purchase_qty,'purchase_unit_id',v_purchase_unit_id,
        'purchase_unit_cost_cents',v_purchase_unit_cost,
        'cost_center_id',v_cost_center_id));
  end loop;

  if v_total<=0 then
    raise exception 'DBS_PURCHASE_TOTAL_INVALID: valor total precisa ser maior que zero.' using errcode='22023';
  end if;

  v_ledger := public.post_treasury_ledger_entry(
    v_scope,v_company,v_date,v_date,
    'purchase_registered','Compra registrada · '||v_supplier,
    left(v_key||':payable',200),'purchase-payable:'||v_purchase::text,
    v_actor,'posted',
    jsonb_build_object('source','dbs_control_purchase','purchase_id',v_purchase,'status','draft','cost_center_id',v_cost_center_id,'supplier_id',v_supplier_id),
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

CREATE OR REPLACE FUNCTION public.dbs_control_save_quote(p_quote jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE
  v_actor uuid:=auth.uid();
  v_user public.users%rowtype;
  v_quote public.dbs_control_quotes%rowtype;
  v_scope text;
  v_key text:=nullif(btrim(p_quote->>'idempotencyKey'),'');
  v_quote_number text:=nullif(btrim(p_quote->>'id'),'');
  v_client uuid:=nullif(p_quote->>'clienteId','')::uuid;
  v_cost_center_id uuid:=nullif(p_quote->>'costCenterId','')::uuid;
  v_item jsonb;
  v_part uuid;
  v_qty numeric(18,4);
  v_unit numeric;
  v_line bigint;
  v_subtotal bigint;
  v_discount bigint;
  v_total bigint;
BEGIN
  IF v_actor IS NULL OR NOT public.dbs_control_is_admin_actor(v_actor) THEN
    RAISE EXCEPTION 'DBS_QUOTE_SAVE_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF jsonb_typeof(p_quote) IS DISTINCT FROM 'object' OR v_quote_number IS NULL OR
     v_key IS NULL OR char_length(v_key) NOT BETWEEN 8 AND 240 OR
     v_client IS NULL OR v_cost_center_id IS NULL OR
     jsonb_typeof(p_quote->'itens') IS DISTINCT FROM 'array' OR
     jsonb_array_length(p_quote->'itens')=0 THEN
    RAISE EXCEPTION 'DBS_QUOTE_SAVE_INPUT_INVALID: centro de custo, cliente e itens são obrigatórios.' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_user FROM public.users WHERE id=v_actor AND status='ativo';
  IF NOT FOUND THEN RAISE EXCEPTION 'DBS_QUOTE_SAVE_ACTOR_INACTIVE' USING ERRCODE='42501'; END IF;
  v_scope:=CASE WHEN v_user.company_id IS NOT NULL THEN 'company:'||v_user.company_id::text ELSE 'user:'||v_actor::text END;
  IF NOT EXISTS (
    SELECT 1 FROM public.dbs_control_cost_centers cc
    WHERE cc.id=v_cost_center_id AND cc.scope_key=v_scope AND cc.status='active'
  ) THEN
    RAISE EXCEPTION 'DBS_QUOTE_COST_CENTER_INVALID' USING ERRCODE='23503';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.dbs_control_clients c WHERE c.id=v_client AND c.status='ativo') THEN
    RAISE EXCEPTION 'DBS_QUOTE_CLIENT_UNAVAILABLE' USING ERRCODE='23503';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_scope||':quote:'||v_quote_number,0));
  SELECT * INTO v_quote FROM public.dbs_control_quotes
   WHERE scope_key=v_scope AND idempotency_key=v_key FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object('ok',true,'replayed',true,'quote_id',v_quote.id,'quote_number',v_quote.quote_number);
  END IF;
  IF EXISTS (SELECT 1 FROM public.dbs_control_quotes
      WHERE scope_key=v_scope AND quote_number=v_quote_number) THEN
    RAISE EXCEPTION 'DBS_QUOTE_NUMBER_CONFLICT' USING ERRCODE='23505';
  END IF;
  v_subtotal:=round(coalesce(nullif(p_quote->>'subtotal','')::numeric,0)*100)::bigint;
  v_discount:=round(coalesce(nullif(p_quote->>'desconto','')::numeric,0)*100)::bigint;
  v_total:=round(coalesce(nullif(p_quote->>'total','')::numeric,0)*100)::bigint;
  INSERT INTO public.dbs_control_quotes(
    scope_key,company_id,client_id,cost_center_id,quote_number,status,description,payment_terms,
    subtotal_cents,discount_cents,total_cents,idempotency_key,metadata
  ) VALUES (
    v_scope,v_user.company_id,v_client,v_cost_center_id,v_quote_number,'draft',
    nullif(p_quote->>'desc',''),nullif(p_quote->>'pagamento',''),
    greatest(v_subtotal,0),greatest(v_discount,0),greatest(v_total,0),v_key,
    jsonb_build_object('source','dbs_control_quote_ui','cost_center_id',v_cost_center_id,
      'legacy_payload',jsonb_build_object('data',p_quote->>'data','validade',p_quote->>'validade'))
  ) RETURNING * INTO v_quote;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_quote->'itens')
  LOOP
    v_qty:=nullif(v_item->>'quantidade','')::numeric;
    v_unit:=coalesce(nullif(v_item->>'valorUnitario','')::numeric,0);
    IF v_qty IS NULL OR v_qty<=0 OR v_unit<0 THEN
      RAISE EXCEPTION 'DBS_QUOTE_ITEM_INVALID' USING ERRCODE='22023';
    END IF;
    v_part:=NULL;
    IF coalesce(v_item->>'tipo','')='peca' AND nullif(v_item->>'catalogoId','') IS NOT NULL THEN
      v_part:=nullif(v_item->>'catalogoId','')::uuid;
      IF NOT EXISTS (SELECT 1 FROM public.dbs_control_sales_catalog c WHERE c.part_id=v_part) THEN
        RAISE EXCEPTION 'DBS_QUOTE_CATALOG_PART_UNAVAILABLE' USING ERRCODE='23503';
      END IF;
    END IF;
    v_line:=round(coalesce(nullif(v_item->>'total','')::numeric,v_qty*v_unit)*100)::bigint;
    INSERT INTO public.dbs_control_quote_items(
      quote_id,item_type,part_id,description,measure_unit,quantity,unit_sale_cents,total_cents,source_item
    ) VALUES (
      v_quote.id,
      CASE WHEN v_part IS NOT NULL THEN 'catalog' WHEN coalesce(v_item->>'tipo','')='servico' THEN 'service' ELSE 'manual' END,
      v_part,coalesce(nullif(v_item->>'descricao',''),'Item do orçamento'),
      nullif(coalesce(v_item->>'unidade','UN'),''),v_qty,round(v_unit*100)::integer,greatest(v_line,0),v_item
    );
  END LOOP;
  RETURN jsonb_build_object('ok',true,'replayed',false,'quote_id',v_quote.id,'quote_number',v_quote.quote_number,
    'cost_center_id',v_cost_center_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.dbs_control_approve_quote_and_create_work_order(
  p_quote_id uuid, p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_quote public.dbs_control_quotes%rowtype;
  v_client public.dbs_control_clients%rowtype;
  v_os public.dbs_control_work_orders%rowtype;
  v_key text := nullif(btrim(p_idempotency_key),'');
  v_items jsonb;
  v_reservation jsonb;
BEGIN
  IF v_actor IS NULL OR NOT public.dbs_control_is_admin_actor(v_actor) THEN
    RAISE EXCEPTION 'DBS_QUOTE_APPROVAL_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF p_quote_id IS NULL OR v_key IS NULL OR char_length(v_key) NOT BETWEEN 8 AND 240 THEN
    RAISE EXCEPTION 'DBS_QUOTE_APPROVAL_INPUT_INVALID' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('quote-approve:'||p_quote_id::text,0));
  SELECT * INTO v_quote FROM public.dbs_control_quotes WHERE id=p_quote_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DBS_QUOTE_NOT_FOUND' USING ERRCODE='23503'; END IF;
  IF v_quote.work_order_id IS NOT NULL THEN
    SELECT * INTO v_os FROM public.dbs_control_work_orders WHERE id=v_quote.work_order_id;
    RETURN jsonb_build_object('ok',true,'replayed',true,'quote_id',v_quote.id,'work_order_id',v_os.id,'protocol',v_os.protocol);
  END IF;
  IF v_quote.cost_center_id IS NULL THEN RAISE EXCEPTION 'DBS_QUOTE_COST_CENTER_REQUIRED' USING ERRCODE='23514'; END IF;
  IF v_quote.status NOT IN ('draft','approved') THEN
    RAISE EXCEPTION 'DBS_QUOTE_STATUS_NOT_APPROVABLE' USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_client FROM public.dbs_control_clients WHERE id=v_quote.client_id AND status='ativo';
  IF NOT FOUND THEN RAISE EXCEPTION 'DBS_QUOTE_CLIENT_UNAVAILABLE' USING ERRCODE='23514'; END IF;
  IF EXISTS (SELECT 1 FROM public.users u WHERE u.id=v_actor AND u.status='ativo'
      AND u.company_id IS NOT NULL AND u.company_id IS DISTINCT FROM v_quote.company_id) THEN
    RAISE EXCEPTION 'DBS_QUOTE_SCOPE_MISMATCH' USING ERRCODE='42501';
  END IF;

  INSERT INTO public.dbs_control_work_orders(
    protocol,protocolo,client_id,created_by_user_id,type,priority,status,description,total_cents,cost_center_id
  ) VALUES (
    v_quote.quote_number||'-'||substr(replace(gen_random_uuid()::text,'-',''),1,6),
    v_quote.quote_number,v_quote.client_id,v_actor,'corretiva','normal','aberta',
    coalesce(v_quote.description,'Orçamento aprovado '||v_quote.quote_number),v_quote.total_cents::integer,v_quote.cost_center_id
  ) RETURNING * INTO v_os;

  UPDATE public.dbs_control_quotes SET status='converted',work_order_id=v_os.id,
    approved_by=v_actor,approved_at=coalesce(approved_at,now()),idempotency_key=v_key,updated_at=now()
   WHERE id=v_quote.id;

  SELECT coalesce(jsonb_agg(jsonb_build_object('part_id',i.part_id,'quantity',i.quantity)
      ORDER BY i.part_id),'[]'::jsonb)
    INTO v_items FROM public.dbs_control_quote_items i
   WHERE i.quote_id=v_quote.id AND i.item_type='catalog' AND i.part_id IS NOT NULL;
  IF jsonb_array_length(v_items)>0 THEN
    v_reservation := public.dbs_control_reserve_work_order_parts(jsonb_build_object(
      'actor_user_id',v_actor,'work_order_id',v_os.id,
      'idempotency_key','quote:'||v_quote.id::text||':'||md5(v_key),'items',v_items
    ));
  ELSE
    v_reservation := jsonb_build_object('ok',true,'reservations','[]'::jsonb);
  END IF;
  RETURN jsonb_build_object('ok',true,'replayed',false,'quote_id',v_quote.id,
    'work_order_id',v_os.id,'protocol',v_os.protocol,'reservation',v_reservation);
END;
$$;

CREATE OR REPLACE FUNCTION public.dbs_control_fill_cost_center()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_center uuid; v_purchase uuid; v_work_order uuid; v_receipt uuid;
BEGIN
  IF TG_TABLE_NAME='dbs_control_work_orders' THEN
    IF NEW.cost_center_id IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM public.dbs_control_cost_centers cc
       WHERE cc.id=NEW.cost_center_id AND cc.status='active'
    ) THEN RAISE EXCEPTION 'DBS_WORK_ORDER_COST_CENTER_INVALID' USING ERRCODE='23503'; END IF;
    RETURN NEW;
  ELSIF TG_TABLE_NAME='dbs_control_quotes' THEN
    IF NEW.cost_center_id IS NULL THEN RAISE EXCEPTION 'DBS_QUOTE_COST_CENTER_REQUIRED' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  ELSIF TG_TABLE_NAME='dbs_control_purchases' THEN
    IF NEW.cost_center_id IS NULL OR NEW.supplier_id IS NULL THEN
      RAISE EXCEPTION 'DBS_PURCHASE_SUPPLIER_AND_COST_CENTER_REQUIRED' USING ERRCODE='23514';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.dbs_control_cost_centers cc
      WHERE cc.id=NEW.cost_center_id AND cc.scope_key=NEW.scope_key AND cc.status='active') THEN
      RAISE EXCEPTION 'DBS_PURCHASE_COST_CENTER_INVALID' USING ERRCODE='23503';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.dbs_control_suppliers s
      WHERE s.id=NEW.supplier_id AND s.scope_key=NEW.scope_key AND s.status='active') THEN
      RAISE EXCEPTION 'DBS_PURCHASE_SUPPLIER_INVALID' USING ERRCODE='23503';
    END IF;
    RETURN NEW;
  ELSIF TG_TABLE_NAME='dbs_control_purchase_items' THEN
    SELECT p.cost_center_id INTO v_center FROM public.dbs_control_purchases p WHERE p.id=NEW.purchase_id;
    NEW.cost_center_id:=coalesce(NEW.cost_center_id,v_center);
  ELSIF TG_TABLE_NAME='dbs_control_purchase_receipts' THEN
    SELECT p.cost_center_id INTO v_center FROM public.dbs_control_purchases p WHERE p.id=NEW.purchase_id;
    NEW.cost_center_id:=coalesce(NEW.cost_center_id,v_center);
  ELSIF TG_TABLE_NAME='dbs_control_purchase_receipt_items' THEN
    SELECT r.cost_center_id INTO v_center FROM public.dbs_control_purchase_receipts r WHERE r.id=NEW.receipt_id;
    NEW.cost_center_id:=coalesce(NEW.cost_center_id,v_center);
  ELSIF TG_TABLE_NAME='dbs_control_work_order_financials' THEN
    SELECT wo.cost_center_id INTO v_center FROM public.dbs_control_work_orders wo WHERE wo.id=NEW.work_order_id;
    NEW.cost_center_id:=coalesce(NEW.cost_center_id,v_center);
    IF NEW.cost_center_id IS NULL THEN RAISE EXCEPTION 'DBS_OS_FINANCIAL_COST_CENTER_REQUIRED' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME IN ('dbs_control_work_order_parts','dbs_control_work_order_reservations','dbs_control_reservation_consumptions','dbs_control_car_stock_consumptions','dbs_control_gas_usage') THEN
    v_work_order:=NEW.work_order_id;
    SELECT wo.cost_center_id INTO v_center FROM public.dbs_control_work_orders wo WHERE wo.id=v_work_order;
    NEW.cost_center_id:=coalesce(NEW.cost_center_id,v_center);
    IF NEW.cost_center_id IS NULL THEN RAISE EXCEPTION 'DBS_OS_COST_CENTER_REQUIRED' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='dbs_control_inventory_movements' THEN
    IF NEW.purchase_id IS NOT NULL THEN
      SELECT cost_center_id INTO v_center FROM public.dbs_control_purchases WHERE id=NEW.purchase_id;
    ELSIF NEW.work_order_id IS NOT NULL THEN
      SELECT cost_center_id INTO v_center FROM public.dbs_control_work_orders WHERE id=NEW.work_order_id;
    END IF;
    NEW.cost_center_id:=coalesce(NEW.cost_center_id,v_center);
    IF NEW.cost_center_id IS NULL AND (NEW.purchase_id IS NOT NULL OR NEW.work_order_id IS NOT NULL) THEN
      RAISE EXCEPTION 'DBS_INVENTORY_MOVEMENT_COST_CENTER_REQUIRED' USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME='treasury_ledger_entries' THEN
    v_center:=nullif(NEW.metadata->>'cost_center_id','')::uuid;
    v_purchase:=nullif(NEW.metadata->>'purchase_id','')::uuid;
    v_work_order:=nullif(NEW.metadata->>'work_order_id','')::uuid;
    IF v_center IS NULL AND v_purchase IS NOT NULL THEN
      SELECT cost_center_id INTO v_center FROM public.dbs_control_purchases WHERE id=v_purchase;
    END IF;
    IF v_center IS NULL AND v_work_order IS NOT NULL THEN
      SELECT cost_center_id INTO v_center FROM public.dbs_control_work_orders WHERE id=v_work_order;
    END IF;
    NEW.cost_center_id:=coalesce(NEW.cost_center_id,v_center);
    IF (NEW.entry_type LIKE 'purchase_%' OR NEW.entry_type LIKE 'work_order_%') AND NEW.cost_center_id IS NULL THEN
      RAISE EXCEPTION 'TREASURY_COST_CENTER_REQUIRED' USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME='treasury_ledger_lines' THEN
    SELECT e.cost_center_id INTO v_center FROM public.treasury_ledger_entries e WHERE e.id=NEW.entry_id;
    NEW.cost_center_id:=coalesce(NEW.cost_center_id,v_center);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_dbs_purchase_cost_center ON public.dbs_control_purchases;
CREATE TRIGGER trg_dbs_purchase_cost_center BEFORE INSERT OR UPDATE OF supplier_id,cost_center_id
ON public.dbs_control_purchases FOR EACH ROW EXECUTE FUNCTION public.dbs_control_fill_cost_center();
DROP TRIGGER IF EXISTS trg_dbs_quote_cost_center ON public.dbs_control_quotes;
CREATE TRIGGER trg_dbs_quote_cost_center BEFORE INSERT OR UPDATE OF cost_center_id
ON public.dbs_control_quotes FOR EACH ROW EXECUTE FUNCTION public.dbs_control_fill_cost_center();
DROP TRIGGER IF EXISTS trg_dbs_work_order_cost_center ON public.dbs_control_work_orders;
CREATE TRIGGER trg_dbs_work_order_cost_center BEFORE INSERT OR UPDATE OF cost_center_id
ON public.dbs_control_work_orders FOR EACH ROW EXECUTE FUNCTION public.dbs_control_fill_cost_center();
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'dbs_control_purchase_items','dbs_control_purchase_receipts','dbs_control_purchase_receipt_items',
    'dbs_control_inventory_movements','dbs_control_work_order_parts','dbs_control_work_order_reservations',
    'dbs_control_reservation_consumptions','dbs_control_work_order_financials','dbs_control_car_stock_consumptions',
    'dbs_control_gas_usage','treasury_ledger_entries','treasury_ledger_lines'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_'||t||'_cost_center',t);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.dbs_control_fill_cost_center()', 'trg_'||t||'_cost_center',t);
  END LOOP;
END $$;

create or replace function public.dbs_control_list_my_gas_cylinders(p_work_order_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid(); v_employee uuid; v_os public.dbs_control_work_orders%rowtype;
begin
 if v_actor is null then raise exception 'DBS_GAS_UNAUTHENTICATED' using errcode='42501'; end if;
 select * into v_os from public.dbs_control_work_orders where id=p_work_order_id and deleted_at is null;
 if not found then raise exception 'DBS_OS_NOT_FOUND' using errcode='23503'; end if;
 select ea.employee_id into v_employee from public.users u join public.rh_employee_access ea on ea.user_id=u.id and ea.access_enabled=true where u.id=v_actor and u.status='ativo'
 union select re.id from public.users u join public.rh_employees re on re.ponto_portal_user_id=u.id and re.dbs_control_access_enabled=true and re.is_active=true where u.id=v_actor and u.status='ativo';
 if public.dbs_control_is_admin_actor(v_actor) then v_employee:=v_os.assigned_employee_id; end if;
 if v_employee is null or v_os.assigned_employee_id is distinct from v_employee then raise exception 'DBS_GAS_FORBIDDEN' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'serial_number',serial_number,'refrigerant_type',refrigerant_type,
 'total_charges',total_charges,'used_charges',used_charges,'remaining_charges',remaining_charges,'refill_count',refill_count,
 'vehicle_label',vehicle_label,'status',status,
 'tare_weight_kg',tare_weight_kg,'initial_gross_weight_kg',initial_gross_weight_kg,
 'current_gross_weight_kg',current_gross_weight_kg,'cost_per_kg_cents',cost_per_kg_cents,
 'remaining_net_weight_kg',case when tare_weight_kg is not null and current_gross_weight_kg is not null
   then greatest(current_gross_weight_kg-tare_weight_kg,0) else null end) order by assigned_at desc)
 from public.dbs_control_gas_cylinders where employee_id=v_employee and status='active'), '[]'::jsonb);
end $$;

CREATE OR REPLACE FUNCTION public.dbs_control_register_gas_usage_weighted(
  p_work_order_id uuid,p_cylinder_id uuid,p_equipment_reference text,p_application_note text,
  p_gross_weight_before_kg numeric,p_gross_weight_after_kg numeric,p_idempotency_key text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_actor uuid:=auth.uid();
  v_cylinder public.dbs_control_gas_cylinders%rowtype;
  v_existing public.dbs_control_gas_usage%rowtype;
  v_os public.dbs_control_work_orders%rowtype;
  v_scope record;
  v_result jsonb;
  v_ledger jsonb;
  v_ledger_id uuid;
  v_consumed numeric(12,3);
  v_total bigint;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'DBS_GAS_UNAUTHENTICATED' USING ERRCODE='42501'; END IF;
  IF p_gross_weight_before_kg IS NULL OR p_gross_weight_after_kg IS NULL
     OR p_gross_weight_before_kg<0 OR p_gross_weight_after_kg<0
     OR p_gross_weight_after_kg>p_gross_weight_before_kg THEN
    RAISE EXCEPTION 'DBS_GAS_WEIGHT_INVALID' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_cylinder FROM public.dbs_control_gas_cylinders WHERE id=p_cylinder_id FOR UPDATE;
  IF NOT FOUND OR v_cylinder.tare_weight_kg IS NULL THEN
    RAISE EXCEPTION 'DBS_GAS_TARE_WEIGHT_REQUIRED' USING ERRCODE='23514';
  END IF;
  IF coalesce(v_cylinder.cost_per_kg_cents,0)<=0 THEN
    RAISE EXCEPTION 'DBS_GAS_COST_PER_KG_REQUIRED: cadastre o custo do gás por kg antes de consumir.' USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_os FROM public.dbs_control_work_orders WHERE id=p_work_order_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DBS_OS_NOT_FOUND' USING ERRCODE='23503'; END IF;
  SELECT * INTO v_existing FROM public.dbs_control_gas_usage WHERE idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_existing.work_order_id<>p_work_order_id OR v_existing.cylinder_id<>p_cylinder_id
       OR abs(coalesce(v_existing.gross_weight_before_kg,-1)-p_gross_weight_before_kg)>0.001
       OR abs(coalesce(v_existing.gross_weight_after_kg,-1)-p_gross_weight_after_kg)>0.001 THEN
      RAISE EXCEPTION 'DBS_GAS_WEIGHT_IDEMPOTENCY_CONFLICT' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('ok',true,'replayed',true,'work_order_id',p_work_order_id,
      'cylinder_id',p_cylinder_id,'gas_consumed_kg',v_existing.gas_consumed_kg,
      'gross_weight_after_kg',v_existing.gross_weight_after_kg,
      'cost_per_kg_cents',v_existing.cost_per_kg_cents,
      'total_cost_cents',v_existing.total_cost_cents,
      'ledger_entry_id',v_existing.ledger_entry_id,
      'remaining_net_weight_kg',greatest(v_existing.gross_weight_after_kg-v_cylinder.tare_weight_kg,0));
  END IF;
  IF p_gross_weight_after_kg<v_cylinder.tare_weight_kg THEN
    RAISE EXCEPTION 'DBS_GAS_WEIGHT_BELOW_TARE' USING ERRCODE='23514';
  END IF;
  IF v_cylinder.current_gross_weight_kg IS NULL THEN
    RAISE EXCEPTION 'DBS_GAS_INITIAL_WEIGHT_REQUIRED' USING ERRCODE='23514';
  END IF;
  IF abs(v_cylinder.current_gross_weight_kg-p_gross_weight_before_kg)>0.05 THEN
    RAISE EXCEPTION 'DBS_GAS_WEIGHT_STALE: atualize a pesagem antes de registrar o consumo.' USING ERRCODE='40001';
  END IF;
  v_consumed:=round((p_gross_weight_before_kg-p_gross_weight_after_kg)::numeric,3);
  IF v_consumed<=0 THEN RAISE EXCEPTION 'DBS_GAS_NO_WEIGHT_CHANGE' USING ERRCODE='22023'; END IF;
  v_result:=public.dbs_control_register_gas_usage(
    p_work_order_id,p_cylinder_id,p_equipment_reference,p_application_note,p_idempotency_key
  );
  IF coalesce((v_result->>'replayed')::boolean,false)=false THEN
    UPDATE public.dbs_control_gas_cylinders SET current_gross_weight_kg=p_gross_weight_after_kg,updated_at=now()
     WHERE id=p_cylinder_id;
    v_total:=round(v_consumed*v_cylinder.cost_per_kg_cents)::bigint;
    SELECT * INTO v_scope FROM public.dbs_control_inventory_scope_for_work_order(p_work_order_id);
    v_ledger:=public.post_treasury_ledger_entry(
      v_scope.scope_key,v_scope.company_id,current_date,current_date,
      'work_order_gas_cogs','Consumo de gás · OS '||coalesce(v_os.protocol,p_work_order_id::text),
      left(p_idempotency_key,150)||':ledger','work-order-gas:'||p_idempotency_key,
      v_actor,'posted',
      jsonb_build_object('source','dbs_control_gas_usage','work_order_id',p_work_order_id,
        'cylinder_id',p_cylinder_id,'gas_consumed_kg',v_consumed,
        'cost_per_kg_cents',v_cylinder.cost_per_kg_cents,'cost_center_id',v_os.cost_center_id),
      jsonb_build_array(
        jsonb_build_object('account_code','5.1.01','account_name','Custo de materiais consumidos',
          'account_type','expense','debit_cents',v_total,'credit_cents',0),
        jsonb_build_object('account_code','1.1.03','account_name','Estoque de materiais',
          'account_type','asset','debit_cents',0,'credit_cents',v_total)
      )
    );
    v_ledger_id:=nullif(v_ledger->>'entry_id','')::uuid;
    IF v_ledger_id IS NULL THEN RAISE EXCEPTION 'DBS_GAS_COGS_LEDGER_FAILED' USING ERRCODE='23514'; END IF;
    UPDATE public.dbs_control_gas_usage SET
      gross_weight_before_kg=p_gross_weight_before_kg,
      gross_weight_after_kg=p_gross_weight_after_kg,
      gas_consumed_kg=v_consumed,
      cost_per_kg_cents=v_cylinder.cost_per_kg_cents,
      total_cost_cents=v_total,
      ledger_entry_id=v_ledger_id
     WHERE idempotency_key=p_idempotency_key;
    INSERT INTO public.dbs_control_work_order_financials(work_order_id,company_id,scope_key,parts_cost_cents)
    VALUES(p_work_order_id,v_scope.company_id,v_scope.scope_key,v_total)
    ON CONFLICT(work_order_id) DO UPDATE SET
      parts_cost_cents=public.dbs_control_work_order_financials.parts_cost_cents+excluded.parts_cost_cents,
      version=public.dbs_control_work_order_financials.version+1,updated_at=now();
  END IF;
  RETURN v_result||jsonb_build_object('gas_consumed_kg',v_consumed,
    'cost_per_kg_cents',v_cylinder.cost_per_kg_cents,'total_cost_cents',v_total,
    'ledger_entry_id',v_ledger_id,
    'remaining_net_weight_kg',greatest(p_gross_weight_after_kg-v_cylinder.tare_weight_kg,0),
    'gross_weight_after_kg',p_gross_weight_after_kg);
END $$;

CREATE OR REPLACE FUNCTION public.dbs_control_initialize_existing_gas_cylinder_weights(
  p_cylinder_id uuid,p_tare_weight_kg numeric,p_initial_gross_weight_kg numeric,p_cost_per_kg_cents integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_actor uuid:=auth.uid(); v_row public.dbs_control_gas_cylinders%rowtype;
BEGIN
  IF v_actor IS NULL OR NOT public.dbs_control_is_admin_actor(v_actor) THEN
    RAISE EXCEPTION 'DBS_GAS_WEIGHT_INITIALIZE_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF p_tare_weight_kg IS NULL OR p_initial_gross_weight_kg IS NULL OR
     p_tare_weight_kg<0 OR p_initial_gross_weight_kg<=p_tare_weight_kg OR coalesce(p_cost_per_kg_cents,0)<=0 THEN
    RAISE EXCEPTION 'DBS_GAS_INITIAL_WEIGHTS_INVALID' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_row FROM public.dbs_control_gas_cylinders WHERE id=p_cylinder_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DBS_GAS_CYLINDER_NOT_FOUND' USING ERRCODE='23503'; END IF;
  IF v_row.tare_weight_kg IS NOT NULL OR v_row.current_gross_weight_kg IS NOT NULL THEN
    RAISE EXCEPTION 'DBS_GAS_WEIGHTS_ALREADY_INITIALIZED' USING ERRCODE='23514';
  END IF;
  UPDATE public.dbs_control_gas_cylinders SET tare_weight_kg=p_tare_weight_kg,
    initial_gross_weight_kg=p_initial_gross_weight_kg,current_gross_weight_kg=p_initial_gross_weight_kg,
    cost_per_kg_cents=p_cost_per_kg_cents,
    updated_at=now() WHERE id=p_cylinder_id;
  RETURN jsonb_build_object('ok',true,'cylinder_id',p_cylinder_id,'tare_weight_kg',p_tare_weight_kg,
    'initial_gross_weight_kg',p_initial_gross_weight_kg,'current_gross_weight_kg',p_initial_gross_weight_kg,
    'cost_per_kg_cents',p_cost_per_kg_cents,'remaining_net_weight_kg',p_initial_gross_weight_kg-p_tare_weight_kg);
END $;

REVOKE ALL ON FUNCTION public.dbs_control_initialize_existing_gas_cylinder_weights(uuid,numeric,numeric,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.dbs_control_initialize_existing_gas_cylinder_weights(uuid,numeric,numeric,integer) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.dbs_control_assign_gas_cylinder_weighted(
  p_serial_number text,p_refrigerant_type text,p_employee_id uuid,p_total_charges integer,
  p_vehicle_label text,p_tare_weight_kg numeric,p_initial_gross_weight_kg numeric,p_cost_per_kg_cents integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_result jsonb; v_id uuid;
BEGIN
  IF p_tare_weight_kg IS NULL OR p_initial_gross_weight_kg IS NULL OR
     p_tare_weight_kg<0 OR p_initial_gross_weight_kg<=p_tare_weight_kg OR coalesce(p_cost_per_kg_cents,0)<=0 THEN
    RAISE EXCEPTION 'DBS_GAS_INITIAL_WEIGHTS_INVALID' USING ERRCODE='22023';
  END IF;
  v_result:=public.dbs_control_assign_gas_cylinder(
    p_serial_number,p_refrigerant_type,p_employee_id,p_total_charges,p_vehicle_label
  );
  v_id:=nullif(v_result->>'cylinder_id','')::uuid;
  UPDATE public.dbs_control_gas_cylinders SET
    tare_weight_kg=p_tare_weight_kg,initial_gross_weight_kg=p_initial_gross_weight_kg,
    current_gross_weight_kg=p_initial_gross_weight_kg,updated_at=now()
  WHERE id=v_id;
  RETURN v_result||jsonb_build_object('tare_weight_kg',p_tare_weight_kg,
    'initial_gross_weight_kg',p_initial_gross_weight_kg,'current_gross_weight_kg',p_initial_gross_weight_kg,
    'cost_per_kg_cents',p_cost_per_kg_cents,'remaining_net_weight_kg',p_initial_gross_weight_kg-p_tare_weight_kg);
END $;

REVOKE ALL ON FUNCTION public.dbs_control_register_gas_usage_weighted(uuid,uuid,text,text,numeric,numeric,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.dbs_control_assign_gas_cylinder_weighted(text,text,uuid,integer,text,numeric,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.dbs_control_register_gas_usage_weighted(uuid,uuid,text,text,numeric,numeric,text) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.dbs_control_assign_gas_cylinder_weighted(text,text,uuid,integer,text,numeric,numeric) TO authenticated,service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
