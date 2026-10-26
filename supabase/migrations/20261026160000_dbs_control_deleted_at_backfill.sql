-- Preserva no modelo relacional as OS que o snapshot antigo marcou como
-- excluídas. O registro não é apagado: fica auditável e filtrável por deleted_at.
begin;

alter table public.dbs_control_work_orders
  add column if not exists deleted_at timestamptz;

create index if not exists idx_dbs_control_work_orders_deleted_at
  on public.dbs_control_work_orders(deleted_at);

do $$
begin
  update public.dbs_control_work_orders w
  set deleted_at = nullif(h.value->>'excluidaEm','')::timestamptz
  from public.dbs_control_snapshots s
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(s.state->'ordens') = 'array'
      then s.state->'ordens' else '[]'::jsonb end
  ) h
  join public.dbs_control_legacy_id_map m
    on m.scope_key = s.scope_key
   and m.entity_type = 'work_order'
   and m.legacy_key = coalesce(nullif(btrim(h.value->>'id'),''), md5(h.value::text))
  where w.id = m.canonical_id
    and nullif(h.value->>'excluidaEm','') is not null
    and (h.value->>'excluidaEm') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
    and w.deleted_at is null;
exception
  when others then
    raise exception 'DBS_DELETED_AT_BACKFILL_FAILED: %', sqlerrm;
end;
$$;

commit;
