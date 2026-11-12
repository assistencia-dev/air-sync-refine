BEGIN;

-- Link cylinders and gas usage to the same relational part catalog used by
-- purchases, quotes and stock. Existing cylinders/usages remain untouched
-- until an administrator explicitly links a cylinder to its catalog item.
ALTER TABLE public.dbs_control_gas_cylinders
  ADD COLUMN IF NOT EXISTS part_id uuid;

ALTER TABLE public.dbs_control_gas_usage
  ADD COLUMN IF NOT EXISTS part_id uuid,
  ADD COLUMN IF NOT EXISTS unit_cost_cents_per_kg integer,
  ADD COLUMN IF NOT EXISTS total_cost_cents bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS work_order_part_id uuid,
  ADD COLUMN IF NOT EXISTS ledger_entry_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='dbs_control_gas_cylinders_part_id_fkey'
  ) THEN
    ALTER TABLE public.dbs_control_gas_cylinders
      ADD CONSTRAINT dbs_control_gas_cylinders_part_id_fkey
      FOREIGN KEY(part_id) REFERENCES public.dbs_control_parts(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='dbs_control_gas_usage_part_id_fkey'
  ) THEN
    ALTER TABLE public.dbs_control_gas_usage
      ADD CONSTRAINT dbs_control_gas_usage_part_id_fkey
      FOREIGN KEY(part_id) REFERENCES public.dbs_control_parts(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='dbs_control_gas_usage_work_order_part_id_fkey'
  ) THEN
    ALTER TABLE public.dbs_control_gas_usage
      ADD CONSTRAINT dbs_control_gas_usage_work_order_part_id_fkey
      FOREIGN KEY(work_order_part_id) REFERENCES public.dbs_control_work_order_parts(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='dbs_control_gas_usage_ledger_entry_id_fkey'
  ) THEN
    ALTER TABLE public.dbs_control_gas_usage
      ADD CONSTRAINT dbs_control_gas_usage_ledger_entry_id_fkey
      FOREIGN KEY(ledger_entry_id) REFERENCES public.treasury_ledger_entries(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='dbs_control_gas_usage_unit_cost_nonnegative'
  ) THEN
    ALTER TABLE public.dbs_control_gas_usage
      ADD CONSTRAINT dbs_control_gas_usage_unit_cost_nonnegative
      CHECK (unit_cost_cents_per_kg IS NULL OR unit_cost_cents_per_kg >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='dbs_control_gas_usage_total_cost_nonnegative'
  ) THEN
    ALTER TABLE public.dbs_control_gas_usage
      ADD CONSTRAINT dbs_control_gas_usage_total_cost_nonnegative
      CHECK (total_cost_cents >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS dbs_control_gas_cylinders_part_id_idx
  ON public.dbs_control_gas_cylinders(part_id)
  WHERE part_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS dbs_control_gas_usage_os_cost_idx
  ON public.dbs_control_gas_usage(work_order_id,created_at DESC,part_id);

-- A quote may only expose a catalog item after supplier and base unit have
-- been attached. Legacy rows are preserved, but are not sellable/quotable
-- until an administrator completes those relations.
CREATE OR REPLACE VIEW public.dbs_control_sales_catalog AS
SELECT p.id AS part_id,
       p.sku,
       p.name,
       p.description,
       p.measure_unit_id,
       p.sale_cents,
       p.status
  FROM public.dbs_control_parts p
  JOIN public.dbs_control_suppliers s
    ON s.id=p.supplier_id AND s.status='active'
  JOIN public.dbs_control_measure_units u
    ON u.id=p.measure_unit_id AND u.status='active'
 WHERE p.status='ativo'
   AND p.sale_cents IS NOT NULL
   AND p.sale_cents >= 0
   AND p.supplier_id IS NOT NULL
   AND p.measure_unit_id IS NOT NULL;

-- New weighted cylinder assignment accepts a catalog UUID instead of free
-- text refrigerant. Cost is always sourced from the current weighted-average
-- cost of the KG catalog item.
CREATE OR REPLACE FUNCTION public.dbs_control_assign_gas_cylinder_weighted(
  p_serial_number text,
  p_part_id uuid,
  p_employee_id uuid,
  p_total_charges integer,
  p_vehicle_label text,
  p_tare_weight_kg numeric,
  p_initial_gross_weight_kg numeric
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_actor uuid:=auth.uid();
  v_employee_user public.users%rowtype;
  v_part record;
  v_scope text;
  v_result jsonb;
  v_cylinder_id uuid;
BEGIN
  IF v_actor IS NULL OR NOT public.dbs_control_is_admin_actor(v_actor) THEN
    RAISE EXCEPTION 'DBS_GAS_ASSIGN_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF p_part_id IS NULL OR p_tare_weight_kg IS NULL OR p_initial_gross_weight_kg IS NULL
     OR p_tare_weight_kg < 0 OR p_initial_gross_weight_kg <= p_tare_weight_kg
     OR p_total_charges IS NULL OR p_total_charges <= 0 THEN
    RAISE EXCEPTION 'DBS_GAS_ASSIGN_INPUT_INVALID' USING ERRCODE='22023';
  END IF;

  SELECT u.* INTO v_employee_user
    FROM public.rh_employee_access ea
    JOIN public.users u ON u.id=ea.user_id
   WHERE ea.employee_id=p_employee_id
     AND ea.access_enabled=true
     AND u.status='ativo'
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DBS_GAS_EMPLOYEE_ACCESS_MISSING' USING ERRCODE='23503';
  END IF;
  v_scope:=CASE WHEN v_employee_user.company_id IS NOT NULL
    THEN 'company:'||v_employee_user.company_id::text
    ELSE 'user:'||v_employee_user.id::text END;

  SELECT p.id,p.name,p.cost_cents
    INTO v_part
    FROM public.dbs_control_parts p
    JOIN public.dbs_control_suppliers s
      ON s.id=p.supplier_id AND s.scope_key=v_scope AND s.status='active'
    JOIN public.dbs_control_measure_units u
      ON u.id=p.measure_unit_id AND u.scope_key=v_scope AND u.status='active'
   WHERE p.id=p_part_id
     AND p.status='ativo'
     AND upper(u.code)='KG';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DBS_GAS_CATALOG_PART_INVALID: selecione material ativo do catálogo em KG no mesmo escopo.' USING ERRCODE='23503';
  END IF;
  IF coalesce(v_part.cost_cents,0) <= 0 THEN
    RAISE EXCEPTION 'DBS_GAS_COST_REQUIRED: informe o custo médio por KG no catálogo.' USING ERRCODE='23514';
  END IF;

  v_result:=public.dbs_control_assign_gas_cylinder(
    p_serial_number,v_part.name,p_employee_id,p_total_charges,p_vehicle_label
  );
  v_cylinder_id:=nullif(v_result->>'cylinder_id','')::uuid;
  UPDATE public.dbs_control_gas_cylinders
     SET part_id=p_part_id,
         refrigerant_type=v_part.name,
         tare_weight_kg=p_tare_weight_kg,
         initial_gross_weight_kg=p_initial_gross_weight_kg,
         current_gross_weight_kg=p_initial_gross_weight_kg,
         updated_at=now()
   WHERE id=v_cylinder_id;

  RETURN v_result||jsonb_build_object(
    'part_id',p_part_id,
    'refrigerant_type',v_part.name,
    'cost_cents_per_kg',v_part.cost_cents,
    'tare_weight_kg',p_tare_weight_kg,
    'initial_gross_weight_kg',p_initial_gross_weight_kg,
    'current_gross_weight_kg',p_initial_gross_weight_kg
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.dbs_control_list_my_gas_cylinders(p_work_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_actor uuid:=auth.uid();
  v_employee uuid;
  v_os public.dbs_control_work_orders%rowtype;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'DBS_GAS_UNAUTHENTICATED' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_os
    FROM public.dbs_control_work_orders
   WHERE id=p_work_order_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'DBS_OS_NOT_FOUND' USING ERRCODE='23503'; END IF;

  SELECT ea.employee_id INTO v_employee
    FROM public.users u
    JOIN public.rh_employee_access ea ON ea.user_id=u.id AND ea.access_enabled=true
   WHERE u.id=v_actor AND u.status='ativo'
  UNION
  SELECT re.id
    FROM public.users u
    JOIN public.rh_employees re
      ON re.ponto_portal_user_id=u.id
     AND re.dbs_control_access_enabled=true
     AND re.is_active=true
   WHERE u.id=v_actor AND u.status='ativo';

  IF public.dbs_control_is_admin_actor(v_actor) THEN
    v_employee:=v_os.assigned_employee_id;
  END IF;
  IF v_employee IS NULL OR v_os.assigned_employee_id IS DISTINCT FROM v_employee THEN
    RAISE EXCEPTION 'DBS_GAS_FORBIDDEN' USING ERRCODE='42501';
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id',c.id,
      'serial_number',c.serial_number,
      'refrigerant_type',c.refrigerant_type,
      'part_id',c.part_id,
      'part_name',p.name,
      'cost_cents_per_kg',p.cost_cents,
      'total_charges',c.total_charges,
      'used_charges',c.used_charges,
      'remaining_charges',c.remaining_charges,
      'refill_count',c.refill_count,
      'vehicle_label',c.vehicle_label,
      'status',c.status,
      'tare_weight_kg',c.tare_weight_kg,
      'initial_gross_weight_kg',c.initial_gross_weight_kg,
      'current_gross_weight_kg',c.current_gross_weight_kg,
      'remaining_net_weight_kg',CASE
        WHEN c.tare_weight_kg IS NOT NULL AND c.current_gross_weight_kg IS NOT NULL
        THEN greatest(c.current_gross_weight_kg-c.tare_weight_kg,0)
        ELSE NULL END
    ) ORDER BY c.assigned_at DESC)
    FROM public.dbs_control_gas_cylinders c
    LEFT JOIN public.dbs_control_parts p ON p.id=c.part_id
    WHERE c.employee_id=v_employee AND c.status='active'
  ),'[]'::jsonb);
