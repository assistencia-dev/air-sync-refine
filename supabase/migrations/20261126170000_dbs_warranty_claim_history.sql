-- DBS Air | Histórico imutável e transacional de solicitações de garantia.
-- Adiciona versão otimista e trilha de eventos sem substituir os registros existentes.
BEGIN;

ALTER TABLE public.dbs_control_warranty_claims
  ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1 CHECK (version > 0);

CREATE TABLE IF NOT EXISTS public.dbs_control_warranty_claim_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE RESTRICT,
  scope_key text NOT NULL,
  claim_id uuid NOT NULL REFERENCES public.dbs_control_warranty_claims(id) ON DELETE RESTRICT,
  from_status text,
  to_status text NOT NULL CHECK (to_status IN ('opened','under_review','approved','rejected','replaced','credited','closed')),
  note text NOT NULL DEFAULT '',
  idempotency_key text NOT NULL CHECK (char_length(btrim(idempotency_key)) BETWEEN 8 AND 240),
  changed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(scope_key, idempotency_key)
);

CREATE INDEX IF NOT EXISTS dbs_control_warranty_claim_history_claim_idx
  ON public.dbs_control_warranty_claim_history(scope_key, claim_id, created_at DESC);

ALTER TABLE public.dbs_control_warranty_claim_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dbs_control_warranty_claim_history FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.dbs_control_warranty_claim_history TO service_role;

