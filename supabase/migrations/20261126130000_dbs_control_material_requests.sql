-- DBS Air | Solicitações operacionais de peças, ferramentas, insumos e gás.
-- Fase aditiva: conecta necessidade do DBS Control à decisão e compra do Financeiro.
BEGIN;

CREATE TABLE IF NOT EXISTS public.dbs_control_material_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE RESTRICT,
  scope_key text NOT NULL,
  request_type text NOT NULL
    CHECK (request_type IN ('part','new_part','tool','supply','gas_refill')),
  part_id uuid REFERENCES public.dbs_control_parts(id) ON DELETE RESTRICT,
  work_order_id uuid REFERENCES public.dbs_control_work_orders(id) ON DELETE RESTRICT,
  gas_cylinder_id uuid REFERENCES public.dbs_control_gas_cylinders(id) ON DELETE RESTRICT,
  destination_stock_id uuid REFERENCES public.dbs_control_operational_stocks(id) ON DELETE SET NULL,
  employee_id uuid REFERENCES public.rh_employees(id) ON DELETE SET NULL,
  vehicle_label text,
  description text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 2 AND 240),
  quantity numeric(18,4) NOT NULL CHECK (quantity > 0),
  unit_label text NOT NULL DEFAULT 'un',
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 5 AND 2000),
  need_by_date date,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','in_review','approved','rejected','awaiting_purchase','ready_for_delivery','fulfilled','cancelled')),
  decision_note text NOT NULL DEFAULT '',
  requested_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  decided_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  fulfilled_quantity numeric(18,4) NOT NULL DEFAULT 0 CHECK (fulfilled_quantity >= 0),
  request_hash text NOT NULL,
  idempotency_key text NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (fulfilled_quantity <= quantity),
  CHECK (request_type <> 'part' OR (part_id IS NOT NULL AND work_order_id IS NOT NULL)),
  CHECK (request_type <> 'new_part' OR part_id IS NULL),
  CHECK (request_type <> 'gas_refill' OR gas_cylinder_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS dbs_control_material_requests_idempotency_uidx
  ON public.dbs_control_material_requests(scope_key, idempotency_key);
CREATE INDEX IF NOT EXISTS dbs_control_material_requests_queue_idx
  ON public.dbs_control_material_requests(scope_key, status, created_at DESC);
CREATE INDEX IF NOT EXISTS dbs_control_material_requests_work_order_idx
  ON public.dbs_control_material_requests(work_order_id, created_at DESC)
  WHERE work_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS dbs_control_material_requests_part_idx
  ON public.dbs_control_material_requests(part_id, status, created_at DESC)
  WHERE part_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.dbs_control_material_request_purchase_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_key text NOT NULL,
  material_request_id uuid NOT NULL REFERENCES public.dbs_control_material_requests(id) ON DELETE RESTRICT,
  purchase_id uuid NOT NULL REFERENCES public.dbs_control_purchases(id) ON DELETE RESTRICT,
  purchase_item_id uuid NOT NULL REFERENCES public.dbs_control_purchase_items(id) ON DELETE RESTRICT,
  quantity_linked numeric(18,4) NOT NULL CHECK (quantity_linked > 0),
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(material_request_id, purchase_item_id)
);

CREATE INDEX IF NOT EXISTS dbs_control_material_request_purchase_links_request_idx
  ON public.dbs_control_material_request_purchase_links(material_request_id, created_at);
CREATE INDEX IF NOT EXISTS dbs_control_material_request_purchase_links_purchase_idx
  ON public.dbs_control_material_request_purchase_links(purchase_id, purchase_item_id);

ALTER TABLE public.dbs_control_material_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dbs_control_material_request_purchase_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dbs_control_material_requests,
  public.dbs_control_material_request_purchase_links
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.dbs_control_material_requests,
  public.dbs_control_material_request_purchase_links
  TO service_role;

