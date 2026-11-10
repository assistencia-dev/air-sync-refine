-- DBS CONTROL: campos de data opcionais nunca devem chegar ao Postgres como "".
-- Migração aditiva e idempotente; não altera nem exclui OS existentes.
begin;

create or replace function public.dbs_control_normalize_work_order_timestamps(p_patch jsonb)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  v_key text;
  v_raw text;
  v_probe timestamptz;
begin
  foreach v_key in array array['scheduled_at','started_at','completed_at','sla_deadline','deleted_at'] loop
    if v_patch ? v_key then
      v_raw := nullif(btrim(v_patch->>v_key), '');
      if v_raw is null then
        v_patch := jsonb_set(v_patch, array[v_key], 'null'::jsonb, true);
      else
        begin
          -- Validar antes de jsonb_populate_record; valores malformados
          -- opcionais são descartados como NULL, sem bloquear a OS.
          v_probe := v_raw::timestamptz;
          v_patch := jsonb_set(v_patch, array[v_key], to_jsonb(v_raw), true);
        exception when others then
          v_patch := jsonb_set(v_patch, array[v_key], 'null'::jsonb, true);
        end;
      end if;
    end if;
  end loop;
  return v_patch;
end;
$$;

revoke all on function public.dbs_control_normalize_work_order_timestamps(jsonb) from public, anon, authenticated;
grant execute on function public.dbs_control_normalize_work_order_timestamps(jsonb) to service_role;

do $do$
declare
  v_definition text;
  v_old text := $old$  v_patch jsonb := coalesce(p_payload->'patch', '{}'::jsonb);$old$;
  v_new text := $new$  v_patch jsonb := public.dbs_control_normalize_work_order_timestamps(coalesce(p_payload->'patch', '{}'::jsonb));$new$;
begin
  select pg_get_functiondef(p.oid)
    into v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'dbs_control_apply_work_order_delta'
    and pg_get_function_identity_arguments(p.oid) = 'p_payload jsonb';

  if v_definition is null then
    raise exception 'DBS_TIMESTAMP_MIGRATION_FUNCTION_MISSING: função de delta não encontrada.';
  end if;
  if position('dbs_control_normalize_work_order_timestamps' in v_definition) > 0 then
    return;
  end if;
  if position(v_old in v_definition) = 0 then
    raise exception 'DBS_TIMESTAMP_MIGRATION_UNEXPECTED_DEFINITION: patch da função não encontrado.';
  end if;

  v_definition := replace(v_definition, v_old, v_new);
  execute v_definition;
end;
$do$;

commit;
