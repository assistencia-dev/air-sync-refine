-- DBS Air | Recarga rastreável de cilindros a partir de item comprado e recebido.
-- A recarga operacional consome um SKU de serviço/material no estoque central,
-- atualiza a botija e contabiliza o custo uma única vez no Ledger.
BEGIN;

CREATE TABLE IF NOT EXISTS public.dbs_control_gas_refill_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE RESTRICT,
  scope_key text NOT NULL,
  material_request_id uuid NOT NULL REFERENCES public.dbs_control_material_requests(id) ON DELETE RESTRICT,
  gas_cylinder_id uuid NOT NULL REFERENCES public.dbs_control_gas_cylinders(id) ON DELETE RESTRICT,
  part_id uuid NOT NULL REFERENCES public.dbs_control_parts(id) ON DELETE RESTRICT,
  purchase_id uuid NOT NULL REFERENCES public.dbs_control_purchases(id) ON DELETE RESTRICT,
  purchase_item_id uuid NOT NULL REFERENCES public.dbs_control_purchase_items(id) ON DELETE RESTRICT,
  receipt_item_id uuid NOT NULL REFERENCES public.dbs_control_purchase_receipt_items(id) ON DELETE RESTRICT,
  inventory_movement_id uuid NOT NULL REFERENCES public.dbs_control_inventory_movements(id) ON DELETE RESTRICT,
  ledger_entry_id uuid NOT NULL REFERENCES public.treasury_ledger_entries(id) ON DELETE RESTRICT,
  quantity_consumed numeric(18,4) NOT NULL CHECK (quantity_consumed > 0),
  unit_cost_cents integer NOT NULL CHECK (unit_cost_cents > 0),
  total_cost_cents bigint NOT NULL CHECK (total_cost_cents > 0),
  total_charges_after integer NOT NULL CHECK (total_charges_after > 0),
  serial_number text NOT NULL,
  refrigerant_type text NOT NULL,
  idempotency_key text NOT NULL CHECK (char_length(btrim(idempotency_key)) BETWEEN 8 AND 240),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(scope_key, idempotency_key),
  UNIQUE(scope_key, material_request_id),
  UNIQUE(inventory_movement_id),
  UNIQUE(ledger_entry_id)
);

CREATE INDEX IF NOT EXISTS dbs_control_gas_refill_events_cylinder_idx
  ON public.dbs_control_gas_refill_events(scope_key, gas_cylinder_id, created_at DESC);
CREATE INDEX IF NOT EXISTS dbs_control_gas_refill_events_purchase_item_idx
  ON public.dbs_control_gas_refill_events(scope_key, purchase_item_id, created_at DESC);

ALTER TABLE public.dbs_control_gas_refill_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dbs_control_gas_refill_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.dbs_control_gas_refill_events TO service_role;

CREATE OR REPLACE FUNCTION public.dbs_control_reject_gas_refill_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  RAISE EXCEPTION 'DBS_GAS_REFILL_EVENT_IMMUTABLE' USING errcode='55000';
END;
$function$;

REVOKE ALL ON FUNCTION public.dbs_control_reject_gas_refill_event_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_dbs_control_gas_refill_events_immutable
  ON public.dbs_control_gas_refill_events;
CREATE TRIGGER trg_dbs_control_gas_refill_events_immutable
BEFORE UPDATE OR DELETE ON public.dbs_control_gas_refill_events
FOR EACH ROW EXECUTE FUNCTION public.dbs_control_reject_gas_refill_event_mutation();

DROP TRIGGER IF EXISTS trg_dbs_control_gas_refill_events_no_truncate
  ON public.dbs_control_gas_refill_events;
CREATE TRIGGER trg_dbs_control_gas_refill_events_no_truncate
BEFORE TRUNCATE ON public.dbs_control_gas_refill_events
FOR EACH STATEMENT EXECUTE FUNCTION public.dbs_control_reject_gas_refill_event_mutation();

