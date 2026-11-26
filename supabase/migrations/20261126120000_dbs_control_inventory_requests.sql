-- Solicitações operacionais de peças, ferramentas, insumos e gás.
-- Fluxo rastreável DBS Control -> Financeiro -> compra/estoque -> expedição.
BEGIN;

CREATE TABLE IF NOT EXISTS public.dbs_control_inventory_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number text UNIQUE,
  company_id uuid REFERENCES public.companies(id) ON DELETE RESTRICT,
  scope_key text NOT NULL,
  requested_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  cost_center_id uuid REFERENCES public.dbs_control_cost_centers(id) ON DELETE RESTRICT,
  work_order_id uuid REFERENCES public.dbs_control_work_orders(id) ON DELETE RESTRICT,
  urgency text NOT NULL DEFAULT 'normal'
    CHECK (urgency IN ('normal','urgent')),
  reason text NOT NULL CHECK (char_length(trim(reason)) BETWEEN 5 AND 2000),
  status text NOT NULL DEFAULT 'pending_finance'
    CHECK (status IN ('pending_finance','ready_for_dispatch','waiting_purchase','purchase_registered','partially_fulfilled','fulfilled','rejected','cancelled')),
  decision_reason text,
  decided_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  decided_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  idempotency_key text NOT NULL CHECK (char_length(trim(idempotency_key)) BETWEEN 8 AND 240),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(scope_key,idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.dbs_control_inventory_request_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.dbs_control_inventory_requests(id) ON DELETE RESTRICT,
  line_no integer NOT NULL CHECK (line_no > 0),
  item_type text NOT NULL CHECK (item_type IN ('part','tool','supply','gas')),
  part_id uuid REFERENCES public.dbs_control_parts(id) ON DELETE RESTRICT,
  resolved_part_id uuid REFERENCES public.dbs_control_parts(id) ON DELETE RESTRICT,
  requested_label text NOT NULL CHECK (char_length(trim(requested_label)) BETWEEN 2 AND 180),
  requested_sku text,
  description text,
  quantity numeric(18,4) NOT NULL CHECK (quantity > 0),
  unit_label text NOT NULL DEFAULT 'un',
  quantity_ready_for_dispatch numeric(18,4) NOT NULL DEFAULT 0 CHECK (quantity_ready_for_dispatch >= 0),
  quantity_fulfilled numeric(18,4) NOT NULL DEFAULT 0 CHECK (quantity_fulfilled >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','mapped','partially_fulfilled','fulfilled','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(request_id,line_no),
  CHECK (quantity_ready_for_dispatch <= quantity),
  CHECK (quantity_fulfilled <= quantity)
);

CREATE TABLE IF NOT EXISTS public.dbs_control_inventory_request_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.dbs_control_inventory_requests(id) ON DELETE RESTRICT,
  scope_key text NOT NULL,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  action text NOT NULL,
  previous_status text,
  new_status text,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL CHECK (char_length(trim(idempotency_key)) BETWEEN 8 AND 240),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(scope_key,idempotency_key)
);

ALTER TABLE public.dbs_control_inventory_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dbs_control_inventory_request_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dbs_control_inventory_request_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dbs_control_inventory_requests, public.dbs_control_inventory_request_items,
  public.dbs_control_inventory_request_history FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.dbs_control_inventory_requests, public.dbs_control_inventory_request_items,
  public.dbs_control_inventory_request_history TO service_role;

CREATE INDEX IF NOT EXISTS dbs_control_inventory_requests_queue_idx
  ON public.dbs_control_inventory_requests(scope_key,status,created_at DESC);
CREATE INDEX IF NOT EXISTS dbs_control_inventory_requests_os_idx
  ON public.dbs_control_inventory_requests(work_order_id,created_at DESC);
CREATE INDEX IF NOT EXISTS dbs_control_inventory_request_items_part_idx
  ON public.dbs_control_inventory_request_items(resolved_part_id,request_id);
CREATE INDEX IF NOT EXISTS dbs_control_inventory_request_history_request_idx
  ON public.dbs_control_inventory_request_history(request_id,created_at DESC);

ALTER TABLE public.dbs_control_purchases
  ADD COLUMN IF NOT EXISTS source_inventory_request_id uuid
  REFERENCES public.dbs_control_inventory_requests(id) ON DELETE RESTRICT;

