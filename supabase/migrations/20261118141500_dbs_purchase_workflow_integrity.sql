-- DBS Air | Compra, aprovação, recebimento parcial e conciliação
-- Aditiva: preserva compras existentes e o Ledger. Não altera linhas já recebidas.
BEGIN;

ALTER TABLE public.dbs_control_purchases
  ADD COLUMN IF NOT EXISTS source_quote_id uuid
    REFERENCES public.dbs_control_quotes(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS dbs_control_purchases_source_quote_idx
  ON public.dbs_control_purchases(scope_key, source_quote_id)
  WHERE source_quote_id IS NOT NULL;

COMMENT ON COLUMN public.dbs_control_purchases.source_quote_id IS
  'Orçamento relacional que originou a necessidade de compra; preserva a rastreabilidade sem transformar orçamento de venda em cotação de fornecedor.';

-- Registra o vínculo com o orçamento na mesma transação da compra. O RPC
-- legado continua disponível para integrações que não possuem orçamento.
CREATE OR REPLACE FUNCTION public.dbs_control_register_purchase_with_quote(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid := nullif(p_payload->>'actor_user_id','')::uuid;
  v_actor_company uuid;
  v_scope text;
  v_quote_id uuid := nullif(p_payload->>'source_quote_id','')::uuid;
  v_quote_scope text;
  v_result jsonb;
  v_purchase_id uuid;
  v_existing_quote_id uuid;
  v_updated integer;
BEGIN
  IF v_actor IS NULL OR NOT public.dbs_control_is_admin_actor(v_actor) THEN
    RAISE EXCEPTION 'DBS_PURCHASE_REGISTER_FORBIDDEN' USING errcode='42501';
  END IF;

  SELECT company_id INTO v_actor_company
    FROM public.users
   WHERE id = v_actor AND status = 'ativo';

  v_scope := CASE
    WHEN v_actor_company IS NOT NULL THEN 'company:' || v_actor_company::text
    ELSE 'user:' || v_actor::text
  END;

  IF nullif(btrim(p_payload->>'scope_key'),'') IS DISTINCT FROM v_scope THEN
    RAISE EXCEPTION 'DBS_PURCHASE_SCOPE_MISMATCH' USING errcode='42501';
  END IF;

  IF v_quote_id IS NOT NULL THEN
    SELECT scope_key INTO v_quote_scope
      FROM public.dbs_control_quotes
     WHERE id = v_quote_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'DBS_PURCHASE_SOURCE_QUOTE_NOT_FOUND' USING errcode='23503';
    END IF;
    IF v_quote_scope IS DISTINCT FROM v_scope THEN
      RAISE EXCEPTION 'DBS_PURCHASE_SOURCE_QUOTE_SCOPE_MISMATCH' USING errcode='42501';
    END IF;
  END IF;

  v_result := public.dbs_control_register_purchase(p_payload);
  v_purchase_id := nullif(v_result->>'purchase_id','')::uuid;
  IF v_purchase_id IS NULL THEN
    RAISE EXCEPTION 'DBS_PURCHASE_REGISTER_RESULT_INVALID' USING errcode='23514';
  END IF;

  IF v_quote_id IS NOT NULL THEN
    SELECT source_quote_id INTO v_existing_quote_id
      FROM public.dbs_control_purchases
     WHERE id = v_purchase_id AND scope_key = v_scope
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'DBS_PURCHASE_NOT_FOUND' USING errcode='23503';
    END IF;
    IF v_existing_quote_id IS NOT NULL AND v_existing_quote_id IS DISTINCT FROM v_quote_id THEN
      RAISE EXCEPTION 'DBS_PURCHASE_SOURCE_QUOTE_IDEMPOTENCY_CONFLICT' USING errcode='23505';
    END IF;
    UPDATE public.dbs_control_purchases
       SET source_quote_id = v_quote_id
     WHERE id = v_purchase_id AND scope_key = v_scope
       AND source_quote_id IS NULL;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 AND v_existing_quote_id IS DISTINCT FROM v_quote_id THEN
      RAISE EXCEPTION 'DBS_PURCHASE_SOURCE_QUOTE_IDEMPOTENCY_CONFLICT' USING errcode='23505';
    END IF;
  END IF;

  RETURN v_result || jsonb_build_object('source_quote_id', v_quote_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.dbs_control_register_purchase_with_quote(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dbs_control_register_purchase_with_quote(jsonb)
  TO service_role;

-- Somente SUPER_ADMIN pode aprovar/rejeitar. FINANCEIRO_LEITURA permanece
-- estritamente consultivo. Uma repetição da mesma decisão retorna replay
-- mesmo quando a versão enviada pelo navegador já ficou desatualizada.
DO $patch_approval$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(
    'public.dbs_control_decide_purchase_approval(uuid,uuid,text,text,bigint)'::regprocedure
  ) INTO v_def;

  v_old := $old$'SUPER_ADMIN','ADMIN_OPERACIONAL','GESTOR_CONTA','GESTOR_REGIONAL','FINANCEIRO_LEITURA'$old$;
  v_new := $new$'SUPER_ADMIN'$new$;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'Migration: lista de perfis de aprovação mudou; função não foi substituída.';
  END IF;
  v_def := replace(v_def, v_old, v_new);

  v_old := $old$IF p_expected_version IS NOT NULL AND p_expected_version <> v_purchase.version THEN$old$;
  v_new := $new$IF p_expected_version IS NOT NULL
     AND p_expected_version <> v_purchase.version
     AND v_purchase.approval_status IS DISTINCT FROM v_decision THEN$new$;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'Migration: guarda de versão da aprovação mudou; função não foi substituída.';
  END IF;
  v_def := replace(v_def, v_old, v_new);

  EXECUTE v_def;
END;
$patch_approval$;

-- O total de cada linha é alocado pelo valor contratado acumulado, e não
-- pelo custo-base arredondado. A última entrega fecha exatamente o total
-- original da linha; o custo médio usa o valor efetivamente alocado.
DO $patch_receipt$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(
    'public.dbs_control_receive_purchase_items(uuid,uuid,text,jsonb)'::regprocedure
  ) INTO v_def;

  v_old := $old$  v_ledger_id uuid;$old$;
  v_new := $new$  v_ledger_id uuid;
  v_receipt_unit_cost integer;$new$;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'Migration: declaração do Ledger de recebimento mudou; função não foi substituída.';
  END IF;
  v_def := replace(v_def, v_old, v_new);

  v_old := $old$    v_new_stock := coalesce(v_part.stock_quantity,0) + v_qty;
    v_new_cost := CASE WHEN v_new_stock > 0 THEN
      round((coalesce(v_part.stock_quantity,0)*coalesce(v_part.cost_cents,0)
        + v_qty*v_order_item.unit_cost_cents)/v_new_stock)::integer
      ELSE v_order_item.unit_cost_cents END;
    v_line_total := round(v_qty*v_order_item.unit_cost_cents)::bigint;$old$;
  v_new := $new$    v_line_total := CASE
      WHEN v_order_item.quantity_received + v_qty >= v_order_item.quantity
        THEN greatest(v_order_item.total_cents - v_order_item.received_total_cents, 0)
      ELSE round(
        v_order_item.total_cents
        * (v_order_item.quantity_received + v_qty)
        / nullif(v_order_item.quantity, 0)
      )::bigint - v_order_item.received_total_cents
    END;
    v_line_total := greatest(v_line_total, 0);
    v_receipt_unit_cost := round(v_line_total / nullif(v_qty, 0))::integer;
    v_new_stock := coalesce(v_part.stock_quantity,0) + v_qty;
    v_new_cost := CASE WHEN v_new_stock > 0 THEN
      round((coalesce(v_part.stock_quantity,0)*coalesce(v_part.cost_cents,0)
        + v_line_total)/v_new_stock)::integer
      ELSE v_receipt_unit_cost END;$new$;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'Migration: cálculo do valor/custo do recebimento mudou; função não foi substituída.';
  END IF;
  v_def := replace(v_def, v_old, v_new);

  v_old := $old$v_line_total,v_order_item.unit_cost_cents,$old$;
  v_new := $new$v_line_total,v_receipt_unit_cost,$new$;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'Migration: custo unitário do item de recebimento mudou; função não foi substituída.';
  END IF;
  v_def := replace(v_def, v_old, v_new);

  v_old := $old$v_order_item.unit_cost_cents,v_new_stock,p_purchase_id,$old$;
  v_new := $new$v_receipt_unit_cost,v_new_stock,p_purchase_id,$new$;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'Migration: custo unitário do movimento de estoque mudou; função não foi substituída.';
  END IF;
  v_def := replace(v_def, v_old, v_new);

  EXECUTE v_def;
END;
$patch_receipt$;

COMMIT;