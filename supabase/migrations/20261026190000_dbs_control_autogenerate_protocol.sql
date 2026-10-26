-- DBS CONTROL: protocolo de OS gerado no servidor.
-- A criação de uma OS não depende mais de um campo preenchido no formulário.
-- A sequência é apenas um gerador de identificadores legíveis; lacunas são
-- aceitáveis e nenhuma linha existente é alterada.
begin;

create sequence if not exists public.dbs_control_work_order_protocol_seq start with 1;

do $do$
declare
  v_definition text;
  v_old_protocol_line text := $old$  v_candidate.protocol := coalesce(nullif(v_candidate.protocol,''), nullif(v_candidate.protocolo,''), v_protocol);$old$;
  v_new_protocol_line text := $new$  v_candidate.protocol := coalesce(nullif(v_candidate.protocol,''), nullif(v_candidate.protocolo,''), v_protocol,
    'DBS-' || to_char(clock_timestamp(), 'YYYY') || '-' || lpad(nextval('public.dbs_control_work_order_protocol_seq')::text, 6, '0'));$new$;
begin
  select pg_get_functiondef(p.oid)
    into v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'dbs_control_apply_work_order_delta'
    and pg_get_function_identity_arguments(p.oid) = 'p_payload jsonb';

  if v_definition is null then
    raise exception 'DBS_PROTOCOL_MIGRATION_FUNCTION_MISSING: função de delta não encontrada.';
  end if;
  if position(v_old_protocol_line in v_definition) = 0 then
    raise exception 'DBS_PROTOCOL_MIGRATION_UNEXPECTED_DEFINITION: linha de protocolo não encontrada.';
  end if;

  v_definition := replace(v_definition, v_old_protocol_line, v_new_protocol_line);
  v_definition := replace(
    v_definition,
    $old$  v_old_status text;$old$,
    $new$  v_old_status text;
  v_current_found boolean := false;$new$
  );
  v_definition := replace(
    v_definition,
    $oldblock$  if v_order_id is not null then
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

  if found then$oldblock$,
    $newblock$  if v_order_id is not null then
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

  if v_current_found then$newblock$
  );
  v_definition := replace(
    v_definition,
    $old$    if v_candidate.protocol is null or v_candidate.client_id is null then$old$,
    $new$    if v_candidate.client_id is null then$new$
  );
  v_definition := replace(
    v_definition,
    $old$      raise exception 'DBS_OS_REQUIRED: protocolo e cliente são obrigatórios.' using errcode = '22023';$old$,
    $new$      raise exception 'DBS_OS_REQUIRED: cliente é obrigatório.' using errcode = '22023';$new$
  );

  execute v_definition;
end;
$do$;

commit;
