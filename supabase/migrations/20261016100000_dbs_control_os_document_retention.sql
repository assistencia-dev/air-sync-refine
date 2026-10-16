-- DBS CONTROL: trilha append-only e proteção contra exclusão/reabertura de OS.
-- Não altera registros existentes; protege novas alterações a partir da instalação.
create table if not exists public.dbs_control_work_order_revisions (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null,
  protocol text,
  action text not null check (action in ('INSERT','UPDATE')),
  before_data jsonb,
  after_data jsonb,
  actor_user_id uuid,
  recorded_at timestamptz not null default now()
);
create index if not exists dbs_control_work_order_revisions_order_idx
  on public.dbs_control_work_order_revisions (work_order_id, recorded_at desc);
create index if not exists dbs_control_work_order_revisions_protocol_idx
  on public.dbs_control_work_order_revisions (protocol, recorded_at desc);
alter table public.dbs_control_work_order_revisions enable row level security;
revoke all on public.dbs_control_work_order_revisions from anon, authenticated;
grant select on public.dbs_control_work_order_revisions to authenticated;
drop policy if exists "dbs_control_work_order_revisions_admin_read" on public.dbs_control_work_order_revisions;
create policy "dbs_control_work_order_revisions_admin_read"
  on public.dbs_control_work_order_revisions for select to authenticated
  using (public.current_role_key() in ('SUPER_ADMIN','ADMIN_OPERACIONAL','GESTOR_CONTA','GESTOR_REGIONAL'));

create or replace function public.dbs_control_protect_work_order_document()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  old_completed boolean := false;
  new_completed boolean := false;
  actor_text text;
begin
  if TG_OP = 'DELETE' then
    raise exception 'Exclusão física de Ordem de Serviço bloqueada: documento operacional deve ser preservado. Cancele a OS com justificativa e mantenha seu histórico.'
      using errcode = '55000';
  end if;
  if TG_OP = 'UPDATE' then
    old_completed := lower(trim(coalesce(OLD.status, ''))) in ('concluida','concluída','concluido','concluído');
    new_completed := lower(trim(coalesce(NEW.status, ''))) in ('concluida','concluída','concluido','concluído');
    if old_completed and not new_completed then
      raise exception 'OS concluída protegida: não é permitido reabrir ou rebaixar o status do documento assinado.'
        using errcode = '55000';
    end if;
    if old_completed and (
      (nullif(trim(coalesce(OLD.signature_data, '')), '') is not null and nullif(trim(coalesce(NEW.signature_data, '')), '') is null)
      or (nullif(trim(coalesce(OLD.signature_name, '')), '') is not null and nullif(trim(coalesce(NEW.signature_name, '')), '') is null)
      or (OLD.completed_at is not null and NEW.completed_at is null)
      or (nullif(trim(coalesce(OLD.technical_opinion, '')), '') is not null and nullif(trim(coalesce(NEW.technical_opinion, '')), '') is null)
      or (nullif(trim(coalesce(OLD.observation, '')), '') is not null and nullif(trim(coalesce(NEW.observation, '')), '') is null)
    ) then
      raise exception 'OS concluída protegida: assinatura, laudo, observação e data de conclusão não podem ser apagados.'
        using errcode = '55000';
    end if;
  end if;
  actor_text := nullif(current_setting('request.jwt.claim.sub', true), '');
  insert into public.dbs_control_work_order_revisions
    (work_order_id, protocol, action, before_data, after_data, actor_user_id)
  values (
    NEW.id, NEW.protocol, TG_OP,
    case when TG_OP = 'UPDATE' then to_jsonb(OLD) else null end,
    to_jsonb(NEW),
    case when actor_text is not null then actor_text::uuid else null end
  );
  return NEW;
end;
$$;
drop trigger if exists dbs_control_work_order_document_guard on public.dbs_control_work_orders;
create trigger dbs_control_work_order_document_guard
  before insert or update or delete on public.dbs_control_work_orders
  for each row execute function public.dbs_control_protect_work_order_document();
comment on table public.dbs_control_work_order_revisions is
  'Trilha append-only de versões de OS para auditoria e recuperação de dados documentais.';
