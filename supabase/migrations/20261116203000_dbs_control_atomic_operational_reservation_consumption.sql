-- Atomic integration of legacy and operational reservations with OS completion.
-- Additive only: preserves the existing delta/reservation flow and makes both stock
-- consumption paths commit or roll back together.
BEGIN;

CREATE TABLE IF NOT EXISTS public.dbs_control_operational_reservation_consumptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_key text NOT NULL,
  work_order_id uuid NOT NULL REFERENCES public.dbs_control_work_orders(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL CHECK(char_length(btrim(idempotency_key)) BETWEEN 8 AND 240),
  total_cost_cents bigint NOT NULL DEFAULT 0 CHECK(total_cost_cents>=0),
  ledger_entry_id uuid REFERENCES public.treasury_ledger_entries(id) ON DELETE RESTRICT,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(work_order_id),
  UNIQUE(scope_key,idempotency_key)
);
CREATE INDEX IF NOT EXISTS dbs_control_operational_reservation_consumptions_scope_idx
  ON public.dbs_control_operational_reservation_consumptions(scope_key,created_at DESC);
ALTER TABLE public.dbs_control_operational_reservation_consumptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dbs_control_operational_reservation_consumptions FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.dbs_control_operational_reservation_consumptions TO service_role;

CREATE OR REPLACE FUNCTION public.dbs_control_operational_stock_consume_work_order(
  p_actor_user_id uuid,p_work_order_id uuid,p_idempotency_key text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $
DECLARE
  v_actor_company uuid;
  v_actor_scope text;
  v_scope record;
  v_key text:=nullif(btrim(p_idempotency_key),'');
  v_r record;
  v_part public.dbs_control_parts%rowtype;
  v_balance public.dbs_control_operational_stock_balances%rowtype;
  v_existing public.dbs_control_operational_reservation_consumptions%rowtype;
  v_work_order_part public.dbs_control_work_order_parts%rowtype;
  v_count integer:=0;
  v_total_quantity numeric(14,3):=0;
  v_total_cost bigint:=0;
  v_ledger jsonb;
  v_ledger_id uuid;
BEGIN
  IF p_actor_user_id IS NULL OR NOT public.dbs_control_is_admin_actor(p_actor_user_id) THEN
    RAISE EXCEPTION 'DBS_OPERATIONAL_CONSUMPTION_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF p_work_order_id IS NULL OR v_key IS NULL OR char_length(v_key) NOT BETWEEN 8 AND 240 THEN
    RAISE EXCEPTION 'DBS_OPERATIONAL_CONSUMPTION_INPUT_INVALID' USING ERRCODE='22023';
  END IF;

  SELECT company_id INTO v_actor_company FROM public.users
    WHERE id=p_actor_user_id AND status='ativo';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DBS_OPERATIONAL_CONSUMPTION_ACTOR_INVALID' USING ERRCODE='42501';
  END IF;
  v_actor_scope:=CASE WHEN v_actor_company IS NULL THEN 'user:'||p_actor_user_id ELSE 'company:'||v_actor_company END;
  SELECT * INTO v_scope FROM public.dbs_control_inventory_scope_for_work_order(p_work_order_id);
  IF NOT FOUND OR v_scope.scope_key IS DISTINCT FROM v_actor_scope
     OR NOT EXISTS(SELECT 1 FROM public.dbs_control_work_orders WHERE id=p_work_order_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'DBS_OPERATIONAL_CONSUMPTION_OS_SCOPE_INVALID' USING ERRCODE='42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('dbs-os-reservations:'||p_work_order_id::text,0));
  SELECT * INTO v_existing FROM public.dbs_control_operational_reservation_consumptions
    WHERE work_order_id=p_work_order_id FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object('ok',true,'replayed',true,'work_order_id',p_work_order_id,
      'consumed_reservations',0,'quantity',0,'cost_cents',v_existing.total_cost_cents,
      'ledger_entry_id',v_existing.ledger_entry_id);
  END IF;

  FOR v_r IN
    SELECT * FROM public.dbs_control_operational_reservations
    WHERE scope_key=v_actor_scope AND work_order_id=p_work_order_id AND status='reserved'
    ORDER BY part_id,stock_id,id FOR UPDATE
  LOOP
    SELECT * INTO v_part FROM public.dbs_control_parts WHERE id=v_r.part_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'DBS_OPERATIONAL_CONSUMPTION_PART_NOT_FOUND' USING ERRCODE='23503';
    END IF;
    SELECT * INTO v_balance FROM public.dbs_control_operational_stock_balances
      WHERE stock_id=v_r.stock_id AND part_id=v_r.part_id FOR UPDATE;
    IF NOT FOUND OR v_balance.quantity<v_r.quantity OR v_balance.reserved_quantity<v_r.quantity THEN
      RAISE EXCEPTION 'DBS_OPERATIONAL_CONSUMPTION_BALANCE_INCONSISTENT' USING ERRCODE='23514';
    END IF;

    UPDATE public.dbs_control_operational_stock_balances
      SET quantity=quantity-v_r.quantity,reserved_quantity=reserved_quantity-v_r.quantity,
          version=version+1,updated_at=now()
      WHERE id=v_balance.id;
    UPDATE public.dbs_control_operational_reservations
      SET status='consumed',consumed_at=now()
      WHERE id=v_r.id;

    SELECT * INTO v_work_order_part FROM public.dbs_control_work_order_parts
      WHERE work_order_id=p_work_order_id AND part_id=v_r.part_id
      ORDER BY created_at,id LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      UPDATE public.dbs_control_work_order_parts
        SET cost_cents=CASE WHEN quantity+v_r.quantity>0
              THEN round((coalesce(cost_cents,v_r.unit_cost_cents)*quantity+v_r.unit_cost_cents*v_r.quantity)
                /(quantity+v_r.quantity))::integer ELSE v_r.unit_cost_cents END,
            quantity=quantity+v_r.quantity,
            consumption_status='consumed',idempotency_key=v_key
        WHERE id=v_work_order_part.id
        RETURNING * INTO v_work_order_part;
    ELSE
      INSERT INTO public.dbs_control_work_order_parts(
        work_order_id,part_id,quantity,unit_cents,cost_cents,consumption_status,idempotency_key
      ) VALUES(p_work_order_id,v_r.part_id,v_r.quantity,coalesce(v_part.sale_cents,0),
        v_r.unit_cost_cents,'consumed',v_key)
      RETURNING * INTO v_work_order_part;
    END IF;

    INSERT INTO public.dbs_control_operational_stock_movements(
      company_id,scope_key,part_id,movement_type,quantity,source_stock_id,work_order_id,
      reference,idempotency_key,created_by,metadata
    ) VALUES(
      v_r.company_id,v_r.scope_key,v_r.part_id,'SAIDA_OS',v_r.quantity,v_r.stock_id,
      p_work_order_id,'Consumo de material na conclusão da OS',
      left(v_key,150)||':op-os:'||v_r.id::text,p_actor_user_id,
      jsonb_build_object('operational_reservation_id',v_r.id,'purpose',v_r.purpose,
        'work_order_part_id',v_work_order_part.id,'unit_cost_cents',v_r.unit_cost_cents)
    );
    v_count:=v_count+1;
    v_total_quantity:=v_total_quantity+v_r.quantity;
    v_total_cost:=v_total_cost+round(v_r.quantity*v_r.unit_cost_cents)::bigint;
  END LOOP;

  IF v_count=0 THEN
    RETURN jsonb_build_object('ok',true,'replayed',false,'work_order_id',p_work_order_id,
      'consumed_reservations',0,'quantity',0,'cost_cents',0,'ledger_entry_id',NULL);
  END IF;

  IF v_total_cost>0 THEN
    v_ledger:=public.post_treasury_ledger_entry(
      v_scope.scope_key,v_scope.company_id,current_date,current_date,
      'work_order_operational_parts_cogs','Consumo de peças do estoque operacional · OS '||p_work_order_id::text,
      left(v_key,150)||':'||md5(v_scope.scope_key||':'||v_key||':operational-cogs'),
      'work-order-operational-cogs:'||p_work_order_id::text||':'||left(v_key,150),
      p_actor_user_id,'posted',
      jsonb_build_object('source','dbs_control_operational_reservations','work_order_id',p_work_order_id),
      jsonb_build_array(
        jsonb_build_object('account_code','5.1.01','account_name','Custo de peças aplicadas','account_type','expense','debit_cents',v_total_cost,'credit_cents',0),
        jsonb_build_object('account_code','1.1.03','account_name','Estoque de peças','account_type','asset','debit_cents',0,'credit_cents',v_total_cost)
      )
    );
    v_ledger_id:=nullif(v_ledger->>'entry_id','')::uuid;
  END IF;

  INSERT INTO public.dbs_control_operational_reservation_consumptions(
    scope_key,work_order_id,idempotency_key,total_cost_cents,ledger_entry_id,created_by
  ) VALUES(v_scope.scope_key,p_work_order_id,v_key,v_total_cost,v_ledger_id,p_actor_user_id);

  INSERT INTO public.dbs_control_work_order_financials(work_order_id,company_id,scope_key,parts_cost_cents)
  VALUES(p_work_order_id,v_scope.company_id,v_scope.scope_key,v_total_cost)
  ON CONFLICT(work_order_id) DO UPDATE SET
    parts_cost_cents=dbs_control_work_order_financials.parts_cost_cents+excluded.parts_cost_cents,
    updated_at=now(),version=dbs_control_work_order_financials.version+1;

  RETURN jsonb_build_object('ok',true,'replayed',false,'work_order_id',p_work_order_id,
    'consumed_reservations',v_count,'quantity',v_total_quantity,'cost_cents',v_total_cost,
    'ledger_entry_id',v_ledger_id);
END $;

REVOKE ALL ON FUNCTION public.dbs_control_operational_stock_consume_work_order(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dbs_control_operational_stock_consume_work_order(uuid,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.dbs_control_apply_work_order_delta_with_reservations(p_payload jsonb)
RETURNS TABLE(ok boolean,status text,work_order_id uuid,protocol text,version bigint,command_id uuid,idempotency_key text,error_code text,error_message text,changed_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_payload jsonb:=p_payload;
  v_order_id uuid;
  v_status text:=lower(btrim(coalesce(p_payload->'patch'->>'status','')));
  v_key text:=nullif(btrim(p_payload->>'idempotency_key'),'');
  v_actor uuid:=nullif(p_payload->>'actor_user_id','')::uuid;
  v_has_reservations boolean:=false;
  v_has_operational_reservations boolean:=false;
  v_delta record;
  v_consumption jsonb;
BEGIN
  IF nullif(p_payload->>'work_order_id','') IS NOT NULL THEN
    v_order_id:=(p_payload->>'work_order_id')::uuid;
  ELSE
    SELECT id INTO v_order_id FROM public.dbs_control_work_orders
      WHERE protocol=nullif(btrim(coalesce(p_payload->>'protocol',p_payload->>'protocolo')),'')
      LIMIT 1;
  END IF;

  IF v_order_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('dbs-os-reservations:'||v_order_id::text,0));
    SELECT EXISTS(SELECT 1 FROM public.dbs_control_work_order_reservations
      WHERE work_order_id=v_order_id AND status='reserved') INTO v_has_reservations;
    SELECT EXISTS(SELECT 1 FROM public.dbs_control_operational_reservations
      WHERE work_order_id=v_order_id AND status='reserved') INTO v_has_operational_reservations;

    IF v_has_reservations THEN
      v_payload:=jsonb_set(v_payload,'{parts}',coalesce((
        SELECT jsonb_agg(jsonb_set(i.value,'{quantity}',to_jsonb(greatest(0,
          coalesce(nullif(i.value->>'quantity','')::numeric,nullif(i.value->>'qtd','')::numeric,0)
          -coalesce(r.reserved_qty,0))),true))
        FROM jsonb_array_elements(coalesce(p_payload->'parts','[]'::jsonb)) i(value)
        LEFT JOIN (
          SELECT reserved.part_id,sum(reserved.quantity) AS reserved_qty
          FROM (
            SELECT part_id,quantity
            FROM public.dbs_control_work_order_reservations
            WHERE work_order_id=v_order_id AND status='reserved'
            UNION ALL
            SELECT part_id,quantity
            FROM public.dbs_control_operational_reservations
            WHERE work_order_id=v_order_id AND status='reserved'
          ) reserved
          GROUP BY reserved.part_id
        ) r ON r.part_id=nullif(coalesce(i.value->>'part_id',i.value->>'id'),'')::uuid
        WHERE coalesce(nullif(i.value->>'quantity','')::numeric,nullif(i.value->>'qtd','')::numeric,0)
          > coalesce(r.reserved_qty,0)
      ),'[]'::jsonb),true);
    END IF;
  END IF;

  SELECT * INTO v_delta FROM public.dbs_control_apply_work_order_delta(v_payload);
  IF v_delta.ok AND (v_has_reservations OR v_has_operational_reservations) AND v_status IN
    ('concluida','concluída','concluido','concluído','concluida com pendencia',
     'concluída com pendência','atendimento com pendencia','atendimento com pendência',
     'completed','complete','finalizada','finalizado') THEN
    IF v_has_reservations THEN
      v_consumption:=public.dbs_control_consume_work_order_reservations_serialized(
        v_delta.work_order_id,v_actor,left(v_key,190)||':reserved-parts-consume');
      IF coalesce((v_consumption->>'ok')::boolean,false) IS NOT TRUE THEN
        RAISE EXCEPTION 'DBS_RESERVATION_CONSUMPTION_FAILED' USING errcode='23514';
      END IF;
    END IF;
    IF v_has_operational_reservations THEN
      v_consumption:=public.dbs_control_operational_stock_consume_work_order(
        v_actor,v_delta.work_order_id,left(v_key,180)||':operational-consume');
      IF coalesce((v_consumption->>'ok')::boolean,false) IS NOT TRUE THEN
        RAISE EXCEPTION 'DBS_OPERATIONAL_RESERVATION_CONSUMPTION_FAILED' USING errcode='23514';
      END IF;
    END IF;
  END IF;

  RETURN QUERY SELECT v_delta.ok,v_delta.status,v_delta.work_order_id,v_delta.protocol,
    v_delta.version,v_delta.command_id,v_delta.idempotency_key,v_delta.error_code,
    v_delta.error_message,v_delta.changed_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.dbs_control_consume_all_work_order_reservations(
  p_work_order_id uuid,p_actor_user_id uuid,p_idempotency_key text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_has_legacy boolean;
  v_has_operational boolean;
  v_legacy jsonb:='{"ok":true,"consumed":0}'::jsonb;
  v_operational jsonb:='{"ok":true,"consumed_reservations":0}'::jsonb;
  v_key text:=nullif(btrim(p_idempotency_key),'');
BEGIN
  IF p_work_order_id IS NULL OR p_actor_user_id IS NULL OR v_key IS NULL
     OR char_length(v_key) NOT BETWEEN 8 AND 240 THEN
    RAISE EXCEPTION 'DBS_RESERVATION_CONSUMPTION_INPUT_INVALID' USING errcode='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('dbs-os-reservations:'||p_work_order_id::text,0));
  SELECT EXISTS(SELECT 1 FROM public.dbs_control_work_order_reservations
    WHERE work_order_id=p_work_order_id AND status='reserved') INTO v_has_legacy;
  SELECT EXISTS(SELECT 1 FROM public.dbs_control_operational_reservations
    WHERE work_order_id=p_work_order_id AND status='reserved') INTO v_has_operational;
  IF v_has_legacy THEN
    v_legacy:=public.dbs_control_consume_work_order_reservations_serialized(
      p_work_order_id,p_actor_user_id,left(v_key,190)||':legacy');
    IF coalesce((v_legacy->>'ok')::boolean,false) IS NOT TRUE THEN
      RAISE EXCEPTION 'DBS_LEGACY_RESERVATION_CONSUMPTION_FAILED' USING errcode='23514';
    END IF;
  END IF;
  IF v_has_operational THEN
    v_operational:=public.dbs_control_operational_stock_consume_work_order(
      p_actor_user_id,p_work_order_id,left(v_key,180)||':operational');
    IF coalesce((v_operational->>'ok')::boolean,false) IS NOT TRUE THEN
      RAISE EXCEPTION 'DBS_OPERATIONAL_RESERVATION_CONSUMPTION_FAILED' USING errcode='23514';
    END IF;
  END IF;
  RETURN jsonb_build_object('ok',true,'legacy',v_legacy,'operational',v_operational);
END;
$$;

CREATE OR REPLACE FUNCTION public.dbs_control_operational_stock_release_reservation(
  p_actor_user_id uuid,p_reservation_id uuid,p_idempotency_key text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $
DECLARE
  v_r public.dbs_control_operational_reservations%rowtype;
  v_balance public.dbs_control_operational_stock_balances%rowtype;
  v_actor_company uuid;
  v_work_order_id uuid;
  v_key text:=nullif(btrim(p_idempotency_key),'');
BEGIN
  IF p_actor_user_id IS NULL OR NOT public.dbs_control_is_admin_actor(p_actor_user_id) THEN
    RAISE EXCEPTION 'DBS_OPERATIONAL_RESERVATION_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF v_key IS NULL OR char_length(v_key) NOT BETWEEN 8 AND 240 THEN
    RAISE EXCEPTION 'DBS_OPERATIONAL_RESERVATION_IDEMPOTENCY_REQUIRED' USING ERRCODE='22023';
  END IF;

  -- Read the OS id without locking the reservation; acquire the shared OS lock first.
  SELECT work_order_id INTO v_work_order_id
    FROM public.dbs_control_operational_reservations WHERE id=p_reservation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DBS_OPERATIONAL_RESERVATION_NOT_FOUND' USING ERRCODE='23503';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('dbs-os-reservations:'||v_work_order_id::text,0));

  SELECT * INTO v_r FROM public.dbs_control_operational_reservations
    WHERE id=p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DBS_OPERATIONAL_RESERVATION_NOT_FOUND' USING ERRCODE='23503';
  END IF;
  SELECT company_id INTO v_actor_company FROM public.users
    WHERE id=p_actor_user_id AND status='ativo';
  IF NOT FOUND OR v_actor_company IS DISTINCT FROM v_r.company_id THEN
    RAISE EXCEPTION 'DBS_OPERATIONAL_RESERVATION_SCOPE_MISMATCH' USING ERRCODE='42501';
  END IF;
  IF v_r.status<>'reserved' THEN
    RETURN jsonb_build_object('ok',true,'replayed',true,'reservation_id',v_r.id,'status',v_r.status);
  END IF;
  SELECT * INTO v_balance FROM public.dbs_control_operational_stock_balances
    WHERE stock_id=v_r.stock_id AND part_id=v_r.part_id FOR UPDATE;
  IF NOT FOUND OR v_balance.reserved_quantity<v_r.quantity THEN
    RAISE EXCEPTION 'DBS_OPERATIONAL_RESERVATION_BALANCE_INCONSISTENT' USING ERRCODE='23514';
  END IF;
  UPDATE public.dbs_control_operational_stock_balances
    SET reserved_quantity=reserved_quantity-v_r.quantity,version=version+1,updated_at=now()
    WHERE id=v_balance.id;
  UPDATE public.dbs_control_operational_reservations
    SET status='released',released_at=now() WHERE id=v_r.id;
  RETURN jsonb_build_object('ok',true,'replayed',false,'reservation_id',v_r.id,'status','released');
END $;

REVOKE ALL ON FUNCTION public.dbs_control_operational_stock_release_reservation(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dbs_control_operational_stock_release_reservation(uuid,uuid,text) TO service_role;

REVOKE ALL ON FUNCTION public.dbs_control_apply_work_order_delta_with_reservations(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dbs_control_apply_work_order_delta_with_reservations(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.dbs_control_consume_all_work_order_reservations(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dbs_control_consume_all_work_order_reservations(uuid,uuid,text) TO service_role;

COMMIT;
