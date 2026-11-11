-- DBS CONTROL: uma OS nova sem protocolo não pode herdar FOUND de uma
-- consulta anterior e ser tratada incorretamente como conflito.
begin;

do $do$
declare
  v_definition text;
  v_old_block text := $oldblock$  if v_order_id is not null then
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

  if found then$oldblock$;
  v_new_block text := $newblock$  if v_order_id is not null then
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

  if v_current_found then$newblock$;
begin
  select pg_get_functiondef(p.oid)
    into v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'dbs_control_apply_work_order_delta'
    and pg_get_function_identity_arguments(p.oid) = 'p_payload jsonb';

  if v_definition is null then
    raise exception 'DBS_PROTOCOL_LOOKUP_MIGRATION_FUNCTION_MISSING: função de delta não encontrada.';
  end if;
  if position(v_old_block in v_definition) = 0 then
    if position('v_current_found boolean' in v_definition) > 0 then
      return;
    end if;
    raise exception 'DBS_PROTOCOL_LOOKUP_MIGRATION_UNEXPECTED_DEFINITION: bloco de consulta não encontrado.';
  end if;

  v_definition := replace(v_definition, $old$  v_old_status text;$old$, $new$  v_old_status text;
  v_current_found boolean := false;$new$);
  v_definition := replace(v_definition, v_old_block, v_new_block);
  execute v_definition;
end;
$do$;

commit;
