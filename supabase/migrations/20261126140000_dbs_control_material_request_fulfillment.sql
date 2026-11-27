-- DBS Air | Entrega de solicitações por transferência operacional transacional.
-- Mantém o estoque central/operacional existente e impede baixa lógica sem movimento.
BEGIN;

CREATE TABLE IF NOT EXISTS public.dbs_control_material_request_fulfillments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_key text NOT NULL,
  material_request_id uuid NOT NULL REFERENCES public.dbs_control_material_requests(id) ON DELETE RESTRICT,
  movement_id uuid NOT NULL REFERENCES public.dbs_control_operational_stock_movements(id) ON DELETE RESTRICT,
  part_id uuid NOT NULL REFERENCES public.dbs_control_parts(id) ON DELETE RESTRICT,
  destination_stock_id uuid NOT NULL REFERENCES public.dbs_control_operational_stocks(id) ON DELETE RESTRICT,
  quantity numeric(18,4) NOT NULL CHECK (quantity > 0),
  idempotency_key text NOT NULL CHECK (char_length(btrim(idempotency_key)) BETWEEN 8 AND 240),
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(scope_key, idempotency_key)
);

CREATE INDEX IF NOT EXISTS dbs_control_material_request_fulfillments_request_idx
  ON public.dbs_control_material_request_fulfillments(material_request_id, created_at DESC);

ALTER TABLE public.dbs_control_material_request_fulfillments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dbs_control_material_request_fulfillments FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.dbs_control_material_request_fulfillments TO service_role;

-- A transferência física continua executada pelo RPC existente. Este patch apenas
-- aceita também o FINANCEIRO_OPERADOR vinculado, sem ampliar dbs_control_is_admin_actor.
DO $patch_transfer$
DECLARE
  v_def text;
  v_old text := $old$IF p_actor_user_id IS NULL OR NOT public.dbs_control_is_admin_actor(p_actor_user_id) THEN$old$;
  v_new text := $new$IF p_actor_user_id IS NULL OR NOT public.dbs_control_is_inventory_finance_actor(p_actor_user_id) THEN$new$;
BEGIN
  SELECT pg_get_functiondef(
    'public.dbs_control_operational_stock_transfer(uuid,uuid,numeric,uuid,uuid,text,text)'::regprocedure
  ) INTO v_def;
  IF v_def IS NULL OR position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'DBS material fulfillment: guarda do RPC de transferência mudou; migração abortada.';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END;
$patch_transfer$;

