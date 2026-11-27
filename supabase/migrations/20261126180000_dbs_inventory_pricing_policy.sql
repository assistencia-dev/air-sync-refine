-- DBS Air | Política global de preço de revenda do catálogo de peças.
-- A peça é um catálogo compartilhado; uma única regra global impede preços diferentes
-- para o mesmo SKU entre estoques/OS da mesma base relacional.
-- A regra não escolhe percentuais por padrão: o Financeiro precisa configurá-la.
BEGIN;

CREATE TABLE IF NOT EXISTS public.dbs_control_inventory_pricing_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_key text NOT NULL UNIQUE CHECK (scope_key = 'dbs-control:global'),
  company_id uuid REFERENCES public.companies(id) ON DELETE RESTRICT,
  owner_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  pricing_method text NOT NULL CHECK (pricing_method IN ('markup','gross_margin')),
  rate_bps integer NOT NULL CHECK (rate_bps > 0 AND rate_bps <= 99000),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (pricing_method <> 'gross_margin' OR rate_bps < 10000)
);

ALTER TABLE public.dbs_control_inventory_pricing_policies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dbs_control_inventory_pricing_policies FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.dbs_control_inventory_pricing_policies TO service_role;

COMMENT ON TABLE public.dbs_control_inventory_pricing_policies IS
  'Regra global de cálculo do preço de revenda para o catálogo compartilhado. Não há percentual padrão; Financeiro configura explicitamente.';
COMMENT ON COLUMN public.dbs_control_inventory_pricing_policies.rate_bps IS
  'Taxa em pontos-base (100 bps = 1%). Em markup incide sobre custo; em gross_margin define margem bruta sobre preço de venda.';

CREATE OR REPLACE FUNCTION public.dbs_control_save_inventory_pricing_policy(
  p_actor_user_id uuid,
  p_pricing_method text,
  p_rate_bps integer,
  p_expected_version bigint
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_method text := lower(btrim(coalesce(p_pricing_method,'')));
  v_policy public.dbs_control_inventory_pricing_policies%rowtype;
  v_actor public.users%rowtype;
  v_owner public.users%rowtype;
  v_owner_user_id uuid;
  v_scope text;
  v_new_version bigint;
  v_updated_parts integer := 0;
  v_price numeric;
BEGIN
  SELECT * INTO v_actor FROM public.users
   WHERE id=p_actor_user_id AND status='ativo';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DBS_INVENTORY_PRICING_POLICY_FORBIDDEN' USING errcode='42501';
  END IF;
  IF v_actor.role_key::text='SUPER_ADMIN' THEN
    v_owner_user_id := v_actor.id;
  ELSIF v_actor.role_key::text='FINANCEIRO_OPERADOR' THEN
    SELECT owner.id INTO v_owner_user_id
      FROM public.treasury_viewer_access access
      JOIN public.users owner
        ON owner.id=access.owner_user_id
       AND owner.status='ativo'
       AND owner.role_key::text='SUPER_ADMIN'
       AND owner.company_id IS NOT DISTINCT FROM v_actor.company_id
     WHERE access.viewer_user_id=v_actor.id
       AND access.enabled=true;
  END IF;
  SELECT * INTO v_owner FROM public.users
   WHERE id=v_owner_user_id AND status='ativo' AND role_key::text='SUPER_ADMIN';
  IF v_owner.id IS NULL THEN
    RAISE EXCEPTION 'DBS_INVENTORY_PRICING_POLICY_OWNER_INVALID' USING errcode='42501';
  END IF;

  v_scope := public.dbs_control_inventory_finance_scope_key(p_actor_user_id);
  IF v_scope IS NULL OR p_expected_version IS NULL OR p_expected_version < 0
     OR v_method NOT IN ('markup','gross_margin')
     OR p_rate_bps IS NULL OR p_rate_bps <= 0 OR p_rate_bps > 99000
     OR (v_method = 'gross_margin' AND p_rate_bps >= 10000) THEN
    RAISE EXCEPTION 'DBS_INVENTORY_PRICING_POLICY_INPUT_INVALID' USING errcode='22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('dbs-control:global:pricing-policy',0));
  SELECT * INTO v_policy
    FROM public.dbs_control_inventory_pricing_policies
   WHERE scope_key='dbs-control:global'
   FOR UPDATE;

  IF FOUND THEN
    IF v_policy.owner_user_id IS DISTINCT FROM v_owner_user_id
       OR v_policy.company_id IS DISTINCT FROM v_owner.company_id THEN
      RAISE EXCEPTION 'DBS_INVENTORY_PRICING_POLICY_OWNER_MISMATCH' USING errcode='42501';
    END IF;
    IF v_policy.version IS DISTINCT FROM p_expected_version THEN
      RAISE EXCEPTION 'DBS_INVENTORY_PRICING_POLICY_VERSION_CONFLICT' USING errcode='40001';
    END IF;
    v_new_version := v_policy.version + 1;
    UPDATE public.dbs_control_inventory_pricing_policies
       SET pricing_method=v_method,rate_bps=p_rate_bps,version=v_new_version,
           updated_by=p_actor_user_id,updated_at=now()
     WHERE id=v_policy.id;
  ELSE
    IF p_expected_version <> 0 THEN
      RAISE EXCEPTION 'DBS_INVENTORY_PRICING_POLICY_VERSION_CONFLICT' USING errcode='40001';
    END IF;
    v_new_version := 1;
    INSERT INTO public.dbs_control_inventory_pricing_policies(
      scope_key,company_id,owner_user_id,pricing_method,rate_bps,version,updated_by
    ) VALUES ('dbs-control:global',v_owner.company_id,v_owner_user_id,v_method,p_rate_bps,v_new_version,p_actor_user_id)
    RETURNING * INTO v_policy;
  END IF;

  UPDATE public.dbs_control_parts
     SET sale_cents = CASE
       WHEN cost_cents IS NULL THEN NULL
       WHEN v_method='markup' THEN round(cost_cents::numeric * (10000 + p_rate_bps)::numeric / 10000)::integer
       ELSE round(cost_cents::numeric * 10000::numeric / (10000 - p_rate_bps)::numeric)::integer
     END,
     version = version + 1,
     updated_at = now()
   WHERE cost_cents IS NOT NULL
     AND CASE
       WHEN v_method='markup' THEN cost_cents::numeric * (10000 + p_rate_bps)::numeric / 10000
       ELSE cost_cents::numeric * 10000::numeric / (10000 - p_rate_bps)::numeric
     END <= 2147483647;

  GET DIAGNOSTICS v_updated_parts = ROW_COUNT;

  IF EXISTS (
    SELECT 1
      FROM public.dbs_control_parts
     WHERE cost_cents IS NOT NULL
       AND CASE
         WHEN v_method='markup' THEN cost_cents::numeric * (10000 + p_rate_bps)::numeric / 10000
         ELSE cost_cents::numeric * 10000::numeric / (10000 - p_rate_bps)::numeric
       END > 2147483647
  ) THEN
    RAISE EXCEPTION 'DBS_INVENTORY_PRICING_POLICY_PRICE_OVERFLOW' USING errcode='22003';
  END IF;

  RETURN jsonb_build_object(
    'ok',true,'pricing_method',v_method,'rate_bps',p_rate_bps,
    'version',v_new_version,'parts_repriced',v_updated_parts
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.dbs_control_save_inventory_pricing_policy(uuid,text,integer,bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dbs_control_save_inventory_pricing_policy(uuid,text,integer,bigint)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
