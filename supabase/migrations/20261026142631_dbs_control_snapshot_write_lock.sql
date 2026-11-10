-- DBS CONTROL: encerra definitivamente os caminhos de escrita por snapshot.
-- O JSON legado permanece disponível apenas para leitura/reconciliação; a
-- fonte operacional é a camada relacional e os comandos por delta.
begin;

revoke insert, update, delete, truncate on table public.dbs_control_snapshots
  from anon, authenticated, service_role;

revoke all on function public.dbs_control_save_snapshot_safe(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.dbs_control_save_snapshot_safe_v2(jsonb)
  from public, anon, authenticated, service_role;

comment on table public.dbs_control_snapshots is
  'Compatibilidade de leitura somente; gravações operacionais devem usar deltas relacionais e a outbox transacional.';

commit;
