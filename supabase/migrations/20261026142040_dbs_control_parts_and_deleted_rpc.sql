-- DBS CONTROL: gravação por deltas, idempotência e outbox transacional.
-- Migração estritamente aditiva: nenhum snapshot, OS ou histórico existente é removido.
begin;

alter table public.dbs_control_work_orders
  add column if not exists version bigint not null default 1,
  add column if not exists idempotency_key text,
  add column if not exists deleted_at timestamptz;

create index if not exists idx_dbs_control_work_orders_deleted_at
  on public.dbs_control_work_orders(deleted_at);

alter table public.dbs_control_work_order_events
  add column if not exists idempotency_key text;

create unique index if not exists uq_dbs_control_work_order_events_idempotency
  on public.dbs_control_work_order_events(idempotency_key)
  where idempotency_key is not null;

create table if not exists public.dbs_control_sync_commands (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  company_id uuid references public.companies(id) on delete restrict,
  actor_user_id uuid references public.users(id) on delete set null,
  aggregate_type text not null default 'work_order',
  aggregate_id uuid references public.dbs_control_work_orders(id) on delete restrict,
  expected_version bigint,
  payload jsonb not null default '{}'::jsonb,
  payload_hash text not null,
  status text not null default 'received' check (status in ('received','applied','conflict','failed')),
  result jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  conflict_at timestamptz
);

create index if not exists idx_dbs_control_sync_commands_status_created
  on public.dbs_control_sync_commands(status, created_at);
create index if not exists idx_dbs_control_sync_commands_aggregate
  on public.dbs_control_sync_commands(aggregate_type, aggregate_id, created_at desc);
create index if not exists idx_dbs_control_sync_commands_actor
  on public.dbs_control_sync_commands(actor_user_id, created_at desc);
create index if not exists idx_dbs_control_sync_commands_company
  on public.dbs_control_sync_commands(company_id, created_at desc);