CREATE OR REPLACE FUNCTION public.dbs_control_open_warranty_claim(
  p_actor_user_id uuid,
  p_claim_type text,
  p_warranty_id uuid,
  p_issue_description text,
  p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor public.users%rowtype;
  v_scope text;
  v_type text := lower(btrim(coalesce(p_claim_type,'')));
  v_issue text := btrim(coalesce(p_issue_description,''));
  v_key text := nullif(btrim(p_idempotency_key),'');
  v_supplier public.dbs_control_supplier_warranties%rowtype;
  v_customer public.dbs_control_customer_warranties%rowtype;
  v_claim public.dbs_control_warranty_claims%rowtype;
  v_previous public.dbs_control_warranty_claim_history%rowtype;
BEGIN
  IF p_actor_user_id IS NULL OR v_key IS NULL OR char_length(v_key) NOT BETWEEN 8 AND 240
     OR p_warranty_id IS NULL OR v_type NOT IN ('supplier','customer')
     OR char_length(v_issue) NOT BETWEEN 5 AND 4000 THEN
    RAISE EXCEPTION 'DBS_WARRANTY_CLAIM_INPUT_INVALID' USING errcode='22023';
  END IF;

  SELECT * INTO v_actor FROM public.users
   WHERE id=p_actor_user_id AND status='ativo';
  IF NOT FOUND OR v_actor.role_key::text NOT IN
    ('SUPER_ADMIN','ADMIN_OPERACIONAL','GESTOR_CONTA','GESTOR_REGIONAL','FINANCEIRO_OPERADOR') THEN
    RAISE EXCEPTION 'DBS_WARRANTY_CLAIM_FORBIDDEN' USING errcode='42501';
  END IF;

  IF v_actor.role_key::text IN ('SUPER_ADMIN','FINANCEIRO_OPERADOR') THEN
    v_scope := public.dbs_control_inventory_finance_scope_key(p_actor_user_id);
  ELSE
    v_scope := CASE WHEN v_actor.company_id IS NOT NULL
      THEN 'company:'||v_actor.company_id::text
      ELSE 'user:'||v_actor.id::text END;
  END IF;
  IF v_scope IS NULL THEN
    RAISE EXCEPTION 'DBS_WARRANTY_CLAIM_SCOPE_INVALID' USING errcode='42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_scope||':warranty-claim:'||v_key,0));
  SELECT * INTO v_previous FROM public.dbs_control_warranty_claim_history
   WHERE scope_key=v_scope AND idempotency_key=v_key;
  IF FOUND THEN
    SELECT * INTO v_claim FROM public.dbs_control_warranty_claims
     WHERE id=v_previous.claim_id AND scope_key=v_scope;
    IF NOT FOUND THEN RAISE EXCEPTION 'DBS_WARRANTY_CLAIM_REPLAY_NOT_FOUND' USING errcode='23503'; END IF;
    RETURN jsonb_build_object('ok',true,'replayed',true,'claim_id',v_claim.id,'status',v_claim.status,'version',v_claim.version);
  END IF;

  IF v_type='supplier' THEN
    SELECT * INTO v_supplier FROM public.dbs_control_supplier_warranties
     WHERE id=p_warranty_id AND scope_key=v_scope FOR UPDATE;
    IF NOT FOUND OR v_supplier.status IN ('void','replaced') THEN
      RAISE EXCEPTION 'DBS_SUPPLIER_WARRANTY_NOT_AVAILABLE' USING errcode='23503';
    END IF;
    INSERT INTO public.dbs_control_warranty_claims(
      company_id,scope_key,claim_type,supplier_warranty_id,work_order_id,
      issue_description,status,opened_by
    ) VALUES (
      v_supplier.company_id,v_scope,'supplier',v_supplier.id,NULLIF(v_supplier.source_receipt_item_id::text,'')::uuid,
      v_issue,'opened',p_actor_user_id
    ) RETURNING * INTO v_claim;
    UPDATE public.dbs_control_supplier_warranties SET status='claimed',updated_by=p_actor_user_id,updated_at=now()
     WHERE id=v_supplier.id AND status='active';
  ELSE
    SELECT * INTO v_customer FROM public.dbs_control_customer_warranties
     WHERE id=p_warranty_id AND scope_key=v_scope FOR UPDATE;
    IF NOT FOUND OR v_customer.status IN ('void','replaced') THEN
      RAISE EXCEPTION 'DBS_CUSTOMER_WARRANTY_NOT_AVAILABLE' USING errcode='23503';
    END IF;
    INSERT INTO public.dbs_control_warranty_claims(
      company_id,scope_key,claim_type,customer_warranty_id,work_order_id,work_order_part_id,
      issue_description,status,opened_by
    ) VALUES (
      v_customer.company_id,v_scope,'customer',v_customer.id,v_customer.work_order_id,v_customer.work_order_part_id,
      v_issue,'opened',p_actor_user_id
    ) RETURNING * INTO v_claim;
  END IF;

  INSERT INTO public.dbs_control_warranty_claim_history(
    company_id,scope_key,claim_id,from_status,to_status,note,idempotency_key,changed_by
  ) VALUES (
    v_claim.company_id,v_scope,v_claim.id,NULL,'opened',v_issue,v_key,p_actor_user_id
  );

  RETURN jsonb_build_object('ok',true,'replayed',false,'claim_id',v_claim.id,'status',v_claim.status,'version',v_claim.version);
END;
$function$;

REVOKE ALL ON FUNCTION public.dbs_control_open_warranty_claim(uuid,text,uuid,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dbs_control_open_warranty_claim(uuid,text,uuid,text,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.dbs_control_update_warranty_claim(
  p_actor_user_id uuid,
  p_claim_id uuid,
  p_status text,
  p_note text,
  p_expected_version bigint,
  p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_scope text;
  v_claim public.dbs_control_warranty_claims%rowtype;
  v_previous public.dbs_control_warranty_claim_history%rowtype;
  v_status text := lower(btrim(coalesce(p_status,'')));
  v_note text := left(btrim(coalesce(p_note,'')),2000);
  v_key text := nullif(btrim(p_idempotency_key),'');
  v_resolved boolean;
BEGIN
  v_scope := public.dbs_control_inventory_finance_scope_key(p_actor_user_id);
  IF v_scope IS NULL OR p_claim_id IS NULL OR p_expected_version IS NULL OR p_expected_version < 1
     OR v_key IS NULL OR char_length(v_key) NOT BETWEEN 8 AND 240
     OR v_status NOT IN ('opened','under_review','approved','rejected','replaced','credited','closed') THEN
    RAISE EXCEPTION 'DBS_WARRANTY_CLAIM_UPDATE_INPUT_INVALID' USING errcode='22023';
  END IF;
  IF v_status IN ('rejected','replaced','credited') AND char_length(v_note)<5 THEN
    RAISE EXCEPTION 'DBS_WARRANTY_CLAIM_RESOLUTION_REQUIRED' USING errcode='22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_scope||':warranty-claim-update:'||v_key,0));
  SELECT * INTO v_previous FROM public.dbs_control_warranty_claim_history
   WHERE scope_key=v_scope AND idempotency_key=v_key;
  IF FOUND THEN
    IF v_previous.claim_id IS DISTINCT FROM p_claim_id OR v_previous.to_status IS DISTINCT FROM v_status THEN
      RAISE EXCEPTION 'DBS_WARRANTY_CLAIM_IDEMPOTENCY_CONFLICT' USING errcode='23505';
    END IF;
    SELECT * INTO v_claim FROM public.dbs_control_warranty_claims
     WHERE id=p_claim_id AND scope_key=v_scope;
    IF NOT FOUND THEN RAISE EXCEPTION 'DBS_WARRANTY_CLAIM_NOT_FOUND' USING errcode='23503'; END IF;
    RETURN jsonb_build_object('ok',true,'replayed',true,'claim_id',v_claim.id,'status',v_claim.status,'version',v_claim.version);
  END IF;

  SELECT * INTO v_claim FROM public.dbs_control_warranty_claims
   WHERE id=p_claim_id AND scope_key=v_scope FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DBS_WARRANTY_CLAIM_NOT_FOUND' USING errcode='23503'; END IF;
  IF v_claim.version<>p_expected_version THEN
    RAISE EXCEPTION 'DBS_WARRANTY_CLAIM_VERSION_CONFLICT' USING errcode='40001';
  END IF;
  IF v_claim.status IN ('rejected','replaced','credited','closed') THEN
    RAISE EXCEPTION 'DBS_WARRANTY_CLAIM_FINALIZED' USING errcode='23514';
  END IF;

  v_resolved := v_status IN ('approved','rejected','replaced','credited','closed');
  UPDATE public.dbs_control_warranty_claims
     SET status=v_status,resolution=v_note,
         resolved_by=CASE WHEN v_resolved THEN p_actor_user_id ELSE NULL END,
         resolved_at=CASE WHEN v_resolved THEN now() ELSE NULL END,
         updated_at=now(),version=version+1
   WHERE id=p_claim_id
   RETURNING * INTO v_claim;

  INSERT INTO public.dbs_control_warranty_claim_history(
    company_id,scope_key,claim_id,from_status,to_status,note,idempotency_key,changed_by
  ) VALUES (
    v_claim.company_id,v_scope,v_claim.id,v_previous.to_status,v_status,v_note,v_key,p_actor_user_id
  );

  IF v_claim.claim_type='supplier' AND v_status IN ('rejected','closed') THEN
    UPDATE public.dbs_control_supplier_warranties
       SET status='active',updated_at=now()
     WHERE id=v_claim.supplier_warranty_id AND status='claimed';
  ELSIF v_claim.claim_type='supplier' AND v_status='replaced' THEN
    UPDATE public.dbs_control_supplier_warranties
       SET status='replaced',updated_at=now()
     WHERE id=v_claim.supplier_warranty_id;
  END IF;

  RETURN jsonb_build_object('ok',true,'replayed',false,'claim_id',v_claim.id,'status',v_claim.status,'version',v_claim.version);
END;
$function$;

REVOKE ALL ON FUNCTION public.dbs_control_update_warranty_claim(uuid,uuid,text,text,bigint,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dbs_control_update_warranty_claim(uuid,uuid,text,text,bigint,text)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
