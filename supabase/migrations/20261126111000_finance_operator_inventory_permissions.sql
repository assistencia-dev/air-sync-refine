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
  v_old text;
  v_new text;
  v_signatures text[] := ARRAY[
    'public.dbs_control_register_purchase(jsonb)',
    'public.dbs_control_register_purchase_with_quote(jsonb)',
    'public.dbs_control_upsert_part(jsonb)',
    'public.dbs_control_upsert_part_safe(jsonb)',
    'public.dbs_control_receive_purchase(jsonb)',
    'public.dbs_control_receive_purchase_items(uuid,uuid,text,jsonb)',
    'public.dbs_control_reverse_inventory_movement(uuid,uuid,text,text)'
  ];
BEGIN
  FOREACH v_signature IN ARRAY v_signatures LOOP
    SELECT pg_get_functiondef(v_signature::regprocedure)
      INTO v_definition;

    IF v_signature IN (
      'public.dbs_control_register_purchase(jsonb)',
      'public.dbs_control_register_purchase_with_quote(jsonb)',
      'public.dbs_control_upsert_part(jsonb)',
      'public.dbs_control_upsert_part_safe(jsonb)',
      'public.dbs_control_receive_purchase(jsonb)'
    ) THEN
      v_old := 'v_actor is null or not public.dbs_control_is_admin_actor(v_actor)';
      v_new := 'v_actor is null or not (public.dbs_control_is_admin_actor(v_actor) or public.dbs_control_is_finance_actor(v_actor))';
      IF position(v_old IN lower(v_definition)) = 0 THEN
        v_old := 'v_actor IS NULL OR NOT public.dbs_control_is_admin_actor(v_actor)';
        v_new := 'v_actor IS NULL OR NOT (public.dbs_control_is_admin_actor(v_actor) OR public.dbs_control_is_finance_actor(v_actor))';
      END IF;
    ELSE
      v_old := 'p_actor_user_id IS NULL OR NOT public.dbs_control_is_admin_actor(p_actor_user_id)';
      v_new := 'p_actor_user_id IS NULL OR NOT (public.dbs_control_is_admin_actor(p_actor_user_id) OR public.dbs_control_is_finance_actor(p_actor_user_id))';
    END IF;

    IF position(v_old IN v_definition) = 0 THEN
      RAISE EXCEPTION 'Migration Finance Operator: guarda de autorização mudou em %; nenhuma função foi substituída.', v_signature;
    END IF;
    v_definition := replace(v_definition, v_old, v_new);
    EXECUTE v_definition;
  END LOOP;
END;
$finance_rpc$;

-- A aprovação continua vinculada ao mesmo fluxo transacional, ao escopo e à
-- versão esperada. Apenas o perfil de consulta permanece sem permissão.
DO $finance_approval$
DECLARE
  v_definition text;
  v_old text := $old$'SUPER_ADMIN'$old$;
  v_new text := $new$'SUPER_ADMIN','FINANCEIRO_OPERADOR'$new$;
BEGIN
  SELECT pg_get_functiondef(
    'public.dbs_control_decide_purchase_approval(uuid,uuid,text,text,bigint)'::regprocedure
  ) INTO v_definition;

  IF position('v_actor_role NOT IN (' IN v_definition) = 0
     OR position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Migration Finance Operator: guarda de aprovação mudou; nenhuma função foi substituída.';
  END IF;

  v_definition := replace(v_definition, v_old, v_new);
  EXECUTE v_definition;
END;
$finance_approval$;

COMMIT;
