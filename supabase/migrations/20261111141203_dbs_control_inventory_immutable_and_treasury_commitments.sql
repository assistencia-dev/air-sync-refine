-- Migration E: livro de movimentos imutável, estorno rastreável e leitura de compromissos no Treasury.
BEGIN;

ALTER TABLE public.dbs_control_inventory_movements
  ADD COLUMN IF NOT EXISTS reversal_of_movement_id uuid
    REFERENCES public.dbs_control_inventory_movements(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS dbs_control_inventory_movements_one_reversal_uidx
  ON public.dbs_control_inventory_movements(reversal_of_movement_id)
  WHERE reversal_of_movement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS dbs_control_purchases_treasury_commitment_idx
  ON public.dbs_control_purchases(scope_key, approval_status, payment_status, purchase_date DESC);

CREATE OR REPLACE FUNCTION public.dbs_control_reject_inventory_movement_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'DBS_INVENTORY_MOVEMENT_IMMUTABLE: correções somente por estorno rastreável.'
    USING errcode = '55000';
END;
$$;
DROP TRIGGER IF EXISTS trg_dbs_control_inventory_movements_immutable ON public.dbs_control_inventory_movements;
CREATE TRIGGER trg_dbs_control_inventory_movements_immutable
BEFORE UPDATE OR DELETE ON public.dbs_control_inventory_movements
FOR EACH ROW EXECUTE FUNCTION public.dbs_control_reject_inventory_movement_mutation();
DROP TRIGGER IF EXISTS trg_dbs_control_inventory_movements_no_truncate ON public.dbs_control_inventory_movements;
CREATE TRIGGER trg_dbs_control_inventory_movements_no_truncate
BEFORE TRUNCATE ON public.dbs_control_inventory_movements
FOR EACH STATEMENT EXECUTE FUNCTION public.dbs_control_reject_inventory_movement_mutation();

REVOKE UPDATE, DELETE, TRUNCATE ON public.dbs_control_inventory_movements
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.dbs_control_inventory_movements TO service_role;

CREATE OR REPLACE FUNCTION public.dbs_control_reverse_inventory_movement(
  p_movement_id uuid, p_actor_user_id uuid, p_idempotency_key text, p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_original public.dbs_control_inventory_movements%rowtype;
  v_existing public.dbs_control_inventory_movements%rowtype;
  v_part public.dbs_control_parts%rowtype;
  v_actor_company uuid;
  v_key text := nullif(btrim(p_idempotency_key), '');
  v_reason text := nullif(btrim(p_reason), '');
  v_reverse_delta numeric(18,4);
  v_new_stock numeric(18,4);
  v_new_value numeric;
  v_new_cost integer;
  v_amount bigint;
  v_ledger jsonb;
  v_ledger_id uuid;
  v_already_reversed uuid;
BEGIN
  IF p_actor_user_id IS NULL OR NOT public.dbs_control_is_admin_actor(p_actor_user_id) THEN
    RAISE EXCEPTION 'DBS_INVENTORY_REVERSAL_FORBIDDEN' USING errcode = '42501';
  END IF;
  IF p_movement_id IS NULL OR v_key IS NULL OR char_length(v_key) NOT BETWEEN 8 AND 240
     OR v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 5 AND 1000 THEN
    RAISE EXCEPTION 'DBS_INVENTORY_REVERSAL_INPUT_INVALID' USING errcode = '22023';
  END IF;
  SELECT company_id INTO v_actor_company FROM public.users
   WHERE id = p_actor_user_id AND status = 'ativo';
  SELECT * INTO v_original FROM public.dbs_control_inventory_movements
   WHERE id = p_movement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DBS_INVENTORY_MOVEMENT_NOT_FOUND' USING errcode = '23503'; END IF;
  IF v_actor_company IS NOT NULL AND v_actor_company IS DISTINCT FROM v_original.company_id THEN
    RAISE EXCEPTION 'DBS_INVENTORY_REVERSAL_SCOPE_MISMATCH' USING errcode = '42501';
  END IF;
  IF v_original.movement_type NOT IN ('receipt','consume','return','adjustment')
     OR v_original.work_order_id IS NOT NULL OR v_original.work_order_part_id IS NOT NULL THEN
    RAISE EXCEPTION 'DBS_INVENTORY_MOVEMENT_REVERSAL_TYPE_NOT_SUPPORTED: movimentos de reserva e consumo vinculados à OS devem ser corrigidos pelo fluxo operacional da OS.'
      USING errcode = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('inventory-movement-reversal:' || p_movement_id::text, 0));
  SELECT * INTO v_existing FROM public.dbs_control_inventory_movements
   WHERE scope_key = v_original.scope_key AND idempotency_key = v_key;
  IF FOUND THEN
    IF v_existing.reversal_of_movement_id IS DISTINCT FROM p_movement_id THEN
      RAISE EXCEPTION 'DBS_INVENTORY_REVERSAL_IDEMPOTENCY_CONFLICT' USING errcode = '23505';
    END IF;
    RETURN jsonb_build_object('ok',true,'replayed',true,'movement_id',v_existing.id,
      'reversal_of_movement_id',p_movement_id);
  END IF;
  SELECT id INTO v_already_reversed FROM public.dbs_control_inventory_movements
   WHERE reversal_of_movement_id = p_movement_id;
  IF FOUND THEN RAISE EXCEPTION 'DBS_INVENTORY_MOVEMENT_ALREADY_REVERSED' USING errcode = '23514'; END IF;
  SELECT * INTO v_part FROM public.dbs_control_parts WHERE id = v_original.part_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DBS_INVENTORY_REVERSAL_PART_NOT_FOUND' USING errcode = '23503'; END IF;

  v_reverse_delta := -v_original.quantity_delta;
  v_new_stock := coalesce(v_part.stock_quantity,0) + v_reverse_delta;
  IF v_new_stock < 0 THEN RAISE EXCEPTION 'DBS_INVENTORY_REVERSAL_NEGATIVE_STOCK' USING errcode = '23514'; END IF;
  v_new_value := coalesce(v_part.stock_quantity,0) * coalesce(v_part.cost_cents,0)
    + v_reverse_delta * v_original.unit_cost_cents;
  IF v_new_value < 0 THEN RAISE EXCEPTION 'DBS_INVENTORY_REVERSAL_NEGATIVE_VALUE' USING errcode = '23514'; END IF;
  v_new_cost := CASE WHEN v_new_stock > 0 THEN round(v_new_value / v_new_stock)::integer ELSE 0 END;
  v_amount := round(abs(v_original.quantity_delta) * v_original.unit_cost_cents)::bigint;

  IF v_original.movement_type = 'receipt' AND v_original.purchase_item_id IS NOT NULL THEN
    UPDATE public.dbs_control_purchase_items
       SET quantity_received = quantity_received - v_original.quantity_delta,
           received_total_cents = greatest(0, received_total_cents - v_amount)
     WHERE id = v_original.purchase_item_id AND quantity_received >= v_original.quantity_delta;
    IF NOT FOUND THEN RAISE EXCEPTION 'DBS_PURCHASE_RECEIPT_REVERSAL_ITEM_CONFLICT' USING errcode = '23514'; END IF;
    UPDATE public.dbs_control_purchases p
       SET received_total_cents = (SELECT coalesce(sum(pi.received_total_cents),0)::bigint
         FROM public.dbs_control_purchase_items pi WHERE pi.purchase_id = p.id),
           status = CASE
             WHEN (SELECT bool_and(pi.quantity_received = pi.quantity) FROM public.dbs_control_purchase_items pi WHERE pi.purchase_id = p.id) THEN 'received'
             WHEN (SELECT bool_or(pi.quantity_received > 0) FROM public.dbs_control_purchase_items pi WHERE pi.purchase_id = p.id) THEN 'partially_received'
             ELSE 'draft' END,
           version = version + 1, updated_at = now()
     WHERE p.id = v_original.purchase_id;
  END IF;

  UPDATE public.dbs_control_parts SET stock_quantity = v_new_stock, cost_cents = v_new_cost,
    version = version + 1, updated_at = now() WHERE id = v_part.id;
  INSERT INTO public.dbs_control_inventory_movements(
    company_id,scope_key,part_id,movement_type,quantity_delta,unit_cost_cents,balance_after,
    purchase_id,purchase_item_id,work_order_id,work_order_part_id,idempotency_key,created_by,
    metadata,reversal_of_movement_id
  ) VALUES (
    v_original.company_id,v_original.scope_key,v_original.part_id,'reversal',v_reverse_delta,
    v_original.unit_cost_cents,v_new_stock,v_original.purchase_id,v_original.purchase_item_id,
    v_original.work_order_id,v_original.work_order_part_id,v_key,p_actor_user_id,
    jsonb_build_object('source','inventory_movement_reversal','reversal_of_movement_id',p_movement_id,
      'reason',v_reason,'original_movement_type',v_original.movement_type),p_movement_id
  ) RETURNING * INTO v_existing;

  IF v_amount > 0 THEN
    IF v_original.movement_type = 'receipt' THEN
      v_ledger := public.post_treasury_ledger_entry(
        v_original.scope_key,v_original.company_id,current_date,current_date,
        'inventory_receipt_reversal','Estorno de recebimento de estoque · '||v_part.name,
        left(v_key||':ledger',200),'inventory-reversal:'||p_movement_id::text,p_actor_user_id,'posted',
        jsonb_build_object('source','dbs_control_inventory_movements','movement_id',p_movement_id,
          'reversal_movement_id',v_existing.id,'reason',v_reason),
        jsonb_build_array(
          jsonb_build_object('account_code','1.1.04','account_name','Estoque em trânsito','account_type','asset','debit_cents',v_amount,'credit_cents',0),
          jsonb_build_object('account_code','1.1.03','account_name','Estoque de peças','account_type','asset','debit_cents',0,'credit_cents',v_amount)
        )
      );
    ELSIF v_reverse_delta > 0 THEN
      v_ledger := public.post_treasury_ledger_entry(
        v_original.scope_key,v_original.company_id,current_date,current_date,
        'inventory_movement_reversal','Estorno de movimento de estoque · '||v_part.name,
        left(v_key||':ledger',200),'inventory-reversal:'||p_movement_id::text,p_actor_user_id,'posted',
        jsonb_build_object('source','dbs_control_inventory_movements','movement_id',p_movement_id,
          'reversal_movement_id',v_existing.id,'reason',v_reason),
        jsonb_build_array(
          jsonb_build_object('account_code','1.1.03','account_name','Estoque de peças','account_type','asset','debit_cents',v_amount,'credit_cents',0),
          jsonb_build_object('account_code','5.1.01','account_name','Custo de peças aplicadas','account_type','expense','debit_cents',0,'credit_cents',v_amount)
        )
      );
    ELSE
      v_ledger := public.post_treasury_ledger_entry(
        v_original.scope_key,v_original.company_id,current_date,current_date,
        'inventory_movement_reversal','Estorno de movimento de estoque · '||v_part.name,
        left(v_key||':ledger',200),'inventory-reversal:'||p_movement_id::text,p_actor_user_id,'posted',
        jsonb_build_object('source','dbs_control_inventory_movements','movement_id',p_movement_id,
          'reversal_movement_id',v_existing.id,'reason',v_reason),
        jsonb_build_array(
          jsonb_build_object('account_code','5.1.01','account_name','Custo de peças aplicadas','account_type':'expense','debit_cents',v_amount,'credit_cents',0),
          jsonb_build_object('account_code','1.1.03','account_name','Estoque de peças','account_type':'asset','debit_cents',0,'credit_cents',v_amount)
        )
      );
    END IF;
    v_ledger_id := nullif(v_ledger->>'entry_id','')::uuid;
    IF v_ledger_id IS NULL THEN RAISE EXCEPTION 'DBS_INVENTORY_REVERSAL_LEDGER_FAILED' USING errcode = '23514'; END IF;
  END IF;
  RETURN jsonb_build_object('ok',true,'replayed',false,'movement_id',v_existing.id,
    'reversal_of_movement_id',p_movement_id,'stock_quantity',v_new_stock,
    'cost_cents',v_new_cost,'ledger_entry_id',v_ledger_id);
END;
$$;

REVOKE ALL ON FUNCTION public.dbs_control_reverse_inventory_movement(uuid,uuid,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dbs_control_reverse_inventory_movement(uuid,uuid,text,text)
  TO service_role;

CREATE OR REPLACE VIEW public.dbs_treasury_purchase_commitments
WITH (security_invoker = true)
AS
SELECT p.id AS purchase_id,p.company_id,p.scope_key,p.supplier_id,p.supplier_name,
  p.document_number,p.purchase_date AS commitment_date,p.status AS purchase_status,
  p.approval_status,p.payment_status,p.total_cents,p.paid_cents,
  greatest(p.total_cents-p.paid_cents,0)::bigint AS outstanding_cents,
  p.received_total_cents,p.ledger_entry_id AS payable_ledger_entry_id,
  le.status AS payable_ledger_status,p.created_at,p.updated_at
FROM public.dbs_control_purchases p
JOIN public.treasury_ledger_entries le ON le.id=p.ledger_entry_id AND le.scope_key=p.scope_key
WHERE p.approval_status='approved' AND p.status<>'cancelled'
  AND p.paid_cents<p.total_cents AND le.status IN ('draft','posted');

REVOKE ALL ON public.dbs_treasury_purchase_commitments FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.dbs_treasury_purchase_commitments TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;