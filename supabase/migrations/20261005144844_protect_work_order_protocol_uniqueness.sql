create or replace function public.ensure_dbs_control_work_order_protocol_unique()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.protocol is null or btrim(new.protocol) = '' then
    new.protocol := 'OS-' || replace(new.id::text, '-', '');
  end if;

  if exists (
    select 1
    from public.dbs_control_work_orders existing
    where existing.protocol = new.protocol
      and existing.id <> new.id
  ) then
    new.protocol := left(new.protocol, 80) || '-FC-' || replace(new.id::text, '-', '');
  end if;

  return new;
end;
$$;

drop trigger if exists trg_ensure_dbs_control_work_order_protocol_unique
on public.dbs_control_work_orders;

create trigger trg_ensure_dbs_control_work_order_protocol_unique
before insert or update of protocol
on public.dbs_control_work_orders
for each row
execute function public.ensure_dbs_control_work_order_protocol_unique();
