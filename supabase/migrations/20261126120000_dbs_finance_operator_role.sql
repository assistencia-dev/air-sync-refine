-- DBS Air | Papel financeiro operacional com escopo de responsável vinculado.
-- Aditivo: FINANCEIRO_LEITURA permanece consultivo; os administradores atuais mantêm seus acessos.
-- A aprovação, recebimento, pagamento e consulta financeira validam o escopo no banco.
BEGIN;

ALTER TYPE public.role_key ADD VALUE IF NOT EXISTS 'FINANCEIRO_OPERADOR';

CREATE OR REPLACE FUNCTION public.dbs_control_inventory_finance_scope_key(p_actor_user_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor public.users%rowtype;
  v_owner public.users%rowtype;
BEGIN
  SELECT * INTO v_actor
    FROM public.users
   WHERE id = p_actor_user_id AND status = 'ativo';
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF public.dbs_control_is_admin_actor(v_actor.id) THEN
    RETURN CASE
      WHEN v_actor.company_id IS NOT NULL THEN 'company:' || v_actor.company_id::text
      ELSE 'user:' || v_actor.id::text
    END;
  END IF;

  IF v_actor.role_key::text <> 'FINANCEIRO_OPERADOR' THEN
    RETURN NULL;
  END IF;

  SELECT owner.* INTO v_owner
    FROM public.treasury_viewer_access access
    JOIN public.users owner ON owner.id = access.owner_user_id
   WHERE access.viewer_user_id = v_actor.id
     AND access.enabled = true
     AND owner.status = 'ativo'
     AND owner.role_key::text = 'SUPER_ADMIN'
     AND owner.company_id IS NOT DISTINCT FROM v_actor.company_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN CASE
    WHEN v_owner.company_id IS NOT NULL THEN 'company:' || v_owner.company_id::text
    ELSE 'user:' || v_owner.id::text
  END;
END;
$function$;

REVOKE ALL ON FUNCTION public.dbs_control_inventory_finance_scope_key(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dbs_control_inventory_finance_scope_key(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.dbs_control_is_inventory_finance_actor(p_actor_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT public.dbs_control_inventory_finance_scope_key(p_actor_user_id) IS NOT NULL;
$function$;

REVOKE ALL ON FUNCTION public.dbs_control_is_inventory_finance_actor(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dbs_control_is_inventory_finance_actor(uuid)
  TO service_role;

-- Compra: a chave de escopo enviada pelo servidor deve ser exatamente a do ator.
-- Mantém o RPC original e seu fluxo de versão, idempotência, estoque, Ledger e Outbox.
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
        ('public.dbs_control_receive_purchase_items(uuid,uuid,text,jsonb)',
         'IF p_actor_user_id IS NULL OR NOT public.dbs_control_is_admin_actor(p_actor_user_id) THEN',
         'IF p_actor_user_id IS NULL OR NOT public.dbs_control_is_inventory_finance_actor(p_actor_user_id) THEN'),
        ('public.dbs_control_settle_purchase(uuid,uuid,bigint,text,text)',
         'if p_actor_user_id is null or not public.dbs_control_is_admin_actor(p_actor_user_id) then',
         'if p_actor_user_id is null or not public.dbs_control_is_inventory_finance_actor(p_actor_user_id) then'),
        ('public.dbs_control_inventory_financial_overview(uuid)',
         'if p_actor_user_id is null or not public.dbs_control_is_admin_actor(p_actor_user_id) then',
         'if p_actor_user_id is null or not public.dbs_control_is_inventory_finance_actor(p_actor_user_id) then'),
        ('public.dbs_control_register_purchase_with_quote(jsonb)',
         'IF v_actor IS NULL OR NOT public.dbs_control_is_admin_actor(v_actor) THEN',
         'IF v_actor IS NULL OR NOT public.dbs_control_is_inventory_finance_actor(v_actor) THEN')
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
    v_def := replace(v_def, v_old, v_new);

    IF v_signature = 'public.dbs_control_register_purchase(jsonb)' THEN
      v_old := 'v_scope := coalesce(v_scope,case when v_company is not null then ''company:''||v_company::text else ''user:''||v_actor::text end);';
      v_new := 'v_scope := public.dbs_control_inventory_finance_scope_key(v_actor);' ||
        E'\n  if v_scope is null or (nullif(btrim(p_payload->>''scope_key''), '''') is not null and nullif(btrim(p_payload->>''scope_key''), '''') is distinct from v_scope) then' ||
        E'\n    raise exception ''DBS_PURCHASE_SCOPE_MISMATCH'' using errcode=''42501'';' ||
        E'\n  end if;';
      IF position(v_old IN v_def) = 0 THEN
        RAISE EXCEPTION 'DBS finance role migration: cálculo de escopo do registro mudou; migração abortada.';
      END IF;
      v_def := replace(v_def, v_old, v_new);
    ELSIF v_signature = 'public.dbs_control_register_purchase_with_quote(jsonb)' THEN
      v_old := 'v_scope := CASE' ||
        E'\n    WHEN v_actor_company IS NOT NULL THEN ''company:'' || v_actor_company::text' ||
        E'\n    ELSE ''user:'' || v_actor::text' ||
        E'\n  END;';
      v_new := 'v_scope := public.dbs_control_inventory_finance_scope_key(v_actor);';
      IF position(v_old IN v_def) = 0 THEN
        RAISE EXCEPTION 'DBS finance role migration: cálculo de escopo da cotação mudou; migração abortada.';
      END IF;
      v_def := replace(v_def, v_old, v_new);
    ELSIF v_signature = 'public.dbs_control_inventory_financial_overview(uuid)' THEN
      v_old := 'v_scope_key := case' ||
        E'\n    when v_company_id is not null then ''company:'' || v_company_id::text' ||
        E'\n    else ''user:'' || p_actor_user_id::text' ||
        E'\n  end;';
      v_new := 'v_scope_key := public.dbs_control_inventory_finance_scope_key(p_actor_user_id);';
      IF position(v_old IN v_def) = 0 THEN
        RAISE EXCEPTION 'DBS finance role migration: cálculo de escopo do resumo financeiro mudou; migração abortada.';
      END IF;
      v_def := replace(v_def, v_old, v_new);
    END IF;

    EXECUTE v_def;
  END LOOP;

  -- A aprovação foi endurecida em migration posterior para SUPER_ADMIN only.
  -- FINANCEIRO_LEITURA continua bloqueado; FINANCEIRO_OPERADOR precisa ter vínculo válido.
  v_signature := 'public.dbs_control_decide_purchase_approval(uuid,uuid,text,text,bigint)';
  SELECT pg_get_functiondef(v_signature::regprocedure) INTO v_def;
  v_old := 'IF p_actor_user_id IS NULL OR v_actor_role IS NULL OR v_actor_role NOT IN (' ||
    E'\n    ''SUPER_ADMIN''' ||
    E'\n  ) THEN';
  v_new := 'IF p_actor_user_id IS NULL OR NOT public.dbs_control_is_inventory_finance_actor(p_actor_user_id) THEN';
  IF v_def IS NULL OR position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'DBS finance role migration: guarda de aprovação mudou; migração abortada.';
  END IF;
  v_def := replace(v_def, v_old, v_new);

  -- Impede que um operador financeiro use o UUID de uma compra de outro responsável.
  v_old := 'IF NOT FOUND THEN' ||
    E'\n    RAISE EXCEPTION ''DBS_PURCHASE_NOT_FOUND'' USING errcode=''23503'';' ||
    E'\n  END IF;' ||
    E'\n  IF v_actor_company IS NOT NULL AND v_actor_company IS DISTINCT FROM v_purchase.company_id THEN';
  v_new := 'IF NOT FOUND THEN' ||
    E'\n    RAISE EXCEPTION ''DBS_PURCHASE_NOT_FOUND'' USING errcode=''23503'';' ||
    E'\n  END IF;' ||
    E'\n  IF v_purchase.scope_key IS DISTINCT FROM public.dbs_control_inventory_finance_scope_key(p_actor_user_id) THEN' ||
    E'\n    RAISE EXCEPTION ''DBS_PURCHASE_SCOPE_MISMATCH'' USING errcode=''42501'';' ||
    E'\n  END IF;' ||
    E'\n  IF v_actor_company IS NOT NULL AND v_actor_company IS DISTINCT FROM v_purchase.company_id THEN';
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'DBS finance role migration: validação de escopo da aprovação mudou; migração abortada.';
  END IF;
  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;
END;
$patch$;

-- Recebimento e pagamento também validam o scope_key da compra, não apenas company_id.
DO $patch_purchase_scope$
DECLARE
  v_def text;
  v_old text;
  v_new text;
  v_signature text;
BEGIN
  v_signature := 'public.dbs_control_receive_purchase_items(uuid,uuid,text,jsonb)';
  SELECT pg_get_functiondef(v_signature::regprocedure) INTO v_def;
  v_old := 'IF NOT FOUND THEN' ||
    E'\n    RAISE EXCEPTION ''DBS_PURCHASE_NOT_FOUND'' USING errcode = ''23503'';' ||
    E'\n  END IF;' ||
    E'\n  IF v_actor_company IS NOT NULL AND v_actor_company IS DISTINCT FROM v_purchase.company_id THEN';
  v_new := 'IF NOT FOUND THEN' ||
    E'\n    RAISE EXCEPTION ''DBS_PURCHASE_NOT_FOUND'' USING errcode = ''23503'';' ||
    E'\n  END IF;' ||
    E'\n  IF v_purchase.scope_key IS DISTINCT FROM public.dbs_control_inventory_finance_scope_key(p_actor_user_id) THEN' ||
    E'\n    RAISE EXCEPTION ''DBS_PURCHASE_SCOPE_MISMATCH'' USING errcode = ''42501'';' ||
    E'\n  END IF;' ||
    E'\n  IF v_actor_company IS NOT NULL AND v_actor_company IS DISTINCT FROM v_purchase.company_id THEN';
  IF v_def IS NULL OR position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'DBS finance role migration: validação de escopo de recebimento mudou; migração abortada.';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);

  v_signature := 'public.dbs_control_settle_purchase(uuid,uuid,bigint,text,text)';
  SELECT pg_get_functiondef(v_signature::regprocedure) INTO v_def;
  v_old := 'if not found then' ||
    E'\n    raise exception ''DBS_PURCHASE_NOT_FOUND'' using errcode = ''23503'';' ||
    E'\n  end if;' ||
    E'\n  if v_actor_company is not null and v_actor_company is distinct from v_purchase.company_id then';
  v_new := 'if not found then' ||
    E'\n    raise exception ''DBS_PURCHASE_NOT_FOUND'' using errcode = ''23503'';' ||
    E'\n  end if;' ||
    E'\n  if v_purchase.scope_key is distinct from public.dbs_control_inventory_finance_scope_key(p_actor_user_id) then' ||
    E'\n    raise exception ''DBS_PURCHASE_SCOPE_MISMATCH'' using errcode = ''42501'';' ||
    E'\n  end if;' ||
    E'\n  if v_actor_company is not null and v_actor_company is distinct from v_purchase.company_id then';
  IF v_def IS NULL OR position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'DBS finance role migration: validação de escopo de pagamento mudou; migração abortada.';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END;
$patch_purchase_scope$;

-- O Ledger continua consultável no escopo do responsável vinculado.
-- O perfil FINANCEIRO_LEITURA conserva seu comportamento de leitura original.
DO $patch_scope$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef('private.dbs_my_treasury_scope_keys()'::regprocedure)
    INTO v_def;
  v_old := 'and viewer.role_key = ''FINANCEIRO_LEITURA''::public.role_key;';
  v_new := 'and viewer.role_key::text in (''FINANCEIRO_LEITURA'',''FINANCEIRO_OPERADOR'')' ||
    E'\n    and (viewer.role_key::text <> ''FINANCEIRO_OPERADOR'' or (' ||
    E'\n      owner.role_key::text = ''SUPER_ADMIN'' and owner.company_id IS NOT DISTINCT FROM viewer.company_id' ||
    E'\n    ));';
  IF v_def IS NULL OR position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'DBS finance role migration: escopo read-only do Treasury mudou; migração abortada.';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END;
$patch_scope$;

NOTIFY pgrst, 'reload schema';
COMMIT;
