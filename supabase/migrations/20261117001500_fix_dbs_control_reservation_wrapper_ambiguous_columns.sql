-- Fix Postgres OUT-parameter ambiguity in the transactional OS reservation wrapper.
-- Keeps both legacy and operational stock reservation checks and their atomic consumption.
-- No OS rows, attachment rows, stock balances, or ledger entries are changed by this migration.
BEGIN;

CREATE OR REPLACE FUNCTION public.dbs_control_apply_work_order_delta_with_reservations(p_payload jsonb)
RETURNS TABLE(
  ok boolean,
  status text,
  work_order_id uuid,
  protocol text,
  version bigint,
  command_id uuid,
  idempotency_key text,
  error_code text,
  error_message text,
  changed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $$
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
    SELECT wo.id INTO v_order_id
    FROM public.dbs_control_work_orders AS wo
    WHERE wo.protocol=nullif(btrim(coalesce(p_payload->>'protocol',p_payload->>'protocolo')),'')
    LIMIT 1;
  END IF;

  IF v_order_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('dbs-os-reservations:'||v_order_id::text,0));

    SELECT EXISTS(
      SELECT 1
      FROM public.dbs_control_work_order_reservations AS legacy_reservation
      WHERE legacy_reservation.work_order_id=v_order_id
        AND legacy_reservation.status='reserved'
    ) INTO v_has_reservations;

    SELECT EXISTS(
      SELECT 1
      FROM public.dbs_control_operational_reservations AS operational_reservation
      WHERE operational_reservation.work_order_id=v_order_id
        AND operational_reservation.status='reserved'
    ) INTO v_has_operational_reservations;

    IF v_has_reservations OR v_has_operational_reservations THEN
      v_payload:=jsonb_set(v_payload,'{parts}',coalesce((
        SELECT jsonb_agg(jsonb_set(item.value,'{quantity}',to_jsonb(greatest(0,
          coalesce(nullif(item.value->>'quantity','')::numeric,nullif(item.value->>'qtd','')::numeric,0)
          -coalesce(reserved.reserved_qty,0))),true))
        FROM jsonb_array_elements(coalesce(p_payload->'parts','[]'::jsonb)) AS item(value)
        LEFT JOIN (
          SELECT all_reserved.part_id,sum(all_reserved.quantity) AS reserved_qty
          FROM (
            SELECT legacy_part_reservation.part_id,legacy_part_reservation.quantity
            FROM public.dbs_control_work_order_reservations AS legacy_part_reservation
            WHERE legacy_part_reservation.work_order_id=v_order_id
              AND legacy_part_reservation.status='reserved'
            UNION ALL
            SELECT operational_part_reservation.part_id,operational_part_reservation.quantity
            FROM public.dbs_control_operational_reservations AS operational_part_reservation
            WHERE operational_part_reservation.work_order_id=v_order_id
              AND operational_part_reservation.status='reserved'
          ) AS all_reserved
          GROUP BY all_reserved.part_id
        ) AS reserved
          ON reserved.part_id=nullif(coalesce(item.value->>'part_id',item.value->>'id'),'')::uuid
        WHERE coalesce(nullif(item.value->>'quantity','')::numeric,nullif(item.value->>'qtd','')::numeric,0)
          > coalesce(reserved.reserved_qty,0)
      ),'[]'::jsonb),true);
    END IF;
  END IF;

  SELECT * INTO v_delta
  FROM public.dbs_control_apply_work_order_delta(v_payload);

  IF v_delta.ok
     AND (v_has_reservations OR v_has_operational_reservations)
     AND v_status IN (
       'concluida','concluída','concluido','concluído','concluida com pendencia',
       'concluída com pendência','atendimento com pendencia','atendimento com pendência',
       'completed','complete','finalizada','finalizado'
     ) THEN
    IF v_has_reservations THEN
      v_consumption:=public.dbs_control_consume_work_order_reservations_serialized(
        v_delta.work_order_id,v_actor,left(v_key,190)||':reserved-parts-consume'
      );
      IF coalesce((v_consumption->>'ok')::boolean,false) IS NOT TRUE THEN
        RAISE EXCEPTION 'DBS_RESERVATION_CONSUMPTION_FAILED' USING ERRCODE='23514';
      END IF;
    END IF;

    IF v_has_operational_reservations THEN
      v_consumption:=public.dbs_control_operational_stock_consume_work_order(
        v_actor,v_delta.work_order_id,left(v_key,180)||':operational-consume'
      );
      IF coalesce((v_consumption->>'ok')::boolean,false) IS NOT TRUE THEN
        RAISE EXCEPTION 'DBS_OPERATIONAL_RESERVATION_CONSUMPTION_FAILED' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;

  RETURN QUERY
  SELECT v_delta.ok,v_delta.status,v_delta.work_order_id,v_delta.protocol,
    v_delta.version,v_delta.command_id,v_delta.idempotency_key,v_delta.error_code,
    v_delta.error_message,v_delta.changed_at;
END;
$$;

REVOKE ALL ON FUNCTION public.dbs_control_apply_work_order_delta_with_reservations(jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dbs_control_apply_work_order_delta_with_reservations(jsonb)
  TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
