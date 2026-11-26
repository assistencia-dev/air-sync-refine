-- Gestão separada das garantias de fornecedor e de atendimento DBS.
-- Os prazos são configurados pelo Financeiro; nenhuma duração legal/comercial é presumida.
BEGIN;

-- Garante os identificadores antes de instalar os gatilhos de garantia.
ALTER TABLE public.dbs_control_purchase_receipt_items
  ADD COLUMN IF NOT EXISTS serial_number text,
  ADD COLUMN IF NOT EXISTS lot_number text;

CREATE TABLE IF NOT EXISTS public.dbs_control_part_warranty_defaults (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_key text NOT NULL,
  part_id uuid NOT NULL REFERENCES public.dbs_control_parts(id) ON DELETE RESTRICT,
  supplier_id uuid REFERENCES public.dbs_control_suppliers(id) ON DELETE RESTRICT,
  supplier_warranty_months integer CHECK (supplier_warranty_months BETWEEN 0 AND 1200),
  supplier_start_rule text NOT NULL DEFAULT 'receipt_date'
    CHECK (supplier_start_rule IN ('invoice_date','receipt_date')),
  supplier_terms text,
  customer_warranty_months integer CHECK (customer_warranty_months BETWEEN 0 AND 1200),
  customer_start_rule text NOT NULL DEFAULT 'work_order_completion'
    CHECK (customer_start_rule IN ('work_order_completion')),
  customer_terms text,
  version bigint NOT NULL DEFAULT 1 CHECK (version>0),
  updated_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(scope_key,part_id)
);

CREATE TABLE IF NOT EXISTS public.dbs_control_supplier_warranties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_key text NOT NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE RESTRICT,
  purchase_id uuid NOT NULL REFERENCES public.dbs_control_purchases(id) ON DELETE RESTRICT,
  purchase_item_id uuid NOT NULL REFERENCES public.dbs_control_purchase_items(id) ON DELETE RESTRICT,
  receipt_id uuid NOT NULL REFERENCES public.dbs_control_purchase_receipts(id) ON DELETE RESTRICT,
  receipt_item_id uuid NOT NULL REFERENCES public.dbs_control_purchase_receipt_items(id) ON DELETE RESTRICT,
  part_id uuid NOT NULL REFERENCES public.dbs_control_parts(id) ON DELETE RESTRICT,
  supplier_id uuid REFERENCES public.dbs_control_suppliers(id) ON DELETE RESTRICT,
  supplier_name_snapshot text,
  serial_number text,
  lot_number text,
  quantity_covered numeric(18,4) NOT NULL CHECK (quantity_covered>0),
  start_rule text NOT NULL CHECK (start_rule IN ('invoice_date','receipt_date','custom')),
  start_date date NOT NULL,
  end_date date NOT NULL,
  terms text,
  invoice_reference text,
  certificate_reference text,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','claim_open','expired','void','replaced')),
  replacement_of uuid REFERENCES public.dbs_control_supplier_warranties(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date>=start_date),
  CHECK (serial_number IS NULL OR char_length(trim(serial_number)) BETWEEN 1 AND 180),
  CHECK (lot_number IS NULL OR char_length(trim(lot_number)) BETWEEN 1 AND 180)
);

CREATE TABLE IF NOT EXISTS public.dbs_control_customer_warranties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_key text NOT NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE RESTRICT,
  work_order_id uuid NOT NULL REFERENCES public.dbs_control_work_orders(id) ON DELETE RESTRICT,
  source_reservation_id uuid UNIQUE REFERENCES public.dbs_control_operational_reservations(id) ON DELETE RESTRICT,
  part_id uuid NOT NULL REFERENCES public.dbs_control_parts(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL REFERENCES public.dbs_control_clients(id) ON DELETE RESTRICT,
  supplier_warranty_id uuid REFERENCES public.dbs_control_supplier_warranties(id) ON DELETE RESTRICT,
  serial_number text,
  lot_number text,
  quantity_covered numeric(18,4) NOT NULL CHECK (quantity_covered>0),
  start_date date NOT NULL,
  end_date date NOT NULL,
  terms text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','claim_open','expired','void','replaced')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date>=start_date)
);

