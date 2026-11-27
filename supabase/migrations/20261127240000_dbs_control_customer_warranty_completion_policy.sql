BEGIN;

-- Regras explícitas e aprovadas pelo Financeiro. Nenhum prazo é presumido.
CREATE TABLE IF NOT EXISTS public.dbs_control_customer_warranty_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE RESTRICT,
  scope_key text NOT NULL,
  policy_key text NOT NULL,
  coverage_type text NOT NULL CHECK (coverage_type IN ('part','service','work_order')),
  part_id uuid REFERENCES public.dbs_control_parts(id) ON DELETE RESTRICT,
  service_id uuid REFERENCES public.dbs_control_service_catalog(id) ON DELETE RESTRICT,
  duration_months integer NOT NULL CHECK (duration_months BETWEEN 1 AND 1200),
  terms text NOT NULL CHECK (char_length(btrim(terms)) BETWEEN 5 AND 4000),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  approved_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  approved_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (coverage_type='part' AND part_id IS NOT NULL AND service_id IS NULL)
    OR (coverage_type='service' AND part_id IS NULL AND service_id IS NOT NULL)
    OR (coverage_type='work_order' AND part_id IS NULL AND service_id IS NULL)
  ),
  UNIQUE(scope_key,policy_key)
);
CREATE INDEX IF NOT EXISTS dbs_control_customer_warranty_policies_active_idx
  ON public.dbs_control_customer_warranty_policies(scope_key,coverage_type,status);

CREATE TABLE IF NOT EXISTS public.dbs_control_customer_warranty_policy_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid NOT NULL REFERENCES public.dbs_control_customer_warranty_policies(id) ON DELETE RESTRICT,
  scope_key text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('created','updated')),
  before_data jsonb,
  after_data jsonb NOT NULL,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dbs_control_customer_warranty_policy_history_idx
  ON public.dbs_control_customer_warranty_policy_history(scope_key,policy_id,created_at DESC);

