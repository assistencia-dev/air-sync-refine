-- DBS CONTROL Fases 2–4: OS relacional, versionamento otimista e RLS.
-- Migração aditiva: preserva as tabelas e registros existentes.
begin;

alter table public.dbs_control_work_orders
  add column if not exists protocolo text,
  add column if not exists diagnostico text,
  add column if not exists servico_executado text,
  add column if not exists assinatura_path text,
  add column if not exists version bigint not null default 1;

update public.dbs_control_work_orders
set protocolo = coalesce(nullif(btrim(protocolo), ''), protocol),
    diagnostico = coalesce(diagnostico, technical_opinion),
    servico_executado = coalesce(servico_executado, observation),
    version = greatest(coalesce(version, 1), 1);

create index if not exists idx_dbs_control_work_orders_protocol
  on public.dbs_control_work_orders(protocol);
create index if not exists idx_dbs_control_work_orders_status_updated
  on public.dbs_control_work_orders(status, updated_at desc);
create index if not exists idx_dbs_control_work_orders_assignee_status_updated
  on public.dbs_control_work_orders(assigned_employee_id, status, updated_at desc);
create index if not exists idx_dbs_control_work_orders_scheduled
  on public.dbs_control_work_orders(scheduled_at) where completed_at is null;

-- Importa somente OS cujo cliente já existe no cadastro relacional. Não apaga nem
-- sobrescreve protocolos existentes; itens legados sem cliente válido ficam no snapshot.
insert into public.dbs_control_work_orders
  (id, protocol, protocolo, client_id, site_id, assigned_employee_id, created_by_user_id,
   type, priority, status, scheduled_at, started_at, completed_at, description,
   technical_opinion, diagnostico, observation, servico_executado, signature_name,
   signature_data, signature_path, assinatura_path, created_at, updated_at, version)
