\set ON_ERROR_STOP on

\echo 'Backup restore parity: comparing manifest counts with isolated restored tables'

create temporary table parity_results (
  table_name text primary key,
  expected_count bigint not null,
  restored_count bigint not null,
  difference bigint not null,
  status text not null
);

do $$
declare
  item record;
  actual_count bigint;
begin
  for item in
    select table_name, restored_table_name, expected_count
    from backup_restore.manifest_counts
    order by table_name
  loop
    execute format(
      'select count(*)::bigint from backup_restore.%I',
      item.restored_table_name
    ) into actual_count;

    insert into parity_results (table_name, expected_count, restored_count, difference, status)
    values (
      item.table_name,
      item.expected_count,
      actual_count,
      actual_count - item.expected_count,
      case when actual_count = item.expected_count then 'OK' else 'DIVERGENTE' end
    );
  end loop;
end
$$;

select table_name, expected_count, restored_count, difference, status
from parity_results
order by table_name;

select
  count(*)::int as table_count,
  count(*) filter (where status = 'OK')::int as matching_tables,
  count(*) filter (where status <> 'OK')::int as divergent_tables,
  coalesce(sum(abs(difference)), 0)::bigint as total_difference
from parity_results;

do $$
declare
  metadata record;
  divergent_count integer;
  expected_documents bigint;
  restored_documents bigint;
begin
  select * into metadata from backup_restore.restore_metadata where id = true;
  if not found then
    raise exception 'Metadados da restauração não encontrados.';
  end if;
  if metadata.table_count <> 78 then
    raise exception 'Quantidade de tabelas restauradas inválida: esperado 78, encontrado %.', metadata.table_count;
  end if;
  if metadata.snapshot_size_bytes <> metadata.downloaded_size_bytes then
    raise exception 'Tamanho do snapshot divergiu: manifesto %, download %.',
      metadata.snapshot_size_bytes, metadata.downloaded_size_bytes;
  end if;

  select count(*) filter (where status <> 'OK')::int into divergent_count
  from parity_results;
  if divergent_count <> 0 then
    raise exception 'Paridade de tabelas falhou: % tabela(s) divergente(s).', divergent_count;
  end if;

  expected_documents := metadata.document_count;
  select count(*)::bigint into restored_documents from backup_restore.document_manifest;
  if expected_documents <> restored_documents then
    raise exception 'Paridade de documentos falhou: esperado %, restaurado %.',
      expected_documents, restored_documents;
  end if;
end
$$;

\echo 'Backup restore parity: OK — 78 tabelas e documentos conferidos sem divergências.'
