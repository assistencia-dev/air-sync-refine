-- Expande o manifesto para registrar todos os buckets de documentos cobertos.
-- A coluna antiga permanece para compatibilidade com leitores já publicados.
begin;

alter table public.dbs_control_backup_manifests
  add column if not exists document_buckets text[] not null default '{}'::text[];

comment on column public.dbs_control_backup_manifests.document_buckets is
  'Buckets de Storage percorridos e verificados pelo backup; os objetos individuais ficam em document_manifest.';

commit;
