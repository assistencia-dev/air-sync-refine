do $$
declare
  v_def text;
  v_old text := $old$   where status = 'ativo';$old$;
begin
  select pg_get_functiondef('public.dbs_control_inventory_financial_overview(uuid)'::regprocedure)
    into v_def;
  if position(v_old in v_def)=0 then
    raise exception 'Expected active-only stock valuation filter was not found.';
  end if;
  execute replace(v_def,v_old,';');
end;
$$;
