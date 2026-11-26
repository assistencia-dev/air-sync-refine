-- DBS Air | Autorizar estorno de movimento ao Financeiro com escopo vinculado.
-- O fluxo de estorno permanece compensatório, imutável, idempotente e com Ledger.
BEGIN;

DO $patch_inventory_reversal$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(
    'public.dbs_control_reverse_inventory_movement(uuid,uuid,text,text)'::regprocedure
  ) INTO v_def;

  v_old := $old$IF p_actor_user_id IS NULL OR NOT public.dbs_control_is_admin_actor(p_actor_user_id) THEN$old$;
  v_new := $new$IF p_actor_user_id IS NULL OR NOT public.dbs_control_is_inventory_finance_actor(p_actor_user_id) THEN$new$;
  IF v_def IS NULL OR position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'DBS finance reversal migration: guarda do RPC mudou; migração abortada.';
  END IF;
  v_def := replace(v_def, v_old, v_new);

  v_old := $old$IF v_actor_company IS NOT NULL AND v_actor_company IS DISTINCT FROM v_original.company_id THEN
    RAISE EXCEPTION 'DBS_INVENTORY_REVERSAL_SCOPE_MISMATCH' USING errcode = '42501';
  END IF;$old$;
  v_new := $new$IF v_original.scope_key IS DISTINCT FROM public.dbs_control_inventory_finance_scope_key(p_actor_user_id) THEN
    RAISE EXCEPTION 'DBS_INVENTORY_REVERSAL_SCOPE_MISMATCH' USING errcode = '42501';
  END IF;$new$;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'DBS finance reversal migration: validação de escopo mudou; migração abortada.';
  END IF;
  v_def := replace(v_def, v_old, v_new);

  EXECUTE v_def;
END;
$patch_inventory_reversal$;

NOTIFY pgrst, 'reload schema';
COMMIT;
