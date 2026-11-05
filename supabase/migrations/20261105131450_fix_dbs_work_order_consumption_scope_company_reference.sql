do $$
declare
  v_def text;
  v_old text := 'and coalesce(u.company_id,wo.company_id)=wo.company_id';
  v_new text := 'and coalesce(u.company_id,v_scope.company_id)=v_scope.company_id';
begin
  select pg_get_functiondef('public.dbs_control_consume_work_order_reservations(uuid,uuid,text)'::regprocedure)
    into v_def;
  if position(v_old in v_def)=0 then
    raise exception 'Expected obsolete work-order company_id reference was not found.';
  end if;
  execute replace(v_def,v_old,v_new);
end;
$$;
