-- Integra garantia informada pelo Financeiro ao mesmo recebimento físico transacional.
-- Não presume prazo: a garantia só é criada quando o operador informa validade ou duração.
BEGIN;

CREATE OR REPLACE FUNCTION public.dbs_control_receive_purchase_items_with_warranties(
  p_purchase_id uuid,
  p_actor_user_id uuid,
  p_idempotency_key text,
  p_items jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_clean_items jsonb;
  v_result jsonb;
  v_receipt_id uuid;
  v_purchase public.dbs_control_purchases%rowtype;
  v_receipt public.dbs_control_purchase_receipts%rowtype;
  v_item jsonb;
  v_warranty jsonb;
  v_receipt_item public.dbs_control_purchase_receipt_items%rowtype;
  v_anchor text;
  v_starts_on date;
  v_expires_on date;
  v_months integer;
  v_serial text;
  v_lot text;
  v_terms text;
  v_document text;
  v_provider text;
  v_existing public.dbs_control_supplier_warranties%rowtype;
  v_created integer := 0;
BEGIN
  IF p_actor_user_id IS NULL OR NOT public.dbs_control_is_admin_actor(p_actor_user_id) THEN
    RAISE EXCEPTION 'DBS_PURCHASE_RECEIVE_FORBIDDEN' USING errcode='42501';
  END IF;
  IF p_purchase_id IS NULL OR nullif(btrim(p_idempotency_key),'') IS NULL
     OR char_length(btrim(p_idempotency_key)) NOT BETWEEN 8 AND 240
     OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items)=0 THEN
    RAISE EXCEPTION 'DBS_PURCHASE_RECEIPT_ITEMS_REQUIRED' USING errcode='22023';
  END IF;

  SELECT * INTO v_purchase FROM public.dbs_control_purchases WHERE id=p_purchase_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'DBS_PURCHASE_NOT_FOUND' USING errcode='23503'; END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'purchase_item_id',x.value->>'purchase_item_id',
    'quantity_received',x.value->>'quantity_received',
    'receipt_number',x.value->>'receipt_number'
  ) ORDER BY x.ordinality)
  INTO v_clean_items
  FROM jsonb_array_elements(p_items) WITH ORDINALITY AS x(value,ordinality);

  v_result := public.dbs_control_receive_purchase_items(
    p_purchase_id,p_actor_user_id,p_idempotency_key,v_clean_items
  );
  v_receipt_id := nullif(v_result->>'receipt_id','')::uuid;
  IF v_receipt_id IS NULL THEN RAISE EXCEPTION 'DBS_PURCHASE_RECEIPT_NOT_RETURNED' USING errcode='23514'; END IF;

  SELECT * INTO v_receipt FROM public.dbs_control_purchase_receipts WHERE id=v_receipt_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'DBS_PURCHASE_RECEIPT_NOT_FOUND' USING errcode='23503'; END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_warranty := v_item->'warranty';
    IF v_warranty IS NULL OR jsonb_typeof(v_warranty)='null' THEN CONTINUE; END IF;
    IF jsonb_typeof(v_warranty) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'DBS_PURCHASE_WARRANTY_INPUT_INVALID' USING errcode='22023';
    END IF;

    SELECT * INTO v_receipt_item
      FROM public.dbs_control_purchase_receipt_items
     WHERE receipt_id=v_receipt_id
       AND purchase_item_id=nullif(v_item->>'purchase_item_id','')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'DBS_PURCHASE_RECEIPT_ITEM_NOT_FOUND' USING errcode='23503'; END IF;

    v_anchor := lower(coalesce(nullif(btrim(v_warranty->>'start_anchor'),''),'receipt_date'));
    IF v_anchor NOT IN ('invoice_date','receipt_date','installation_date','manual_date') THEN
      RAISE EXCEPTION 'DBS_PURCHASE_WARRANTY_START_ANCHOR_INVALID' USING errcode='22023';
    END IF;
    v_months := nullif(v_warranty->>'duration_months','')::integer;
    IF v_months IS NOT NULL AND v_months NOT BETWEEN 1 AND 1200 THEN
      RAISE EXCEPTION 'DBS_PURCHASE_WARRANTY_DURATION_INVALID' USING errcode='22023';
    END IF;

    v_starts_on := CASE
      WHEN v_anchor='receipt_date' THEN v_receipt.received_at::date
      WHEN v_anchor='invoice_date' THEN v_purchase.purchase_date
      ELSE nullif(v_warranty->>'starts_on','')::date
    END;
    IF v_starts_on IS NULL THEN
      RAISE EXCEPTION 'DBS_PURCHASE_WARRANTY_START_DATE_REQUIRED' USING errcode='22023';
    END IF;

    v_expires_on := coalesce(
      nullif(v_warranty->>'expires_on','')::date,
      CASE WHEN v_months IS NOT NULL THEN (v_starts_on + make_interval(months=>v_months))::date ELSE null END
    );
    IF v_expires_on IS NULL OR v_expires_on < v_starts_on THEN
      RAISE EXCEPTION 'DBS_PURCHASE_WARRANTY_EXPIRY_REQUIRED' USING errcode='22023';
    END IF;

    v_serial := nullif(left(btrim(coalesce(v_warranty->>'serial_number','')),160),'');
    v_lot := nullif(left(btrim(coalesce(v_warranty->>'lot_number','')),160),'');
    v_terms := left(btrim(coalesce(v_warranty->>'terms','')),4000);
    v_document := nullif(left(btrim(coalesce(v_warranty->>'document_reference','')),240),'');
    v_provider := coalesce(nullif(left(btrim(coalesce(v_warranty->>'provider_name','')),180),''),v_purchase.supplier_name);

    SELECT * INTO v_existing
      FROM public.dbs_control_supplier_warranties
     WHERE scope_key=v_purchase.scope_key AND source_receipt_item_id=v_receipt_item.id
     ORDER BY created_at DESC LIMIT 1;
    IF FOUND THEN
      IF v_existing.part_id IS DISTINCT FROM v_receipt_item.part_id
         OR v_existing.serial_number IS DISTINCT FROM v_serial
         OR v_existing.lot_number IS DISTINCT FROM v_lot
         OR v_existing.starts_on IS DISTINCT FROM v_starts_on
         OR v_existing.expires_on IS DISTINCT FROM v_expires_on THEN
        RAISE EXCEPTION 'DBS_PURCHASE_WARRANTY_IDEMPOTENCY_CONFLICT' USING errcode='23505';
      END IF;
      CONTINUE;
    END IF;

    INSERT INTO public.dbs_control_supplier_warranties(
      company_id,scope_key,part_id,supplier_id,source_receipt_item_id,serial_number,lot_number,
      quantity_covered,provider_name,start_anchor,starts_on,expires_on,duration_months,
      terms,document_reference,status,created_by,updated_by
    ) VALUES (
      v_purchase.company_id,v_purchase.scope_key,v_receipt_item.part_id,v_purchase.supplier_id,
      v_receipt_item.id,v_serial,v_lot,v_receipt_item.quantity_received,v_provider,v_anchor,
      v_starts_on,v_expires_on,v_months,v_terms,v_document,'active',p_actor_user_id,p_actor_user_id
    );
    v_created := v_created+1;
  END LOOP;

  RETURN v_result || jsonb_build_object('supplier_warranties_created',v_created);
END;
$function$;

REVOKE ALL ON FUNCTION public.dbs_control_receive_purchase_items_with_warranties(uuid,uuid,text,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dbs_control_receive_purchase_items_with_warranties(uuid,uuid,text,jsonb)
  TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