-- Linking a purchase to a gas refill also identifies the exact refill SKU.
-- The request remains a request for one cylinder refill; it is not a normal
-- part reservation or a second stock movement.
DO $patch_gas_request_link$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(
    'public.dbs_control_link_material_request_purchase(uuid,uuid,uuid,uuid,numeric,bigint)'::regprocedure
  ) INTO v_def;

  v_old := $old$  IF v_request.part_id IS NOT NULL AND v_item.part_id IS DISTINCT FROM v_request.part_id THEN
    RAISE EXCEPTION 'DBS_MATERIAL_REQUEST_SKU_MISMATCH' USING errcode = '23514';
  END IF;$old$;
  v_new := $new$  IF v_request.request_type = 'gas_refill' THEN
    IF v_request.quantity IS DISTINCT FROM 1::numeric OR p_quantity_linked IS DISTINCT FROM 1::numeric THEN
      RAISE EXCEPTION 'DBS_GAS_REFILL_REQUEST_MUST_LINK_ONE_SERVICE_UNIT' USING errcode = '23514';
    END IF;
  END IF;
  IF v_request.part_id IS NOT NULL AND v_item.part_id IS DISTINCT FROM v_request.part_id THEN
    RAISE EXCEPTION 'DBS_MATERIAL_REQUEST_SKU_MISMATCH' USING errcode = '23514';
  END IF;$new$;
  IF v_def IS NULL OR position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'DBS gas refill migration: guarda de SKU do vínculo mudou; migração abortada.';
  END IF;
  v_def := replace(v_def, v_old, v_new);

  v_old := $old$  UPDATE public.dbs_control_material_requests
     SET status = 'awaiting_purchase',
         updated_at = now(),
         version = version + 1
   WHERE id = p_request_id
   RETURNING * INTO v_request;$old$;
  v_new := $new$  UPDATE public.dbs_control_material_requests
     SET part_id = CASE WHEN request_type = 'gas_refill' THEN v_item.part_id ELSE part_id END,
         status = 'awaiting_purchase',
         updated_at = now(),
         version = version + 1
   WHERE id = p_request_id
   RETURNING * INTO v_request;$new$;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'DBS gas refill migration: atualização do vínculo de compra mudou; migração abortada.';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END;
$patch_gas_request_link$;