CREATE OR REPLACE FUNCTION public.dbs_control_fulfill_material_request(
  p_request_id uuid,
  p_actor_user_id uuid,
  p_quantity numeric,
  p_destination_stock_id uuid,
  p_idempotency_key text,
  p_expected_version bigint
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor_company uuid;
  v_scope text;
  v_request public.dbs_control_material_requests%rowtype;
  v_stock public.dbs_control_operational_stocks%rowtype;
  v_existing public.dbs_control_material_request_fulfillments%rowtype;
  v_linked_quantity numeric(18,4);
  v_received_quantity numeric(18,4);
  v_has_links boolean;
  v_movement jsonb;
  v_movement_id uuid;
  v_fulfilled numeric(18,4);
  v_new_status text;
  v_key text := nullif(btrim(p_idempotency_key), '');
BEGIN
  IF p_actor_user_id IS NULL OR NOT public.dbs_control_is_inventory_finance_actor(p_actor_user_id) THEN
    RAISE EXCEPTION 'DBS_MATERIAL_REQUEST_FULFILLMENT_FORBIDDEN' USING errcode = '42501';
  END IF;
  IF p_request_id IS NULL OR p_quantity IS NULL OR p_quantity <= 0
     OR p_destination_stock_id IS NULL OR v_key IS NULL
     OR char_length(v_key) NOT BETWEEN 8 AND 240
     OR p_expected_version IS NULL OR p_expected_version < 1 THEN
    RAISE EXCEPTION 'DBS_MATERIAL_REQUEST_FULFILLMENT_INPUT_INVALID' USING errcode = '22023';
  END IF;

  SELECT company_id INTO v_actor_company
    FROM public.users WHERE id = p_actor_user_id AND status = 'ativo';
  v_scope := CASE WHEN v_actor_company IS NOT NULL
    THEN 'company:' || v_actor_company::text
    ELSE 'user:' || p_actor_user_id::text END;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_scope || ':material-request-fulfillment:' || v_key, 0));

  SELECT * INTO v_existing
    FROM public.dbs_control_material_request_fulfillments
   WHERE scope_key = v_scope AND idempotency_key = v_key;
  IF FOUND THEN
    IF v_existing.material_request_id IS DISTINCT FROM p_request_id
       OR v_existing.quantity IS DISTINCT FROM p_quantity
       OR v_existing.destination_stock_id IS DISTINCT FROM p_destination_stock_id THEN
      RAISE EXCEPTION 'DBS_MATERIAL_REQUEST_FULFILLMENT_KEY_REUSED' USING errcode = '23505';
    END IF;
    RETURN jsonb_build_object('ok', true, 'replayed', true,
      'fulfillment_id', v_existing.id, 'movement_id', v_existing.movement_id,
      'request_id', v_existing.material_request_id, 'quantity', v_existing.quantity);
  END IF;

  SELECT * INTO v_request
    FROM public.dbs_control_material_requests
   WHERE id = p_request_id AND scope_key = v_scope
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DBS_MATERIAL_REQUEST_NOT_FOUND' USING errcode = 'P0002'; END IF;
  IF v_request.version <> p_expected_version THEN
    RAISE EXCEPTION 'DBS_MATERIAL_REQUEST_VERSION_CONFLICT' USING errcode = '40001';
  END IF;
  IF v_request.status NOT IN ('approved','awaiting_purchase','ready_for_delivery') THEN
    RAISE EXCEPTION 'DBS_MATERIAL_REQUEST_NOT_READY_FOR_DELIVERY' USING errcode = '23514';
  END IF;
  IF v_request.part_id IS NULL THEN
    RAISE EXCEPTION 'DBS_MATERIAL_REQUEST_PART_NOT_MAPPED' USING errcode = '23514';
  END IF;
  IF p_quantity > v_request.quantity - v_request.fulfilled_quantity THEN
    RAISE EXCEPTION 'DBS_MATERIAL_REQUEST_FULFILLMENT_EXCEEDS_REMAINING' USING errcode = '23514';
  END IF;

  SELECT * INTO v_stock
    FROM public.dbs_control_operational_stocks
   WHERE id = p_destination_stock_id AND scope_key = v_scope AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'DBS_OPERATIONAL_STOCK_DESTINATION_INVALID' USING errcode = '23503'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.dbs_control_material_request_purchase_links
    WHERE material_request_id = p_request_id
  ) INTO v_has_links;
  IF v_has_links THEN
    SELECT coalesce(sum(l.quantity_linked), 0),
           coalesce(sum(least(l.quantity_linked, coalesce(pi.quantity_received, 0))), 0)
      INTO v_linked_quantity, v_received_quantity
      FROM public.dbs_control_material_request_purchase_links l
      JOIN public.dbs_control_purchase_items pi ON pi.id = l.purchase_item_id
     WHERE l.material_request_id = p_request_id;
    IF v_request.fulfilled_quantity + p_quantity > v_linked_quantity THEN
      RAISE EXCEPTION 'DBS_MATERIAL_REQUEST_PURCHASE_LINK_QUANTITY_PENDING' USING errcode = '23514';
    END IF;
    IF v_request.fulfilled_quantity + p_quantity > v_received_quantity THEN
      RAISE EXCEPTION 'DBS_MATERIAL_REQUEST_PURCHASE_NOT_RECEIVED' USING errcode = '23514';
    END IF;
  END IF;

  -- Transfere do saldo central para o estoque operacional. O RPC existente
  -- valida saldo disponível, atualiza ambos os saldos e grava um movimento único.
  v_movement := public.dbs_control_operational_stock_transfer(
    p_actor_user_id, v_request.part_id, p_quantity, NULL,
    p_destination_stock_id, v_key, 'Solicitação DBS ' || p_request_id::text
  );
  v_movement_id := nullif(v_movement->>'movement_id','')::uuid;
  IF v_movement_id IS NULL THEN
    RAISE EXCEPTION 'DBS_MATERIAL_REQUEST_MOVEMENT_NOT_CONFIRMED' USING errcode = 'P0001';
  END IF;

  INSERT INTO public.dbs_control_material_request_fulfillments(
    scope_key, material_request_id, movement_id, part_id,
    destination_stock_id, quantity, idempotency_key, created_by
  ) VALUES (
    v_scope, p_request_id, v_movement_id, v_request.part_id,
    p_destination_stock_id, p_quantity, v_key, p_actor_user_id
  ) RETURNING * INTO v_existing;

  v_fulfilled := v_request.fulfilled_quantity + p_quantity;
  IF v_fulfilled >= v_request.quantity THEN
    v_new_status := 'fulfilled';
  ELSIF v_has_links AND v_received_quantity >= v_request.quantity THEN
    v_new_status := 'ready_for_delivery';
  ELSE
    v_new_status := v_request.status;
  END IF;

  UPDATE public.dbs_control_material_requests
     SET fulfilled_quantity = v_fulfilled,
         status = v_new_status,
         updated_at = now(),
         version = version + 1
   WHERE id = p_request_id
   RETURNING * INTO v_request;

  RETURN jsonb_build_object(
    'ok', true, 'replayed', false,
    'fulfillment_id', v_existing.id, 'movement_id', v_movement_id,
    'request_id', p_request_id, 'quantity', p_quantity,
    'fulfilled_quantity', v_fulfilled, 'status', v_request.status,
    'version', v_request.version
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.dbs_control_fulfill_material_request(uuid,uuid,numeric,uuid,text,bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dbs_control_fulfill_material_request(uuid,uuid,numeric,uuid,text,bigint)
  TO service_role;

-- Permite vincular mais de um recebimento/linha após um atendimento parcial.
DO $patch_links$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(
    'public.dbs_control_link_material_request_purchase(uuid,uuid,uuid,uuid,numeric,bigint)'::regprocedure
  ) INTO v_def;
  v_old := $old$v_request.status NOT IN ('approved','awaiting_purchase')$old$;
  v_new := $new$v_request.status NOT IN ('approved','awaiting_purchase','ready_for_delivery')$new$;
  IF v_def IS NULL OR position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'DBS material fulfillment: condição de vínculo mudou; migração abortada.';
  END IF;
  v_def := replace(v_def, v_old, v_new);

  v_old := $old$     SET status = 'awaiting_purchase',
         updated_at = now(),$old$;
  v_new := $new$     SET status = 'awaiting_purchase',
         part_id = coalesce(part_id, v_item.part_id),
         updated_at = now(),$new$;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'DBS material fulfillment: atualização do vínculo mudou; migração abortada.';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END;
$patch_links$;

NOTIFY pgrst, 'reload schema';
COMMIT;
