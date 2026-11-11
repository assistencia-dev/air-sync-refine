-- DBS CONTROL: versiona o guard FieldControl que existia apenas no banco.
-- A função e os gatilhos foram conferidos no Supabase oficial em 2026-11-10.
-- A função de protocolo é restaurada na migration histórica 20261005144844;
-- aqui ela apenas recebe novamente o endurecimento de privilégios/search_path.
begin;

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

-- Garante o search_path seguro nas duas funções SECURITY DEFINER.
alter function public.ensure_dbs_control_work_order_protocol_unique()
  set search_path = pg_catalog;
alter function public.protect_dbs_control_fieldcontrol_integration()
  set search_path = pg_catalog;

-- Bloqueia RPC direto; os triggers permanecem associados às funções.
revoke all on function public.ensure_dbs_control_work_order_protocol_unique()
  from public, anon, authenticated;
grant execute on function public.ensure_dbs_control_work_order_protocol_unique()
  to service_role;

revoke all on function public.protect_dbs_control_fieldcontrol_integration()
  from public, anon, authenticated;
grant execute on function public.protect_dbs_control_fieldcontrol_integration()
  to service_role;

-- O trigger da integração também passa a ser reproduzível em banco novo.
drop trigger if exists trg_protect_dbs_control_fieldcontrol_integration
  on public.dbs_control_integrations;
create trigger trg_protect_dbs_control_fieldcontrol_integration
  before delete or update
  on public.dbs_control_integrations
  for each row
  execute function public.protect_dbs_control_fieldcontrol_integration();

comment on function public.protect_dbs_control_fieldcontrol_integration() is
  'Impede excluir a integração FieldControl e impede apagar sua chave por UPDATE vazio.';

commit;