ALTER TABLE public.dbs_control_purchase_items
  ADD COLUMN IF NOT EXISTS source_inventory_request_item_id uuid
  REFERENCES public.dbs_control_inventory_request_items(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS dbs_control_purchases_source_request_idx
  ON public.dbs_control_purchases(scope_key,source_inventory_request_id)
  WHERE source_inventory_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS dbs_control_purchase_items_source_request_item_idx
  ON public.dbs_control_purchase_items(source_inventory_request_item_id)
  WHERE source_inventory_request_item_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.dbs_control_create_inventory_request(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid := nullif(p_payload->>'actor_user_id','')::uuid;
  v_company uuid;
  v_scope text;
  v_key text := nullif(btrim(p_payload->>'idempotency_key'),'');
  v_reason text := nullif(btrim(p_payload->>'reason'),'');
  v_work_order uuid := nullif(p_payload->>'work_order_id','')::uuid;
  v_cost_center uuid := nullif(p_payload->>'cost_center_id','')::uuid;
  v_urgency text := coalesce(nullif(lower(btrim(p_payload->>'urgency')),''),'normal');
  v_items jsonb := p_payload->'items';
  v_existing public.dbs_control_inventory_requests%rowtype;
  v_request uuid;
  v_item jsonb;
  v_line integer := 0;
  v_type text;
  v_part uuid;
  v_label text;
  v_qty numeric(18,4);
BEGIN
  IF v_actor IS NULL OR NOT public.dbs_control_is_admin_actor(v_actor) THEN
    RAISE EXCEPTION 'DBS_INVENTORY_REQUEST_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF v_key IS NULL OR char_length(v_key) NOT BETWEEN 8 AND 240
     OR v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 5 AND 2000
     OR v_urgency NOT IN ('normal','urgent')
     OR jsonb_typeof(v_items) IS DISTINCT FROM 'array'
     OR jsonb_array_length(v_items) NOT BETWEEN 1 AND 30 THEN
    RAISE EXCEPTION 'DBS_INVENTORY_REQUEST_INPUT_INVALID' USING ERRCODE='22023';
  END IF;

  SELECT company_id INTO v_company FROM public.users
   WHERE id=v_actor AND status='ativo';
  IF NOT FOUND THEN RAISE EXCEPTION 'DBS_INVENTORY_REQUEST_ACTOR_INVALID' USING ERRCODE='42501'; END IF;
  v_scope := CASE WHEN v_company IS NULL THEN 'user:'||v_actor::text ELSE 'company:'||v_company::text END;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_scope||':inventory-request:'||v_key,0));
  SELECT * INTO v_existing FROM public.dbs_control_inventory_requests
   WHERE scope_key=v_scope AND idempotency_key=v_key FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object('ok',true,'replayed',true,'request_id',v_existing.id,
      'request_number',v_existing.request_number,'status',v_existing.status,'version',v_existing.version);
  END IF;

  IF v_cost_center IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.dbs_control_cost_centers
     WHERE id=v_cost_center AND scope_key=v_scope AND status='active'
  ) THEN
    RAISE EXCEPTION 'DBS_INVENTORY_REQUEST_COST_CENTER_INVALID' USING ERRCODE='23503';
  END IF;
  IF v_work_order IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.dbs_control_work_orders w
     WHERE w.id=v_work_order AND w.deleted_at IS NULL
       AND EXISTS (
         SELECT 1 FROM public.users creator
          WHERE creator.id=w.created_by_user_id AND creator.status='ativo'
            AND ((v_company IS NOT NULL AND creator.company_id=v_company)
              OR (v_company IS NULL AND creator.id=v_actor))
       )
  ) THEN
    RAISE EXCEPTION 'DBS_INVENTORY_REQUEST_WORK_ORDER_SCOPE_MISMATCH' USING ERRCODE='42501';
  END IF;

  INSERT INTO public.dbs_control_inventory_requests(
    company_id,scope_key,requested_by,cost_center_id,work_order_id,urgency,reason,status,idempotency_key
  ) VALUES (
    v_company,v_scope,v_actor,v_cost_center,v_work_order,v_urgency,v_reason,'pending_finance',v_key
  ) RETURNING id INTO v_request;
  UPDATE public.dbs_control_inventory_requests
     SET request_number='REQ-'||upper(substr(replace(v_request::text,'-',''),1,10))
   WHERE id=v_request;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) AS item(value) LOOP
    v_line := v_line+1;
    v_type := coalesce(nullif(lower(btrim(v_item->>'item_type')),''),'part');
    v_part := nullif(v_item->>'part_id','')::uuid;
    v_label := nullif(btrim(coalesce(v_item->>'requested_label','')),'');
    v_qty := nullif(v_item->>'quantity','')::numeric;
    IF v_type NOT IN ('part','tool','supply','gas') OR v_qty IS NULL OR v_qty<=0 THEN
      RAISE EXCEPTION 'DBS_INVENTORY_REQUEST_ITEM_INVALID' USING ERRCODE='22023';
    END IF;
    IF v_part IS NOT NULL THEN
      SELECT name INTO v_label FROM public.dbs_control_parts WHERE id=v_part AND status='ativo';
      IF NOT FOUND THEN RAISE EXCEPTION 'DBS_INVENTORY_REQUEST_PART_INVALID' USING ERRCODE='23503'; END IF;
    END IF;
    IF v_label IS NULL OR char_length(v_label) NOT BETWEEN 2 AND 180 THEN
      RAISE EXCEPTION 'DBS_INVENTORY_REQUEST_ITEM_LABEL_REQUIRED' USING ERRCODE='22023';
    END IF;
    INSERT INTO public.dbs_control_inventory_request_items(
      request_id,line_no,item_type,part_id,resolved_part_id,requested_label,requested_sku,
      description,quantity,unit_label,status
    ) VALUES (
      v_request,v_line,v_type,v_part,v_part,v_label,
      nullif(btrim(v_item->>'requested_sku'),''),
      nullif(btrim(v_item->>'description'),''),
      v_qty,coalesce(nullif(btrim(v_item->>'unit_label'),''),'un'),
      CASE WHEN v_part IS NULL THEN 'pending' ELSE 'mapped' END
    );
  END LOOP;

  INSERT INTO public.dbs_control_inventory_request_history(
    request_id,scope_key,actor_user_id,action,previous_status,new_status,reason,metadata,idempotency_key
  ) VALUES (
    v_request,v_scope,v_actor,'created',NULL,'pending_finance',v_reason,
    jsonb_build_object('item_count',v_line,'work_order_id',v_work_order,'cost_center_id',v_cost_center),
    left('request-created:'||v_request::text,240)
  );

  RETURN jsonb_build_object('ok',true,'replayed',false,'request_id',v_request,
    'request_number','REQ-'||upper(substr(replace(v_request::text,'-',''),1,10)),
    'status','pending_finance','version',1);
