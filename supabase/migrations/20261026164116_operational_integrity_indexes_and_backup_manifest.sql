-- DBS AIR: garantias operacionais aditivas.
-- Não remove dados. Índices só são criados depois de a auditoria confirmar que
-- não existem batidas duplicadas no mesmo funcionário/dia/tipo.
begin;

create unique index if not exists rh_ponto_records_employee_date_type_uq
  on public.rh_ponto_records(employee_id, work_date, punch_type);

create index if not exists dbs_control_work_orders_employee_active_idx
  on public.dbs_control_work_orders(assigned_employee_id, updated_at desc)
  where deleted_at is null
    and lower(coalesce(status, '')) not in ('cancelada', 'cancelado');

create index if not exists dbs_control_work_order_attachments_order_idx
  on public.dbs_control_work_order_attachments(work_order_id, created_at desc);

create table if not exists public.dbs_control_backup_manifests (
  id uuid primary key default gen_random_uuid(),
  generated_at timestamptz not null,
  object_path text not null unique,
  manifest_path text not null unique,
  snapshot_sha256 text not null,
  table_counts jsonb not null default '{}'::jsonb,
  document_count integer not null default 0 check (document_count >= 0),
  document_manifest jsonb not null default '[]'::jsonb,
  status text not null default 'verified' check (status in ('verified', 'failed')),
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists dbs_control_backup_manifests_generated_idx
  on public.dbs_control_backup_manifests(generated_at desc);

alter table public.dbs_control_backup_manifests enable row level security;
revoke all on public.dbs_control_backup_manifests from public, anon, authenticated;
grant all on public.dbs_control_backup_manifests to service_role;

comment on table public.dbs_control_backup_manifests is
  'Manifestos verificados de backup lógico e cópia de documentos do DBS AIR; somente service_role grava/lê.';

commit;