CREATE OR REPLACE FUNCTION public.dbs_control_decide_material_request(
  p_request_id uuid,
  p_actor_user_id uuid,
  p_status text,
  p_note text,
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
  v_status text := lower(coalesce(nullif(btrim(p_status), ''), ''));
  v_note text := left(btrim(coalesce(p_note, '')), 2000);
BEGIN
  IF p_actor_user_id IS NULL OR NOT public.dbs_control_is_inventory_finance_actor(p_actor_user_id) THEN
    RAISE EXCEPTION 'DBS_MATERIAL_REQUEST_FINANCE_FORBIDDEN' USING errcode = '42501';
  END IF;
  IF p_request_id IS NULL OR p_expected_version IS NULL OR p_expected_version < 1
     OR v_status NOT IN ('in_review','approved','rejected','awaiting_purchase','ready_for_delivery','cancelled') THEN
    RAISE EXCEPTION 'DBS_MATERIAL_REQUEST_DECISION_INVALID' USING errcode = '22023';
  END IF;
  IF v_status = 'rejected' AND char_length(v_note) < 5 THEN
    RAISE EXCEPTION 'DBS_MATERIAL_REQUEST_REJECTION_REASON_REQUIRED' USING errcode = '22023';
  END IF;

  SELECT company_id INTO v_actor_company
    FROM public.users WHERE id = p_actor_user_id AND status = 'ativo';
  v_scope := CASE WHEN v_actor_company IS NOT NULL
    THEN 'company:' || v_actor_company::text
    ELSE 'user:' || p_actor_user_id::text END;

  SELECT * INTO v_request
    FROM public.dbs_control_material_requests
   WHERE id = p_request_id AND scope_key = v_scope
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DBS_MATERIAL_REQUEST_NOT_FOUND' USING errcode = 'P0002';
  END IF;
  IF v_request.version <> p_expected_version THEN
    RAISE EXCEPTION 'DBS_MATERIAL_REQUEST_VERSION_CONFLICT' USING errcode = '40001';
  END IF;
  IF v_request.status IN ('fulfilled','rejected','cancelled') THEN
    RAISE EXCEPTION 'DBS_MATERIAL_REQUEST_FINALIZED' USING errcode = '23514';
  END IF;
  IF v_status = 'fulfilled' THEN
    RAISE EXCEPTION 'DBS_MATERIAL_REQUEST_FULFILLMENT_REQUIRES_STOCK_MOVEMENT' USING errcode = '42501';
  END IF;

  UPDATE public.dbs_control_material_requests
     SET status = v_status,
         decision_note = v_note,
         decided_by = p_actor_user_id,
         decided_at = now(),
         updated_at = now(),
         version = version + 1
   WHERE id = p_request_id
   RETURNING * INTO v_request;

  RETURN jsonb_build_object(
    'ok', true,
    'request_id', v_request.id,
    'status', v_request.status,
    'version', v_request.version,
    'decided_at', v_request.decided_at
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.dbs_control_link_material_request_purchase(
  p_request_id uuid,
  p_purchase_id uuid,
  p_purchase_item_id uuid,
  p_actor_user_id uuid,
  p_quantity_linked numeric,
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
  v_purchase public.dbs_control_purchases%rowtype;
  v_item public.dbs_control_purchase_items%rowtype;
  v_already_linked numeric(18,4);
  v_item_linked numeric(18,4);
  v_link public.dbs_control_material_request_purchase_links%rowtype;
BEGIN
  IF p_actor_user_id IS NULL OR NOT public.dbs_control_is_inventory_finance_actor(p_actor_user_id) THEN
    RAISE EXCEPTION 'DBS_MATERIAL_REQUEST_FINANCE_FORBIDDEN' USING errcode = '42501';
  END IF;
  IF p_request_id IS NULL OR p_purchase_id IS NULL OR p_purchase_item_id IS NULL
     OR p_quantity_linked IS NULL OR p_quantity_linked <= 0
     OR p_expected_version IS NULL OR p_expected_version < 1 THEN
    RAISE EXCEPTION 'DBS_MATERIAL_REQUEST_PURCHASE_LINK_INVALID' USING errcode = '22023';
  END IF;

  SELECT company_id INTO v_actor_company
    FROM public.users WHERE id = p_actor_user_id AND status = 'ativo';
  v_scope := CASE WHEN v_actor_company IS NOT NULL
    THEN 'company:' || v_actor_company::text
    ELSE 'user:' || p_actor_user_id::text END;

  SELECT * INTO v_request
    FROM public.dbs_control_material_requests
   WHERE id = p_request_id AND scope_key = v_scope
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DBS_MATERIAL_REQUEST_NOT_FOUND' USING errcode = 'P0002'; END IF;
  IF v_request.version <> p_expected_version THEN
    RAISE EXCEPTION 'DBS_MATERIAL_REQUEST_VERSION_CONFLICT' USING errcode = '40001';
  END IF;
  IF v_request.status NOT IN ('approved','awaiting_purchase') THEN
    RAISE EXCEPTION 'DBS_MATERIAL_REQUEST_NOT_READY_FOR_PURCHASE_LINK' USING errcode = '23514';
  END IF;

  SELECT * INTO v_purchase
    FROM public.dbs_control_purchases
   WHERE id = p_purchase_id AND scope_key = v_scope
   FOR UPDATE;
  IF NOT FOUND OR v_purchase.status = 'cancelled' THEN
    RAISE EXCEPTION 'DBS_PURCHASE_NOT_FOUND_OR_CANCELLED' USING errcode = '23503';
  END IF;

  SELECT * INTO v_item
    FROM public.dbs_control_purchase_items
   WHERE id = p_purchase_item_id AND purchase_id = p_purchase_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DBS_PURCHASE_ITEM_NOT_FOUND' USING errcode = '23503'; END IF;
  IF v_request.part_id IS NOT NULL AND v_item.part_id IS DISTINCT FROM v_request.part_id THEN
    RAISE EXCEPTION 'DBS_MATERIAL_REQUEST_SKU_MISMATCH' USING errcode = '23514';
  END IF;

  SELECT coalesce(sum(quantity_linked),0) INTO v_already_linked
    FROM public.dbs_control_material_request_purchase_links
   WHERE material_request_id = p_request_id;
  SELECT coalesce(sum(quantity_linked),0) INTO v_item_linked
    FROM public.dbs_control_material_request_purchase_links
   WHERE purchase_item_id = p_purchase_item_id;

  IF p_quantity_linked > v_request.quantity - v_already_linked THEN
    RAISE EXCEPTION 'DBS_MATERIAL_REQUEST_LINK_EXCEEDS_REQUEST' USING errcode = '23514';
  END IF;
  IF p_quantity_linked > v_item.quantity - v_item_linked THEN
    RAISE EXCEPTION 'DBS_MATERIAL_REQUEST_LINK_EXCEEDS_PURCHASE_ITEM' USING errcode = '23514';
  END IF;

  SELECT * INTO v_link
    FROM public.dbs_control_material_request_purchase_links
   WHERE material_request_id = p_request_id
     AND purchase_item_id = p_purchase_item_id;
  IF FOUND THEN
    IF v_link.quantity_linked IS DISTINCT FROM p_quantity_linked THEN
      RAISE EXCEPTION 'DBS_MATERIAL_REQUEST_LINK_KEY_REUSED' USING errcode = '23505';
    END IF;
    RETURN jsonb_build_object(
      'ok', true, 'replayed', true,
      'link_id', v_link.id, 'request_id', p_request_id,
      'purchase_id', p_purchase_id, 'purchase_item_id', p_purchase_item_id,
      'quantity_linked', v_link.quantity_linked,
      'version', v_request.version
    );
  END IF;

  INSERT INTO public.dbs_control_material_request_purchase_links(
    scope_key, material_request_id, purchase_id, purchase_item_id,
    quantity_linked, created_by
  ) VALUES (
    v_scope, p_request_id, p_purchase_id, p_purchase_item_id,
    p_quantity_linked, p_actor_user_id
  ) RETURNING * INTO v_link;

  UPDATE public.dbs_control_material_requests
     SET status = 'awaiting_purchase',
         updated_at = now(),
         version = version + 1
   WHERE id = p_request_id
   RETURNING * INTO v_request;

  RETURN jsonb_build_object(
    'ok', true,
    'link_id', v_link.id,
    'request_id', v_request.id,
    'purchase_id', v_purchase.id,
    'purchase_item_id', v_item.id,
    'quantity_linked', v_link.quantity_linked,
    'version', v_request.version
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.dbs_control_decide_material_request(uuid,uuid,text,text,bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dbs_control_decide_material_request(uuid,uuid,text,text,bigint)
  TO service_role;
REVOKE ALL ON FUNCTION public.dbs_control_link_material_request_purchase(uuid,uuid,uuid,uuid,numeric,bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dbs_control_link_material_request_purchase(uuid,uuid,uuid,uuid,numeric,bigint)
  TO service_role;

COMMENT ON TABLE public.dbs_control_material_requests IS
  'Pedidos operacionais de peças, ferramentas, insumos e recarga de gás enviados do DBS Control ao Financeiro; não contém custos.';
COMMENT ON TABLE public.dbs_control_material_request_purchase_links IS
  'Vínculo de-para entre a necessidade operacional e itens reais de compra, permitindo atendimento parcial sem duplicar catálogo.';
COMMENT ON COLUMN public.dbs_control_material_request_purchase_links.quantity_linked IS
  'Quantidade da necessidade operacional comprometida com a quantidade contratada da linha de compra.';

NOTIFY pgrst, 'reload schema';
COMMIT;
