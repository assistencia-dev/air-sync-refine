-- DBS CONTROL Fases 2–4: estrutura relacional, concorrência otimista e autorização.
-- Compatível com a tabela operacional existente; não remove nem recria OS.
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
    version = greatest(coalesce(version, 1), 1)
where protocolo is null
   or diagnostico is null
   or servico_executado is null
   or version is null
   or version < 1;

create unique index if not exists uq_dbs_control_work_orders_protocol
  on public.dbs_control_work_orders (protocol);
create index if not exists idx_dbs_control_work_orders_status_updated
  on public.dbs_control_work_orders (status, updated_at desc);
create index if not exists idx_dbs_control_work_orders_assignee_status_updated
  on public.dbs_control_work_orders (assigned_employee_id, status, updated_at desc);
create index if not exists idx_dbs_control_work_orders_scheduled
  on public.dbs_control_work_orders (scheduled_at) where completed_at is null;

create or replace function public.dbs_control_guard_work_order_write()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  old_is_completed boolean;
  new_is_completed boolean;
  actor_role text;
  actor_employee uuid;
begin
  if tg_op = 'INSERT' then
    new.protocolo := coalesce(nullif(btrim(new.protocolo), ''), nullif(btrim(new.protocol), ''));
    new.protocol := coalesce(nullif(btrim(new.protocol), ''), nullif(btrim(new.protocolo), ''));
    new.version := greatest(coalesce(new.version, 1), 1);
    new.updated_at := now();
    return new;
  end if;

  old_is_completed := lower(trim(coalesce(old.status, ''))) in
    ('concluida','concluída','concluido','concluído','completed','complete');
  new_is_completed := lower(trim(coalesce(new.status, ''))) in
    ('concluida','concluída','concluido','concluído','completed','complete');

  -- Clientes que enviam a versão lida devem corresponder à versão atual.
  -- Escritas legadas sem alteração da coluna version continuam compatíveis.
  if new.version is distinct from old.version and new.version is distinct from old.version + 1 then
    raise exception 'DBS_OS_STALE_VERSION: a OS foi alterada em outro dispositivo; atualize os dados antes de salvar.'
      using errcode = '40001';
  end if;

  if old_is_completed and not new_is_completed then
    raise exception 'DBS_OS_COMPLETED_LOCKED: uma OS concluída não pode ser reaberta por autosave.'
      using errcode = '55000';
  end if;

  if old_is_completed and (
       new.technical_opinion is distinct from old.technical_opinion
    or new.diagnostico is distinct from old.diagnostico
    or new.observation is distinct from old.observation
    or new.servico_executado is distinct from old.servico_executado
    or new.signature_data is distinct from old.signature_data
    or new.signature_path is distinct from old.signature_path
    or new.signature_name is distinct from old.signature_name
    or new.completed_at is distinct from old.completed_at
  ) then
    raise exception 'DBS_OS_COMPLETED_LOCKED: os dados assinados da OS concluída estão protegidos.'
      using errcode = '55000';
  end if;

  select u.role_key::text into actor_role
  from public.users u where u.auth_id = auth.uid() and u.status = 'ativo' limit 1;

  if coalesce(actor_role, '') = 'COLABORADOR' then
    if new.assigned_employee_id is distinct from old.assigned_employee_id
      or new.client_id is distinct from old.client_id
      or new.site_id is distinct from old.site_id
      or new.protocol is distinct from old.protocol
      or new.total_cents is distinct from old.total_cents then
      raise exception 'DBS_OS_FIELD_FORBIDDEN: colaborador não pode alterar campos administrativos da OS.'
        using errcode = '42501';
    end if;
  end if;

  new.protocol := coalesce(nullif(btrim(new.protocol), ''), nullif(btrim(new.protocolo), ''), old.protocol);
  new.protocolo := coalesce(nullif(btrim(new.protocolo), ''), nullif(btrim(new.protocol), ''), old.protocolo);
  new.diagnostico := coalesce(new.diagnostico, new.technical_opinion);
  new.technical_opinion := coalesce(new.technical_opinion, new.diagnostico);
  new.servico_executado := coalesce(new.servico_executado, new.observation);
  new.observation := coalesce(new.observation, new.servico_executado);
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
create policy "dbs_control_work_orders_read_admin_or_assigned"
on public.dbs_control_work_orders for select to authenticated
using (
  exists (
    select 1 from public.users u
    where u.auth_id = (select auth.uid()) and u.status = 'ativo'
      and (
        u.role_key::text in ('SUPER_ADMIN','ADMIN_OPERACIONAL','GESTOR_CONTA','GESTOR_REGIONAL')
        or exists (
          select 1 from public.rh_employee_access ea
          where ea.user_id = u.id and ea.employee_id = dbs_control_work_orders.assigned_employee_id
            and ea.access_enabled = true
        )
      )
  )
);

drop policy if exists "dbs_control_work_orders_insert_admin" on public.dbs_control_work_orders;
create policy "dbs_control_work_orders_insert_admin"
on public.dbs_control_work_orders for insert to authenticated
with check (
  exists (
    select 1 from public.users u
    where u.auth_id = (select auth.uid()) and u.status = 'ativo'
      and u.role_key::text in ('SUPER_ADMIN','ADMIN_OPERACIONAL','GESTOR_CONTA','GESTOR_REGIONAL')
  )
);

drop policy if exists "dbs_control_work_orders_update_admin_or_assigned" on public.dbs_control_work_orders;
create policy "dbs_control_work_orders_update_admin_or_assigned"
on public.dbs_control_work_orders for update to authenticated
using (
  exists (
    select 1 from public.users u
    where u.auth_id = (select auth.uid()) and u.status = 'ativo'
      and (
        u.role_key::text in ('SUPER_ADMIN','ADMIN_OPERACIONAL','GESTOR_CONTA','GESTOR_REGIONAL')
        or exists (
          select 1 from public.rh_employee_access ea
          where ea.user_id = u.id and ea.employee_id = dbs_control_work_orders.assigned_employee_id
            and ea.access_enabled = true
        )
      )
  )
)
with check (
  exists (
    select 1 from public.users u
    where u.auth_id = (select auth.uid()) and u.status = 'ativo'
      and (
        u.role_key::text in ('SUPER_ADMIN','ADMIN_OPERACIONAL','GESTOR_CONTA','GESTOR_REGIONAL')
        or exists (
          select 1 from public.rh_employee_access ea
          where ea.user_id = u.id and ea.employee_id = dbs_control_work_orders.assigned_employee_id
            and ea.access_enabled = true
        )
      )
  )
);

commit;