END;
$function$;

CREATE OR REPLACE FUNCTION public.dbs_control_decide_inventory_request(
  p_request_id uuid,p_actor_user_id uuid,p_decision text,p_reason text,
  p_expected_version bigint,p_item_mappings jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_request public.dbs_control_inventory_requests%rowtype;
  v_actor_company uuid;
  v_decision text := lower(btrim(coalesce(p_decision,'')));
  v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
  v_item jsonb;
  v_item_id uuid;
  v_part_id uuid;
  v_qty numeric(18,4);
  v_ready numeric(18,4);
  v_pending boolean := false;
  v_new_status text;
BEGIN
  IF p_actor_user_id IS NULL OR NOT (
    public.dbs_control_is_admin_actor(p_actor_user_id)
    OR public.dbs_control_is_finance_actor(p_actor_user_id)
  ) THEN
    RAISE EXCEPTION 'DBS_INVENTORY_REQUEST_DECISION_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF p_request_id IS NULL OR p_expected_version IS NULL OR p_expected_version<1
     OR v_decision NOT IN ('approve','waiting_purchase','reject')
     OR (v_decision='reject' AND (v_reason IS NULL OR char_length(v_reason)<5 OR char_length(v_reason)>1000))
     OR jsonb_typeof(coalesce(p_item_mappings,'[]'::jsonb)) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'DBS_INVENTORY_REQUEST_DECISION_INPUT_INVALID' USING ERRCODE='22023';
  END IF;
  SELECT company_id INTO v_actor_company FROM public.users
   WHERE id=p_actor_user_id AND status='ativo';
  SELECT * INTO v_request FROM public.dbs_control_inventory_requests
   WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DBS_INVENTORY_REQUEST_NOT_FOUND' USING ERRCODE='23503'; END IF;
  IF v_actor_company IS NOT NULL AND v_actor_company IS DISTINCT FROM v_request.company_id THEN
    RAISE EXCEPTION 'DBS_INVENTORY_REQUEST_SCOPE_MISMATCH' USING ERRCODE='42501';
  END IF;
  IF v_request.version<>p_expected_version THEN RAISE EXCEPTION 'DBS_INVENTORY_REQUEST_VERSION_CONFLICT' USING ERRCODE='40001'; END IF;
  IF v_request.status<>'pending_finance' THEN RAISE EXCEPTION 'DBS_INVENTORY_REQUEST_ALREADY_DECIDED' USING ERRCODE='23514'; END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(p_item_mappings,'[]'::jsonb)) AS x(value) LOOP
    v_item_id := nullif(v_item->>'request_item_id','')::uuid;
    v_part_id := nullif(v_item->>'part_id','')::uuid;
    IF v_item_id IS NULL OR v_part_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.dbs_control_parts WHERE id=v_part_id AND status='ativo'
    ) THEN
      RAISE EXCEPTION 'DBS_INVENTORY_REQUEST_MAPPING_INVALID' USING ERRCODE='22023';
    END IF;
    UPDATE public.dbs_control_inventory_request_items
       SET resolved_part_id=v_part_id,status='mapped',updated_at=now()
     WHERE id=v_item_id AND request_id=p_request_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'DBS_INVENTORY_REQUEST_ITEM_NOT_FOUND' USING ERRCODE='23503'; END IF;
  END LOOP;

  IF v_decision='reject' THEN
    v_new_status := 'rejected';
    UPDATE public.dbs_control_inventory_request_items
       SET status='rejected',updated_at=now()
     WHERE request_id=p_request_id AND quantity_fulfilled=0;
  ELSE
    IF EXISTS (
      SELECT 1 FROM public.dbs_control_inventory_request_items
       WHERE request_id=p_request_id AND resolved_part_id IS NULL
    ) THEN
      RAISE EXCEPTION 'DBS_INVENTORY_REQUEST_ITEMS_NOT_MAPPED' USING ERRCODE='23514';
    END IF;
    FOR v_item_id,v_part_id,v_qty IN
      SELECT id,resolved_part_id,quantity
        FROM public.dbs_control_inventory_request_items
       WHERE request_id=p_request_id
       ORDER BY line_no
    LOOP
      SELECT greatest(0,coalesce(stock_quantity,0)-coalesce(reserved_quantity,0))
        INTO v_ready FROM public.dbs_control_parts WHERE id=v_part_id;
      UPDATE public.dbs_control_inventory_request_items
         SET quantity_ready_for_dispatch=least(quantity,coalesce(v_ready,0)),
             status=CASE WHEN least(quantity,coalesce(v_ready,0))>=quantity THEN 'mapped' ELSE 'pending' END,
             updated_at=now()
       WHERE id=v_item_id;
      IF least(v_qty,coalesce(v_ready,0))<v_qty THEN v_pending:=true; END IF;
    END LOOP;
    v_new_status := CASE WHEN v_decision='waiting_purchase' OR v_pending THEN 'waiting_purchase' ELSE 'ready_for_dispatch' END;
  END IF;

  UPDATE public.dbs_control_inventory_requests
     SET status=v_new_status,decision_reason=v_reason,decided_by=p_actor_user_id,
         decided_at=now(),version=version+1,updated_at=now()
   WHERE id=p_request_id;
  INSERT INTO public.dbs_control_inventory_request_history(
    request_id,scope_key,actor_user_id,action,previous_status,new_status,reason,metadata,idempotency_key
  ) VALUES (
    p_request_id,v_request.scope_key,p_actor_user_id,'decision:'||v_decision,
    v_request.status,v_new_status,v_reason,
    jsonb_build_object('expected_version',p_expected_version),
    left('request-decision:'||p_request_id::text||':'||v_new_status,240)
  );
  RETURN jsonb_build_object('ok',true,'request_id',p_request_id,'status',v_new_status,'version',p_expected_version+1);
