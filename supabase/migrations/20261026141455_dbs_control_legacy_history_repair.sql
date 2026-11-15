-- Corrige a distinção entre ordens e osHistorico do snapshot legado.
-- osHistorico contém eventos, não novas OS. Os eventos são anexados à OS
-- canônica correspondente e as 30 linhas artificiais criadas pela primeira
-- tentativa do backfill são removidas por chave exata, sem tocar em nenhuma
-- OS original ou no snapshot de origem.
begin;

do $$
declare
  snap record;
  history_item jsonb;
  raw_key text;
  target_key text;
  target_order_id uuid;
  wrong_order_id uuid;
  event_key text;
begin
  for snap in
    select s.scope_key, s.owner_user_id, s.state
    from public.dbs_control_snapshots s
    where s.state is not null and jsonb_typeof(s.state) = 'object'
  loop
    for history_item in
      select value
      from jsonb_array_elements(
        case when jsonb_typeof(snap.state->'osHistorico') = 'array'
          then snap.state->'osHistorico' else '[]'::jsonb end
      )
    loop
      raw_key := coalesce(nullif(btrim(history_item->>'id'), ''), md5(history_item::text));
      target_key := coalesce(nullif(btrim(history_item->>'osId'), ''), nullif(btrim(history_item->>'work_order_id'), ''));

      select m.canonical_id into target_order_id
      from public.dbs_control_legacy_id_map m
      where m.scope_key = snap.scope_key
        and m.entity_type = 'work_order'
        and m.legacy_key = target_key;

      if target_order_id is not null then
        event_key := 'legacy-backfill:' || snap.scope_key || ':history:' || raw_key;
        insert into public.dbs_control_work_order_events
          (work_order_id, actor_user_id, event_type, details, idempotency_key)
        values
          (target_order_id, snap.owner_user_id, 'legacy_history',
           jsonb_build_object('source', history_item, 'legacy_scope', snap.scope_key, 'legacy_key', raw_key),
           event_key)
        on conflict do nothing;
      end if;

      -- A versão anterior podia ter materializado o evento como uma OS com
      -- chave hist-*. Retira somente esse registro artificial, mantendo seu
      -- conteúdo no evento acima e mantendo o snapshot integral.
      select m.canonical_id into wrong_order_id
      from public.dbs_control_legacy_id_map m
      where m.scope_key = snap.scope_key
        and m.entity_type = 'work_order'
        and m.legacy_key = raw_key;

      if wrong_order_id is not null and wrong_order_id is distinct from target_order_id then
        delete from public.dbs_control_legacy_id_map
        where scope_key = snap.scope_key and entity_type = 'work_order' and legacy_key = raw_key;
        delete from public.dbs_control_work_orders where id = wrong_order_id;
      end if;
    end loop;
  end loop;
end;
$$;

commit;
