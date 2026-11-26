-- Política configurável de preço de revenda para catálogo de peças.
-- Não cria percentual padrão: novas peças exigem configuração financeira explícita.
BEGIN;

CREATE TABLE IF NOT EXISTS public.dbs_control_part_pricing_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_key text NOT NULL UNIQUE,
  policy_type text NOT NULL CHECK (policy_type IN ('markup','gross_margin')),
  rate_basis_points integer NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (policy_type='markup' AND rate_basis_points BETWEEN 1 AND 1000000)
    OR (policy_type='gross_margin' AND rate_basis_points BETWEEN 1 AND 9900)
  )
);

CREATE TABLE IF NOT EXISTS public.dbs_control_part_pricing_policy_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid REFERENCES public.dbs_control_part_pricing_policies(id) ON DELETE RESTRICT,
  scope_key text NOT NULL,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  old_policy_type text,
  old_rate_basis_points integer,
  new_policy_type text NOT NULL,
  new_rate_basis_points integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dbs_control_part_pricing_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dbs_control_part_pricing_policy_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dbs_control_part_pricing_policies, public.dbs_control_part_pricing_policy_history
  FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.dbs_control_part_pricing_policies, public.dbs_control_part_pricing_policy_history
  TO service_role;

CREATE OR REPLACE FUNCTION public.dbs_control_calculate_part_sale_cents(
  p_scope_key text,p_cost_cents bigint
) RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_policy public.dbs_control_part_pricing_policies%rowtype;
  v_result numeric;
BEGIN
  IF p_scope_key IS NULL OR p_cost_cents IS NULL OR p_cost_cents < 0 THEN
    RAISE EXCEPTION 'DBS_PART_PRICING_INPUT_INVALID' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_policy
    FROM public.dbs_control_part_pricing_policies
   WHERE scope_key=p_scope_key AND is_active=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'DBS_PART_PRICING_POLICY_NOT_CONFIGURED' USING ERRCODE='23514'; END IF;

  IF v_policy.policy_type='markup' THEN
    v_result := round(p_cost_cents::numeric * (10000+v_policy.rate_basis_points)::numeric / 10000);
  ELSE
    v_result := round(p_cost_cents::numeric * 10000::numeric / (10000-v_policy.rate_basis_points));
  END IF;
  IF v_result > 2147483647 THEN RAISE EXCEPTION 'DBS_PART_SALE_PRICE_OVERFLOW' USING ERRCODE='22003'; END IF;
  RETURN v_result::bigint;
END;
$function$;

REVOKE ALL ON FUNCTION public.dbs_control_calculate_part_sale_cents(text,bigint)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dbs_control_calculate_part_sale_cents(text,bigint)
  TO service_role;

CREATE OR REPLACE FUNCTION public.dbs_control_apply_part_pricing_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_scope_key text;
  v_policy public.dbs_control_part_pricing_policies%rowtype;
BEGIN
  IF TG_OP='UPDATE'
     AND NEW.cost_cents IS NOT DISTINCT FROM OLD.cost_cents
     AND NEW.sale_cents IS NOT DISTINCT FROM OLD.sale_cents
     AND NEW.supplier_id IS NOT DISTINCT FROM OLD.supplier_id THEN
    RETURN NEW;
  END IF;

  IF NEW.supplier_id IS NULL THEN
    IF TG_OP='INSERT' THEN RETURN NEW; END IF;
    IF NEW.sale_cents IS DISTINCT FROM OLD.sale_cents THEN
      RAISE EXCEPTION 'DBS_PART_PRICING_POLICY_REQUIRED_FOR_MANUAL_PRICE' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT scope_key INTO v_scope_key
    FROM public.dbs_control_suppliers
   WHERE id=NEW.supplier_id AND status='active';
  IF v_scope_key IS NULL THEN
    RAISE EXCEPTION 'DBS_PART_PRICING_SUPPLIER_SCOPE_NOT_FOUND' USING ERRCODE='23503';
  END IF;

  SELECT * INTO v_policy
    FROM public.dbs_control_part_pricing_policies
   WHERE scope_key=v_scope_key AND is_active=true;
  IF NOT FOUND THEN
    IF TG_OP='INSERT' THEN
      RAISE EXCEPTION 'DBS_PART_PRICING_POLICY_NOT_CONFIGURED' USING ERRCODE='23514';
    END IF;
    IF NEW.sale_cents IS DISTINCT FROM OLD.sale_cents THEN
      RAISE EXCEPTION 'DBS_PART_PRICING_POLICY_NOT_CONFIGURED' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;

  NEW.sale_cents := public.dbs_control_calculate_part_sale_cents(v_scope_key,coalesce(NEW.cost_cents,0));
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_dbs_control_part_pricing_policy ON public.dbs_control_parts;
CREATE TRIGGER trg_dbs_control_part_pricing_policy
BEFORE INSERT OR UPDATE OF cost_cents,sale_cents,supplier_id
ON public.dbs_control_parts
FOR EACH ROW EXECUTE FUNCTION public.dbs_control_apply_part_pricing_policy();

