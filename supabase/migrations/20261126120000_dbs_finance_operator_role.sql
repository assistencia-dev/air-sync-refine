-- DBS Air | Papel financeiro operacional separado do perfil somente leitura.
-- Preserva o administrador operacional existente; concede ao FINANCEIRO_OPERADOR
-- somente as operações financeiras/catálogos, nunca os controles gerais do DBS Control.
BEGIN;

ALTER TYPE public.role_key ADD VALUE IF NOT EXISTS 'FINANCEIRO_OPERADOR';

CREATE OR REPLACE FUNCTION public.dbs_control_is_inventory_finance_actor(p_actor_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT public.dbs_control_is_admin_actor(p_actor_user_id)
    OR EXISTS (
      SELECT 1
        FROM public.users finance_user
       WHERE finance_user.id = p_actor_user_id
         AND finance_user.status = 'ativo'
         AND finance_user.role_key::text = 'FINANCEIRO_OPERADOR'
         AND EXISTS (
           SELECT 1
             FROM public.treasury_viewer_access access
             JOIN public.users owner
               ON owner.id = access.owner_user_id
              AND owner.status = 'ativo'
              AND owner.role_key::text = 'SUPER_ADMIN'
              AND owner.company_id IS NOT DISTINCT FROM finance_user.company_id
            WHERE access.viewer_user_id = finance_user.id
              AND access.enabled = true
         )
    );
$function$;

REVOKE ALL ON FUNCTION public.dbs_control_is_inventory_finance_actor(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dbs_control_is_inventory_finance_actor(uuid)
  TO service_role;

-- Os RPCs continuam com as mesmas transações, idempotência, versão, estoque,
-- custo médio, Ledger e Outbox. Só muda o predicado de autorização para aceitar
-- o novo perfil financeiro vinculado ao responsável ativo da mesma empresa.
DO $patch$
DECLARE
  v_signature text;
  v_def text;
  v_old text;
  v_new text;
  v_item record;
BEGIN
  FOR v_item IN
    SELECT *
      FROM (VALUES
        ('public.dbs_control_register_purchase(jsonb)',
         'if v_actor is null or not public.dbs_control_is_admin_actor(v_actor) then',
         'if v_actor is null or not public.dbs_control_is_inventory_finance_actor(v_actor) then'),
        ('public.dbs_control_register_purchase_with_quote(jsonb)',
         'IF v_actor IS NULL OR NOT public.dbs_control_is_admin_actor(v_actor) THEN',
         'IF v_actor IS NULL OR NOT public.dbs_control_is_inventory_finance_actor(v_actor) THEN'),
        ('public.dbs_control_receive_purchase_items(uuid,uuid,text,jsonb)',
         'IF p_actor_user_id IS NULL OR NOT public.dbs_control_is_admin_actor(p_actor_user_id) THEN',
         'IF p_actor_user_id IS NULL OR NOT public.dbs_control_is_inventory_finance_actor(p_actor_user_id) THEN'),
        ('public.dbs_control_settle_purchase(uuid,uuid,bigint,text,text)',
         'if p_actor_user_id is null or not public.dbs_control_is_admin_actor(p_actor_user_id) then',
         'if p_actor_user_id is null or not public.dbs_control_is_inventory_finance_actor(p_actor_user_id) then'),
        ('public.dbs_control_inventory_financial_overview(uuid)',
         'if p_actor_user_id is null or not public.dbs_control_is_admin_actor(p_actor_user_id) then',
         'if p_actor_user_id is null or not public.dbs_control_is_inventory_finance_actor(p_actor_user_id) then')
      ) AS patch(signature, old_guard, new_guard)
  LOOP
    v_signature := v_item.signature;
    v_old := v_item.old_guard;
    v_new := v_item.new_guard;
    SELECT pg_get_functiondef(v_signature::regprocedure) INTO v_def;
    IF v_def IS NULL OR position(v_old IN v_def) = 0 THEN
      RAISE EXCEPTION 'DBS finance role migration: guarda não encontrada em %; migração abortada.', v_signature;
    END IF;
    IF length(v_def) - length(replace(v_def, v_old, '')) <> length(v_old) THEN
      RAISE EXCEPTION 'DBS finance role migration: guarda ambígua em %; migração abortada.', v_signature;
    END IF;
    EXECUTE replace(v_def, v_old, v_new);
  END LOOP;

  -- A aprovação foi endurecida em migration posterior para SUPER_ADMIN only.
  -- Mantém FINANCEIRO_LEITURA fora e adiciona exclusivamente FINANCEIRO_OPERADOR.
  v_signature := 'public.dbs_control_decide_purchase_approval(uuid,uuid,text,text,bigint)';
  SELECT pg_get_functiondef(v_signature::regprocedure) INTO v_def;
  v_old := $old$v_actor_role NOT IN ('SUPER_ADMIN')$old$;
  v_new := $new$v_actor_role NOT IN ('SUPER_ADMIN','FINANCEIRO_OPERADOR')$new$;
  IF v_def IS NULL OR position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'DBS finance role migration: guarda de aprovação mudou; migração abortada.';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END;
$patch$;

-- O novo operador consulta o Ledger somente no escopo do responsável ativo
-- vinculado; FINANCEIRO_LEITURA mantém exatamente a mesma permissão de leitura.
DO $patch_scope$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef('private.dbs_my_treasury_scope_keys()'::regprocedure)
    INTO v_def;
  v_old := $old$and viewer.role_key = 'FINANCEIRO_LEITURA'::public.role_key;$old$;
  v_new := $new$and viewer.role_key::text in ('FINANCEIRO_LEITURA','FINANCEIRO_OPERADOR');$new$;
  IF v_def IS NULL OR position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'DBS finance role migration: escopo read-only do Treasury mudou; migração abortada.';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END;
$patch_scope$;

NOTIFY pgrst, 'reload schema';
COMMIT;
