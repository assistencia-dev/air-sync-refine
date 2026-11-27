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
BEGIN
  IF lower(btrim(coalesce(NEW.status,''))) NOT IN ('concluida','concluída','concluido','concluído','completed','complete')
     OR lower(btrim(coalesce(OLD.status,''))) IN ('concluida','concluída','concluido','concluído','completed','complete') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_scope
    FROM public.dbs_control_inventory_scope_for_work_order(NEW.id);
  IF NOT FOUND OR v_scope.scope_key IS NULL THEN
    RETURN NEW;
  END IF;
  v_start := coalesce(NEW.completed_at::date,current_date);

  -- Cobertura por peça: apenas itens já marcados como efetivamente consumidos.
  FOR v_part IN
    SELECT op.id,op.part_id,op.quantity,p.id AS policy_id,p.company_id AS policy_company_id,
           p.scope_key,p.duration_months,p.terms,p.approved_by
      FROM public.dbs_control_work_order_parts op
      JOIN public.dbs_control_customer_warranty_policies p
        ON p.scope_key=v_scope.scope_key AND p.coverage_type='part'
       AND p.part_id=op.part_id AND p.status='active'
     WHERE op.work_order_id=NEW.id AND op.consumption_status='consumed'
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
        v_part.duration_months,v_part.terms,'active',NEW.created_by_user_id,NEW.created_by_user_id,
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
        v_part.duration_months,v_part.terms,'active',NEW.created_by_user_id,NEW.created_by_user_id,
        v_part.policy_id,v_unallocated
      ) ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;

  -- Cobertura de serviço ou do atendimento. Só é emitida quando há regra ativa.
  FOR v_policy IN
    SELECT * FROM public.dbs_control_customer_warranty_policies
     WHERE scope_key=v_scope.scope_key AND status='active'
       AND (
         (coverage_type='service' AND service_id=NEW.service_id)
         OR coverage_type='work_order'
       )
  LOOP
    INSERT INTO public.dbs_control_customer_warranties(
      company_id,scope_key,work_order_id,coverage_type,starts_on,expires_on,
      duration_months,terms,status,created_by,updated_by,policy_id
    ) VALUES (
      v_scope.company_id,v_scope.scope_key,NEW.id,v_policy.coverage_type,v_start,
      (v_start+make_interval(months=>v_policy.duration_months))::date,
      v_policy.duration_months,v_policy.terms,'active',NEW.created_by_user_id,
      NEW.created_by_user_id,v_policy.id
    ) ON CONFLICT DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$function$;

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

DROP TRIGGER IF EXISTS dbs_control_issue_customer_warranties_on_completion
  ON public.dbs_control_work_orders;
CREATE TRIGGER dbs_control_issue_customer_warranties_on_completion
AFTER UPDATE OF status ON public.dbs_control_work_orders
FOR EACH ROW EXECUTE FUNCTION public.dbs_control_issue_customer_warranties_on_work_order_completion();

REVOKE ALL ON FUNCTION public.dbs_control_capture_customer_warranty_policy_history() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.dbs_control_reject_customer_warranty_policy_history_mutation() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.dbs_control_issue_customer_warranties_on_work_order_completion() FROM PUBLIC,anon,authenticated;

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
