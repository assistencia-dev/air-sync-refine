-- Migration D: recebimento físico parcial por item, sem duplicar contas a pagar.
-- Cada conferência movimenta somente a quantidade recebida e reclassifica o valor
-- correspondente de estoque em trânsito para estoque disponível.
BEGIN;

ALTER TABLE public.dbs_control_purchases
  DROP CONSTRAINT IF EXISTS dbs_control_purchases_status_check;
ALTER TABLE public.dbs_control_purchases
  ADD CONSTRAINT dbs_control_purchases_status_check
  CHECK (status IN ('draft','partially_received','received','cancelled'));

ALTER TABLE public.dbs_control_purchases
  ADD COLUMN IF NOT EXISTS received_total_cents bigint NOT NULL DEFAULT 0
  CHECK (received_total_cents >= 0 AND received_total_cents <= total_cents);

ALTER TABLE public.dbs_control_purchase_items
  ADD COLUMN IF NOT EXISTS quantity_received numeric(18,4) NOT NULL DEFAULT 0
    CHECK (quantity_received >= 0 AND quantity_received <= quantity),
  ADD COLUMN IF NOT EXISTS received_total_cents bigint NOT NULL DEFAULT 0
    CHECK (received_total_cents >= 0 AND received_total_cents <= total_cents);

-- Preserva o saldo de compras integralmente recebidas antes desta fase:
-- não cria movimentos nem lançamentos retroativos.
UPDATE public.dbs_control_purchase_items pi
   SET quantity_received = pi.quantity,
       received_total_cents = pi.total_cents
  FROM public.dbs_control_purchases p
 WHERE p.id = pi.purchase_id
   AND (p.status = 'received' OR p.approval_status = 'legacy_received')
   AND pi.quantity_received = 0;

UPDATE public.dbs_control_purchases p
   SET received_total_cents = coalesce((
     SELECT sum(pi.received_total_cents)::bigint
       FROM public.dbs_control_purchase_items pi
      WHERE pi.purchase_id = p.id
   ), 0)
 WHERE p.status = 'received' OR p.approval_status = 'legacy_received';