select
  case when coalesce(o.item->>'id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       then (o.item->>'id')::uuid else gen_random_uuid() end,
  coalesce(nullif(btrim(o.item->>'protocolo'),''), nullif(btrim(o.item->>'protocol'),'')),
  coalesce(nullif(btrim(o.item->>'protocolo'),''), nullif(btrim(o.item->>'protocol'),'')),
  c.id,
  case when coalesce(o.item->>'siteId',o.item->>'localId','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       then coalesce(o.item->>'siteId',o.item->>'localId')::uuid else null end,
  case when coalesce(o.item->>'employeeId',o.item->>'assignedEmployeeId',o.item->>'tecnicoId','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}
  s.updated_by,
  coalesce(nullif(o.item->>'tipo',''),'corretiva'),
  coalesce(nullif(o.item->>'prioridade',''),'normal'),
  case
    when lower(trim(coalesce(o.item->>'status',''))) in ('concluída','concluida','concluído','concluido','completed','complete') then 'concluida'
    when lower(trim(coalesce(o.item->>'status',''))) in ('em atendimento','em_atendimento','andamento') then 'em_atendimento'
    when lower(trim(coalesce(o.item->>'status',''))) in ('aguardando peça','aguardando_peca') then 'aguardando_peca'
    when lower(trim(coalesce(o.item->>'status',''))) in ('aguardando cliente','aguardando_cliente') then 'aguardando_cliente'
    when lower(trim(coalesce(o.item->>'status',''))) in ('cancelada','cancelado') then 'cancelada'
    else 'aberta'
  end,
  case when coalesce(o.item->>'scheduledAt',o.item->>'scheduled_at','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then coalesce(o.item->>'scheduledAt',o.item->>'scheduled_at')::timestamptz else null end,
  case when coalesce(o.item->>'startedAt',o.item->>'started_at','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then coalesce(o.item->>'startedAt',o.item->>'started_at')::timestamptz else null end,
  case when coalesce(o.item->>'concluidoEm',o.item->>'completedAt',o.item->>'completed_at','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then coalesce(o.item->>'concluidoEm',o.item->>'completedAt',o.item->>'completed_at')::timestamptz else null end,
  coalesce(o.item->>'desc',o.item->>'description',''),
  coalesce(o.item->>'diagnostico',o.item->>'technical_opinion',''),
  coalesce(o.item->>'diagnostico',o.item->>'technical_opinion',''),
  coalesce(o.item->>'observacao',o.item->>'observation',''),
  coalesce(o.item->>'trabalhoExecutado',o.item->>'servicoExecutado',o.item->>'observacao',o.item->>'observation',''),
  coalesce(o.item->>'signature_name',o.item->>'signatureName',''),
  case when coalesce(o.item->>'assinaturaStoragePath',o.item->>'assinatura_path',o.item->>'signature_path','') <> '' then null else nullif(o.item->>'assinatura','') end,
  nullif(coalesce(o.item->>'assinaturaStoragePath',o.item->>'assinatura_path',o.item->>'signature_path',''),''),
  nullif(coalesce(o.item->>'assinaturaStoragePath',o.item->>'assinatura_path',o.item->>'signature_path',''),''),
  s.updated_at, s.updated_at, 1
from public.dbs_control_snapshots s
cross join lateral jsonb_array_elements(case when jsonb_typeof(s.state->'ordens')='array' then s.state->'ordens' else '[]'::jsonb end) o(item)
join public.dbs_control_clients c on c.id::text = coalesce(o.item->>'clienteId',o.item->>'client_id','')
where coalesce(nullif(btrim(o.item->>'protocolo'),''),nullif(btrim(o.item->>'protocol'),'')) is not null
  and not exists (select 1 from public.dbs_control_work_orders w where w.protocol = coalesce(nullif(btrim(o.item->>'protocolo'),''),nullif(btrim(o.item->>'protocol'),'')))
on conflict do nothing;

create or replace function public.dbs_control_guard_work_order_write()
returns trigger language plpgsql set search_path = public as $$
declare
  old_done boolean;
  new_done boolean;
  actor_role text;
begin
  if tg_op = 'INSERT' then
    new.protocol := coalesce(nullif(btrim(new.protocol),''), nullif(btrim(new.protocolo),''));
    new.protocolo := coalesce(nullif(btrim(new.protocolo),''), nullif(btrim(new.protocol),''));
    new.diagnostico := coalesce(new.diagnostico,new.technical_opinion);
    new.technical_opinion := coalesce(new.technical_opinion,new.diagnostico);
    new.servico_executado := coalesce(new.servico_executado,new.observation);
    new.observation := coalesce(new.observation,new.servico_executado);
    new.version := greatest(coalesce(new.version,1),1);
    new.updated_at := now();
    return new;
  end if;

  old_done := lower(trim(coalesce(old.status,''))) in ('concluida','concluída','concluido','concluído','completed','complete');
  new_done := lower(trim(coalesce(new.status,''))) in ('concluida','concluída','concluido','concluído','completed','complete');

  if new.version is distinct from old.version and new.version is distinct from old.version + 1 then
    raise exception 'DBS_OS_STALE_VERSION: OS alterada em outro dispositivo; atualize antes de salvar.' using errcode = '40001';
  end if;
  if old_done and not new_done then
    raise exception 'DBS_OS_COMPLETED_LOCKED: OS concluída não pode ser reaberta por autosave.' using errcode = '55000';
  end if;
  if old_done and (
       new.technical_opinion is distinct from old.technical_opinion
    or new.diagnostico is distinct from old.diagnostico
    or new.observation is distinct from old.observation
    or new.servico_executado is distinct from old.servico_executado
    or new.signature_data is distinct from old.signature_data
    or new.signature_path is distinct from old.signature_path
    or new.assinatura_path is distinct from old.assinatura_path
    or new.signature_name is distinct from old.signature_name
    or new.completed_at is distinct from old.completed_at
  ) then
    raise exception 'DBS_OS_COMPLETED_LOCKED: dados assinados da OS concluída estão protegidos.' using errcode = '55000';
  end if;

  select u.role_key::text into actor_role from public.users u
  where u.auth_id = auth.uid() and u.status = 'ativo' limit 1;
  if actor_role = 'COLABORADOR' and (
       new.assigned_employee_id is distinct from old.assigned_employee_id
    or new.client_id is distinct from old.client_id
    or new.site_id is distinct from old.site_id
    or new.protocol is distinct from old.protocol
    or new.total_cents is distinct from old.total_cents
  ) then
    raise exception 'DBS_OS_FIELD_FORBIDDEN: colaborador não pode alterar campos administrativos.' using errcode = '42501';
  end if;

  new.protocol := coalesce(nullif(btrim(new.protocol),''),nullif(btrim(new.protocolo),''),old.protocol);
  new.protocolo := coalesce(nullif(btrim(new.protocolo),''),nullif(btrim(new.protocol),''),old.protocolo);
  new.diagnostico := coalesce(new.diagnostico,new.technical_opinion);
  new.technical_opinion := coalesce(new.technical_opinion,new.diagnostico);
  new.servico_executado := coalesce(new.servico_executado,new.observation);
  new.observation := coalesce(new.observation,new.servico_executado);
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_dbs_control_work_orders_guard_write on public.dbs_control_work_orders;
create trigger trg_dbs_control_work_orders_guard_write
before insert or update on public.dbs_control_work_orders
for each row execute function public.dbs_control_guard_work_order_write();

alter table public.dbs_control_work_orders enable row level security;
drop policy if exists "dbs_control_work_orders_read_admin_or_assigned" on public.dbs_control_work_orders;
create policy "dbs_control_work_orders_read_admin_or_assigned" on public.dbs_control_work_orders
for select to authenticated using (
  exists (select 1 from public.users u where u.auth_id=(select auth.uid()) and u.status='ativo'
    and (u.role_key::text in ('SUPER_ADMIN','ADMIN_OPERACIONAL','GESTOR_CONTA','GESTOR_REGIONAL')
      or exists (select 1 from public.rh_employee_access ea where ea.user_id=u.id
        and ea.employee_id=dbs_control_work_orders.assigned_employee_id and ea.access_enabled=true)))
);

drop policy if exists "dbs_control_work_orders_insert_admin" on public.dbs_control_work_orders;
create policy "dbs_control_work_orders_insert_admin" on public.dbs_control_work_orders
for insert to authenticated with check (
  exists (select 1 from public.users u where u.auth_id=(select auth.uid()) and u.status='ativo'
    and u.role_key::text in ('SUPER_ADMIN','ADMIN_OPERACIONAL','GESTOR_CONTA','GESTOR_REGIONAL'))
);

drop policy if exists "dbs_control_work_orders_update_admin_or_assigned" on public.dbs_control_work_orders;
create policy "dbs_control_work_orders_update_admin_or_assigned" on public.dbs_control_work_orders
for update to authenticated using (
  exists (select 1 from public.users u where u.auth_id=(select auth.uid()) and u.status='ativo'
    and (u.role_key::text in ('SUPER_ADMIN','ADMIN_OPERACIONAL','GESTOR_CONTA','GESTOR_REGIONAL')
      or exists (select 1 from public.rh_employee_access ea where ea.user_id=u.id
        and ea.employee_id=dbs_control_work_orders.assigned_employee_id and ea.access_enabled=true)))
) with check (
  exists (select 1 from public.users u where u.auth_id=(select auth.uid()) and u.status='ativo'
    and (u.role_key::text in ('SUPER_ADMIN','ADMIN_OPERACIONAL','GESTOR_CONTA','GESTOR_REGIONAL')
      or exists (select 1 from public.rh_employee_access ea where ea.user_id=u.id
        and ea.employee_id=dbs_control_work_orders.assigned_employee_id and ea.access_enabled=true)))
);

-- Realtime para as fontes canônicas e snapshot durante compatibilidade.
do $$
declare t text;
begin
  foreach t in array array['dbs_control_snapshots','dbs_control_work_orders','dbs_control_work_order_events','dbs_control_work_order_attachments'] loop
    if to_regclass('public.'||t) is not null and not exists (
      select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t
    ) then execute format('alter publication supabase_realtime add table public.%I',t); end if;
  end loop;
end
$$;

commit;

       then case when exists (select 1 from public.rh_employees e where e.id = coalesce(o.item->>'employeeId',o.item->>'assignedEmployeeId',o.item->>'tecnicoId')::uuid)
            then coalesce(o.item->>'employeeId',o.item->>'assignedEmployeeId',o.item->>'tecnicoId')::uuid else null end
       else null end,
  s.updated_by,
  coalesce(nullif(o.item->>'tipo',''),'corretiva'),
  coalesce(nullif(o.item->>'prioridade',''),'normal'),
  case
    when lower(trim(coalesce(o.item->>'status',''))) in ('concluída','concluida','concluído','concluido','completed','complete') then 'concluida'
    when lower(trim(coalesce(o.item->>'status',''))) in ('em atendimento','em_atendimento','andamento') then 'em_atendimento'
    when lower(trim(coalesce(o.item->>'status',''))) in ('aguardando peça','aguardando_peca') then 'aguardando_peca'
    when lower(trim(coalesce(o.item->>'status',''))) in ('aguardando cliente','aguardando_cliente') then 'aguardando_cliente'
    when lower(trim(coalesce(o.item->>'status',''))) in ('cancelada','cancelado') then 'cancelada'
    else 'aberta'
  end,
  case when coalesce(o.item->>'scheduledAt',o.item->>'scheduled_at','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then coalesce(o.item->>'scheduledAt',o.item->>'scheduled_at')::timestamptz else null end,
  case when coalesce(o.item->>'startedAt',o.item->>'started_at','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then coalesce(o.item->>'startedAt',o.item->>'started_at')::timestamptz else null end,
  case when coalesce(o.item->>'concluidoEm',o.item->>'completedAt',o.item->>'completed_at','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then coalesce(o.item->>'concluidoEm',o.item->>'completedAt',o.item->>'completed_at')::timestamptz else null end,
  coalesce(o.item->>'desc',o.item->>'description',''),
  coalesce(o.item->>'diagnostico',o.item->>'technical_opinion',''),
  coalesce(o.item->>'diagnostico',o.item->>'technical_opinion',''),
  coalesce(o.item->>'observacao',o.item->>'observation',''),
  coalesce(o.item->>'trabalhoExecutado',o.item->>'servicoExecutado',o.item->>'observacao',o.item->>'observation',''),
  coalesce(o.item->>'signature_name',o.item->>'signatureName',''),
  case when coalesce(o.item->>'assinaturaStoragePath',o.item->>'assinatura_path',o.item->>'signature_path','') <> '' then null else nullif(o.item->>'assinatura','') end,
  nullif(coalesce(o.item->>'assinaturaStoragePath',o.item->>'assinatura_path',o.item->>'signature_path',''),''),
  nullif(coalesce(o.item->>'assinaturaStoragePath',o.item->>'assinatura_path',o.item->>'signature_path',''),''),
  s.updated_at, s.updated_at, 1
from public.dbs_control_snapshots s
cross join lateral jsonb_array_elements(case when jsonb_typeof(s.state->'ordens')='array' then s.state->'ordens' else '[]'::jsonb end) o(item)
join public.dbs_control_clients c on c.id::text = coalesce(o.item->>'clienteId',o.item->>'client_id','')
where coalesce(nullif(btrim(o.item->>'protocolo'),''),nullif(btrim(o.item->>'protocol'),'')) is not null
  and not exists (select 1 from public.dbs_control_work_orders w where w.protocol = coalesce(nullif(btrim(o.item->>'protocolo'),''),nullif(btrim(o.item->>'protocol'),'')))
on conflict do nothing;

create or replace function public.dbs_control_guard_work_order_write()
returns trigger language plpgsql set search_path = public as $$
declare
  old_done boolean;
  new_done boolean;
  actor_role text;
begin
  if tg_op = 'INSERT' then
    new.protocol := coalesce(nullif(btrim(new.protocol),''), nullif(btrim(new.protocolo),''));
    new.protocolo := coalesce(nullif(btrim(new.protocolo),''), nullif(btrim(new.protocol),''));
    new.diagnostico := coalesce(new.diagnostico,new.technical_opinion);
    new.technical_opinion := coalesce(new.technical_opinion,new.diagnostico);
    new.servico_executado := coalesce(new.servico_executado,new.observation);
    new.observation := coalesce(new.observation,new.servico_executado);
    new.version := greatest(coalesce(new.version,1),1);
    new.updated_at := now();
    return new;
  end if;

  old_done := lower(trim(coalesce(old.status,''))) in ('concluida','concluída','concluido','concluído','completed','complete');
  new_done := lower(trim(coalesce(new.status,''))) in ('concluida','concluída','concluido','concluído','completed','complete');

  if new.version is distinct from old.version and new.version is distinct from old.version + 1 then
    raise exception 'DBS_OS_STALE_VERSION: OS alterada em outro dispositivo; atualize antes de salvar.' using errcode = '40001';
  end if;
  if old_done and not new_done then
    raise exception 'DBS_OS_COMPLETED_LOCKED: OS concluída não pode ser reaberta por autosave.' using errcode = '55000';
  end if;
  if old_done and (
       new.technical_opinion is distinct from old.technical_opinion
    or new.diagnostico is distinct from old.diagnostico
    or new.observation is distinct from old.observation
    or new.servico_executado is distinct from old.servico_executado
    or new.signature_data is distinct from old.signature_data
    or new.signature_path is distinct from old.signature_path
    or new.assinatura_path is distinct from old.assinatura_path
    or new.signature_name is distinct from old.signature_name
    or new.completed_at is distinct from old.completed_at
  ) then
    raise exception 'DBS_OS_COMPLETED_LOCKED: dados assinados da OS concluída estão protegidos.' using errcode = '55000';
  end if;

  select u.role_key::text into actor_role from public.users u
  where u.auth_id = auth.uid() and u.status = 'ativo' limit 1;
  if actor_role = 'COLABORADOR' and (
       new.assigned_employee_id is distinct from old.assigned_employee_id
    or new.client_id is distinct from old.client_id
    or new.site_id is distinct from old.site_id
    or new.protocol is distinct from old.protocol
    or new.total_cents is distinct from old.total_cents
  ) then
    raise exception 'DBS_OS_FIELD_FORBIDDEN: colaborador não pode alterar campos administrativos.' using errcode = '42501';
  end if;

  new.protocol := coalesce(nullif(btrim(new.protocol),''),nullif(btrim(new.protocolo),''),old.protocol);
  new.protocolo := coalesce(nullif(btrim(new.protocolo),''),nullif(btrim(new.protocol),''),old.protocolo);
  new.diagnostico := coalesce(new.diagnostico,new.technical_opinion);
  new.technical_opinion := coalesce(new.technical_opinion,new.diagnostico);
  new.servico_executado := coalesce(new.servico_executado,new.observation);
  new.observation := coalesce(new.observation,new.servico_executado);
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_dbs_control_work_orders_guard_write on public.dbs_control_work_orders;
create trigger trg_dbs_control_work_orders_guard_write
before insert or update on public.dbs_control_work_orders
for each row execute function public.dbs_control_guard_work_order_write();

alter table public.dbs_control_work_orders enable row level security;
drop policy if exists "dbs_control_work_orders_read_admin_or_assigned" on public.dbs_control_work_orders;
create policy "dbs_control_work_orders_read_admin_or_assigned" on public.dbs_control_work_orders
for select to authenticated using (
  exists (select 1 from public.users u where u.auth_id=(select auth.uid()) and u.status='ativo'
    and (u.role_key::text in ('SUPER_ADMIN','ADMIN_OPERACIONAL','GESTOR_CONTA','GESTOR_REGIONAL')
      or exists (select 1 from public.rh_employee_access ea where ea.user_id=u.id
        and ea.employee_id=dbs_control_work_orders.assigned_employee_id and ea.access_enabled=true)))
);

drop policy if exists "dbs_control_work_orders_insert_admin" on public.dbs_control_work_orders;
create policy "dbs_control_work_orders_insert_admin" on public.dbs_control_work_orders
for insert to authenticated with check (
  exists (select 1 from public.users u where u.auth_id=(select auth.uid()) and u.status='ativo'
    and u.role_key::text in ('SUPER_ADMIN','ADMIN_OPERACIONAL','GESTOR_CONTA','GESTOR_REGIONAL'))
);

drop policy if exists "dbs_control_work_orders_update_admin_or_assigned" on public.dbs_control_work_orders;
create policy "dbs_control_work_orders_update_admin_or_assigned" on public.dbs_control_work_orders
for update to authenticated using (
  exists (select 1 from public.users u where u.auth_id=(select auth.uid()) and u.status='ativo'
    and (u.role_key::text in ('SUPER_ADMIN','ADMIN_OPERACIONAL','GESTOR_CONTA','GESTOR_REGIONAL')
      or exists (select 1 from public.rh_employee_access ea where ea.user_id=u.id
        and ea.employee_id=dbs_control_work_orders.assigned_employee_id and ea.access_enabled=true)))
) with check (
  exists (select 1 from public.users u where u.auth_id=(select auth.uid()) and u.status='ativo'
    and (u.role_key::text in ('SUPER_ADMIN','ADMIN_OPERACIONAL','GESTOR_CONTA','GESTOR_REGIONAL')
      or exists (select 1 from public.rh_employee_access ea where ea.user_id=u.id
        and ea.employee_id=dbs_control_work_orders.assigned_employee_id and ea.access_enabled=true)))
);

-- Realtime para as fontes canônicas e snapshot durante compatibilidade.
do $$
declare t text;
begin
  foreach t in array array['dbs_control_snapshots','dbs_control_work_orders','dbs_control_work_order_events','dbs_control_work_order_attachments'] loop
    if to_regclass('public.'||t) is not null and not exists (
      select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t
    ) then execute format('alter publication supabase_realtime add table public.%I',t); end if;
  end loop;
end
$$;

commit;