END;
$$;

-- The technician's authenticated session (auth.uid()) remains the actor.
-- A weighted application now records the physical cylinder change, the
-- relational work-order part, operational cost and one immutable Treasury
-- ledger entry in the same database transaction.
CREATE OR REPLACE FUNCTION public.dbs_control_register_gas_usage_weighted(
  p_work_order_id uuid,
  p_cylinder_id uuid,
  p_equipment_reference text,
  p_application_note text,
  p_gross_weight_before_kg numeric,
  p_gross_weight_after_kg numeric,
  p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_actor uuid:=auth.uid();
  v_os public.dbs_control_work_orders%rowtype;
  v_cylinder public.dbs_control_gas_cylinders%rowtype;
  v_existing public.dbs_control_gas_usage%rowtype;
  v_scope record;
  v_part record;
  v_result jsonb;
  v_consumed numeric(12,3);
  v_unit_cost integer;
  v_total_cost bigint;
  v_work_order_part_id uuid;
  v_ledger jsonb;
  v_ledger_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'DBS_GAS_UNAUTHENTICATED' USING ERRCODE='42501';
  END IF;
  IF p_idempotency_key IS NULL OR char_length(btrim(p_idempotency_key)) NOT BETWEEN 8 AND 240 THEN
    RAISE EXCEPTION 'DBS_GAS_IDEMPOTENCY_REQUIRED' USING ERRCODE='22023';
  END IF;
  IF p_gross_weight_before_kg IS NULL OR p_gross_weight_after_kg IS NULL
     OR p_gross_weight_before_kg < 0 OR p_gross_weight_after_kg < 0
     OR p_gross_weight_after_kg >= p_gross_weight_before_kg THEN
    RAISE EXCEPTION 'DBS_GAS_WEIGHT_INVALID' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_existing
    FROM public.dbs_control_gas_usage
   WHERE idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_existing.work_order_id IS DISTINCT FROM p_work_order_id
       OR v_existing.cylinder_id IS DISTINCT FROM p_cylinder_id
       OR abs(coalesce(v_existing.gross_weight_before_kg,-1)-p_gross_weight_before_kg)>0.001
       OR abs(coalesce(v_existing.gross_weight_after_kg,-1)-p_gross_weight_after_kg)>0.001 THEN
      RAISE EXCEPTION 'DBS_GAS_WEIGHT_IDEMPOTENCY_CONFLICT' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object(
      'ok',true,'replayed',true,
      'work_order_id',p_work_order_id,
      'cylinder_id',p_cylinder_id,
      'part_id',v_existing.part_id,
      'gas_consumed_kg',v_existing.gas_consumed_kg,
      'unit_cost_cents_per_kg',v_existing.unit_cost_cents_per_kg,
      'cost_cents',v_existing.total_cost_cents,
      'ledger_entry_id',v_existing.ledger_entry_id,
      'gross_weight_after_kg',v_existing.gross_weight_after_kg,
      'remaining_net_weight_kg',(
        SELECT greatest(p_gross_weight_after_kg-c.tare_weight_kg,0)
          FROM public.dbs_control_gas_cylinders c WHERE c.id=p_cylinder_id
      ),
      'legacy_unvalued',v_existing.part_id IS NULL
    );
  END IF;

  SELECT * INTO v_os
    FROM public.dbs_control_work_orders
   WHERE id=p_work_order_id AND deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DBS_OS_NOT_FOUND' USING ERRCODE='23503'; END IF;
  IF v_os.cost_center_id IS NULL THEN
    RAISE EXCEPTION 'DBS_OS_COST_CENTER_REQUIRED: vincule um centro de custo à OS antes do consumo.' USING ERRCODE='23514';
  END IF;

  SELECT * INTO v_cylinder
    FROM public.dbs_control_gas_cylinders
   WHERE id=p_cylinder_id
   FOR UPDATE;
  IF NOT FOUND OR v_cylinder.tare_weight_kg IS NULL THEN
    RAISE EXCEPTION 'DBS_GAS_TARE_WEIGHT_REQUIRED' USING ERRCODE='23514';
  END IF;
  IF v_cylinder.part_id IS NULL THEN
    RAISE EXCEPTION 'DBS_GAS_CATALOG_LINK_REQUIRED: vincule este cilindro a uma peça relacional em KG no Peças & Estoque.' USING ERRCODE='23514';
  END IF;
  IF p_gross_weight_after_kg < v_cylinder.tare_weight_kg THEN
    RAISE EXCEPTION 'DBS_GAS_WEIGHT_BELOW_TARE' USING ERRCODE='23514';
  END IF;
  IF v_cylinder.current_gross_weight_kg IS NULL THEN
    RAISE EXCEPTION 'DBS_GAS_INITIAL_WEIGHT_REQUIRED' USING ERRCODE='23514';
  END IF;
  IF abs(v_cylinder.current_gross_weight_kg-p_gross_weight_before_kg)>0.05 THEN
    RAISE EXCEPTION 'DBS_GAS_WEIGHT_STALE: atualize a pesagem antes de registrar o consumo.' USING ERRCODE='40001';
  END IF;

  SELECT p.id,p.name,p.cost_cents,p.sale_cents
    INTO v_part
    FROM public.dbs_control_parts p
    JOIN public.dbs_control_suppliers s
      ON s.id=p.supplier_id AND s.scope_key=v_cylinder.scope_key AND s.status='active'
    JOIN public.dbs_control_measure_units u
      ON u.id=p.measure_unit_id AND u.scope_key=v_cylinder.scope_key
     AND u.status='active' AND upper(u.code)='KG'
   WHERE p.id=v_cylinder.part_id AND p.status='ativo';
  IF NOT FOUND OR coalesce(v_part.cost_cents,0)<=0 THEN
    RAISE EXCEPTION 'DBS_GAS_CATALOG_COST_INVALID: informe custo médio por KG no material vinculado.' USING ERRCODE='23514';
  END IF;

  SELECT * INTO v_scope
    FROM public.dbs_control_inventory_scope_for_work_order(p_work_order_id);
  IF NOT FOUND OR v_scope.scope_key IS DISTINCT FROM v_cylinder.scope_key THEN
    RAISE EXCEPTION 'DBS_GAS_SCOPE_MISMATCH' USING ERRCODE='42501';
  END IF;

  v_consumed:=round((p_gross_weight_before_kg-p_gross_weight_after_kg)::numeric,3);
  IF v_consumed<=0 THEN RAISE EXCEPTION 'DBS_GAS_NO_WEIGHT_CHANGE' USING ERRCODE='22023'; END IF;
  v_unit_cost:=v_part.cost_cents;
  v_total_cost:=round(v_consumed*v_unit_cost)::bigint;
  IF v_total_cost<=0 THEN RAISE EXCEPTION 'DBS_GAS_COST_INVALID' USING ERRCODE='23514'; END IF;

  -- This RPC checks auth.uid(), the assigned employee and cylinder custody,
  -- decrements the charge count and inserts the gas-usage row. Cost-center
  -- triggers inherit the OS center on that row.
  v_result:=public.dbs_control_register_gas_usage(
    p_work_order_id,p_cylinder_id,p_equipment_reference,p_application_note,p_idempotency_key
  );
  IF coalesce((v_result->>'replayed')::boolean,false) THEN
    RAISE EXCEPTION 'DBS_GAS_USAGE_REPLAY_REQUIRES_COST_RECORD' USING ERRCODE='23505';
  END IF;

  UPDATE public.dbs_control_gas_cylinders
     SET current_gross_weight_kg=p_gross_weight_after_kg,updated_at=now()
   WHERE id=p_cylinder_id;

  INSERT INTO public.dbs_control_work_order_parts(
    work_order_id,part_id,quantity,unit_cents,cost_cents,consumption_status,idempotency_key
  ) VALUES (
    p_work_order_id,v_part.id,v_consumed,coalesce(v_part.sale_cents,0),
    v_unit_cost,'consumed',left('gas:'||p_idempotency_key,240)
  ) RETURNING id INTO v_work_order_part_id;

  v_ledger:=public.post_treasury_ledger_entry(
    v_scope.scope_key,v_scope.company_id,current_date,current_date,
    'work_order_gas_cogs',
    'Consumo de gás refrigerante · OS '||coalesce(v_os.protocol,p_work_order_id::text),
    left(p_idempotency_key,150)||':ledger',
    'work-order-gas:'||p_idempotency_key,
    v_actor,'posted',
    jsonb_build_object(
      'source','dbs_control_gas_usage',
      'work_order_id',p_work_order_id,
      'gas_usage_id',(
        SELECT id FROM public.dbs_control_gas_usage WHERE idempotency_key=p_idempotency_key
      ),
      'part_id',v_part.id,
      'quantity_kg',v_consumed,
      'unit_cost_cents_per_kg',v_unit_cost,
      'cost_center_id',v_os.cost_center_id
    ),
    jsonb_build_array(
      jsonb_build_object(
        'account_code','5.1.01','account_name','Custo de gás refrigerante aplicado',
        'account_type','expense','debit_cents',v_total_cost,'credit_cents',0,
        'memo','Gás aplicado na OS · '||v_part.name
      ),
      jsonb_build_object(
        'account_code','1.1.03','account_name','Estoque de gás refrigerante em custódia',
        'account_type','asset','debit_cents',0,'credit_cents',v_total_cost,
        'memo','Baixa de gás por pesagem · '||v_part.name
      )
    )
  );
  v_ledger_id:=nullif(v_ledger->>'entry_id','')::uuid;
  IF v_ledger_id IS NULL THEN
    RAISE EXCEPTION 'DBS_GAS_LEDGER_POST_FAILED' USING ERRCODE='23514';
  END IF;

  INSERT INTO public.dbs_control_work_order_financials(
    work_order_id,company_id,scope_key,parts_cost_cents
  ) VALUES (
    p_work_order_id,v_scope.company_id,v_scope.scope_key,v_total_cost
  ) ON CONFLICT(work_order_id) DO UPDATE
    SET parts_cost_cents=public.dbs_control_work_order_financials.parts_cost_cents+EXCLUDED.parts_cost_cents,
        version=public.dbs_control_work_order_financials.version+1,
        updated_at=now();

  UPDATE public.dbs_control_gas_usage
     SET gross_weight_before_kg=p_gross_weight_before_kg,
         gross_weight_after_kg=p_gross_weight_after_kg,
         gas_consumed_kg=v_consumed,
         part_id=v_part.id,
         unit_cost_cents_per_kg=v_unit_cost,
         total_cost_cents=v_total_cost,
         work_order_part_id=v_work_order_part_id,
         ledger_entry_id=v_ledger_id
   WHERE idempotency_key=p_idempotency_key;

  RETURN v_result||jsonb_build_object(
    'part_id',v_part.id,
    'part_name',v_part.name,
    'gas_consumed_kg',v_consumed,
    'unit_cost_cents_per_kg',v_unit_cost,
    'cost_cents',v_total_cost,
    'work_order_part_id',v_work_order_part_id,
    'ledger_entry_id',v_ledger_id,
    'gross_weight_after_kg',p_gross_weight_after_kg,
    'remaining_net_weight_kg',greatest(p_gross_weight_after_kg-v_cylinder.tare_weight_kg,0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.dbs_control_assign_gas_cylinder_weighted(text,uuid,uuid,integer,text,numeric,numeric) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.dbs_control_register_gas_usage_weighted(uuid,uuid,text,text,numeric,numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.dbs_control_assign_gas_cylinder_weighted(text,uuid,uuid,integer,text,numeric,numeric) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.dbs_control_register_gas_usage_weighted(uuid,uuid,text,text,numeric,numeric,text) TO authenticated,service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
