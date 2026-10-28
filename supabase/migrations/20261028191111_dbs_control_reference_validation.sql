-- Additive hardening: convert invalid assigned_employee_id references into
-- an idempotent, user-visible rejection instead of a raw FK/HTTP 500.
-- No operational rows are changed by this migration.

begin;

CREATE OR REPLACE FUNCTION public.dbs_control_apply_work_order_delta(p_payload jsonb)
 RETURNS TABLE(ok boolean, status text, work_order_id uuid, protocol text, version bigint, command_id uuid, idempotency_key text, error_code text, error_message text, changed_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_key text := nullif(p_payload->>'idempotency_key', '');
  v_actor uuid := nullif(p_payload->>'actor_user_id', '')::uuid;
  v_order_id uuid;
  v_protocol text := nullif(btrim(coalesce(p_payload->>'protocol', p_payload->>'protocolo', p_payload->'patch'->>'protocol', p_payload->'patch'->>'protocolo')), '');
  v_expected bigint := nullif(p_payload->>'expected_version', '')::bigint;
  v_operation text := lower(coalesce(p_payload->>'operation', 'upsert'));
  v_patch jsonb := public.dbs_control_normalize_work_order_timestamps(coalesce(p_payload->'patch', '{}'::jsonb));
  v_current public.dbs_control_work_orders%rowtype;
  v_candidate public.dbs_control_work_orders%rowtype;
  v_command public.dbs_control_sync_commands%rowtype;
  v_employee_id uuid;
  v_role text;
  v_result jsonb;
  v_changed boolean := true;
  v_status text;
  v_error_code text;
  v_error_message text;
  v_changed_at timestamptz := clock_timestamp();
  v_current_completed boolean;
  v_candidate_completed boolean;
  v_old_status text;
  v_current_found boolean := false;
begin
  if v_key is null then
    raise exception 'DBS_SYNC_IDEMPOTENCY_REQUIRED: idempotency_key é obrigatório.' using errcode = '22023';
  end if;
  if v_actor is null then
    raise exception 'DBS_SYNC_ACTOR_REQUIRED: actor_user_id é obrigatório.' using errcode = '22023';
  end if;

  select sc.* into v_command
  from public.dbs_control_sync_commands sc
  where sc.idempotency_key = v_key
  for update;

  if found and v_command.status <> 'received' then
    return query select
      coalesce((v_command.result->>'ok')::boolean, v_command.status = 'applied'),
      coalesce(v_command.result->>'status', v_command.status),
      nullif(v_command.result->>'work_order_id', '')::uuid,
      v_command.result->>'protocol',
      nullif(v_command.result->>'version', '')::bigint,
      v_command.id,
      v_key,
      v_command.error_code,
      v_command.error_message,
      coalesce(nullif(v_command.result->>'changed_at', '')::timestamptz, v_command.applied_at, v_command.created_at);
    return;
  end if;

  if not found then
    insert into public.dbs_control_sync_commands
      (idempotency_key, actor_user_id, aggregate_type, expected_version, payload, payload_hash)
    values
      (v_key, v_actor, 'work_order', v_expected, p_payload, md5(p_payload::text))
    returning * into v_command;
  end if;

  select u.role_key::text into v_role
  from public.users u
  where u.id = v_actor and u.status = 'ativo';
  if v_role is null then
    raise exception 'DBS_SYNC_ACTOR_INVALID: usuário sem acesso operacional ativo.' using errcode = '42501';
  end if;

  if nullif(p_payload->>'work_order_id', '') is not null then
    v_order_id := (p_payload->>'work_order_id')::uuid;
  end if;

  if v_order_id is not null then
    select w.* into v_current
    from public.dbs_control_work_orders w
    where w.id = v_order_id
    for update;
    v_current_found := found;
  elsif v_protocol is not null then
    select w.* into v_current
    from public.dbs_control_work_orders w
    where w.protocol = v_protocol
    limit 1
    for update;
    v_current_found := found;
    if v_current_found then v_order_id := v_current.id; end if;
  end if;

  if v_current_found then
    if v_expected is null or v_expected <> v_current.version then
      v_result := jsonb_build_object(
        'ok', false, 'status', 'conflict', 'work_order_id', v_current.id,
        'protocol', v_current.protocol, 'version', v_current.version,
        'changed_at', v_changed_at
      );
      update public.dbs_control_sync_commands
      set status = 'conflict', result = v_result,
          error_code = 'DBS_OS_CONFLICT',
          error_message = 'A OS foi alterada em outro acesso; recarregue e reconcilie antes de salvar.',
          conflict_at = v_changed_at
      where id = v_command.id;
      return query select false, 'conflict', v_current.id, v_current.protocol, v_current.version,
        v_command.id, v_key, 'DBS_OS_CONFLICT',
        'A OS foi alterada em outro acesso; recarregue e reconcilie antes de salvar.', v_changed_at;
      return;
    end if;

    v_patch := v_patch - 'id' - 'version' - 'created_at' - 'updated_at' - 'idempotency_key';
    if v_patch ? 'assigned_employee_id'
       and nullif(btrim(v_patch->>'assigned_employee_id'), '') is not null
       and btrim(v_patch->>'assigned_employee_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      v_result := jsonb_build_object(
        'ok', false, 'status', 'failed', 'work_order_id', v_current.id,
        'protocol', v_current.protocol, 'version', v_current.version,
        'changed_at', v_changed_at
      );
      update public.dbs_control_sync_commands
      set status = 'failed', result = v_result,
          error_code = 'DBS_OS_EMPLOYEE_NOT_FOUND',
          error_message = 'O técnico informado não possui um UUID relacional válido.',
          applied_at = v_changed_at
      where id = v_command.id;
      return query select false, 'failed', v_current.id, v_current.protocol, v_current.version,
        v_command.id, v_key, 'DBS_OS_EMPLOYEE_NOT_FOUND',
        'O técnico informado não possui um UUID relacional válido.', v_changed_at;
      return;
    end if;

    v_candidate := jsonb_populate_record(v_current, v_patch);
    if v_candidate.assigned_employee_id is not null
       and not exists (
         select 1 from public.rh_employees e where e.id = v_candidate.assigned_employee_id
       ) then
      v_result := jsonb_build_object(
        'ok', false, 'status', 'failed', 'work_order_id', v_current.id,
        'protocol', v_current.protocol, 'version', v_current.version,
        'changed_at', v_changed_at
      );
      update public.dbs_control_sync_commands
      set status = 'failed', result = v_result,
          error_code = 'DBS_OS_EMPLOYEE_NOT_FOUND',
          error_message = 'O técnico selecionado não existe no cadastro relacional.',
          applied_at = v_changed_at
      where id = v_command.id;
      return query select false, 'failed', v_current.id, v_current.protocol, v_current.version,
        v_command.id, v_key, 'DBS_OS_EMPLOYEE_NOT_FOUND',
        'O técnico selecionado não existe no cadastro relacional.', v_changed_at;
      return;
    end if;


    v_current_completed := lower(trim(coalesce(v_current.status, ''))) in ('concluida','concluída','concluido','concluído','completed','complete');
    v_candidate_completed := lower(trim(coalesce(v_candidate.status, ''))) in ('concluida','concluída','concluido','concluído','completed','complete');
    if v_current_completed and not v_candidate_completed then
      raise exception 'DBS_OS_COMPLETED_LOCKED: OS concluída não pode ser reaberta.' using errcode = '55000';
    end if;
    if v_current_completed and (
         v_candidate.technical_opinion is distinct from v_current.technical_opinion
      or v_candidate.diagnostico is distinct from v_current.diagnostico
      or v_candidate.observation is distinct from v_current.observation
      or v_candidate.servico_executado is distinct from v_current.servico_executado
      or v_candidate.signature_data is distinct from v_current.signature_data
      or v_candidate.signature_path is distinct from v_current.signature_path
      or v_candidate.assinatura_path is distinct from v_current.assinatura_path
      or v_candidate.signature_name is distinct from v_current.signature_name
      or v_candidate.completed_at is distinct from v_current.completed_at
    ) then
      raise exception 'DBS_OS_COMPLETED_LOCKED: dados assinados da OS concluída estão protegidos.' using errcode = '55000';
    end if;

    if v_role = 'COLABORADOR' then
      select coalesce(ea.employee_id, re.id) into v_employee_id
      from public.users u
      left join public.rh_employee_access ea on ea.user_id = u.id and ea.access_enabled = true
      left join public.rh_employees re on re.ponto_portal_user_id = u.id and re.dbs_control_access_enabled = true and re.is_active = true
      where u.id = v_actor;
      if v_employee_id is null or v_current.assigned_employee_id is distinct from v_employee_id then
        raise exception 'DBS_OS_NOT_ASSIGNED: colaborador não está vinculado à OS.' using errcode = '42501';
      end if;
      if v_patch ?| array['client_id','site_id','assigned_employee_id','created_by_user_id','protocol','protocolo','total_cents','type','priority','scheduled_at'] then
        raise exception 'DBS_OS_FIELD_FORBIDDEN: colaborador não pode alterar campos administrativos.' using errcode = '42501';
      end if;
    end if;

    v_candidate.idempotency_key := v_key;
    if (to_jsonb(v_candidate) - 'idempotency_key') is not distinct from (to_jsonb(v_current) - 'idempotency_key') then
      v_changed := false;
    end if;

    if v_changed then
      v_old_status := v_current.status;
      perform set_config('app.dbs_control_idempotency_key', v_key, true);
      update public.dbs_control_work_orders set
        protocol = v_candidate.protocol,
        client_id = v_candidate.client_id,
        site_id = v_candidate.site_id,
        assigned_employee_id = v_candidate.assigned_employee_id,
        created_by_user_id = v_candidate.created_by_user_id,
        service_id = v_candidate.service_id,
        type = v_candidate.type,
        priority = v_candidate.priority,
        status = v_candidate.status,
        scheduled_at = v_candidate.scheduled_at,
        started_at = v_candidate.started_at,
        completed_at = v_candidate.completed_at,
        sla_deadline = v_candidate.sla_deadline,
        description = v_candidate.description,
        technical_opinion = v_candidate.technical_opinion,
        observation = v_candidate.observation,
        latitude = v_candidate.latitude,
        longitude = v_candidate.longitude,
        signature_name = v_candidate.signature_name,
        signature_data = v_candidate.signature_data,
        total_cents = v_candidate.total_cents,
        protocolo = v_candidate.protocolo,
        diagnostico = v_candidate.diagnostico,
        servico_executado = v_candidate.servico_executado,
        assinatura_path = v_candidate.assinatura_path,
        signature_path = v_candidate.signature_path,
        deleted_at = v_candidate.deleted_at,
        idempotency_key = v_key
      where id = v_current.id
      returning * into v_current;

      insert into public.dbs_control_work_order_events
        (work_order_id, actor_user_id, event_type, old_status, new_status, details, idempotency_key)
      values
        (v_current.id, v_actor,
         coalesce(nullif(p_payload->>'event_type',''), 'work_order_updated'),
         v_old_status, v_current.status,
         jsonb_build_object('idempotency_key', v_key, 'patch', v_patch), v_key)
      on conflict do nothing;
    end if;
  else
    if v_operation = 'update' then
      v_result := jsonb_build_object('ok', false, 'status', 'failed', 'changed_at', v_changed_at);
      update public.dbs_control_sync_commands
      set status = 'failed', result = v_result, error_code = 'DBS_OS_NOT_FOUND',
          error_message = 'A OS indicada não existe na fonte relacional.'
      where id = v_command.id;
      return query select false, 'failed', null::uuid, v_protocol, null::bigint,
        v_command.id, v_key, 'DBS_OS_NOT_FOUND',
        'A OS indicada não existe na fonte relacional.', v_changed_at;
      return;
    end if;

    if v_patch ? 'assigned_employee_id'
       and nullif(btrim(v_patch->>'assigned_employee_id'), '') is not null
       and btrim(v_patch->>'assigned_employee_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      v_result := jsonb_build_object(
        'ok', false, 'status', 'failed', 'work_order_id', null,
        'protocol', v_protocol, 'version', null::bigint,
        'changed_at', v_changed_at
      );
      update public.dbs_control_sync_commands
      set status = 'failed', result = v_result,
          error_code = 'DBS_OS_EMPLOYEE_NOT_FOUND',
          error_message = 'O técnico informado não possui um UUID relacional válido.',
          applied_at = v_changed_at
      where id = v_command.id;
      return query select false, 'failed', null::uuid, v_protocol, null::bigint,
        v_command.id, v_key, 'DBS_OS_EMPLOYEE_NOT_FOUND',
        'O técnico informado não possui um UUID relacional válido.', v_changed_at;
      return;
    end if;

    v_candidate := jsonb_populate_record(null::public.dbs_control_work_orders, v_patch - 'id' - 'version' - 'created_at' - 'updated_at' - 'idempotency_key');
    v_candidate.id := coalesce(v_order_id, gen_random_uuid());
    v_candidate.protocol := coalesce(nullif(v_candidate.protocol,''), nullif(v_candidate.protocolo,''), v_protocol,
    'DBS-' || to_char(clock_timestamp(), 'YYYY') || '-' || lpad(nextval('public.dbs_control_work_order_protocol_seq')::text, 6, '0'));
    v_candidate.protocolo := coalesce(nullif(v_candidate.protocolo,''), v_candidate.protocol);
    v_candidate.client_id := v_candidate.client_id;
    v_candidate.status := coalesce(nullif(v_candidate.status,''), 'aberta');
    v_candidate.type := coalesce(nullif(v_candidate.type,''), 'corretiva');
    v_candidate.priority := coalesce(nullif(v_candidate.priority,''), 'normal');
    v_candidate.total_cents := coalesce(v_candidate.total_cents, 0);
    v_candidate.version := 1;
    v_candidate.idempotency_key := v_key;
    v_candidate.created_at := coalesce(v_candidate.created_at, now());
    v_candidate.updated_at := now();
    if v_candidate.assigned_employee_id is not null
       and not exists (
         select 1 from public.rh_employees e where e.id = v_candidate.assigned_employee_id
       ) then
      v_result := jsonb_build_object(
        'ok', false, 'status', 'failed', 'work_order_id', null::uuid,
        'protocol', v_candidate.protocol, 'version', v_candidate.version,
        'changed_at', v_changed_at
      );
      update public.dbs_control_sync_commands
      set status = 'failed', result = v_result,
          error_code = 'DBS_OS_EMPLOYEE_NOT_FOUND',
          error_message = 'O técnico selecionado não existe no cadastro relacional.',
          applied_at = v_changed_at
      where id = v_command.id;
      return query select false, 'failed', null::uuid, v_candidate.protocol, v_candidate.version,
        v_command.id, v_key, 'DBS_OS_EMPLOYEE_NOT_FOUND',
        'O técnico selecionado não existe no cadastro relacional.', v_changed_at;
      return;
    end if;

    if v_candidate.client_id is null then
      raise exception 'DBS_OS_REQUIRED: cliente é obrigatório.' using errcode = '22023';
    end if;
    perform set_config('app.dbs_control_idempotency_key', v_key, true);
    insert into public.dbs_control_work_orders values (v_candidate.*)
    returning * into v_current;
    v_order_id := v_current.id;
    insert into public.dbs_control_work_order_events
      (work_order_id, actor_user_id, event_type, new_status, details, idempotency_key)
    values
      (v_current.id, v_actor, coalesce(nullif(p_payload->>'event_type',''), 'work_order_created'),
       v_current.status, jsonb_build_object('idempotency_key', v_key, 'patch', v_patch), v_key)
    on conflict do nothing;
  end if;

  -- Peças e estoque são aplicados na mesma transação lógica da intenção da OS.
  -- O comando idempotente impede que um retry desconte estoque duas vezes.
  perform public.dbs_control_apply_work_order_parts_in_tx(v_current.id, p_payload->'parts');
  if jsonb_typeof(p_payload->'parts') = 'array' then
    insert into public.dbs_control_work_order_events
      (work_order_id, actor_user_id, event_type, details, idempotency_key)
    values
      (v_current.id, v_actor, 'work_order_parts_delta',
       jsonb_build_object('idempotency_key', v_key, 'parts', p_payload->'parts'), v_key || ':parts')
    on conflict do nothing;
  end if;

  v_status := 'applied';
  v_result := jsonb_build_object(
    'ok', true, 'status', v_status, 'work_order_id', v_current.id,
    'protocol', v_current.protocol, 'version', v_current.version,
    'changed_at', v_changed_at
  );
  update public.dbs_control_sync_commands
  set status = 'applied', aggregate_id = v_current.id, result = v_result,
      applied_at = v_changed_at, error_code = null, error_message = null
  where id = v_command.id;

  return query select true, v_status, v_current.id, v_current.protocol, v_current.version,
    v_command.id, v_key, null::text, null::text, v_changed_at;
end;
$function$;

revoke all on function public.dbs_control_apply_work_order_delta(jsonb) from public, anon, authenticated;
grant execute on function public.dbs_control_apply_work_order_delta(jsonb) to service_role;

commit;