ALTER TABLE public.dbs_control_customer_warranties
  ADD COLUMN IF NOT EXISTS policy_id uuid REFERENCES public.dbs_control_customer_warranty_policies(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS source_receipt_allocation_id uuid REFERENCES public.dbs_control_work_order_part_receipt_allocations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS supplier_warranty_id uuid REFERENCES public.dbs_control_supplier_warranties(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS serial_number text,
  ADD COLUMN IF NOT EXISTS lot_number text,
  ADD COLUMN IF NOT EXISTS quantity_covered numeric(18,4) NOT NULL DEFAULT 1 CHECK (quantity_covered > 0);

CREATE UNIQUE INDEX IF NOT EXISTS dbs_control_customer_warranties_policy_source_uq
  ON public.dbs_control_customer_warranties(
    policy_id,work_order_id,coverage_type,
    coalesce(work_order_part_id,'00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(source_receipt_allocation_id,'00000000-0000-0000-0000-000000000000'::uuid)
  ) WHERE policy_id IS NOT NULL;

-- Keep an immutable before/after trail for each emitted or enriched coverage.
CREATE TABLE IF NOT EXISTS public.dbs_control_customer_warranty_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warranty_id uuid NOT NULL REFERENCES public.dbs_control_customer_warranties(id) ON DELETE RESTRICT,
  scope_key text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('issued','updated')),
  before_data jsonb,
  after_data jsonb NOT NULL,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dbs_control_customer_warranty_history_idx
  ON public.dbs_control_customer_warranty_history(scope_key,warranty_id,created_at DESC);
ALTER TABLE public.dbs_control_customer_warranty_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dbs_control_customer_warranty_history FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.dbs_control_customer_warranty_history TO service_role;

CREATE OR REPLACE FUNCTION public.dbs_control_capture_customer_warranty_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $function$
BEGIN
  INSERT INTO public.dbs_control_customer_warranty_history(
    warranty_id,scope_key,operation,before_data,after_data,actor_user_id
  ) VALUES (
    NEW.id,NEW.scope_key,CASE WHEN TG_OP='INSERT' THEN 'issued' ELSE 'updated' END,
    CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,
    to_jsonb(NEW),COALESCE(NEW.updated_by,NEW.created_by)
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.dbs_control_reject_customer_warranty_history_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $function$
BEGIN
  RAISE EXCEPTION 'DBS_CUSTOMER_WARRANTY_HISTORY_IMMUTABLE' USING errcode='55000';
END;
$function$;

ALTER TABLE public.dbs_control_customer_warranty_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dbs_control_customer_warranty_policy_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dbs_control_customer_warranty_policies,
  public.dbs_control_customer_warranty_policy_history FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.dbs_control_customer_warranty_policies TO service_role;
GRANT SELECT,INSERT ON public.dbs_control_customer_warranty_policy_history TO service_role;

CREATE OR REPLACE FUNCTION public.dbs_control_capture_customer_warranty_policy_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $function$
BEGIN
  INSERT INTO public.dbs_control_customer_warranty_policy_history(
    policy_id,scope_key,operation,before_data,after_data,actor_user_id
  ) VALUES (
    NEW.id,NEW.scope_key,CASE WHEN TG_OP='INSERT' THEN 'created' ELSE 'updated' END,
    CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,
    to_jsonb(NEW),COALESCE(NEW.updated_by,NEW.created_by,NEW.approved_by)
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.dbs_control_reject_customer_warranty_policy_history_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $function$
BEGIN
  RAISE EXCEPTION 'DBS_CUSTOMER_WARRANTY_POLICY_HISTORY_IMMUTABLE' USING errcode='55000';
END;
$function$;

CREATE OR REPLACE FUNCTION public.dbs_control_issue_customer_warranties_on_work_order_completion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $function$
DECLARE
  v_scope record;
  v_policy record;
  v_part record;
  v_allocation record;
  v_start date;
  v_allocated numeric(18,4);
  v_unallocated numeric(18,4);
  v_actor uuid;
BEGIN
  SELECT id INTO v_actor FROM public.users WHERE auth_id=auth.uid() AND status='ativo' LIMIT 1;
  IF lower(btrim(coalesce(NEW.status,''))) NOT IN ('concluida','concluída','concluido','concluído','completed','complete')
     OR lower(btrim(coalesce(OLD.status,''))) IN ('concluida','concluída','concluido','concluído','completed','complete') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_scope
    FROM public.dbs_control_inventory_scope_for_work_order(NEW.id);
  IF NOT FOUND OR v_scope.scope_key IS NULL THEN
    RETURN NEW;
  END IF;
  v_start := coalesce((NEW.completed_at AT TIME ZONE 'America/Sao_Paulo')::date,(now() AT TIME ZONE 'America/Sao_Paulo')::date);

  -- Cobertura por peça: apenas itens já marcados como efetivamente consumidos.
  FOR v_part IN
    SELECT op.id,op.part_id,op.quantity,p.id AS policy_id,p.company_id AS policy_company_id,
           p.scope_key,p.duration_months,p.terms,p.approved_by,p.approved_at
      FROM public.dbs_control_work_order_parts op
      JOIN public.dbs_control_customer_warranty_policies p
        ON p.scope_key=v_scope.scope_key AND p.coverage_type='part'
       AND p.part_id=op.part_id AND p.status='active'
       AND p.approved_at<=coalesce(NEW.completed_at,now())
     WHERE op.work_order_id=NEW.id AND op.consumption_status='consumed'
       AND NOT EXISTS (
         SELECT 1 FROM public.dbs_control_customer_warranties cw
          WHERE cw.scope_key=v_scope.scope_key AND cw.work_order_id=NEW.id
            AND cw.work_order_part_id=op.id AND cw.policy_id IS NULL
            AND cw.status IN ('active','suspended')
       )
  FOR UPDATE OF op
  LOOP
    v_allocated := 0;
    FOR v_allocation IN
      SELECT a.id,a.quantity_allocated,a.supplier_warranty_id,a.serial_number,a.lot_number
        FROM public.dbs_control_work_order_part_receipt_allocations a
       WHERE a.scope_key=v_scope.scope_key AND a.work_order_part_id=v_part.id
       ORDER BY a.created_at,a.id
    LOOP
      INSERT INTO public.dbs_control_customer_warranties(
        company_id,scope_key,work_order_id,work_order_part_id,part_id,coverage_type,
        starts_on,expires_on,duration_months,terms,status,created_by,updated_by,
        policy_id,source_receipt_allocation_id,supplier_warranty_id,serial_number,lot_number,quantity_covered
      ) VALUES (
        v_scope.company_id,v_scope.scope_key,NEW.id,v_part.id,v_part.part_id,'part',
        v_start,(v_start+make_interval(months=>v_part.duration_months))::date,
        v_part.duration_months,v_part.terms,'active',COALESCE(v_actor,NEW.created_by_user_id),COALESCE(v_actor,NEW.created_by_user_id),
        v_part.policy_id,v_allocation.id,v_allocation.supplier_warranty_id,
        v_allocation.serial_number,v_allocation.lot_number,v_allocation.quantity_allocated
      ) ON CONFLICT DO NOTHING;
      v_allocated := v_allocated + v_allocation.quantity_allocated;
    END LOOP;

    v_unallocated := greatest(0,v_part.quantity-v_allocated);
    IF v_unallocated>0 THEN
      INSERT INTO public.dbs_control_customer_warranties(
        company_id,scope_key,work_order_id,work_order_part_id,part_id,coverage_type,
        starts_on,expires_on,duration_months,terms,status,created_by,updated_by,
        policy_id,quantity_covered
      ) VALUES (
        v_scope.company_id,v_scope.scope_key,NEW.id,v_part.id,v_part.part_id,'part',
        v_start,(v_start+make_interval(months=>v_part.duration_months))::date,
        v_part.duration_months,v_part.terms,'active',COALESCE(v_actor,NEW.created_by_user_id),COALESCE(v_actor,NEW.created_by_user_id),
        v_part.policy_id,v_unallocated
      ) ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;

  -- Cobertura de serviço ou do atendimento. Só é emitida quando há regra ativa.
  FOR v_policy IN
    SELECT p.* FROM public.dbs_control_customer_warranty_policies p
     WHERE p.scope_key=v_scope.scope_key AND p.status='active'
       AND (
         (p.coverage_type='service' AND p.service_id=NEW.service_id)
         OR p.coverage_type='work_order'
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.dbs_control_customer_warranties cw
          WHERE cw.scope_key=v_scope.scope_key AND cw.work_order_id=NEW.id
            AND cw.coverage_type=p.coverage_type AND cw.policy_id IS NULL
            AND cw.status IN ('active','suspended')
       )
  LOOP
    INSERT INTO public.dbs_control_customer_warranties(
      company_id,scope_key,work_order_id,coverage_type,starts_on,expires_on,
      duration_months,terms,status,created_by,updated_by,policy_id
    ) VALUES (
      v_scope.company_id,v_scope.scope_key,NEW.id,v_policy.coverage_type,v_start,
      (v_start+make_interval(months=>v_policy.duration_months))::date,
      v_policy.duration_months,v_policy.terms,'active',COALESCE(v_actor,NEW.created_by_user_id),
      COALESCE(v_actor,NEW.created_by_user_id),v_policy.id
    ) ON CONFLICT DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.dbs_control_issue_customer_warranty_after_late_part_consumption()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $function$
DECLARE
  v_order public.dbs_control_work_orders%rowtype;
  v_scope record;
  v_policy record;
  v_allocation record;
  v_start date;
  v_allocated numeric(18,4);
  v_unallocated numeric(18,4);
BEGIN
  IF NEW.consumption_status IS DISTINCT FROM 'consumed' THEN
    RETURN NEW;
  END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.consumption_status IS NOT DISTINCT FROM NEW.consumption_status THEN
      RETURN NEW;
    END IF;
  END IF;
  SELECT * INTO v_order FROM public.dbs_control_work_orders WHERE id=NEW.work_order_id;
  IF NOT FOUND OR v_order.completed_at IS NULL
     OR lower(btrim(coalesce(v_order.status,''))) NOT IN ('concluida','concluída','concluido','concluído','completed','complete') THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_scope FROM public.dbs_control_inventory_scope_for_work_order(v_order.id);
  IF NOT FOUND OR v_scope.scope_key IS NULL THEN
    RETURN NEW;
  END IF;
  v_start:=v_order.completed_at::date;
  IF EXISTS (
    SELECT 1 FROM public.dbs_control_customer_warranties
     WHERE scope_key=v_scope.scope_key AND work_order_id=v_order.id
       AND work_order_part_id=NEW.id AND policy_id IS NULL
       AND status IN ('active','suspended')
  ) THEN
    RETURN NEW;
  END IF;

  FOR v_policy IN
    SELECT * FROM public.dbs_control_customer_warranty_policies
     WHERE scope_key=v_scope.scope_key AND coverage_type='part'
       AND part_id=NEW.part_id AND status='active'
       AND approved_at<=v_order.completed_at
  LOOP
    v_allocated:=0;
    FOR v_allocation IN
      SELECT * FROM public.dbs_control_work_order_part_receipt_allocations
       WHERE scope_key=v_scope.scope_key AND work_order_part_id=NEW.id
       ORDER BY created_at,id
    LOOP
      INSERT INTO public.dbs_control_customer_warranties(
        company_id,scope_key,work_order_id,work_order_part_id,part_id,coverage_type,
        starts_on,expires_on,duration_months,terms,status,created_by,updated_by,
        policy_id,source_receipt_allocation_id,supplier_warranty_id,serial_number,lot_number,quantity_covered
      ) VALUES (
        v_scope.company_id,v_scope.scope_key,v_order.id,NEW.id,NEW.part_id,'part',
        v_start,(v_start+make_interval(months=>v_policy.duration_months))::date,
        v_policy.duration_months,v_policy.terms,'active',v_order.created_by_user_id,v_order.created_by_user_id,
        v_policy.id,v_allocation.id,v_allocation.supplier_warranty_id,
        v_allocation.serial_number,v_allocation.lot_number,v_allocation.quantity_allocated
      ) ON CONFLICT DO NOTHING;
      v_allocated:=v_allocated+v_allocation.quantity_allocated;
    END LOOP;

    v_unallocated:=greatest(0,NEW.quantity-v_allocated);
    IF v_unallocated>0 THEN
      INSERT INTO public.dbs_control_customer_warranties(
        company_id,scope_key,work_order_id,work_order_part_id,part_id,coverage_type,
        starts_on,expires_on,duration_months,terms,status,created_by,updated_by,
        policy_id,quantity_covered
      ) VALUES (
        v_scope.company_id,v_scope.scope_key,v_order.id,NEW.id,NEW.part_id,'part',
        v_start,(v_start+make_interval(months=>v_policy.duration_months))::date,
        v_policy.duration_months,v_policy.terms,'active',v_order.created_by_user_id,v_order.created_by_user_id,
        v_policy.id,v_unallocated
      ) ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.dbs_control_attach_late_receipt_allocation_to_customer_warranty()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $function$
DECLARE
  v_part public.dbs_control_work_order_parts%rowtype;
  v_order public.dbs_control_work_orders%rowtype;
  v_policy public.dbs_control_customer_warranty_policies%rowtype;
  v_unallocated public.dbs_control_customer_warranties%rowtype;
  v_scope record;
  v_start date;
  v_remaining numeric(18,4);
  v_total_allocated numeric(18,4);
BEGIN
  SELECT * INTO v_part FROM public.dbs_control_work_order_parts
   WHERE id=NEW.work_order_part_id FOR UPDATE;
  IF NOT FOUND OR v_part.consumption_status IS DISTINCT FROM 'consumed' THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_order FROM public.dbs_control_work_orders
   WHERE id=v_part.work_order_id;
  IF NOT FOUND OR lower(btrim(coalesce(v_order.status,''))) NOT IN
    ('concluida','concluída','concluido','concluído','completed','complete') THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.dbs_control_customer_warranties
     WHERE scope_key=NEW.scope_key AND work_order_id=v_order.id
       AND work_order_part_id=v_part.id AND policy_id IS NULL
       AND status IN ('active','suspended')
  ) THEN
    RETURN NEW;
  END IF;

  -- Prefer the coverage already issued at close, even when its policy has
  -- since been disabled. This only enriches the existing quantity split.
  SELECT * INTO v_unallocated
    FROM public.dbs_control_customer_warranties
   WHERE policy_id IS NOT NULL AND work_order_id=v_order.id
     AND work_order_part_id=v_part.id AND source_receipt_allocation_id IS NULL
   ORDER BY created_at LIMIT 1 FOR UPDATE;

  IF FOUND THEN
    v_remaining := v_unallocated.quantity_covered-NEW.quantity_allocated;
    IF v_remaining<0 THEN
      RAISE EXCEPTION 'DBS_CUSTOMER_WARRANTY_ALLOCATION_EXCEEDS_COVERAGE' USING errcode='23514';
    END IF;
    IF v_remaining=0 THEN
      UPDATE public.dbs_control_customer_warranties
         SET source_receipt_allocation_id=NEW.id,
             supplier_warranty_id=NEW.supplier_warranty_id,
             serial_number=NEW.serial_number,lot_number=NEW.lot_number,
             quantity_covered=NEW.quantity_allocated,updated_at=now()
       WHERE id=v_unallocated.id;
    ELSE
      UPDATE public.dbs_control_customer_warranties
         SET quantity_covered=v_remaining,updated_at=now()
       WHERE id=v_unallocated.id;
      INSERT INTO public.dbs_control_customer_warranties(
        company_id,scope_key,work_order_id,work_order_part_id,part_id,coverage_type,
        starts_on,expires_on,duration_months,terms,status,created_by,updated_by,
        policy_id,source_receipt_allocation_id,supplier_warranty_id,serial_number,lot_number,quantity_covered
      ) VALUES (
        v_unallocated.company_id,v_unallocated.scope_key,v_unallocated.work_order_id,
        v_unallocated.work_order_part_id,v_unallocated.part_id,v_unallocated.coverage_type,
        v_unallocated.starts_on,v_unallocated.expires_on,v_unallocated.duration_months,
        v_unallocated.terms,v_unallocated.status,v_unallocated.created_by,NEW.created_by,
        v_unallocated.policy_id,NEW.id,NEW.supplier_warranty_id,NEW.serial_number,NEW.lot_number,NEW.quantity_allocated
      ) ON CONFLICT DO NOTHING;
    END IF;
    RETURN NEW;
  END IF;

  -- Late consumption can only receive an automatic warranty when the rule
  -- had already been approved by the recorded OS completion timestamp.
  IF v_order.completed_at IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_policy FROM public.dbs_control_customer_warranty_policies
   WHERE scope_key=NEW.scope_key AND coverage_type='part'
     AND part_id=v_part.part_id AND status='active'
     AND approved_at<=v_order.completed_at
   ORDER BY approved_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.dbs_control_customer_warranties
     WHERE work_order_id=v_order.id AND work_order_part_id=v_part.id
       AND policy_id IS NULL AND status IN ('active','suspended')
  ) THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_scope
    FROM public.dbs_control_inventory_scope_for_work_order(v_order.id);
  IF NOT FOUND OR v_scope.scope_key IS DISTINCT FROM NEW.scope_key THEN
    RAISE EXCEPTION 'DBS_CUSTOMER_WARRANTY_SCOPE_MISMATCH' USING errcode='42501';
  END IF;

  v_start := v_order.completed_at::date;
  INSERT INTO public.dbs_control_customer_warranties(
    company_id,scope_key,work_order_id,work_order_part_id,part_id,coverage_type,
    starts_on,expires_on,duration_months,terms,status,created_by,updated_by,
    policy_id,source_receipt_allocation_id,supplier_warranty_id,serial_number,lot_number,quantity_covered
  ) VALUES (
    v_scope.company_id,NEW.scope_key,v_order.id,v_part.id,v_part.part_id,'part',
    v_start,(v_start+make_interval(months=>v_policy.duration_months))::date,
    v_policy.duration_months,v_policy.terms,'active',v_order.created_by_user_id,NEW.created_by,
    v_policy.id,NEW.id,NEW.supplier_warranty_id,NEW.serial_number,NEW.lot_number,NEW.quantity_allocated
  ) ON CONFLICT DO NOTHING;

  SELECT coalesce(sum(quantity_allocated),0) INTO v_total_allocated
    FROM public.dbs_control_work_order_part_receipt_allocations
   WHERE work_order_part_id=v_part.id;
  v_remaining := greatest(0,v_part.quantity-v_total_allocated);
  IF v_remaining>0 AND NOT EXISTS (
    SELECT 1 FROM public.dbs_control_customer_warranties
     WHERE policy_id=v_policy.id AND work_order_id=v_order.id
       AND work_order_part_id=v_part.id AND source_receipt_allocation_id IS NULL
  ) THEN
    INSERT INTO public.dbs_control_customer_warranties(
      company_id,scope_key,work_order_id,work_order_part_id,part_id,coverage_type,
      starts_on,expires_on,duration_months,terms,status,created_by,updated_by,
      policy_id,quantity_covered
    ) VALUES (
      v_scope.company_id,NEW.scope_key,v_order.id,v_part.id,v_part.part_id,'part',
      v_start,(v_start+make_interval(months=>v_policy.duration_months))::date,
      v_policy.duration_months,v_policy.terms,'active',v_order.created_by_user_id,NEW.created_by,
      v_policy.id,v_remaining
    ) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS dbs_control_customer_warranty_history_capture
  ON public.dbs_control_customer_warranties;
CREATE TRIGGER dbs_control_customer_warranty_history_capture
AFTER INSERT OR UPDATE ON public.dbs_control_customer_warranties
FOR EACH ROW EXECUTE FUNCTION public.dbs_control_capture_customer_warranty_history();

DROP TRIGGER IF EXISTS dbs_control_customer_warranty_history_immutable
  ON public.dbs_control_customer_warranty_history;
CREATE TRIGGER dbs_control_customer_warranty_history_immutable
BEFORE UPDATE OR DELETE ON public.dbs_control_customer_warranty_history
FOR EACH ROW EXECUTE FUNCTION public.dbs_control_reject_customer_warranty_history_mutation();

DROP TRIGGER IF EXISTS dbs_control_customer_warranty_policy_history_capture
  ON public.dbs_control_customer_warranty_policies;
CREATE TRIGGER dbs_control_customer_warranty_policy_history_capture
AFTER INSERT OR UPDATE ON public.dbs_control_customer_warranty_policies
FOR EACH ROW EXECUTE FUNCTION public.dbs_control_capture_customer_warranty_policy_history();

DROP TRIGGER IF EXISTS dbs_control_customer_warranty_policy_history_immutable
  ON public.dbs_control_customer_warranty_policy_history;
CREATE TRIGGER dbs_control_customer_warranty_policy_history_immutable
BEFORE UPDATE OR DELETE ON public.dbs_control_customer_warranty_policy_history
FOR EACH ROW EXECUTE FUNCTION public.dbs_control_reject_customer_warranty_policy_history_mutation();

DROP TRIGGER IF EXISTS dbs_control_issue_customer_warranty_after_late_part_consumption
  ON public.dbs_control_work_order_parts;
CREATE TRIGGER dbs_control_issue_customer_warranty_after_late_part_consumption
AFTER INSERT OR UPDATE OF consumption_status ON public.dbs_control_work_order_parts
FOR EACH ROW EXECUTE FUNCTION public.dbs_control_issue_customer_warranty_after_late_part_consumption();

DROP TRIGGER IF EXISTS dbs_control_attach_late_receipt_allocation_to_customer_warranty
  ON public.dbs_control_work_order_part_receipt_allocations;
CREATE TRIGGER dbs_control_attach_late_receipt_allocation_to_customer_warranty
AFTER INSERT ON public.dbs_control_work_order_part_receipt_allocations
FOR EACH ROW EXECUTE FUNCTION public.dbs_control_attach_late_receipt_allocation_to_customer_warranty();

DROP TRIGGER IF EXISTS dbs_control_issue_customer_warranties_on_completion
  ON public.dbs_control_work_orders;
CREATE TRIGGER dbs_control_issue_customer_warranties_on_completion
AFTER UPDATE OF status ON public.dbs_control_work_orders
FOR EACH ROW EXECUTE FUNCTION public.dbs_control_issue_customer_warranties_on_work_order_completion();

REVOKE ALL ON FUNCTION public.dbs_control_capture_customer_warranty_history() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.dbs_control_reject_customer_warranty_history_mutation() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.dbs_control_capture_customer_warranty_policy_history() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.dbs_control_reject_customer_warranty_policy_history_mutation() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.dbs_control_issue_customer_warranties_on_work_order_completion() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.dbs_control_attach_late_receipt_allocation_to_customer_warranty() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.dbs_control_issue_customer_warranty_after_late_part_consumption() FROM PUBLIC,anon,authenticated;

COMMENT ON TABLE public.dbs_control_customer_warranty_policies IS
  'Regras de cobertura DBS aprovadas explicitamente. Sem regra ativa, concluir OS não cria cobertura automaticamente.';
COMMENT ON COLUMN public.dbs_control_customer_warranties.policy_id IS
  'Regra aprovada que originou a cobertura automática; nulo para registros manuais.';
COMMENT ON COLUMN public.dbs_control_customer_warranties.source_receipt_allocation_id IS
  'Lote/série do recebimento vinculado à peça consumida na OS, quando informado.';
COMMENT ON COLUMN public.dbs_control_customer_warranties.quantity_covered IS
  'Quantidade coberta nesta cobertura individual, preservando divisão por lote/série.';

NOTIFY pgrst,'reload schema';
COMMIT;