CREATE TABLE IF NOT EXISTS public.dbs_control_gas_cylinder_warranties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_key text NOT NULL,
  cylinder_id uuid NOT NULL REFERENCES public.dbs_control_gas_cylinders(id) ON DELETE RESTRICT,
  supplier_id uuid REFERENCES public.dbs_control_suppliers(id) ON DELETE RESTRICT,
  supplier_name_snapshot text,
  serial_number text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  terms text,
  invoice_reference text,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','claim_open','expired','void','replaced')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date>=start_date)
);

CREATE TABLE IF NOT EXISTS public.dbs_control_warranty_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_key text NOT NULL,
  claim_number text UNIQUE,
  supplier_warranty_id uuid REFERENCES public.dbs_control_supplier_warranties(id) ON DELETE RESTRICT,
  customer_warranty_id uuid REFERENCES public.dbs_control_customer_warranties(id) ON DELETE RESTRICT,
  gas_cylinder_warranty_id uuid REFERENCES public.dbs_control_gas_cylinder_warranties(id) ON DELETE RESTRICT,
  opened_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  assigned_to uuid REFERENCES public.users(id) ON DELETE SET NULL,
  issue_description text NOT NULL CHECK (char_length(trim(issue_description)) BETWEEN 5 AND 3000),
  supplier_protocol text,
  requested_resolution text,
  resolution text,
  resolution_reference text,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'opened'
    CHECK (status IN ('opened','in_review','approved','rejected','replacement','credit','closed')),
  replacement_supplier_warranty_id uuid REFERENCES public.dbs_control_supplier_warranties(id) ON DELETE RESTRICT,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(supplier_warranty_id,customer_warranty_id,gas_cylinder_warranty_id)=1),
  CHECK ((status='closed' AND closed_at IS NOT NULL) OR status<>'closed')
);

ALTER TABLE public.dbs_control_part_warranty_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dbs_control_supplier_warranties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dbs_control_customer_warranties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dbs_control_gas_cylinder_warranties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dbs_control_warranty_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dbs_control_part_warranty_defaults,public.dbs_control_supplier_warranties,
  public.dbs_control_customer_warranties,public.dbs_control_gas_cylinder_warranties,
  public.dbs_control_warranty_claims FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.dbs_control_part_warranty_defaults,public.dbs_control_supplier_warranties,
  public.dbs_control_customer_warranties,public.dbs_control_gas_cylinder_warranties,
  public.dbs_control_warranty_claims TO service_role;

CREATE INDEX IF NOT EXISTS dbs_control_supplier_warranties_part_expiry_idx
  ON public.dbs_control_supplier_warranties(scope_key,part_id,end_date)
  WHERE status IN ('active','claim_open');
CREATE INDEX IF NOT EXISTS dbs_control_supplier_warranties_serial_idx
  ON public.dbs_control_supplier_warranties(scope_key,serial_number)
  WHERE serial_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS dbs_control_customer_warranties_client_expiry_idx
  ON public.dbs_control_customer_warranties(scope_key,client_id,end_date)
  WHERE status IN ('active','claim_open');
CREATE INDEX IF NOT EXISTS dbs_control_customer_warranties_os_idx
  ON public.dbs_control_customer_warranties(work_order_id,created_at DESC);
CREATE INDEX IF NOT EXISTS dbs_control_gas_cylinder_warranties_serial_idx
  ON public.dbs_control_gas_cylinder_warranties(scope_key,serial_number);
CREATE INDEX IF NOT EXISTS dbs_control_warranty_claims_queue_idx
  ON public.dbs_control_warranty_claims(scope_key,status,opened_at DESC);

