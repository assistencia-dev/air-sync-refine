-- Migration C: aprovação financeira obrigatória antes de qualquer recebimento físico.
-- Aditiva: preserva histórico e lançamentos existentes; bloqueia o RPC legado de recebimento imediato.
BEGIN;

ALTER TABLE public.dbs_control_purchases
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'dbs_control_purchases_approval_status_check'
      AND conrelid = 'public.dbs_control_purchases'::regclass
  ) THEN
    ALTER TABLE public.dbs_control_purchases
      ADD CONSTRAINT dbs_control_purchases_approval_status_check
      CHECK (approval_status IN ('pending','approved','rejected','legacy_received'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'dbs_control_purchases_approval_consistency_check'
      AND conrelid = 'public.dbs_control_purchases'::regclass
  ) THEN
    ALTER TABLE public.dbs_control_purchases
      ADD CONSTRAINT dbs_control_purchases_approval_consistency_check
      CHECK (
        (approval_status <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
        AND (approval_status <> 'rejected' OR (
          rejected_by IS NOT NULL AND rejected_at IS NOT NULL
          AND nullif(btrim(rejection_reason), '') IS NOT NULL
        ))
        AND (approval_status <> 'legacy_received' OR (
          approved_by IS NULL AND approved_at IS NULL
          AND rejected_by IS NULL AND rejected_at IS NULL
        ))
      );
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS dbs_control_purchases_approval_scope_idx
  ON public.dbs_control_purchases(scope_key, approval_status, purchase_date DESC);

CREATE TABLE IF NOT EXISTS public.dbs_control_purchase_approval_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL REFERENCES public.dbs_control_purchases(id) ON DELETE RESTRICT,
  company_id uuid REFERENCES public.companies(id) ON DELETE RESTRICT,
  scope_key text NOT NULL,
  from_status text,
  to_status text NOT NULL CHECK (to_status IN ('pending','approved','rejected','legacy_received')),
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dbs_control_purchase_approval_history_purchase_idx
  ON public.dbs_control_purchase_approval_history(purchase_id, created_at DESC);
CREATE INDEX IF NOT EXISTS dbs_control_purchase_approval_history_scope_idx
  ON public.dbs_control_purchase_approval_history(scope_key, created_at DESC);

ALTER TABLE public.dbs_control_purchase_approval_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.dbs_control_purchase_approval_history FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.dbs_control_purchase_approval_history TO service_role;

CREATE OR REPLACE FUNCTION public.dbs_control_record_purchase_approval_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid;
  v_from text;
  v_reason text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.approval_status IS NOT DISTINCT FROM NEW.approval_status THEN
    RETURN NEW;
  END IF;
  v_actor := CASE
    WHEN NEW.approval_status = 'approved' THEN NEW.approved_by
    WHEN NEW.approval_status = 'rejected' THEN NEW.rejected_by
    ELSE NEW.created_by
  END;
  v_from := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.approval_status END;
  v_reason := CASE
    WHEN NEW.approval_status = 'approved' THEN 'Compra aprovada para recebimento.'
    WHEN NEW.approval_status = 'rejected' THEN NEW.rejection_reason
    WHEN NEW.approval_status = 'legacy_received' THEN
      'Registro histórico já recebido antes da obrigatoriedade de aprovação; não representa aprovação retroativa.'
    ELSE 'Compra cadastrada aguardando aprovação financeira.'
  END;
  INSERT INTO public.dbs_control_purchase_approval_history(
    purchase_id, company_id, scope_key, from_status, to_status,
    actor_user_id, reason, metadata
  ) VALUES (
    NEW.id, NEW.company_id, NEW.scope_key, v_from, NEW.approval_status,
    v_actor, v_reason,
    jsonb_build_object('source','dbs_control_purchase_approval','purchase_status',NEW.status)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS dbs_control_purchase_approval_history_trg
  ON public.dbs_control_purchases;
CREATE TRIGGER dbs_control_purchase_approval_history_trg
AFTER INSERT OR UPDATE OF approval_status
ON public.dbs_control_purchases
FOR EACH ROW
EXECUTE FUNCTION public.dbs_control_record_purchase_approval_history();

UPDATE public.dbs_control_purchases
   SET approval_status = 'legacy_received'
 WHERE status = 'received'
   AND approval_status = 'pending';

CREATE OR REPLACE FUNCTION public.dbs_control_decide_purchase_approval(
  p_purchase_id uuid,
  p_actor_user_id uuid,
  p_decision text,
  p_reason text DEFAULT NULL,
  p_expected_version bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_purchase public.dbs_control_purchases%rowtype;
  v_actor_company uuid;
  v_decision text := lower(btrim(coalesce(p_decision,'')));
  v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
BEGIN
  IF p_actor_user_id IS NULL OR NOT public.dbs_control_is_admin_actor(p_actor_user_id) THEN
    RAISE EXCEPTION 'DBS_PURCHASE_APPROVAL_FORBIDDEN' USING errcode='42501';
  END IF;
  IF p_purchase_id IS NULL OR v_decision NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'DBS_PURCHASE_APPROVAL_INPUT_INVALID' USING errcode='22023';
  END IF;
  IF v_decision = 'rejected' AND (v_reason IS NULL OR char_length(v_reason) < 5 OR char_length(v_reason) > 1000) THEN
    RAISE EXCEPTION 'DBS_PURCHASE_REJECTION_REASON_REQUIRED' USING errcode='22023';
  END IF;
  SELECT company_id INTO v_actor_company
    FROM public.users WHERE id=p_actor_user_id AND status='ativo';
  SELECT * INTO v_purchase
    FROM public.dbs_control_purchases WHERE id=p_purchase_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DBS_PURCHASE_NOT_FOUND' USING errcode='23503';
  END IF;
  IF v_actor_company IS NOT NULL AND v_actor_company IS DISTINCT FROM v_purchase.company_id THEN
    RAISE EXCEPTION 'DBS_PURCHASE_SCOPE_MISMATCH' USING errcode='42501';
  END IF;
  IF v_purchase.status = 'received' OR v_purchase.approval_status = 'legacy_received' THEN
    RAISE EXCEPTION 'DBS_PURCHASE_ALREADY_RECEIVED' USING errcode='23514';
  END IF;
  IF p_expected_version IS NOT NULL AND p_expected_version <> v_purchase.version THEN
    RAISE EXCEPTION 'DBS_PURCHASE_VERSION_CONFLICT' USING errcode='40001';
  END IF;
  IF v_purchase.approval_status = v_decision THEN
    RETURN jsonb_build_object(
      'ok',true,'replayed',true,'purchase_id',p_purchase_id,
      'approval_status',v_purchase.approval_status,'version',v_purchase.version
    );
  END IF;
  IF v_purchase.approval_status <> 'pending' THEN
    RAISE EXCEPTION 'DBS_PURCHASE_APPROVAL_ALREADY_DECIDED' USING errcode='23514';
  END IF;
  IF v_decision = 'approved' THEN
    UPDATE public.dbs_control_purchases
       SET approval_status='approved',
           approved_by=p_actor_user_id, approved_at=now(),
           rejected_by=NULL, rejected_at=NULL, rejection_reason=NULL,
           version=version+1, updated_at=now()
     WHERE id=p_purchase_id;
  ELSE
    UPDATE public.dbs_control_purchases
       SET approval_status='rejected',
           rejected_by=p_actor_user_id, rejected_at=now(),
           rejection_reason=v_reason,
           version=version+1, updated_at=now()
     WHERE id=p_purchase_id;
  END IF;
  SELECT * INTO v_purchase FROM public.dbs_control_purchases WHERE id=p_purchase_id;
  RETURN jsonb_build_object(
    'ok',true,'replayed',false,'purchase_id',p_purchase_id,
    'approval_status',v_purchase.approval_status,
    'approved_by',v_purchase.approved_by,'approved_at',v_purchase.approved_at,
    'rejected_by',v_purchase.rejected_by,'rejected_at',v_purchase.rejected_at,
    'rejection_reason',v_purchase.rejection_reason,'version',v_purchase.version
  );
END;
$$;

REVOKE ALL ON FUNCTION public.dbs_control_decide_purchase_approval(uuid,uuid,text,text,bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dbs_control_decide_purchase_approval(uuid,uuid,text,text,bigint)
  TO service_role;

DO $$
DECLARE
  v_definition text;
  v_anchor text := '  perform pg_advisory_xact_lock(hashtextextended(v_purchase.scope_key||'':purchase-receive:''||p_purchase_id::text,0));';
  v_guard text := E'  IF v_purchase.approval_status IS DISTINCT FROM ''approved'' THEN\n'
    || E'    RAISE EXCEPTION ''DBS_PURCHASE_APPROVAL_REQUIRED'' USING errcode=''23514'';\n'
    || E'  END IF;\n\n';
BEGIN
  SELECT pg_get_functiondef(
    'public.dbs_control_receive_registered_purchase(uuid,uuid,text)'::regprocedure
  ) INTO v_definition;
  IF position(v_guard IN v_definition) = 0 THEN
    IF position(v_anchor IN v_definition) = 0 THEN
      RAISE EXCEPTION 'Migration C: ponto de inserção da trava de aprovação não encontrado.';
    END IF;
    EXECUTE replace(v_definition, v_anchor, v_guard || v_anchor);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.dbs_control_receive_purchase(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION
    'DBS_PURCHASE_APPROVAL_REQUIRED: registre a compra, aprove financeiramente e só então receba no estoque.'
    USING errcode='23514';
END;
$$;

REVOKE ALL ON FUNCTION public.dbs_control_receive_purchase(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dbs_control_receive_purchase(jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
