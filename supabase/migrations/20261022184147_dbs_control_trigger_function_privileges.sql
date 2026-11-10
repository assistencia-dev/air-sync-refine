begin;

-- These trigger functions were created outside the versioned migrations in some
-- environments. Apply the hardening only where they exist, so a fresh database
-- can replay the history. Access restrictions are unchanged when present.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.ensure_dbs_control_work_order_protocol_unique()',
    'public.protect_dbs_control_fieldcontrol_integration()'
  ]
  loop
    if to_regprocedure(fn) is not null then
      execute format('alter function %s set search_path = pg_catalog', fn);
      execute format('revoke all on function %s from public, anon, authenticated', fn);
      execute format('grant execute on function %s to service_role', fn);
    else
      raise notice 'DBS: % ausente neste ambiente; endurecimento ignorado.', fn;
    end if;
  end loop;
end
$$;

commit;