create table if not exists public.dbs_control_entity_records (
  id uuid primary key default gen_random_uuid(),
  scope_key text not null,
  entity_type text not null check (entity_type in ('compra','orcamento')),
  record_key text not null,
  payload jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  idempotency_key text,
  updated_by uuid references public.users(id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(scope_key, entity_type, record_key)
);

create index if not exists idx_dbs_control_entity_records_scope_type
  on public.dbs_control_entity_records(scope_key, entity_type, updated_at desc);
create index if not exists idx_dbs_control_entity_records_updated_by
  on public.dbs_control_entity_records(updated_by, updated_at desc);

create table if not exists public.dbs_control_outbox (
  id uuid primary key default gen_random_uuid(),
  command_id uuid references public.dbs_control_sync_commands(id) on delete set null,
  idempotency_key text not null unique,
  company_id uuid references public.companies(id) on delete restrict,
  aggregate_type text not null,
  aggregate_id uuid references public.dbs_control_work_orders(id) on delete cascade,
  event_type text not null,
  aggregate_version bigint not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','processing','published','failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  published_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create index if not exists idx_dbs_control_outbox_pending
  on public.dbs_control_outbox(status, available_at, created_at);
create index if not exists idx_dbs_control_outbox_aggregate
  on public.dbs_control_outbox(aggregate_type, aggregate_id, aggregate_version);
create index if not exists idx_dbs_control_outbox_command
  on public.dbs_control_outbox(command_id);
create index if not exists idx_dbs_control_outbox_company
  on public.dbs_control_outbox(company_id, created_at desc);

alter table public.dbs_control_sync_commands enable row level security;
alter table public.dbs_control_entity_records enable row level security;
alter table public.dbs_control_outbox enable row level security;

revoke all on public.dbs_control_sync_commands from anon, authenticated;
revoke all on public.dbs_control_entity_records from anon, authenticated;
revoke all on public.dbs_control_outbox from anon, authenticated;
grant all on public.dbs_control_sync_commands to service_role;
grant all on public.dbs_control_entity_records to service_role;
grant all on public.dbs_control_outbox to service_role;

drop policy if exists dbs_control_sync_commands_service_only on public.dbs_control_sync_commands;
create policy dbs_control_sync_commands_service_only on public.dbs_control_sync_commands
  for all to service_role using (true) with check (true);
drop policy if exists dbs_control_entity_records_service_only on public.dbs_control_entity_records;
create policy dbs_control_entity_records_service_only on public.dbs_control_entity_records
  for all to service_role using (true) with check (true);
drop policy if exists dbs_control_outbox_service_only on public.dbs_control_outbox;
create policy dbs_control_outbox_service_only on public.dbs_control_outbox
  for all to service_role using (true) with check (true);

create or replace function public.dbs_control_enqueue_outbox()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  row_json jsonb := to_jsonb(new);
  v_key text := nullif(current_setting('app.dbs_control_idempotency_key', true), '');
  v_command_id uuid;
  v_company_id uuid;
  v_aggregate_id uuid;
  v_aggregate_type text;
  v_event_type text;
  v_version bigint;
begin
  if v_key is null then
    v_key := 'direct:' || gen_random_uuid()::text;
  end if;

  select id into v_command_id
  from public.dbs_control_sync_commands
  where idempotency_key = v_key;

  if tg_table_name = 'dbs_control_work_orders' then
    v_aggregate_type := 'work_order';
    v_aggregate_id := nullif(row_json->>'id', '')::uuid;
    v_company_id := (
      select u.company_id
      from public.dbs_control_sync_commands sc
      join public.users u on u.id = sc.actor_user_id
      where sc.id = v_command_id
    );
    v_version := greatest(coalesce(nullif(row_json->>'version', '')::bigint, 1), 1);
    v_event_type := case when tg_op = 'INSERT' then 'work_order_created' else 'work_order_updated' end;
  else
    v_aggregate_type := coalesce(row_json->>'entity_type', tg_table_name);
    v_aggregate_id := null;
    v_company_id := null;
    v_version := greatest(coalesce(nullif(row_json->>'version', '')::bigint, 1), 1);
    v_event_type := case when tg_op = 'INSERT' then 'entity_created' else 'entity_updated' end;
  end if;

  insert into public.dbs_control_outbox
    (command_id, idempotency_key, company_id, aggregate_type, aggregate_id,
     event_type, aggregate_version, payload)
  values
    (v_command_id, v_key, v_company_id, v_aggregate_type, v_aggregate_id,
     v_event_type, v_version, row_json)
  on conflict (idempotency_key) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_dbs_control_work_orders_outbox on public.dbs_control_work_orders;
create trigger trg_dbs_control_work_orders_outbox
after insert or update on public.dbs_control_work_orders
for each row execute function public.dbs_control_enqueue_outbox();

drop trigger if exists trg_dbs_control_entity_records_outbox on public.dbs_control_entity_records;
create trigger trg_dbs_control_entity_records_outbox
after insert or update on public.dbs_control_entity_records
for each row execute function public.dbs_control_enqueue_outbox();

create or replace function public.dbs_control_apply_work_order_parts_in_tx(
  p_work_order_id uuid,
  p_parts jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_part jsonb;
  v_existing record;
  v_part_id uuid;
  v_new_quantity numeric;
  v_old_quantity numeric;
  v_delta numeric;
  v_stock numeric;
  v_unit_cents integer;
begin
  if p_parts is null then
    return;
  end if;
  if jsonb_typeof(p_parts) <> 'array' then
    raise exception 'DBS_OS_PARTS_INVALID: peças da OS devem ser uma lista.' using errcode = '22023';
  end if;

  -- A lista recebida representa o conjunto final de peças da OS. Remover uma
  -- linha devolve a quantidade ao estoque, sem apagar o histórico da OS.
  for v_existing in
    select p.id, p.part_id, p.quantity
    from public.dbs_control_work_order_parts p
    where p.work_order_id = p_work_order_id
    for update
  loop
    if not exists (
      select 1
      from jsonb_array_elements(p_parts) incoming(value)
      where nullif(coalesce(incoming.value->>'part_id', incoming.value->>'id'), '')::uuid = v_existing.part_id
        and greatest(coalesce(nullif(coalesce(incoming.value->>'quantity', incoming.value->>'qtd'), '')::numeric, 0), 0) > 0
    ) then
      update public.dbs_control_parts
      set stock_quantity = stock_quantity + v_existing.quantity,
          updated_at = now()
      where id = v_existing.part_id;
      delete from public.dbs_control_work_order_parts where id = v_existing.id;
    end if;
  end loop;

  for v_part in select value from jsonb_array_elements(p_parts)
  loop
    v_part_id := nullif(coalesce(v_part->>'part_id', v_part->>'id'), '')::uuid;
    if v_part_id is null then
      continue;
    end if;
    v_new_quantity := greatest(coalesce(nullif(coalesce(v_part->>'quantity', v_part->>'qtd'), '')::numeric, 0), 0);
    select p.id, p.quantity into v_existing
    from public.dbs_control_work_order_parts p
    where p.work_order_id = p_work_order_id and p.part_id = v_part_id
    order by p.created_at, p.id
    limit 1
    for update;
    v_old_quantity := coalesce(v_existing.quantity, 0);
    v_delta := v_new_quantity - v_old_quantity;

    select p.stock_quantity into v_stock
    from public.dbs_control_parts p
    where p.id = v_part_id
    for update;
    if not found then
      raise exception 'DBS_OS_PART_NOT_FOUND: peça não existe no catálogo relacional.' using errcode = '23503';
    end if;
    if v_delta > v_stock then
      raise exception 'DBS_OS_STOCK_INSUFFICIENT: estoque insuficiente para a peça indicada.' using errcode = '23514';
    end if;
    if v_delta <> 0 then
      update public.dbs_control_parts
      set stock_quantity = stock_quantity - v_delta,
          updated_at = now()
      where id = v_part_id;
    end if;

    v_unit_cents := coalesce(
      nullif(v_part->>'unit_cents', '')::integer,
      round(coalesce(nullif(v_part->>'venda', '')::numeric, 0) * 100)::integer
    );
    if v_new_quantity <= 0 then
      if v_existing.id is not null then
        delete from public.dbs_control_work_order_parts where id = v_existing.id;
      end if;
    elsif v_existing.id is not null then
      update public.dbs_control_work_order_parts
      set quantity = v_new_quantity, unit_cents = v_unit_cents
      where id = v_existing.id;
    else
      insert into public.dbs_control_work_order_parts(work_order_id, part_id, quantity, unit_cents)
      values (p_work_order_id, v_part_id, v_new_quantity, v_unit_cents);
    end if;
  end loop;
end;
$$;

revoke all on function public.dbs_control_apply_work_order_parts_in_tx(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.dbs_control_apply_work_order_parts_in_tx(uuid, jsonb) to service_role;

create or replace function public.dbs_control_apply_work_order_delta(p_payload jsonb)
returns table(
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
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := nullif(p_payload->>'idempotency_key', '');
  v_actor uuid := nullif(p_payload->>'actor_user_id', '')::uuid;
  v_order_id uuid;
  v_protocol text := nullif(btrim(coalesce(p_payload->>'protocol', p_payload->>'protocolo', p_payload->'patch'->>'protocol', p_payload->'patch'->>'protocolo')), '');
  v_expected bigint := nullif(p_payload->>'expected_version', '')::bigint;
  v_operation text := lower(coalesce(p_payload->>'operation', 'upsert'));
  v_patch jsonb := coalesce(p_payload->'patch', '{}'::jsonb);
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
  elsif v_protocol is not null then
    select w.* into v_current
    from public.dbs_control_work_orders w
    where w.protocol = v_protocol
    limit 1
    for update;
    if found then v_order_id := v_current.id; end if;
  end if;

  if found then
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
    v_candidate := jsonb_populate_record(v_current, v_patch);

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
      left join public.rh_employees re on re.ponto_portal_user_id = u.id
        and re.ponto_access_enabled = true and re.dbs_control_access_enabled = true and re.is_active = true
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

    v_candidate := jsonb_populate_record(null::public.dbs_control_work_orders, v_patch - 'id' - 'version' - 'created_at' - 'updated_at' - 'idempotency_key');
    v_candidate.id := coalesce(v_order_id, gen_random_uuid());
    v_candidate.protocol := coalesce(nullif(v_candidate.protocol,''), nullif(v_candidate.protocolo,''), v_protocol);
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
    if v_candidate.protocol is null or v_candidate.client_id is null then
      raise exception 'DBS_OS_REQUIRED: protocolo e cliente são obrigatórios.' using errcode = '22023';
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
$$;

create or replace function public.process_work_order_update(p_payload jsonb)
returns table(
  ok boolean, status text, work_order_id uuid, protocol text, version bigint,
  command_id uuid, idempotency_key text, error_code text, error_message text,
  changed_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select * from public.dbs_control_apply_work_order_delta(p_payload);
$$;

revoke all on function public.dbs_control_apply_work_order_delta(jsonb) from public, anon, authenticated;
revoke all on function public.process_work_order_update(jsonb) from public, anon, authenticated;
revoke all on function public.dbs_control_enqueue_outbox() from public, anon, authenticated;
grant execute on function public.dbs_control_apply_work_order_delta(jsonb) to service_role;
grant execute on function public.process_work_order_update(jsonb) to service_role;

do $$
begin
  if to_regclass('public.dbs_control_entity_records') is not null
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public'
        and tablename = 'dbs_control_entity_records'
    ) then
    alter publication supabase_realtime add table public.dbs_control_entity_records;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'dbs_control_outbox'
  ) then
    alter publication supabase_realtime add table public.dbs_control_outbox;
  end if;
end
$$;

commit;
