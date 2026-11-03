-- DBS Air | Fase 2 hardening: reservas também protegem autosaves não terminais da OS.
-- A baixa legada recebe somente a quantidade não reservada; reserva é consumida no fechamento.
begin;

create or replace function public.dbs_control_apply_work_order_delta_with_reservations(p_payload jsonb)
returns table(ok boolean,status text,work_order_id uuid,protocol text,version bigint,command_id uuid,idempotency_key text,error_code text,error_message text,changed_at timestamptz)
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_payload jsonb:=p_payload;
  v_order_id uuid;
  v_status text:=lower(btrim(coalesce(p_payload->'patch'->>'status','')));
  v_key text:=nullif(btrim(p_payload->>'idempotency_key'),'');
  v_actor uuid:=nullif(p_payload->>'actor_user_id','')::uuid;
  v_has_reservations boolean:=false;
  v_delta record;
  v_consumption jsonb;
begin
  if nullif(p_payload->>'work_order_id','') is not null then
    v_order_id:=(p_payload->>'work_order_id')::uuid;
  else
    select id into v_order_id from public.dbs_control_work_orders
      where protocol=nullif(btrim(coalesce(p_payload->>'protocol',p_payload->>'protocolo')),'')
      limit 1;
  end if;

  if v_order_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('dbs-os-reservation-finalize:'||v_order_id::text,0));
    select exists(select 1 from public.dbs_control_work_order_reservations
      where work_order_id=v_order_id and status='reserved') into v_has_reservations;
    if v_has_reservations then
      v_payload:=jsonb_set(v_payload,'{parts}',coalesce((
        select jsonb_agg(jsonb_set(i.value,'{quantity}',to_jsonb(greatest(0,
          coalesce(nullif(i.value->>'quantity','')::numeric,nullif(i.value->>'qtd','')::numeric,0)
          -coalesce(r.reserved_qty,0))),true))
        from jsonb_array_elements(coalesce(p_payload->'parts','[]'::jsonb)) i(value)
        left join (
          select part_id,sum(quantity) as reserved_qty
          from public.dbs_control_work_order_reservations
          where work_order_id=v_order_id and status='reserved'
          group by part_id
        ) r on r.part_id=nullif(coalesce(i.value->>'part_id',i.value->>'id'),'')::uuid
        where coalesce(nullif(i.value->>'quantity','')::numeric,nullif(i.value->>'qtd','')::numeric,0)
          > coalesce(r.reserved_qty,0)
      ),'[]'::jsonb),true);
    end if;
  end if;

  select * into v_delta from public.dbs_control_apply_work_order_delta(v_payload);
  if v_delta.ok and v_has_reservations and v_status in
    ('concluida','concluída','concluido','concluído','concluida com pendencia',
     'concluída com pendência','atendimento com pendencia','atendimento com pendência',
     'completed','complete','finalizada','finalizado') then
    v_consumption:=public.dbs_control_consume_work_order_reservations(
      v_delta.work_order_id,v_actor,left(v_key,190)||':reserved-parts-consume');
    if coalesce((v_consumption->>'ok')::boolean,false) is not true then
      raise exception 'DBS_RESERVATION_CONSUMPTION_FAILED' using errcode='23514';
    end if;
  end if;
  return query select v_delta.ok,v_delta.status,v_delta.work_order_id,v_delta.protocol,
    v_delta.version,v_delta.command_id,v_delta.idempotency_key,v_delta.error_code,
    v_delta.error_message,v_delta.changed_at;
end;
$$;

revoke all on function public.dbs_control_apply_work_order_delta_with_reservations(jsonb) from public,anon,authenticated;
grant execute on function public.dbs_control_apply_work_order_delta_with_reservations(jsonb) to service_role;

notify pgrst,'reload schema';
commit;
