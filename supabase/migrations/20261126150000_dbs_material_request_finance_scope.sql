-- DBS Air | Escopo do operador financeiro nas solicitações e transferências
-- Corrige o caso em que o responsável financeiro não possui company_id:
-- sempre usa o mesmo escopo canônico do owner vinculado, sem criar saldos paralelos.
BEGIN;

DO $patch_material_scopes$
DECLARE
  v_item record;
  v_def text;
  v_old text;
  v_new text;
BEGIN
  FOR v_item IN
    SELECT *
      FROM (VALUES
        ('public.dbs_control_decide_material_request(uuid,uuid,text,text,bigint)',
         'v_scope := CASE WHEN v_actor_company IS NOT NULL' ||
           E'\n    THEN ''company:'' || v_actor_company::text' ||
           E'\n    ELSE ''user:'' || p_actor_user_id::text END;',
         'v_scope := public.dbs_control_inventory_finance_scope_key(p_actor_user_id);' ||
           E'\n  IF v_scope IS NULL THEN' ||
           E'\n    RAISE EXCEPTION ''DBS_MATERIAL_REQUEST_FINANCE_SCOPE_INVALID'' USING errcode=''42501'';' ||
           E'\n  END IF;'),
        ('public.dbs_control_link_material_request_purchase(uuid,uuid,uuid,uuid,numeric,bigint)',
         'v_scope := CASE WHEN v_actor_company IS NOT NULL' ||
           E'\n    THEN ''company:'' || v_actor_company::text' ||
           E'\n    ELSE ''user:'' || p_actor_user_id::text END;',
         'v_scope := public.dbs_control_inventory_finance_scope_key(p_actor_user_id);' ||
           E'\n  IF v_scope IS NULL THEN' ||
           E'\n    RAISE EXCEPTION ''DBS_MATERIAL_REQUEST_FINANCE_SCOPE_INVALID'' USING errcode=''42501'';' ||
           E'\n  END IF;'),
        ('public.dbs_control_fulfill_material_request(uuid,uuid,numeric,uuid,text,bigint)',
         'v_scope := CASE WHEN v_actor_company IS NOT NULL' ||
           E'\n    THEN ''company:'' || v_actor_company::text' ||
           E'\n    ELSE ''user:'' || p_actor_user_id::text END;',
         'v_scope := public.dbs_control_inventory_finance_scope_key(p_actor_user_id);' ||
           E'\n  IF v_scope IS NULL THEN' ||
           E'\n    RAISE EXCEPTION ''DBS_MATERIAL_REQUEST_FINANCE_SCOPE_INVALID'' USING errcode=''42501'';' ||
           E'\n  END IF;')
      ) AS patches(signature, old_scope, new_scope)
  LOOP
    SELECT pg_get_functiondef(v_item.signature::regprocedure) INTO v_def;
    v_old := v_item.old_scope;
    v_new := v_item.new_scope;
    IF v_def IS NULL OR position(v_old IN v_def) = 0 THEN
      RAISE EXCEPTION 'DBS material scope migration: cálculo de escopo mudou em %; migração abortada.', v_item.signature;
    END IF;
    IF length(v_def) - length(replace(v_def, v_old, '')) <> length(v_old) THEN
      RAISE EXCEPTION 'DBS material scope migration: cálculo de escopo ambíguo em %; migração abortada.', v_item.signature;
    END IF;
    EXECUTE replace(v_def, v_old, v_new);
  END LOOP;
END;
$patch_material_scopes$;

-- O RPC de transferência física mantém seu bloqueio financeiro específico,
-- mas passa a operar sobre o mesmo escopo central/operacional do responsável.
DO $patch_transfer_scope$
DECLARE
  v_def text;
  v_old text := 'v_scope:=CASE WHEN v_actor_company IS NULL THEN ''user:''||p_actor_user_id ELSE ''company:''||v_actor_company END;';
  v_new text := 'v_scope:=public.dbs_control_inventory_finance_scope_key(p_actor_user_id);' ||
    E'\n  IF v_scope IS NULL THEN' ||
    E'\n    RAISE EXCEPTION ''DBS_OPERATIONAL_STOCK_FINANCE_SCOPE_INVALID'' USING ERRCODE=''42501'';' ||
    E'\n  END IF;';
BEGIN
  SELECT pg_get_functiondef(
    'public.dbs_control_operational_stock_transfer(uuid,uuid,numeric,uuid,uuid,text,text)'::regprocedure
  ) INTO v_def;
  IF v_def IS NULL OR position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'DBS material scope migration: cálculo de escopo da transferência mudou; migração abortada.';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END;
$patch_transfer_scope$;

NOTIFY pgrst, 'reload schema';
COMMIT;
