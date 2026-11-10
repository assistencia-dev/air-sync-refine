-- DBS CONTROL: restaura e versiona as duas funções de proteção usadas por triggers.
-- As definições abaixo foram conferidas no Supabase oficial em 2026-11-10.
-- A migration é aditiva: não altera linhas nem recria tabelas.
begin;

create or replace function public.ensure_dbs_control_work_order_protocol_unique()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
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
$function$;

create or replace function public.protect_dbs_control_fieldcontrol_integration()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'A integração FieldControl não pode ser excluída.';
  end if;

  if tg_op = 'UPDATE' then
    if coalesce(trim(new.api_key), '') = '' then
      new.api_key := old.api_key;
    end if;
  end if;

  return new;
end;
$function$;

-- As chamadas diretas pela Data API ficam bloqueadas; os triggers continuam
-- executando estas funções com os privilégios do proprietário.
revoke all on function public.ensure_dbs_control_work_order_protocol_unique()
  from public, anon, authenticated;
grant execute on function public.ensure_dbs_control_work_order_protocol_unique()
  to service_role;

revoke all on function public.protect_dbs_control_fieldcontrol_integration()
  from public, anon, authenticated;
grant execute on function public.protect_dbs_control_fieldcontrol_integration()
  to service_role;

-- Garante que os triggers estejam versionados e ligados às funções acima.
drop trigger if exists trg_ensure_dbs_control_work_order_protocol_unique
  on public.dbs_control_work_orders;
create trigger trg_ensure_dbs_control_work_order_protocol_unique
  before insert or update of protocol
  on public.dbs_control_work_orders
  for each row
  execute function public.ensure_dbs_control_work_order_protocol_unique();

drop trigger if exists trg_protect_dbs_control_fieldcontrol_integration
  on public.dbs_control_integrations;
create trigger trg_protect_dbs_control_fieldcontrol_integration
  before delete or update
  on public.dbs_control_integrations
  for each row
  execute function public.protect_dbs_control_fieldcontrol_integration();

comment on function public.ensure_dbs_control_work_order_protocol_unique() is
  'Gera protocolo quando ausente e evita colisões antes de gravar a OS.';
comment on function public.protect_dbs_control_fieldcontrol_integration() is
  'Impede excluir a integração FieldControl e impede apagar sua chave por UPDATE vazio.';

commit;