CREATE TABLE IF NOT EXISTS public.dbs_control_purchase_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL REFERENCES public.dbs_control_purchases(id) ON DELETE RESTRICT,
  company_id uuid REFERENCES public.companies(id) ON DELETE RESTRICT,
  scope_key text NOT NULL,
  idempotency_key text NOT NULL
    CHECK (char_length(trim(idempotency_key)) BETWEEN 8 AND 240),
  receipt_number text,
  received_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  total_cents bigint NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  ledger_entry_id uuid REFERENCES public.treasury_ledger_entries(id) ON DELETE RESTRICT,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(scope_key, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.dbs_control_purchase_receipt_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES public.dbs_control_purchase_receipts(id) ON DELETE RESTRICT,
  purchase_item_id uuid NOT NULL REFERENCES public.dbs_control_purchase_items(id) ON DELETE RESTRICT,
  part_id uuid NOT NULL REFERENCES public.dbs_control_parts(id) ON DELETE RESTRICT,
  quantity_received numeric(18,4) NOT NULL CHECK (quantity_received > 0),
  unit_cost_cents integer NOT NULL CHECK (unit_cost_cents >= 0),
  total_cents bigint NOT NULL CHECK (total_cents >= 0),
  stock_balance_after numeric(18,4) NOT NULL CHECK (stock_balance_after >= 0),
  weighted_average_cost_cents integer NOT NULL CHECK (weighted_average_cost_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(receipt_id, purchase_item_id)
);

CREATE INDEX IF NOT EXISTS dbs_control_purchase_receipts_purchase_idx
  ON public.dbs_control_purchase_receipts(purchase_id, received_at DESC);
CREATE INDEX IF NOT EXISTS dbs_control_purchase_receipt_items_item_idx
  ON public.dbs_control_purchase_receipt_items(purchase_item_id, created_at DESC);

ALTER TABLE public.dbs_control_purchase_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dbs_control_purchase_receipt_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dbs_control_purchase_receipts, public.dbs_control_purchase_receipt_items
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.dbs_control_purchase_receipts, public.dbs_control_purchase_receipt_items
  TO service_role;

CREATE OR REPLACE FUNCTION public.dbs_control_receive_purchase_items(
  p_purchase_id uuid,
  p_actor_user_id uuid,
  p_idempotency_key text,
  p_items jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_purchase public.dbs_control_purchases%rowtype;
  v_existing public.dbs_control_purchase_receipts%rowtype;
  v_actor_company uuid;
  v_key text := nullif(btrim(p_idempotency_key), '');
  v_item jsonb;
  v_order_item public.dbs_control_purchase_items%rowtype;
  v_part public.dbs_control_parts%rowtype;
  v_receipt_id uuid;
  v_qty numeric(18,4);
  v_new_stock numeric(18,4);
  v_new_cost integer;
  v_line_total bigint;
  v_total bigint := 0;
  v_received_all boolean;
  v_received_any boolean;
  v_count integer := 0;
  v_ledger jsonb;
  v_ledger_id uuid;
BEGIN
  IF p_actor_user_id IS NULL OR NOT public.dbs_control_is_admin_actor(p_actor_user_id) THEN
    RAISE EXCEPTION 'DBS_PURCHASE_RECEIVE_FORBIDDEN' USING errcode = '42501';
  END IF;
  IF p_purchase_id IS NULL OR v_key IS NULL OR char_length(v_key) NOT BETWEEN 8 AND 240 THEN
    RAISE EXCEPTION 'DBS_PURCHASE_RECEIVE_INPUT_INVALID' USING errcode = '22023';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'DBS_PURCHASE_RECEIPT_ITEMS_REQUIRED' USING errcode = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_items) AS x(value)
     WHERE jsonb_typeof(x.value) <> 'object'
        OR nullif(x.value->>'purchase_item_id', '') IS NULL
        OR nullif(x.value->>'quantity_received', '') IS NULL
  ) OR jsonb_array_length(p_items) <> (
    SELECT count(DISTINCT (x.value->>'purchase_item_id')::uuid)
      FROM jsonb_array_elements(p_items) AS x(value)
  ) THEN
    RAISE EXCEPTION 'DBS_PURCHASE_RECEIPT_ITEM_REFERENCE_INVALID' USING errcode = '22023';
  END IF;

  SELECT company_id INTO v_actor_company
    FROM public.users WHERE id = p_actor_user_id AND status = 'ativo';
  SELECT * INTO v_purchase
    FROM public.dbs_control_purchases WHERE id = p_purchase_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DBS_PURCHASE_NOT_FOUND' USING errcode = '23503';
  END IF;
  IF v_actor_company IS NOT NULL AND v_actor_company IS DISTINCT FROM v_purchase.company_id THEN
    RAISE EXCEPTION 'DBS_PURCHASE_SCOPE_MISMATCH' USING errcode = '42501';
  END IF;
  IF v_purchase.status = 'cancelled' THEN
    RAISE EXCEPTION 'DBS_PURCHASE_CANCELLED' USING errcode = '23514';
  END IF;
  IF v_purchase.approval_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'DBS_PURCHASE_APPROVAL_REQUIRED' USING errcode = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_purchase.scope_key || ':purchase-receipt:' || p_purchase_id::text || ':' || v_key, 0
  ));
  SELECT * INTO v_existing
    FROM public.dbs_control_purchase_receipts
   WHERE scope_key = v_purchase.scope_key AND idempotency_key = v_key;
  IF FOUND THEN
    IF v_existing.purchase_id IS DISTINCT FROM p_purchase_id THEN
      RAISE EXCEPTION 'DBS_PURCHASE_RECEIPT_IDEMPOTENCY_CONFLICT' USING errcode = '23505';
    END IF;
    RETURN jsonb_build_object(
      'ok', true, 'replayed', true, 'purchase_id', p_purchase_id,
      'receipt_id', v_existing.id, 'total_cents', v_existing.total_cents,
      'ledger_entry_id', v_existing.ledger_entry_id, 'status', v_purchase.status
    );
  END IF;

  INSERT INTO public.dbs_control_purchase_receipts(
    purchase_id, company_id, scope_key, idempotency_key, receipt_number, received_by, metadata
  ) VALUES (
    p_purchase_id, v_purchase.company_id, v_purchase.scope_key, v_key,
    nullif(btrim(coalesce((p_items->0->>'receipt_number'), '')), ''),
    p_actor_user_id, jsonb_build_object('source', 'dbs_control_purchase_items')
  ) RETURNING id INTO v_receipt_id;

  FOR v_item IN
    SELECT x.value
      FROM jsonb_array_elements(p_items) AS x(value)
      JOIN public.dbs_control_purchase_items pi
        ON pi.id = nullif(x.value->>'purchase_item_id', '')::uuid
       AND pi.purchase_id = p_purchase_id
     ORDER BY pi.part_id, pi.id
  LOOP
    SELECT * INTO v_order_item
      FROM public.dbs_control_purchase_items
     WHERE id = (v_item->>'purchase_item_id')::uuid
       AND purchase_id = p_purchase_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'DBS_PURCHASE_ORDER_ITEM_NOT_FOUND' USING errcode = '23503';
    END IF;

    v_qty := nullif(v_item->>'quantity_received', '')::numeric;
    IF v_qty IS NULL OR v_qty <= 0
       OR v_order_item.quantity_received + v_qty > v_order_item.quantity THEN
      RAISE EXCEPTION 'DBS_PURCHASE_RECEIPT_QUANTITY_INVALID' USING errcode = '22023';
    END IF;

    SELECT * INTO v_part
      FROM public.dbs_control_parts
     WHERE id = v_order_item.part_id
     FOR UPDATE;
    IF NOT FOUND OR v_part.status <> 'ativo' THEN
      RAISE EXCEPTION 'DBS_PURCHASE_RECEIPT_PART_UNAVAILABLE' USING errcode = '23514';
    END IF;

    v_new_stock := coalesce(v_part.stock_quantity, 0) + v_qty;
    v_new_cost := CASE WHEN v_new_stock > 0 THEN
      round((
        coalesce(v_part.stock_quantity, 0) * coalesce(v_part.cost_cents, 0)
        + v_qty * v_order_item.unit_cost_cents
      ) / v_new_stock)::integer
      ELSE v_order_item.unit_cost_cents
    END;
    v_line_total := round(v_qty * v_order_item.unit_cost_cents)::bigint;
    v_total := v_total + v_line_total;

    UPDATE public.dbs_control_parts
       SET stock_quantity = v_new_stock, cost_cents = v_new_cost,
           version = version + 1, updated_at = now()
     WHERE id = v_part.id;

    UPDATE public.dbs_control_purchase_items
       SET quantity_received = quantity_received + v_qty,
           received_total_cents = received_total_cents + v_line_total
     WHERE id = v_order_item.id;

    INSERT INTO public.dbs_control_purchase_receipt_items(
      receipt_id, purchase_item_id, part_id, quantity_received, unit_cost_cents,
      total_cents, stock_balance_after, weighted_average_cost_cents
    ) VALUES (
      v_receipt_id, v_order_item.id, v_part.id, v_qty, v_order_item.unit_cost_cents,
      v_line_total, v_new_stock, v_new_cost
    );

    INSERT INTO public.dbs_control_inventory_movements(
      company_id, scope_key, part_id, movement_type, quantity_delta, unit_cost_cents,
      balance_after, purchase_id, purchase_item_id, idempotency_key, created_by, metadata
    ) VALUES (
      v_purchase.company_id, v_purchase.scope_key, v_part.id, 'receipt', v_qty,
      v_order_item.unit_cost_cents, v_new_stock, p_purchase_id, v_order_item.id,
      left('purchase-receipt:' || v_receipt_id::text || ':' || v_order_item.id::text, 240),
      p_actor_user_id,
      jsonb_build_object('source', 'purchase_physical_receipt', 'purchase_id', p_purchase_id,
        'receipt_id', v_receipt_id, 'receipt_key', v_key)
    );
    v_count := v_count + 1;
  END LOOP;

  IF v_count = 0 OR v_total <= 0 THEN
    RAISE EXCEPTION 'DBS_PURCHASE_RECEIPT_VALUE_INVALID' USING errcode = '22023';
  END IF;

  v_ledger := public.post_treasury_ledger_entry(
    v_purchase.scope_key, v_purchase.company_id, current_date, current_date,
    'inventory_receipt', 'Recebimento físico de compra · ' || v_purchase.supplier_name,
    left(v_key || ':inventory', 200),
    'purchase-receipt:' || v_purchase.id::text || ':' || v_key,
    p_actor_user_id, 'posted',
    jsonb_build_object('source', 'dbs_control_purchase_receipts',
      'purchase_id', p_purchase_id, 'receipt_id', v_receipt_id),
    jsonb_build_array(
      jsonb_build_object('account_code','1.1.03','account_name','Estoque de peças',
        'account_type','asset','debit_cents',v_total,'credit_cents',0),
      jsonb_build_object('account_code','1.1.04','account_name','Estoque em trânsito',
        'account_type','asset','debit_cents',0,'credit_cents',v_total)
    )
  );
  v_ledger_id := nullif(v_ledger->>'entry_id', '')::uuid;
  IF v_ledger_id IS NULL THEN
    RAISE EXCEPTION 'DBS_PURCHASE_RECEIPT_LEDGER_FAILED' USING errcode = '23514';
  END IF;

  UPDATE public.dbs_control_purchase_receipts
     SET total_cents = v_total, ledger_entry_id = v_ledger_id
   WHERE id = v_receipt_id;

  SELECT bool_and(quantity_received = quantity), bool_or(quantity_received > 0)
    INTO v_received_all, v_received_any
    FROM public.dbs_control_purchase_items
   WHERE purchase_id = p_purchase_id;

  UPDATE public.dbs_control_purchases
     SET status = CASE WHEN v_received_all THEN 'received'
                       WHEN v_received_any THEN 'partially_received'
                       ELSE 'draft' END,
         received_total_cents = (
           SELECT coalesce(sum(received_total_cents), 0)::bigint
             FROM public.dbs_control_purchase_items WHERE purchase_id = p_purchase_id
         ),
         received_by = p_actor_user_id,
         receipt_ledger_entry_id = v_ledger_id,
         version = version + 1, updated_at = now()
   WHERE id = p_purchase_id;

  INSERT INTO public.dbs_control_inventory_outbox(
    idempotency_key, scope_key, aggregate_type, aggregate_id, event_type, payload
  ) VALUES (
    left('purchase:receipt:' || v_purchase.scope_key || ':' || v_receipt_id::text, 240),
    v_purchase.scope_key, 'purchase', p_purchase_id, 'inventory.purchase.receipt_recorded',
    jsonb_build_object('purchase_id', p_purchase_id, 'receipt_id', v_receipt_id,
      'total_cents', v_total, 'status', CASE WHEN v_received_all THEN 'received' ELSE 'partially_received' END)
  ) ON CONFLICT(idempotency_key) DO NOTHING;

  RETURN jsonb_build_object(
    'ok', true, 'replayed', false, 'purchase_id', p_purchase_id, 'receipt_id', v_receipt_id,
    'received_total_cents', v_total, 'receipt_ledger_entry_id', v_ledger_id,
    'status', CASE WHEN v_received_all THEN 'received' ELSE 'partially_received' END,
    'movement_count', v_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.dbs_control_receive_purchase_items(uuid,uuid,text,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dbs_control_receive_purchase_items(uuid,uuid,text,jsonb)
  TO service_role;

-- Compatibility wrapper: callers using the previous three-argument RPC still
-- receive only the outstanding balance, now through the same partial-safe path.
CREATE OR REPLACE FUNCTION public.dbs_control_receive_registered_purchase(
  p_purchase_id uuid, p_actor_user_id uuid, p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_items jsonb;
  v_purchase public.dbs_control_purchases%rowtype;
BEGIN
  SELECT * INTO v_purchase FROM public.dbs_control_purchases
   WHERE id = p_purchase_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DBS_PURCHASE_NOT_FOUND' USING errcode = '23503';
  END IF;
  IF v_purchase.status = 'received' THEN
    RETURN jsonb_build_object('ok',true,'replayed',true,'purchase_id',p_purchase_id,
      'status','received','total_cents',v_purchase.total_cents,
      'receipt_ledger_entry_id',v_purchase.receipt_ledger_entry_id);
  END IF;
  SELECT jsonb_agg(jsonb_build_object(
    'purchase_item_id', id,
    'quantity_received', quantity - quantity_received
  ))
  INTO v_items
  FROM public.dbs_control_purchase_items
  WHERE purchase_id = p_purchase_id AND quantity > quantity_received;
  IF v_items IS NULL THEN
    RAISE EXCEPTION 'DBS_PURCHASE_RECEIPT_ITEMS_REQUIRED' USING errcode = '22023';
  END IF;
  RETURN public.dbs_control_receive_purchase_items(
    p_purchase_id, p_actor_user_id, p_idempotency_key, v_items
  );
END;
$$;

REVOKE ALL ON FUNCTION public.dbs_control_receive_registered_purchase(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dbs_control_receive_registered_purchase(uuid,uuid,text)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
