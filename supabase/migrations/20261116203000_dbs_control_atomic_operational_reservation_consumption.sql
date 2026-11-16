-- Atomic integration of legacy and operational reservations with OS completion.
-- Additive only: preserves the existing delta/reservation flow and makes both stock
-- consumption paths commit or roll back together.
BEGIN;

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
          SELECT part_id,sum(quantity) AS reserved_qty
          FROM public.dbs_control_work_order_reservations
          WHERE work_order_id=v_order_id AND status='reserved'
          GROUP BY part_id
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

REVOKE ALL ON FUNCTION public.dbs_control_apply_work_order_delta_with_reservations(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dbs_control_apply_work_order_delta_with_reservations(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.dbs_control_consume_all_work_order_reservations(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dbs_control_consume_all_work_order_reservations(uuid,uuid,text) TO service_role;

COMMIT;
