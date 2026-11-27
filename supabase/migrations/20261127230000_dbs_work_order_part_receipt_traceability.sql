BEGIN;

CREATE TABLE IF NOT EXISTS public.dbs_control_work_order_part_receipt_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE RESTRICT,
  scope_key text NOT NULL,
  work_order_id uuid NOT NULL REFERENCES public.dbs_control_work_orders(id) ON DELETE RESTRICT,
  work_order_part_id uuid NOT NULL REFERENCES public.dbs_control_work_order_parts(id) ON DELETE RESTRICT,
  receipt_item_id uuid NOT NULL REFERENCES public.dbs_control_purchase_receipt_items(id) ON DELETE RESTRICT,
  part_id uuid NOT NULL REFERENCES public.dbs_control_parts(id) ON DELETE RESTRICT,
  supplier_warranty_id uuid REFERENCES public.dbs_control_supplier_warranties(id) ON DELETE RESTRICT,
  quantity_allocated numeric(18,4) NOT NULL CHECK (quantity_allocated > 0),
  serial_number text,
  lot_number text,
  idempotency_key text NOT NULL CHECK (char_length(btrim(idempotency_key)) BETWEEN 8 AND 240),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(scope_key,idempotency_key),
  UNIQUE(work_order_part_id,receipt_item_id)
);

CREATE INDEX IF NOT EXISTS dbs_control_work_order_part_receipt_allocations_os_idx
  ON public.dbs_control_work_order_part_receipt_allocations(scope_key,work_order_id,work_order_part_id);
CREATE INDEX IF NOT EXISTS dbs_control_work_order_part_receipt_allocations_receipt_idx
  ON public.dbs_control_work_order_part_receipt_allocations(scope_key,receipt_item_id);

ALTER TABLE public.dbs_control_work_order_part_receipt_allocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dbs_control_work_order_part_receipt_allocations FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.dbs_control_work_order_part_receipt_allocations TO service_role;

CREATE OR REPLACE FUNCTION public.dbs_control_reject_work_order_part_receipt_allocation_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $function$
BEGIN
  RAISE EXCEPTION 'DBS_WORK_ORDER_RECEIPT_ALLOCATION_IMMUTABLE' USING errcode='55000';
END;
$function$;

DROP TRIGGER IF EXISTS dbs_control_work_order_part_receipt_allocations_immutable
  ON public.dbs_control_work_order_part_receipt_allocations;
CREATE TRIGGER dbs_control_work_order_part_receipt_allocations_immutable
BEFORE UPDATE OR DELETE ON public.dbs_control_work_order_part_receipt_allocations
FOR EACH ROW EXECUTE FUNCTION public.dbs_control_reject_work_order_part_receipt_allocation_mutation();