END;
$function$;

CREATE OR REPLACE FUNCTION public.dbs_control_fulfill_inventory_request_from_central(
  p_request_id uuid,p_request_item_id uuid,p_actor_user_id uuid,
  p_destination_stock_id uuid,p_quantity numeric,p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_request public.dbs_control_inventory_requests%rowtype;
  v_item public.dbs_control_inventory_request_items%rowtype;
  v_stock public.dbs_control_operational_stocks%rowtype;
  v_actor_company uuid;
  v_remaining numeric(18,4);
  v_transfer jsonb;
  v_key text := nullif(btrim(p_idempotency_key),'');
  v_history public.dbs_control_inventory_request_history%rowtype;
  v_new_status text;
BEGIN
  IF p_actor_user_id IS NULL OR NOT (
    public.dbs_control_is_admin_actor(p_actor_user_id)
    OR public.dbs_control_is_finance_actor(p_actor_user_id)
  ) THEN
    RAISE EXCEPTION 'DBS_INVENTORY_REQUEST_FULFILL_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF p_request_id IS NULL OR p_request_item_id IS NULL OR p_destination_stock_id IS NULL
     OR p_quantity IS NULL OR p_quantity<=0 OR v_key IS NULL OR char_length(v_key) NOT BETWEEN 8 AND 240 THEN
    RAISE EXCEPTION 'DBS_INVENTORY_REQUEST_FULFILL_INPUT_INVALID' USING ERRCODE='22023';
  END IF;
  SELECT company_id INTO v_actor_company FROM public.users
   WHERE id=p_actor_user_id AND status='ativo';
  SELECT * INTO v_request FROM public.dbs_control_inventory_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DBS_INVENTORY_REQUEST_NOT_FOUND' USING ERRCODE='23503'; END IF;
  IF v_actor_company IS NOT NULL AND v_actor_company IS DISTINCT FROM v_request.company_id THEN
    RAISE EXCEPTION 'DBS_INVENTORY_REQUEST_SCOPE_MISMATCH' USING ERRCODE='42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_request.scope_key||':request-fulfill:'||v_key,0));
  SELECT * INTO v_history FROM public.dbs_control_inventory_request_history
   WHERE scope_key=v_request.scope_key AND idempotency_key=v_key;
  IF FOUND THEN
    RETURN jsonb_build_object('ok',true,'replayed',true,'request_id',p_request_id,'status',v_request.status);
  END IF;

  SELECT * INTO v_item FROM public.dbs_control_inventory_request_items
   WHERE id=p_request_item_id AND request_id=p_request_id FOR UPDATE;
  IF NOT FOUND OR v_item.resolved_part_id IS NULL THEN
    RAISE EXCEPTION 'DBS_INVENTORY_REQUEST_ITEM_NOT_MAPPED' USING ERRCODE='23503';
  END IF;
  IF v_request.status NOT IN ('ready_for_dispatch','waiting_purchase','partially_fulfilled','purchase_registered') THEN
    RAISE EXCEPTION 'DBS_INVENTORY_REQUEST_NOT_READY' USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_stock FROM public.dbs_control_operational_stocks
   WHERE id=p_destination_stock_id AND scope_key=v_request.scope_key AND status='active';
  IF NOT FOUND OR (v_request.cost_center_id IS NOT NULL AND v_stock.cost_center_id IS DISTINCT FROM v_request.cost_center_id) THEN
    RAISE EXCEPTION 'DBS_INVENTORY_REQUEST_DESTINATION_INVALID' USING ERRCODE='23503';
  END IF;
  v_remaining := v_item.quantity_ready_for_dispatch-v_item.quantity_fulfilled;
  IF v_remaining<=0 OR p_quantity>v_remaining THEN
    RAISE EXCEPTION 'DBS_INVENTORY_REQUEST_QUANTITY_NOT_READY' USING ERRCODE='23514';
  END IF;

  v_transfer := public.dbs_control_operational_stock_transfer(
    p_actor_user_id,v_item.resolved_part_id,p_quantity,NULL,p_destination_stock_id,
    v_key,'Solicitação '||coalesce(v_request.request_number,p_request_id::text)
  );
  UPDATE public.dbs_control_inventory_request_items
     SET quantity_fulfilled=quantity_fulfilled+p_quantity,
         status=CASE WHEN quantity_fulfilled+p_quantity>=quantity THEN 'fulfilled' ELSE 'partially_fulfilled' END,
         updated_at=now()
   WHERE id=v_item.id;
  UPDATE public.dbs_control_inventory_request_items
     SET status='partially_fulfilled',updated_at=now()
   WHERE request_id=p_request_id AND quantity_fulfilled>0
     AND quantity_fulfilled<quantity AND status<>'rejected';

  IF NOT EXISTS (
    SELECT 1 FROM public.dbs_control_inventory_request_items
     WHERE request_id=p_request_id AND status NOT IN ('fulfilled','rejected')
  ) THEN
    v_new_status:='fulfilled';
  ELSE
    v_new_status:='partially_fulfilled';
  END IF;
  UPDATE public.dbs_control_inventory_requests
     SET status=v_new_status,version=version+1,updated_at=now()
   WHERE id=p_request_id;

  INSERT INTO public.dbs_control_inventory_request_history(
    request_id,scope_key,actor_user_id,action,previous_status,new_status,reason,metadata,idempotency_key
  ) VALUES (
    p_request_id,v_request.scope_key,p_actor_user_id,'fulfilled',
    v_request.status,v_new_status,NULL,
    jsonb_build_object('request_item_id',p_request_item_id,'quantity',p_quantity,
      'destination_stock_id',p_destination_stock_id,'movement_id',v_transfer->>'movement_id'),
    v_key
  );
  RETURN jsonb_build_object('ok',true,'replayed',false,'request_id',p_request_id,
    'status',v_new_status,'movement_id',v_transfer->>'movement_id');
END;
$function$;

-- Vincula as linhas de compra a uma solicitação operacional. A compra continua
-- usando o mesmo RPC idempotente, aprovação e recebimento parcial existentes.
CREATE OR REPLACE FUNCTION public.dbs_control_register_purchase_with_request(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid := nullif(p_payload->>'actor_user_id','')::uuid;
  v_request_id uuid := nullif(p_payload->>'source_inventory_request_id','')::uuid;
  v_actor_company uuid;
  v_request public.dbs_control_inventory_requests%rowtype;
  v_result jsonb;
  v_purchase_id uuid;
BEGIN
  IF v_actor IS NULL OR NOT (
    public.dbs_control_is_admin_actor(v_actor)
    OR public.dbs_control_is_finance_actor(v_actor)
  ) THEN
    RAISE EXCEPTION 'DBS_PURCHASE_REQUEST_REGISTER_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF v_request_id IS NULL THEN RAISE EXCEPTION 'DBS_PURCHASE_REQUEST_REFERENCE_REQUIRED' USING ERRCODE='22023'; END IF;
  SELECT company_id INTO v_actor_company FROM public.users WHERE id=v_actor AND status='ativo';
  SELECT * INTO v_request FROM public.dbs_control_inventory_requests WHERE id=v_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DBS_PURCHASE_SOURCE_REQUEST_NOT_FOUND' USING ERRCODE='23503'; END IF;
  IF v_actor_company IS NOT NULL AND v_actor_company IS DISTINCT FROM v_request.company_id THEN
    RAISE EXCEPTION 'DBS_PURCHASE_SOURCE_REQUEST_SCOPE_MISMATCH' USING ERRCODE='42501';
  END IF;
  IF v_request.status NOT IN ('waiting_purchase','purchase_registered','partially_fulfilled') THEN
    RAISE EXCEPTION 'DBS_PURCHASE_SOURCE_REQUEST_NOT_WAITING' USING ERRCODE='23514';
  END IF;

  v_result := public.dbs_control_register_purchase_with_quote(p_payload);
  v_purchase_id := nullif(v_result->>'purchase_id','')::uuid;
  IF v_purchase_id IS NULL THEN RAISE EXCEPTION 'DBS_PURCHASE_REGISTER_RESULT_INVALID' USING ERRCODE='23514'; END IF;

  UPDATE public.dbs_control_purchases
     SET source_inventory_request_id=v_request_id,updated_at=now()
   WHERE id=v_purchase_id AND scope_key=v_request.scope_key
     AND (source_inventory_request_id IS NULL OR source_inventory_request_id=v_request_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'DBS_PURCHASE_SOURCE_REQUEST_IDEMPOTENCY_CONFLICT' USING ERRCODE='23505'; END IF;

  UPDATE public.dbs_control_purchase_items pi
     SET source_inventory_request_item_id=ri.id
    FROM public.dbs_control_inventory_request_items ri
   WHERE pi.purchase_id=v_purchase_id
     AND ri.request_id=v_request_id
     AND ri.resolved_part_id=pi.part_id
     AND pi.source_inventory_request_item_id IS NULL;

  UPDATE public.dbs_control_inventory_requests
     SET status='purchase_registered',version=version+1,updated_at=now()
   WHERE id=v_request_id AND status<>'purchase_registered';

  INSERT INTO public.dbs_control_inventory_request_history(
    request_id,scope_key,actor_user_id,action,previous_status,new_status,reason,metadata,idempotency_key
  ) VALUES (
    v_request_id,v_request.scope_key,v_actor,'purchase_registered',
    v_request.status,'purchase_registered',NULL,
    jsonb_build_object('purchase_id',v_purchase_id),
    left('request-purchase:'||v_request_id::text||':'||v_purchase_id::text,240)
  ) ON CONFLICT(scope_key,idempotency_key) DO NOTHING;

  RETURN v_result || jsonb_build_object('source_inventory_request_id',v_request_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.dbs_control_refresh_inventory_request_received_quantity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_delta numeric(18,4) := coalesce(NEW.quantity_received,0)-coalesce(OLD.quantity_received,0);
  v_item record;
BEGIN
  IF v_delta=0 OR NEW.source_inventory_request_item_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_item FROM public.dbs_control_inventory_request_items
   WHERE id=NEW.source_inventory_request_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DBS_INVENTORY_REQUEST_RECEIPT_LINK_NOT_FOUND' USING ERRCODE='23503'; END IF;
  IF v_item.quantity_ready_for_dispatch+v_delta<v_item.quantity_fulfilled THEN
    RAISE EXCEPTION 'DBS_INVENTORY_REQUEST_RECEIPT_ALREADY_DISPATCHED' USING ERRCODE='23514';
  END IF;
  UPDATE public.dbs_control_inventory_request_items
     SET quantity_ready_for_dispatch=least(quantity,greatest(quantity_fulfilled,quantity_ready_for_dispatch+v_delta)),
         status=CASE WHEN quantity_fulfilled>=quantity THEN 'fulfilled' ELSE 'mapped' END,
         updated_at=now()
   WHERE id=v_item.id;
  UPDATE public.dbs_control_inventory_requests
     SET status=CASE
       WHEN status IN ('waiting_purchase','purchase_registered') THEN 'ready_for_dispatch'
       ELSE status END,
         version=version+1,updated_at=now()
   WHERE id=(SELECT request_id FROM public.dbs_control_inventory_request_items WHERE id=v_item.id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_dbs_control_inventory_request_receipt_refresh
  ON public.dbs_control_purchase_items;
CREATE TRIGGER trg_dbs_control_inventory_request_receipt_refresh
AFTER UPDATE OF quantity_received ON public.dbs_control_purchase_items
FOR EACH ROW EXECUTE FUNCTION public.dbs_control_refresh_inventory_request_received_quantity();

REVOKE ALL ON FUNCTION public.dbs_control_create_inventory_request(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.dbs_control_decide_inventory_request(uuid,uuid,text,text,bigint,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.dbs_control_fulfill_inventory_request_from_central(uuid,uuid,uuid,uuid,numeric,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.dbs_control_register_purchase_with_request(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.dbs_control_refresh_inventory_request_received_quantity() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dbs_control_create_inventory_request(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.dbs_control_decide_inventory_request(uuid,uuid,text,text,bigint,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.dbs_control_fulfill_inventory_request_from_central(uuid,uuid,uuid,uuid,numeric,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.dbs_control_register_purchase_with_request(jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