CREATE OR REPLACE FUNCTION public.dbs_control_fulfill_gas_refill_request(
  p_request_id uuid,
  p_actor_user_id uuid,
  p_total_charges integer,
  p_idempotency_key text,
  p_expected_version bigint
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_scope text;
  v_actor_company uuid;
  v_request public.dbs_control_material_requests%rowtype;
  v_cylinder public.dbs_control_gas_cylinders%rowtype;
  v_link public.dbs_control_material_request_purchase_links%rowtype;
  v_purchase public.dbs_control_purchases%rowtype;
  v_item public.dbs_control_purchase_items%rowtype;
  v_part public.dbs_control_parts%rowtype;
  v_receipt_item public.dbs_control_purchase_receipt_items%rowtype;
  v_event public.dbs_control_gas_refill_events%rowtype;
  v_received numeric(18,4);
  v_consumed numeric(18,4);
  v_linked numeric(18,4);
  v_new_stock numeric(18,4);
  v_quantity numeric(18,4);
  v_unit_cost integer;
  v_total_cost bigint;
  v_ledger jsonb;
  v_ledger_id uuid;
  v_movement_id uuid := gen_random_uuid();
  v_event_id uuid := gen_random_uuid();
  v_key text := nullif(btrim(p_idempotency_key),'');
BEGIN
  IF p_actor_user_id IS NULL OR NOT public.dbs_control_is_inventory_finance_actor(p_actor_user_id) THEN
    RAISE EXCEPTION 'DBS_GAS_REFILL_FINANCE_FORBIDDEN' USING errcode='42501';
  END IF;
  v_scope := public.dbs_control_inventory_finance_scope_key(p_actor_user_id);
  IF v_scope IS NULL OR p_request_id IS NULL
     OR p_total_charges IS NULL OR p_total_charges <= 0
     OR v_key IS NULL OR char_length(v_key) NOT BETWEEN 8 AND 240
     OR p_expected_version IS NULL OR p_expected_version < 1 THEN
    RAISE EXCEPTION 'DBS_GAS_REFILL_INPUT_INVALID' USING errcode='22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_scope||':gas-refill:'||p_request_id::text,0));
  SELECT * INTO v_event
    FROM public.dbs_control_gas_refill_events
   WHERE scope_key=v_scope AND (material_request_id=p_request_id OR idempotency_key=v_key);
  IF FOUND THEN
    IF v_event.material_request_id IS DISTINCT FROM p_request_id
       OR v_event.idempotency_key IS DISTINCT FROM v_key
       OR v_event.total_charges_after IS DISTINCT FROM p_total_charges THEN
      RAISE EXCEPTION 'DBS_GAS_REFILL_IDEMPOTENCY_CONFLICT' USING errcode='23505';
    END IF;
    RETURN jsonb_build_object(
      'ok',true,'replayed',true,'event_id',v_event.id,
      'request_id',p_request_id,'gas_cylinder_id',v_event.gas_cylinder_id,
      'total_charges',v_event.total_charges_after,'total_cost_cents',v_event.total_cost_cents,
      'ledger_entry_id',v_event.ledger_entry_id,'version',p_expected_version
    );
  END IF;

  SELECT * INTO v_request
    FROM public.dbs_control_material_requests
   WHERE id=p_request_id AND scope_key=v_scope
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DBS_MATERIAL_REQUEST_NOT_FOUND' USING errcode='23503'; END IF;
  IF v_request.request_type IS DISTINCT FROM 'gas_refill'
     OR v_request.gas_cylinder_id IS NULL
     OR v_request.part_id IS NULL
     OR v_request.quantity IS DISTINCT FROM 1::numeric THEN
    RAISE EXCEPTION 'DBS_GAS_REFILL_REQUEST_INVALID' USING errcode='23514';
  END IF;
  IF v_request.status NOT IN ('approved','awaiting_purchase','ready_for_delivery') THEN
    RAISE EXCEPTION 'DBS_GAS_REFILL_REQUEST_NOT_READY' USING errcode='23514';
  END IF;
  IF v_request.version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'DBS_MATERIAL_REQUEST_VERSION_CONFLICT' USING errcode='40001';
  END IF;

  SELECT * INTO v_cylinder
    FROM public.dbs_control_gas_cylinders
   WHERE id=v_request.gas_cylinder_id AND scope_key=v_scope AND status IN ('active','empty')
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DBS_GAS_CYLINDER_NOT_AVAILABLE' USING errcode='23503'; END IF;
  IF v_request.employee_id IS NOT NULL AND v_request.employee_id IS DISTINCT FROM v_cylinder.employee_id THEN
    RAISE EXCEPTION 'DBS_GAS_REFILL_EMPLOYEE_MISMATCH' USING errcode='42501';
  END IF;

  SELECT * INTO v_link
    FROM public.dbs_control_material_request_purchase_links
   WHERE material_request_id=p_request_id AND scope_key=v_scope
   ORDER BY created_at DESC LIMIT 1
   FOR UPDATE;
  IF NOT FOUND OR v_link.quantity_linked IS DISTINCT FROM 1::numeric THEN
    RAISE EXCEPTION 'DBS_GAS_REFILL_PURCHASE_LINK_REQUIRED' USING errcode='23514';
  END IF;

  SELECT * INTO v_purchase
    FROM public.dbs_control_purchases
   WHERE id=v_link.purchase_id AND scope_key=v_scope
   FOR UPDATE;
  IF NOT FOUND OR v_purchase.approval_status IS DISTINCT FROM 'approved'
     OR v_purchase.status NOT IN ('received','partially_received') THEN
    RAISE EXCEPTION 'DBS_GAS_REFILL_PURCHASE_NOT_RECEIVED' USING errcode='23514';
  END IF;

  SELECT * INTO v_item
    FROM public.dbs_control_purchase_items
   WHERE id=v_link.purchase_item_id AND purchase_id=v_purchase.id
   FOR UPDATE;
  IF NOT FOUND OR v_item.part_id IS DISTINCT FROM v_request.part_id THEN
    RAISE EXCEPTION 'DBS_GAS_REFILL_PURCHASE_ITEM_MISMATCH' USING errcode='23514';
  END IF;

  SELECT coalesce(sum(quantity_linked),0) INTO v_linked
    FROM public.dbs_control_material_request_purchase_links
   WHERE purchase_item_id=v_item.id;
  SELECT coalesce(sum(quantity_received),0) INTO v_received
    FROM public.dbs_control_purchase_receipt_items
   WHERE purchase_item_id=v_item.id AND part_id=v_item.part_id;
  SELECT coalesce(sum(quantity_consumed),0) INTO v_consumed
    FROM public.dbs_control_gas_refill_events
   WHERE purchase_item_id=v_item.id AND scope_key=v_scope;
  IF v_received-v_consumed < 1 OR v_linked > v_item.quantity THEN
    RAISE EXCEPTION 'DBS_GAS_REFILL_RECEIPT_QUANTITY_UNAVAILABLE' USING errcode='23514';
  END IF;

  SELECT receipt_line.* INTO v_receipt_item
    FROM public.dbs_control_purchase_receipt_items receipt_line
   WHERE receipt_line.purchase_item_id=v_item.id
     AND receipt_line.part_id=v_item.part_id
     AND receipt_line.quantity_received - coalesce((
       SELECT sum(refill_event.quantity_consumed)
         FROM public.dbs_control_gas_refill_events refill_event
        WHERE refill_event.receipt_item_id=receipt_line.id
          AND refill_event.scope_key=v_scope
     ),0) >= 1
   ORDER BY receipt_line.created_at ASC, receipt_line.id
   LIMIT 1
   FOR UPDATE OF receipt_line;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DBS_GAS_REFILL_RECEIPT_LINE_QUANTITY_UNAVAILABLE' USING errcode='23514';
  END IF;

  SELECT * INTO v_part
    FROM public.dbs_control_parts
   WHERE id=v_request.part_id AND scope_key=v_scope AND status='ativo'
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DBS_GAS_REFILL_PART_NOT_AVAILABLE' USING errcode='23503'; END IF;
  v_quantity := 1;
  IF coalesce(v_part.stock_quantity,0)-coalesce(v_part.reserved_quantity,0) < v_quantity THEN
    RAISE EXCEPTION 'DBS_GAS_REFILL_STOCK_INSUFFICIENT' USING errcode='23514';
  END IF;
  v_unit_cost := coalesce(v_part.cost_cents,0);
  IF v_unit_cost <= 0 THEN RAISE EXCEPTION 'DBS_GAS_REFILL_COST_REQUIRED' USING errcode='23514'; END IF;
  v_total_cost := round(v_quantity*v_unit_cost)::bigint;
  IF v_total_cost <= 0 THEN RAISE EXCEPTION 'DBS_GAS_REFILL_COST_REQUIRED' USING errcode='23514'; END IF;
  v_new_stock := v_part.stock_quantity-v_quantity;

  UPDATE public.dbs_control_parts
     SET stock_quantity=v_new_stock,version=version+1,updated_at=now()
   WHERE id=v_part.id;

  INSERT INTO public.dbs_control_inventory_movements(
    id,company_id,scope_key,part_id,movement_type,quantity_delta,unit_cost_cents,balance_after,
    purchase_id,purchase_item_id,idempotency_key,created_by,metadata
  ) VALUES (
    v_movement_id,v_purchase.company_id,v_scope,v_part.id,'consume',-v_quantity,v_unit_cost,v_new_stock,
    v_purchase.id,v_item.id,left('gas-refill-stock:'||v_event_id::text,240),
    p_actor_user_id,
    jsonb_build_object('source','dbs_control_gas_refill_events','request_id',p_request_id,
      'cylinder_id',v_cylinder.id,'serial_number',v_cylinder.serial_number,'refrigerant_type',v_cylinder.refrigerant_type)
  );

  v_ledger := public.post_treasury_ledger_entry(
    v_scope,v_purchase.company_id,current_date,current_date,
    'gas_cylinder_refill_consumption','Recarga de gás · '||v_cylinder.serial_number,
    left('gas-refill:'||v_event_id::text,200),
    'gas-refill-event:'||v_event_id::text,
    p_actor_user_id,'posted',
    jsonb_build_object('source','dbs_control_gas_refill_events','request_id',p_request_id,
      'cylinder_id',v_cylinder.id,'part_id',v_part.id,'purchase_id',v_purchase.id,
      'purchase_item_id',v_item.id,'receipt_item_id',v_receipt_item.id),
    jsonb_build_array(
      jsonb_build_object('account_code','5.1.01','account_name','Consumo de peças e materiais',
        'account_type','expense','debit_cents',v_total_cost,'credit_cents',0),
      jsonb_build_object('account_code','1.1.03','account_name','Estoque de peças',
        'account_type','asset','debit_cents',0,'credit_cents',v_total_cost)
    )
  );
  v_ledger_id := nullif(v_ledger->>'entry_id','')::uuid;
  IF v_ledger_id IS NULL THEN
    RAISE EXCEPTION 'DBS_GAS_REFILL_LEDGER_FAILED' USING errcode='23514';
  END IF;

  UPDATE public.dbs_control_gas_cylinders
     SET total_charges=p_total_charges,used_charges=0,remaining_charges=p_total_charges,
         refill_count=refill_count+1,status='active',updated_at=now()
   WHERE id=v_cylinder.id;

  INSERT INTO public.dbs_control_gas_refill_events(
    id,company_id,scope_key,material_request_id,gas_cylinder_id,part_id,purchase_id,
    purchase_item_id,receipt_item_id,inventory_movement_id,ledger_entry_id,
    quantity_consumed,unit_cost_cents,total_cost_cents,total_charges_after,
    serial_number,refrigerant_type,idempotency_key,created_by
  ) VALUES (
    v_event_id,v_purchase.company_id,v_scope,p_request_id,v_cylinder.id,v_part.id,v_purchase.id,
    v_item.id,v_receipt_item.id,v_movement_id,v_ledger_id,
    v_quantity,v_unit_cost,v_total_cost,p_total_charges,
    v_cylinder.serial_number,v_cylinder.refrigerant_type,v_key,p_actor_user_id
  );

  UPDATE public.dbs_control_material_requests
     SET status='fulfilled',fulfilled_quantity=quantity,
         decision_note=left('Recarga registrada. Custo de material: '||v_total_cost::text||' centavos.',2000),
         decided_by=p_actor_user_id,decided_at=now(),updated_at=now(),version=version+1
   WHERE id=p_request_id;

  INSERT INTO public.dbs_control_inventory_outbox(
    idempotency_key,scope_key,aggregate_type,aggregate_id,event_type,payload
  ) VALUES (
    left('gas-refill:completed:'||v_scope||':'||v_event_id::text,240),
    v_scope,'gas_cylinder',v_cylinder.id,'inventory.gas_cylinder.refilled',
    jsonb_build_object('event_id',v_event_id,'request_id',p_request_id,'gas_cylinder_id',v_cylinder.id,
      'part_id',v_part.id,'purchase_id',v_purchase.id,'total_charges',p_total_charges,
      'total_cost_cents',v_total_cost,'ledger_entry_id',v_ledger_id)
  ) ON CONFLICT(idempotency_key) DO NOTHING;

  RETURN jsonb_build_object(
    'ok',true,'replayed',false,'event_id',v_event_id,'request_id',p_request_id,
    'gas_cylinder_id',v_cylinder.id,'total_charges',p_total_charges,
    'total_cost_cents',v_total_cost,'ledger_entry_id',v_ledger_id,'version',v_request.version+1
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.dbs_control_fulfill_gas_refill_request(uuid,uuid,integer,text,bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dbs_control_fulfill_gas_refill_request(uuid,uuid,integer,text,bigint)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
