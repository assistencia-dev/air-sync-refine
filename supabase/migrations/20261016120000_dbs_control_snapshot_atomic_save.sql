-- DBS CONTROL: gravação atômica do snapshot compartilhado.
-- Serializa gravações concorrentes e reconcilia OS por id/protocolo dentro da transação.
-- Não remove registros ausentes do payload recebido e protege documentos já concluídos.
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
  v_key text;
  v_latest_key text;
  v_seen_keys text[] := array[]::text[];
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

  -- A linha é bloqueada até o commit; gravações do mesmo escopo são serializadas.
  select s.state into v_current_state
  from public.dbs_control_snapshots s
  where s.scope_key = v_scope_key
  for update;

  if v_current_state is not null then
    v_latest_orders := case when jsonb_typeof(v_current_state->'ordens') = 'array'
      then v_current_state->'ordens' else '[]'::jsonb end;
  else
    v_latest_orders := '[]'::jsonb;
  end if;
  v_incoming_orders := case when jsonb_typeof(v_incoming_state->'ordens') = 'array'
    then v_incoming_state->'ordens' else '[]'::jsonb end;

  -- Para cada OS enviada, preserva status/documentos se a versão salva já estava concluída.
  for v_order in select value from jsonb_array_elements(v_incoming_orders)
  loop
    v_key := coalesce(
      nullif(v_order->>'id', ''),
      nullif(v_order->>'protocolo', ''),
      nullif(v_order->>'protocol', ''),
      nullif(v_order->>'numero', '')
    );
    v_latest := null;

    if v_key is not null then
      select value into v_latest
      from jsonb_array_elements(v_latest_orders) latest(value)
      where coalesce(
        nullif(value->>'id', ''),
        nullif(value->>'protocolo', ''),
        nullif(value->>'protocol', ''),
        nullif(value->>'numero', '')
      ) = v_key
      limit 1;
    end if;

    if v_latest is not null and lower(trim(coalesce(v_latest->>'status',''))) in
      ('concluida','concluída','concluido','concluído') then
      v_order := v_order || jsonb_build_object('status', v_latest->'status');
      foreach v_latest_key in array array[
        'assinatura','assinaturaCliente','signature_data','signature_name',
        'concluidoEm','completedAt','diagnostico','laudo','observacao'
      ]
      loop
        -- Para documentos concluídos, o valor já persistido prevalece inclusive
        -- quando um cliente atrasado envia um valor antigo não vazio.
        if nullif(trim(coalesce(v_latest->>v_latest_key,'')), '') is not null then
          v_order := v_order || jsonb_build_object(v_latest_key, v_latest->v_latest_key);
        end if;
      end loop;
    end if;

    v_merged_orders := v_merged_orders || jsonb_build_array(v_order);
    if v_key is not null then
      v_seen_keys := array_append(v_seen_keys, v_key);
    end if;
  end loop;

  -- OS presentes na última versão mas ausentes num autosave atrasado não são removidas.
  for v_order in select value from jsonb_array_elements(v_latest_orders)
  loop
    v_key := coalesce(
      nullif(v_order->>'id', ''),
      nullif(v_order->>'protocolo', ''),
      nullif(v_order->>'protocol', ''),
      nullif(v_order->>'numero', '')
    );
    if v_key is not null and not (v_key = any(v_seen_keys)) then
      v_merged_orders := v_merged_orders || jsonb_build_array(v_order);
    end if;
  end loop;

  if v_current_state is not null then
    v_incoming_state := v_incoming_state || jsonb_build_object('ordens', v_merged_orders);
  else
    v_incoming_state := v_incoming_state || jsonb_build_object('ordens', v_merged_orders);
  end if;

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
  'Atomic DBS Control snapshot persistence; serializes same-scope writes and preserves missing/completed work orders.';
