-- Permissões de Financeiro Operador em catálogo, compras e estornos.
-- Não amplia dbs_control_is_admin_actor, evitando conceder acesso geral ao DBS Control.
BEGIN;

CREATE OR REPLACE FUNCTION public.dbs_control_is_finance_actor(p_actor uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.users u
     WHERE u.id = p_actor
       AND u.status = 'ativo'
       AND u.role_key::text = 'FINANCEIRO_OPERADOR'
  );
$function$;

REVOKE ALL ON FUNCTION public.dbs_control_is_finance_actor(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dbs_control_is_finance_actor(uuid)
  TO service_role;

-- Atualiza somente RPCs financeiros específicos. A checagem geral de
-- administrador operacional permanece inalterada.
DO $finance_rpc$
DECLARE
  v_signature text;
  v_definition text;
  v_rewritten text;
  v_signatures text[] := ARRAY[
    'public.dbs_control_register_purchase(jsonb)',
    'public.dbs_control_register_purchase_with_quote(jsonb)',
    'public.dbs_control_upsert_part(jsonb)',
    'public.dbs_control_upsert_part_safe(jsonb)',
    'public.dbs_control_receive_purchase_items(uuid,uuid,text,jsonb)',
    'public.dbs_control_reverse_inventory_movement(uuid,uuid,text,text)',
    'public.dbs_control_operational_stock_transfer(uuid,uuid,numeric,uuid,uuid,text,text)'
  ];
BEGIN
  FOREACH v_signature IN ARRAY v_signatures LOOP
    SELECT pg_get_functiondef(v_signature::regprocedure)
      INTO v_definition;

    IF v_signature IN (
      'public.dbs_control_register_purchase(jsonb)',
      'public.dbs_control_register_purchase_with_quote(jsonb)',
      'public.dbs_control_upsert_part(jsonb)',
      'public.dbs_control_upsert_part_safe(jsonb)'
    ) THEN
      v_rewritten := regexp_replace(
        v_definition,
        'v_actor[[:space:]]+is[[:space:]]+null[[:space:]]+or[[:space:]]+not[[:space:]]+public\.dbs_control_is_admin_actor[[:space:]]*\([[:space:]]*v_actor[[:space:]]*\)',
        'v_actor IS NULL OR NOT (public.dbs_control_is_admin_actor(v_actor) OR public.dbs_control_is_finance_actor(v_actor))',
        'i'
      );
    ELSE
      v_rewritten := regexp_replace(
        v_definition,
        'p_actor_user_id[[:space:]]+IS[[:space:]]+NULL[[:space:]]+OR[[:space:]]+NOT[[:space:]]+public\.dbs_control_is_admin_actor[[:space:]]*\([[:space:]]*p_actor_user_id[[:space:]]*\)',
        'p_actor_user_id IS NULL OR NOT (public.dbs_control_is_admin_actor(p_actor_user_id) OR public.dbs_control_is_finance_actor(p_actor_user_id))',
        'i'
      );
    END IF;

    IF v_rewritten IS NOT DISTINCT FROM v_definition THEN
      RAISE EXCEPTION 'Migration Finance Operator: guarda de autorização mudou em %; nenhuma função foi substituída.', v_signature;
    END IF;
    EXECUTE v_rewritten;
  END LOOP;
END;
$finance_rpc$;

-- Mantém aprovação restrita ao SUPER_ADMIN e FINANCEIRO_OPERADOR.
-- Substitui a lista atual de perfis sem pressupor a formatação do corpo SQL.
DO $finance_approval$
DECLARE
  v_definition text;
  v_rewritten text;
BEGIN
  SELECT pg_get_functiondef(
    'public.dbs_control_decide_purchase_approval(uuid,uuid,text,text,bigint)'::regprocedure
  ) INTO v_definition;

  v_rewritten := regexp_replace(
    v_definition,
    'v_actor_role[[:space:]]+NOT[[:space:]]+IN[[:space:]]*\\([^)]*\\)',
    'v_actor_role NOT IN (''SUPER_ADMIN'',''FINANCEIRO_OPERADOR'')',
    'i'
  );

  IF v_rewritten IS NOT DISTINCT FROM v_definition
     OR position('FINANCEIRO_LEITURA' IN v_rewritten)>0 THEN
    RAISE EXCEPTION 'Migration Finance Operator: guarda de aprovação mudou; nenhuma função foi substituída.';
  END IF;

  EXECUTE v_rewritten;
END;
$finance_approval$;

COMMIT;
