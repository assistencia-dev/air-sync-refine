-- Garante o armazenamento privado usado por fotos e assinaturas das OS.
-- A migração é aditiva: não remove arquivos, registros ou políticas existentes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'dbs-control-os',
  'dbs-control-os',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[];