CREATE OR REPLACE FUNCTION public.dbs_control_link_work_order_part_receipt_item(
  p_actor_user_id uuid,
  p_work_order_part_id uuid,
  p_receipt_item_id uuid,
  p_quantity numeric,
  p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $function$
DECLARE
  v_actor public.users%rowtype;
  v_scope record;
  v_work_order_part public.dbs_control_work_order_parts%rowtype;
  v_receipt_item public.dbs_control_purchase_receipt_items%rowtype;
  v_receipt public.dbs_control_purchase_receipts%rowtype;
  v_existing public.dbs_control_work_order_part_receipt_allocations%rowtype;
  v_warranty_id uuid;
  v_used_for_os numeric(18,4);
  v_used_from_receipt numeric(18,4);
  v_key text:=nullif(btrim(p_idempotency_key),'');
  v_allocation_id uuid;
BEGIN
  IF p_actor_user_id IS NULL OR p_work_order_part_id IS NULL OR p_receipt_item_id IS NULL
     OR p_quantity IS NULL OR p_quantity<=0 OR v_key IS NULL OR char_length(v_key) NOT BETWEEN 8 AND 240 THEN
    RAISE EXCEPTION 'DBS_WORK_ORDER_RECEIPT_ALLOCATION_INPUT_INVALID' USING errcode='22023';
  END IF;

  SELECT * INTO v_actor FROM public.users WHERE id=p_actor_user_id AND status='ativo';
  IF NOT FOUND OR v_actor.role_key NOT IN ('SUPER_ADMIN','ADMIN_OPERACIONAL','GESTOR_CONTA','GESTOR_REGIONAL','FINANCEIRO_OPERADOR') THEN
    RAISE EXCEPTION 'DBS_WORK_ORDER_RECEIPT_ALLOCATION_FORBIDDEN' USING errcode='42501';
  END IF;

  SELECT * INTO v_work_order_part
    FROM public.dbs_control_work_order_parts WHERE id=p_work_order_part_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'DBS_WORK_ORDER_PART_NOT_FOUND' USING errcode='23503'; END IF;

  SELECT * INTO v_scope FROM public.dbs_control_inventory_scope_for_work_order(v_work_order_part.work_order_id);
  IF NOT FOUND OR (v_actor.company_id IS NOT NULL AND v_actor.company_id IS DISTINCT FROM v_scope.company_id) THEN
    RAISE EXCEPTION 'DBS_WORK_ORDER_RECEIPT_ALLOCATION_SCOPE_MISMATCH' USING errcode='42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_scope.scope_key||':receipt-allocation:'||p_receipt_item_id::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended(v_scope.scope_key||':work-order-part-allocation:'||p_work_order_part_id::text,0));

  SELECT * INTO v_existing FROM public.dbs_control_work_order_part_receipt_allocations
   WHERE scope_key=v_scope.scope_key AND idempotency_key=v_key;
  IF FOUND THEN
    IF v_existing.work_order_part_id IS DISTINCT FROM p_work_order_part_id
       OR v_existing.receipt_item_id IS DISTINCT FROM p_receipt_item_id
       OR v_existing.quantity_allocated IS DISTINCT FROM p_quantity THEN
      RAISE EXCEPTION 'DBS_WORK_ORDER_RECEIPT_ALLOCATION_IDEMPOTENCY_CONFLICT' USING errcode='23505';
    END IF;
    RETURN jsonb_build_object('ok',true,'replayed',true,'allocation_id',v_existing.id);
  END IF;

  SELECT * INTO v_work_order_part FROM public.dbs_control_work_order_parts
   WHERE id=p_work_order_part_id FOR UPDATE;
  IF v_work_order_part.consumption_status IS DISTINCT FROM 'consumed' THEN
    RAISE EXCEPTION 'DBS_WORK_ORDER_PART_NOT_CONSUMED' USING errcode='23514';
  END IF;

  SELECT pri.* INTO v_receipt_item
    FROM public.dbs_control_purchase_receipt_items pri
    JOIN public.dbs_control_purchase_receipts pr ON pr.id=pri.receipt_id
   WHERE pri.id=p_receipt_item_id AND pr.scope_key=v_scope.scope_key
   FOR UPDATE OF pri;
  IF NOT FOUND OR v_receipt_item.part_id IS DISTINCT FROM v_work_order_part.part_id THEN
    RAISE EXCEPTION 'DBS_WORK_ORDER_RECEIPT_PART_MISMATCH' USING errcode='23503';
  END IF;

  SELECT coalesce(sum(quantity_allocated),0) INTO v_used_for_os
    FROM public.dbs_control_work_order_part_receipt_allocations
   WHERE work_order_part_id=p_work_order_part_id;
  IF v_used_for_os+p_quantity>v_work_order_part.quantity THEN
    RAISE EXCEPTION 'DBS_WORK_ORDER_RECEIPT_ALLOCATION_EXCEEDS_OS_QUANTITY' USING errcode='23514';
  END IF;

  SELECT coalesce(sum(quantity_allocated),0) INTO v_used_from_receipt
    FROM public.dbs_control_work_order_part_receipt_allocations
   WHERE receipt_item_id=p_receipt_item_id;
  IF v_used_from_receipt+p_quantity>v_receipt_item.quantity_received THEN
    RAISE EXCEPTION 'DBS_WORK_ORDER_RECEIPT_ALLOCATION_EXCEEDS_RECEIVED_QUANTITY' USING errcode='23514';
  END IF;
  IF v_receipt_item.serial_number IS NOT NULL AND p_quantity<>1 THEN
    RAISE EXCEPTION 'DBS_WORK_ORDER_SERIAL_QUANTITY_MUST_BE_ONE' USING errcode='22023';
  END IF;

  SELECT id INTO v_warranty_id FROM public.dbs_control_supplier_warranties
   WHERE scope_key=v_scope.scope_key AND source_receipt_item_id=p_receipt_item_id
   ORDER BY created_at DESC LIMIT 1;

  INSERT INTO public.dbs_control_work_order_part_receipt_allocations(
    company_id,scope_key,work_order_id,work_order_part_id,receipt_item_id,part_id,
    supplier_warranty_id,quantity_allocated,serial_number,lot_number,idempotency_key,created_by
  ) VALUES (
    v_scope.company_id,v_scope.scope_key,v_work_order_part.work_order_id,p_work_order_part_id,
    p_receipt_item_id,v_work_order_part.part_id,v_warranty_id,p_quantity,
    v_receipt_item.serial_number,v_receipt_item.lot_number,v_key,p_actor_user_id
  ) RETURNING id INTO v_allocation_id;

  RETURN jsonb_build_object('ok',true,'replayed',false,'allocation_id',v_allocation_id,
    'serial_number',v_receipt_item.serial_number,'lot_number',v_receipt_item.lot_number,
    'supplier_warranty_id',v_warranty_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.dbs_control_reject_work_order_part_receipt_allocation_mutation() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.dbs_control_link_work_order_part_receipt_item(uuid,uuid,uuid,numeric,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dbs_control_link_work_order_part_receipt_item(uuid,uuid,uuid,numeric,text) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