CREATE TABLE IF NOT EXISTS public.dbs_control_warranty_claim_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_key text NOT NULL,
  claim_id uuid NOT NULL REFERENCES public.dbs_control_warranty_claims(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE RESTRICT,
  previous_status text,
  new_status text NOT NULL,
  note text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.dbs_control_warranty_claim_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dbs_control_warranty_claim_history FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.dbs_control_warranty_claim_history TO service_role;
CREATE INDEX IF NOT EXISTS dbs_control_warranty_claim_history_claim_idx
  ON public.dbs_control_warranty_claim_history(scope_key,claim_id,created_at DESC);

CREATE OR REPLACE FUNCTION public.dbs_control_set_warranty_claim_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $function$
BEGIN
  IF NEW.claim_number IS NULL OR btrim(NEW.claim_number)='' THEN
    NEW.claim_number:='GAR-'||upper(substr(replace(NEW.id::text,'-',''),1,12));
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_dbs_control_set_warranty_claim_number ON public.dbs_control_warranty_claims;
CREATE TRIGGER trg_dbs_control_set_warranty_claim_number
BEFORE INSERT ON public.dbs_control_warranty_claims
FOR EACH ROW EXECUTE FUNCTION public.dbs_control_set_warranty_claim_number();
REVOKE ALL ON FUNCTION public.dbs_control_set_warranty_claim_number() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.dbs_control_sync_warranty_claim_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $function$
DECLARE
  v_restore text;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.supplier_warranty_id IS NOT NULL THEN
      UPDATE public.dbs_control_supplier_warranties SET status='claim_open',updated_at=now()
       WHERE id=NEW.supplier_warranty_id AND status='active';
    ELSIF NEW.customer_warranty_id IS NOT NULL THEN
      UPDATE public.dbs_control_customer_warranties SET status='claim_open',updated_at=now()
       WHERE id=NEW.customer_warranty_id AND status='active';
    ELSE
      UPDATE public.dbs_control_gas_cylinder_warranties SET status='claim_open',updated_at=now()
       WHERE id=NEW.gas_cylinder_warranty_id AND status='active';
    END IF;
    INSERT INTO public.dbs_control_warranty_claim_history(scope_key,claim_id,actor_user_id,new_status,note)
    VALUES(NEW.scope_key,NEW.id,NEW.opened_by,'opened',NEW.issue_description);
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.dbs_control_warranty_claim_history(
      scope_key,claim_id,actor_user_id,previous_status,new_status,note,metadata
    ) VALUES(
      NEW.scope_key,NEW.id,NEW.assigned_to,OLD.status,NEW.status,NEW.resolution,
      jsonb_build_object('resolution_reference',NEW.resolution_reference,
        'replacement_supplier_warranty_id',NEW.replacement_supplier_warranty_id)
    );
    IF OLD.supplier_warranty_id IS NOT NULL THEN
      SELECT CASE WHEN end_date>=current_date THEN 'active' ELSE 'expired' END
        INTO v_restore FROM public.dbs_control_supplier_warranties WHERE id=OLD.supplier_warranty_id;
      UPDATE public.dbs_control_supplier_warranties SET status=v_restore,updated_at=now()
       WHERE id=OLD.supplier_warranty_id AND status='claim_open' AND NEW.status IN ('rejected','closed','credit');
    ELSIF OLD.customer_warranty_id IS NOT NULL THEN
      SELECT CASE WHEN end_date>=current_date THEN 'active' ELSE 'expired' END
        INTO v_restore FROM public.dbs_control_customer_warranties WHERE id=OLD.customer_warranty_id;
      UPDATE public.dbs_control_customer_warranties SET status=v_restore,updated_at=now()
       WHERE id=OLD.customer_warranty_id AND status='claim_open' AND NEW.status IN ('rejected','closed','credit');
    ELSIF OLD.gas_cylinder_warranty_id IS NOT NULL THEN
      SELECT CASE WHEN end_date>=current_date THEN 'active' ELSE 'expired' END
        INTO v_restore FROM public.dbs_control_gas_cylinder_warranties WHERE id=OLD.gas_cylinder_warranty_id;
      UPDATE public.dbs_control_gas_cylinder_warranties SET status=v_restore,updated_at=now()
       WHERE id=OLD.gas_cylinder_warranty_id AND status='claim_open' AND NEW.status IN ('rejected','closed','credit');
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_dbs_control_sync_warranty_claim_status ON public.dbs_control_warranty_claims;
CREATE TRIGGER trg_dbs_control_sync_warranty_claim_status
AFTER INSERT OR UPDATE ON public.dbs_control_warranty_claims
FOR EACH ROW EXECUTE FUNCTION public.dbs_control_sync_warranty_claim_status();
REVOKE ALL ON FUNCTION public.dbs_control_sync_warranty_claim_status() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.dbs_control_update_warranty_claim(
  p_claim_id uuid,p_actor_user_id uuid,p_status text,p_resolution text,
  p_resolution_reference text DEFAULT NULL,p_replacement_supplier_warranty_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $function$
DECLARE
  v_user public.users%rowtype;
  v_claim public.dbs_control_warranty_claims%rowtype;
  v_scope_key text;
  v_source_part_id uuid;
  v_replacement_part_id uuid;
BEGIN
  IF p_actor_user_id IS NULL OR NOT (
    public.dbs_control_is_admin_actor(p_actor_user_id)
    OR public.dbs_control_is_finance_actor(p_actor_user_id)
  ) THEN
    RAISE EXCEPTION 'DBS_WARRANTY_CLAIM_UPDATE_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF p_status NOT IN ('in_review','approved','rejected','replacement','credit','closed')
     OR p_resolution IS NULL OR char_length(trim(p_resolution))<5
     OR char_length(p_resolution)>3000 THEN
    RAISE EXCEPTION 'DBS_WARRANTY_CLAIM_UPDATE_INPUT_INVALID' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_user FROM public.users WHERE id=p_actor_user_id AND status='ativo';
  IF NOT FOUND THEN RAISE EXCEPTION 'DBS_WARRANTY_CLAIM_ACTOR_INVALID' USING ERRCODE='42501'; END IF;
  v_scope_key:=CASE WHEN v_user.company_id IS NULL THEN 'user:'||v_user.id::text ELSE 'company:'||v_user.company_id::text END;
  SELECT * INTO v_claim FROM public.dbs_control_warranty_claims
   WHERE id=p_claim_id AND scope_key=v_scope_key FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DBS_WARRANTY_CLAIM_NOT_FOUND' USING ERRCODE='23503'; END IF;
  IF v_claim.status IN ('closed','rejected','replacement','credit') THEN
    RAISE EXCEPTION 'DBS_WARRANTY_CLAIM_ALREADY_RESOLVED' USING ERRCODE='23514';
  END IF;

  IF p_replacement_supplier_warranty_id IS NOT NULL THEN
    IF v_claim.supplier_warranty_id IS NULL OR p_status<>'replacement' THEN
      RAISE EXCEPTION 'DBS_WARRANTY_REPLACEMENT_NOT_ALLOWED' USING ERRCODE='23514';
    END IF;
    SELECT part_id INTO v_source_part_id FROM public.dbs_control_supplier_warranties
     WHERE id=v_claim.supplier_warranty_id AND scope_key=v_scope_key;
    SELECT part_id INTO v_replacement_part_id FROM public.dbs_control_supplier_warranties
     WHERE id=p_replacement_supplier_warranty_id AND scope_key=v_scope_key
       AND status='active' AND replacement_of IS NULL;
    IF v_source_part_id IS NULL OR v_replacement_part_id IS DISTINCT FROM v_source_part_id THEN
      RAISE EXCEPTION 'DBS_WARRANTY_REPLACEMENT_PART_MISMATCH' USING ERRCODE='23514';
    END IF;
    UPDATE public.dbs_control_supplier_warranties
       SET replacement_of=v_claim.supplier_warranty_id,updated_at=now()
     WHERE id=p_replacement_supplier_warranty_id;
    UPDATE public.dbs_control_supplier_warranties
       SET status='replaced',updated_at=now()
     WHERE id=v_claim.supplier_warranty_id;
  ELSIF p_status='replacement' AND v_claim.supplier_warranty_id IS NOT NULL THEN
    RAISE EXCEPTION 'DBS_WARRANTY_REPLACEMENT_RECORD_REQUIRED' USING ERRCODE='23514';
  END IF;

  UPDATE public.dbs_control_warranty_claims
     SET status=p_status,resolution=trim(p_resolution),
         resolution_reference=nullif(trim(coalesce(p_resolution_reference,'')),''),
         replacement_supplier_warranty_id=p_replacement_supplier_warranty_id,
         assigned_to=p_actor_user_id,
         closed_at=CASE WHEN p_status IN ('closed','rejected','replacement','credit') THEN now() ELSE NULL END,
         updated_at=now()
   WHERE id=p_claim_id;

  RETURN jsonb_build_object('ok',true,'claim_id',p_claim_id,'status',p_status,
    'replacement_supplier_warranty_id',p_replacement_supplier_warranty_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.dbs_control_update_warranty_claim(uuid,uuid,text,text,text,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dbs_control_update_warranty_claim(uuid,uuid,text,text,text,uuid)
  TO service_role;



CREATE OR REPLACE FUNCTION public.dbs_control_create_supplier_warranty_on_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_purchase record;
  v_default public.dbs_control_part_warranty_defaults%rowtype;
  v_start date;
BEGIN
  SELECT p.id,p.company_id,p.scope_key,p.supplier_id,p.supplier_name,p.purchase_date,p.document_number,
         r.received_at::date AS receipt_date
    INTO v_purchase
    FROM public.dbs_control_purchase_receipts r
    JOIN public.dbs_control_purchases p ON p.id=r.purchase_id
   WHERE r.id=NEW.receipt_id;

  SELECT * INTO v_default
    FROM public.dbs_control_part_warranty_defaults d
   WHERE d.scope_key=v_purchase.scope_key
     AND d.part_id=NEW.part_id
     AND (d.supplier_id IS NULL OR d.supplier_id=v_purchase.supplier_id);

  IF NOT FOUND OR coalesce(v_default.supplier_warranty_months,0)<=0 THEN RETURN NEW; END IF;
  v_start := CASE WHEN v_default.supplier_start_rule='invoice_date'
    THEN v_purchase.purchase_date::date ELSE v_purchase.receipt_date END;

  INSERT INTO public.dbs_control_supplier_warranties(
    scope_key,company_id,purchase_id,purchase_item_id,receipt_id,receipt_item_id,
    part_id,supplier_id,supplier_name_snapshot,serial_number,lot_number,quantity_covered,start_rule,
    start_date,end_date,terms,invoice_reference,status
  ) VALUES (
    v_purchase.scope_key,v_purchase.company_id,v_purchase.id,NEW.purchase_item_id,
    NEW.receipt_id,NEW.id,NEW.part_id,v_purchase.supplier_id,v_purchase.supplier_name,
    NEW.serial_number,NEW.lot_number,NEW.quantity_received,v_default.supplier_start_rule,v_start,
    (v_start + make_interval(months=>v_default.supplier_warranty_months))::date,
    v_default.supplier_terms,v_purchase.document_number,'active'
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_dbs_control_supplier_warranty_on_receipt
  ON public.dbs_control_purchase_receipt_items;
CREATE TRIGGER trg_dbs_control_supplier_warranty_on_receipt
AFTER INSERT ON public.dbs_control_purchase_receipt_items
FOR EACH ROW EXECUTE FUNCTION public.dbs_control_create_supplier_warranty_on_receipt();

CREATE OR REPLACE FUNCTION public.dbs_control_create_customer_warranty_on_consumption()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_order record;
  v_default public.dbs_control_part_warranty_defaults%rowtype;
  v_start date;
BEGIN
  IF NEW.status<>'consumed' OR OLD.status='consumed' THEN RETURN NEW; END IF;

  SELECT w.id,w.client_id,w.completed_at,w.status
    INTO v_order FROM public.dbs_control_work_orders w
   WHERE w.id=NEW.work_order_id AND w.deleted_at IS NULL;
  IF NOT FOUND OR v_order.client_id IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO v_default FROM public.dbs_control_part_warranty_defaults d
   WHERE d.scope_key=NEW.scope_key AND d.part_id=NEW.part_id;
  IF NOT FOUND OR coalesce(v_default.customer_warranty_months,0)<=0 THEN RETURN NEW; END IF;

  v_start := coalesce(v_order.completed_at::date,current_date);
  INSERT INTO public.dbs_control_customer_warranties(
    scope_key,company_id,work_order_id,source_reservation_id,part_id,client_id,
    quantity_covered,start_date,end_date,terms,status
  ) VALUES (
    NEW.scope_key,NEW.company_id,NEW.work_order_id,NEW.id,NEW.part_id,v_order.client_id,
    NEW.quantity,v_start,
    (v_start + make_interval(months=>v_default.customer_warranty_months))::date,
    v_default.customer_terms,'active'
  ) ON CONFLICT(source_reservation_id) DO NOTHING;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_dbs_control_customer_warranty_on_consumption
  ON public.dbs_control_operational_reservations;
CREATE TRIGGER trg_dbs_control_customer_warranty_on_consumption
AFTER UPDATE OF status ON public.dbs_control_operational_reservations
FOR EACH ROW EXECUTE FUNCTION public.dbs_control_create_customer_warranty_on_consumption();

REVOKE ALL ON FUNCTION public.dbs_control_create_supplier_warranty_on_receipt()
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.dbs_control_create_customer_warranty_on_consumption()
  FROM PUBLIC,anon,authenticated;

COMMIT;
