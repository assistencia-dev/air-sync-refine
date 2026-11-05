do $$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef('public.dbs_control_register_purchase(jsonb)'::regprocedure) into v_def;
  v_old := $old$insert into public.dbs_control_outbox(
    idempotency_key,company_id,aggregate_type,aggregate_id,event_type,aggregate_version,payload
  ) values(
    left('purchase:registered:'||v_scope||':'||v_key,240),
    v_company,'purchase',v_purchase,'purchase.registered',1,
    jsonb_build_object('purchase_id',v_purchase,'scope_key',v_scope,'total_cents',v_total)
  ) on conflict(idempotency_key) do nothing;$old$;
  v_new := $new$insert into public.dbs_control_inventory_outbox(
    idempotency_key,scope_key,aggregate_type,aggregate_id,event_type,payload
  ) values(
    left('purchase:registered:'||v_scope||':'||v_key,240),
    v_scope,'purchase',v_purchase,'purchase.registered',
    jsonb_build_object('purchase_id',v_purchase,'scope_key',v_scope,'total_cents',v_total)
  ) on conflict(idempotency_key) do nothing;$new$;
  if position(v_old in v_def)=0 then
    raise exception 'Purchase registration outbox block was not found for safe replacement.';
  end if;
  execute replace(v_def,v_old,v_new);

  select pg_get_functiondef('public.dbs_control_receive_registered_purchase(uuid,uuid,text)'::regprocedure) into v_def;
  v_old := $old$insert into public.dbs_control_outbox(
    idempotency_key,company_id,aggregate_type,aggregate_id,event_type,aggregate_version,payload
  ) values(
    left('purchase:received:'||v_purchase.scope_key||':'||p_purchase_id::text,240),
    v_purchase.company_id,'purchase',p_purchase_id,'inventory.purchase.received',v_purchase.version+1,
    jsonb_build_object('purchase_id',p_purchase_id,'scope_key',v_purchase.scope_key,'total_cents',v_purchase.total_cents)
  ) on conflict(idempotency_key) do nothing;$old$;
  v_new := $new$insert into public.dbs_control_inventory_outbox(
    idempotency_key,scope_key,aggregate_type,aggregate_id,event_type,payload
  ) values(
    left('purchase:received:'||v_purchase.scope_key||':'||p_purchase_id::text,240),
    v_purchase.scope_key,'purchase',p_purchase_id,'inventory.purchase.received',
    jsonb_build_object('purchase_id',p_purchase_id,'scope_key',v_purchase.scope_key,'total_cents',v_purchase.total_cents)
  ) on conflict(idempotency_key) do nothing;$new$;
  if position(v_old in v_def)=0 then
    raise exception 'Purchase receipt outbox block was not found for safe replacement.';
  end if;
  execute replace(v_def,v_old,v_new);
end;
$$;