REVOKE ALL ON FUNCTION public.dbs_control_apply_part_pricing_policy()
  FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.dbs_control_set_part_pricing_policy(
  p_actor_user_id uuid,p_policy_type text,p_rate_basis_points integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user public.users%rowtype;
  v_scope_key text;
  v_existing public.dbs_control_part_pricing_policies%rowtype;
  v_saved public.dbs_control_part_pricing_policies%rowtype;
  v_policy_type text := lower(btrim(coalesce(p_policy_type,'')));
BEGIN
  IF p_actor_user_id IS NULL OR NOT (
    public.dbs_control_is_admin_actor(p_actor_user_id)
    OR public.dbs_control_is_finance_actor(p_actor_user_id)
  ) THEN
    RAISE EXCEPTION 'DBS_PART_PRICING_POLICY_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF v_policy_type NOT IN ('markup','gross_margin')
     OR p_rate_basis_points IS NULL
     OR (v_policy_type='markup' AND p_rate_basis_points NOT BETWEEN 1 AND 1000000)
     OR (v_policy_type='gross_margin' AND p_rate_basis_points NOT BETWEEN 1 AND 9900) THEN
    RAISE EXCEPTION 'DBS_PART_PRICING_POLICY_INPUT_INVALID' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_user FROM public.users
   WHERE id=p_actor_user_id AND status='ativo';
  IF NOT FOUND THEN RAISE EXCEPTION 'DBS_PART_PRICING_ACTOR_INVALID' USING ERRCODE='42501'; END IF;
  v_scope_key := CASE WHEN v_user.company_id IS NULL THEN 'user:'||v_user.id::text
    ELSE 'company:'||v_user.company_id::text END;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_scope_key||':part-pricing-policy',0));

  SELECT * INTO v_existing FROM public.dbs_control_part_pricing_policies
   WHERE scope_key=v_scope_key FOR UPDATE;

  IF FOUND THEN
    UPDATE public.dbs_control_part_pricing_policies
       SET policy_type=v_policy_type,rate_basis_points=p_rate_basis_points,
           is_active=true,version=version+1,updated_by=p_actor_user_id,updated_at=now()
     WHERE id=v_existing.id
     RETURNING * INTO v_saved;
  ELSE
    INSERT INTO public.dbs_control_part_pricing_policies(
      scope_key,policy_type,rate_basis_points,is_active,created_by,updated_by
    ) VALUES (v_scope_key,v_policy_type,p_rate_basis_points,true,p_actor_user_id,p_actor_user_id)
    RETURNING * INTO v_saved;
  END IF;

  INSERT INTO public.dbs_control_part_pricing_policy_history(
    policy_id,scope_key,actor_user_id,old_policy_type,old_rate_basis_points,
    new_policy_type,new_rate_basis_points
  ) VALUES (
    v_saved.id,v_scope_key,p_actor_user_id,
    CASE WHEN v_existing.id IS NULL THEN NULL ELSE v_existing.policy_type END,
    CASE WHEN v_existing.id IS NULL THEN NULL ELSE v_existing.rate_basis_points END,
    v_policy_type,p_rate_basis_points
  );

  -- Recalcula o preço de revenda a partir do custo vigente, sem mudar estoque
  -- ou qualquer valor do Ledger. O trigger mantém a mesma regra nas futuras entradas.
  UPDATE public.dbs_control_parts p
     SET sale_cents=public.dbs_control_calculate_part_sale_cents(s.scope_key,p.cost_cents)
    FROM public.dbs_control_suppliers s
   WHERE s.id=p.supplier_id AND s.scope_key=v_scope_key
     AND p.cost_cents IS NOT NULL;

  RETURN jsonb_build_object(
    'ok',true,'scope_key',v_scope_key,'policy_type',v_saved.policy_type,
    'rate_basis_points',v_saved.rate_basis_points,'version',v_saved.version,
    'updated_at',v_saved.updated_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.dbs_control_set_part_pricing_policy(uuid,text,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dbs_control_set_part_pricing_policy(uuid,text,integer)
  TO service_role;

COMMIT;
