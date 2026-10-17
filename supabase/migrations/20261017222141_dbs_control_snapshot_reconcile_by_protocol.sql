-- DBS CONTROL: reconcile OS snapshots by both stable ID and business protocol.
-- Protects completed work orders from stale/parallel autosaves without deleting records.
create or replace function public.dbs_control_save_snapshot_safe(p_payload jsonb)
returns table(state jsonb, state_version integer, updated_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scope_key text;
  v_current_state jsonb;
  v_incoming_state jsonb;
  v_latest_orders jsonb;
  v_incoming_orders jsonb;
  v_merged_orders jsonb := '[]'::jsonb;
  v_order jsonb;
  v_latest jsonb;
  v_order_id text;
  v_protocol text;
  v_latest_id text;
  v_latest_protocol text;
  v_seen_ids text[] := array[]::text[];
  v_seen_protocols text[] := array[]::text[];
  v_seen_duplicate boolean;
  v_field text;
  v_saved public.dbs_control_snapshots%rowtype;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Payload de snapshot inválido' using errcode = '22023';
  end if;

  v_scope_key := nullif(p_payload->>'scope_key', '');
  if v_scope_key is null then
    raise exception 'scope_key obrigatório' using errcode = '22023';
  end if;

  v_incoming_state := coalesce(p_payload->'state', '{}'::jsonb);
  if jsonb_typeof(v_incoming_state) <> 'object' then
    raise exception 'state deve ser um objeto JSON' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_scope_key, 0));

  select s.state into v_current_state
  from public.dbs_control_snapshots s
  where s.scope_key = v_scope_key
  for update;

  v_latest_orders := case
    when jsonb_typeof(v_current_state->'ordens') = 'array' then v_current_state->'ordens'
    else '[]'::jsonb
  end;
  v_incoming_orders := case
    when jsonb_typeof(v_incoming_state->'ordens') = 'array' then v_incoming_state->'ordens'
    else '[]'::jsonb
  end;

  for v_order in select value from jsonb_array_elements(v_incoming_orders)
  loop
    v_order_id := nullif(btrim(coalesce(v_order->>'id', '')), '');
    v_protocol := lower(coalesce(
      nullif(btrim(v_order->>'protocolo'), ''),
      nullif(btrim(v_order->>'protocol'), ''),
      nullif(btrim(v_order->>'numero'), '')
    ));

    -- Deduplicate repeated payload entries by either ID or protocol.
    v_seen_duplicate :=
      (v_order_id is not null and v_order_id = any(v_seen_ids))
      or (v_protocol is not null and v_protocol = any(v_seen_protocols));
    if v_seen_duplicate then
      continue;
    end if;

    v_latest := null;

    -- Exact ID wins. If IDs differ across legacy/device snapshots, protocol is fallback.
    if v_order_id is not null then
      select latest.value into v_latest
      from jsonb_array_elements(v_latest_orders) latest(value)
      where nullif(btrim(coalesce(latest.value->>'id', '')), '') = v_order_id
      limit 1;
    end if;

    if v_latest is null and v_protocol is not null then
      select latest.value into v_latest
      from jsonb_array_elements(v_latest_orders) latest(value)
      where lower(coalesce(
        nullif(btrim(latest.value->>'protocolo'), ''),
        nullif(btrim(latest.value->>'protocol'), ''),
        nullif(btrim(latest.value->>'numero'), '')
      )) = v_protocol
      limit 1;
    end if;

    if v_latest is not null
       and lower(btrim(coalesce(v_latest->>'status', ''))) in
         ('concluida','concluída','concluido','concluído') then
      -- A completed OS keeps its canonical identity and status.
      if nullif(btrim(coalesce(v_latest->>'id', '')), '') is not null then
        v_order := v_order || jsonb_build_object('id', v_latest->'id');
      end if;
      if nullif(btrim(coalesce(v_latest->>'protocolo', v_latest->>'protocol', v_latest->>'numero', '')), '') is not null then
        if v_latest ? 'protocolo' then
          v_order := v_order || jsonb_build_object('protocolo', v_latest->'protocolo');
        elsif v_latest ? 'protocol' then
          v_order := v_order || jsonb_build_object('protocol', v_latest->'protocol');
        else
          v_order := v_order || jsonb_build_object('numero', v_latest->'numero');
        end if;
      end if;
      v_order := v_order || jsonb_build_object('status', v_latest->'status');

      -- Keep every already-populated execution/document field; stale non-empty values
      -- are just as dangerous as blanks after completion.
      foreach v_field in array array[
        'tecnicoId','employeeId','assignedEmployeeId','concluidoPorEmployeeId',
        'assinatura','assinaturaCliente','signature_data','signature_name',
        'assinaturaEm','concluidoEm','completedAt','completed_at',
        'diagnostico','laudo','technical_opinion','trabalhoExecutado',
        'observacao','observation','observacaoTecnico','observacaoComplementarTecnico',
        'fotoAntes','fotoDepois'
      ]
      loop
        if nullif(btrim(coalesce(v_latest->>v_field, '')), '') is not null then
          v_order := v_order || jsonb_build_object(v_field, v_latest->v_field);
        end if;
      end loop;
    end if;

    v_merged_orders := v_merged_orders || jsonb_build_array(v_order);
    if v_order_id is not null then
      v_seen_ids := array_append(v_seen_ids, v_order_id);
    end if;
    if v_protocol is not null then
      v_seen_protocols := array_append(v_seen_protocols, v_protocol);
    end if;
    -- Track the canonical ID/protocol too, in case incoming legacy identity differs.
    v_latest_id := nullif(btrim(coalesce(v_latest->>'id', '')), '');
    v_latest_protocol := lower(coalesce(
      nullif(btrim(v_latest->>'protocolo'), ''),
      nullif(btrim(v_latest->>'protocol'), ''),
      nullif(btrim(v_latest->>'numero'), '')
    ));
    if v_latest_id is not null and not (v_latest_id = any(v_seen_ids)) then
      v_seen_ids := array_append(v_seen_ids, v_latest_id);
    end if;
    if v_latest_protocol is not null and not (v_latest_protocol = any(v_seen_protocols)) then
      v_seen_protocols := array_append(v_seen_protocols, v_latest_protocol);
    end if;
  end loop;

  -- Never discard records omitted by an older autosave. Match both aliases.
  for v_order in select value from jsonb_array_elements(v_latest_orders)
  loop
    v_latest_id := nullif(btrim(coalesce(v_order->>'id', '')), '');
    v_latest_protocol := lower(coalesce(
      nullif(btrim(v_order->>'protocolo'), ''),
      nullif(btrim(v_order->>'protocol'), ''),
      nullif(btrim(v_order->>'numero'), '')
    ));
    if (v_latest_id is not null and v_latest_id = any(v_seen_ids))
       or (v_latest_protocol is not null and v_latest_protocol = any(v_seen_protocols)) then
      continue;
    end if;
    v_merged_orders := v_merged_orders || jsonb_build_array(v_order);
    if v_latest_id is not null then v_seen_ids := array_append(v_seen_ids, v_latest_id); end if;
    if v_latest_protocol is not null then v_seen_protocols := array_append(v_seen_protocols, v_latest_protocol); end if;
  end loop;

  v_incoming_state := v_incoming_state || jsonb_build_object('ordens', v_merged_orders);

  insert into public.dbs_control_snapshots
    (scope_key, company_id, owner_user_id, state, state_version, updated_by, updated_at)
  values (
    v_scope_key,
    nullif(p_payload->>'company_id','')::uuid,
    nullif(p_payload->>'owner_user_id','')::uuid,
    v_incoming_state,
    coalesce(nullif(p_payload->>'state_version','')::integer, 2),
    nullif(p_payload->>'updated_by','')::uuid,
    coalesce(nullif(p_payload->>'updated_at','')::timestamptz, now())
  )
  on conflict (scope_key) do update set
    company_id = coalesce(excluded.company_id, dbs_control_snapshots.company_id),
    owner_user_id = coalesce(dbs_control_snapshots.owner_user_id, excluded.owner_user_id),
    state = excluded.state,
    state_version = excluded.state_version,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at
  returning * into v_saved;

  return query select v_saved.state, v_saved.state_version, v_saved.updated_at;
end;
$$;

revoke all on function public.dbs_control_save_snapshot_safe(jsonb) from public, anon, authenticated;
grant execute on function public.dbs_control_save_snapshot_safe(jsonb) to service_role;

comment on function public.dbs_control_save_snapshot_safe(jsonb) is
  'Atomic DBS Control snapshot persistence; matches OS by ID and protocol, deduplicates aliases, and protects completed work-order documents.';
