-- DBS CONTROL: accept stale snapshots when only OS records changed.
-- Dispatch/create conflicts are reconciled under the per-scope advisory lock;
-- unrelated stale changes still fail closed.
begin;

do $migration$
declare
  v_definition text;
  v_old_guard text := $old$
  if v_current_updated_at is not null and (
    v_base_updated_at is null or v_base_updated_at is distinct from v_current_updated_at
  ) then
    raise exception 'DBS_SNAPSHOT_STALE_VERSION: A base compartilhada foi alterada em outro dispositivo. Atualize a tela antes de salvar.'
      using errcode = '40001';
  end if;
$old$;
  v_new_guard text := $new$
  v_is_stale := v_current_updated_at is not null and (
    v_base_updated_at is null or v_base_updated_at is distinct from v_current_updated_at
  );

  -- A stale full snapshot is safe to reconcile only when its non-OS state
  -- matches the server. This allows OS creation/dispatch without allowing an
  -- old client/equipment/stock list to overwrite newer administrative data.
  if v_is_stale and (v_incoming_state - 'ordens') is distinct from (coalesce(v_current_state, '{}'::jsonb) - 'ordens') then
    raise exception 'DBS_SNAPSHOT_STALE_VERSION: Conflito de versão em dados fora das OS. Recarregue a versão mais recente antes de salvar.'
      using errcode = '40001';
  end if;
$new$;
  v_old_completed text := $old$
    if v_latest is not null
       and lower(btrim(coalesce(v_latest->>'status', ''))) in
         ('concluida','concluída','concluido','concluído') then
$old$;
  v_new_completed text := $new$
    -- For a stale dispatch/create request, preserve the latest execution
    -- evidence. Assignment and dispatch status remain incoming fields; photos,
    -- diagnosis, reports, signatures and completion metadata remain canonical.
    if v_is_stale and v_latest is not null then
      foreach v_field in array array[
        'assinatura','assinaturaCliente','signature_data','signature_name',
        'assinaturaEm','concluidoEm','completedAt','completed_at',
        'diagnostico','laudo','technical_opinion','trabalhoExecutado',
        'observacao','observation','observacaoTecnico','observacaoComplementarTecnico',
        'fotoAntes','fotoDepois','assinaturaStoragePath','fotoAntesStoragePath','fotoDepoisStoragePath'
      ]
      loop
        if nullif(btrim(coalesce(v_latest->>v_field, '')), '') is not null then
          v_order := v_order || jsonb_build_object(v_field, v_latest->v_field);
        end if;
      end loop;
    end if;

    if v_latest is not null
       and lower(btrim(coalesce(v_latest->>'status', ''))) in
         ('concluida','concluída','concluido','concluído') then
$new$;
begin
  select pg_get_functiondef(p.oid) into v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'dbs_control_save_snapshot_safe_v2'
    and pg_get_function_identity_arguments(p.oid) = 'p_payload jsonb';

  if v_definition is null then
    raise exception 'Função dbs_control_save_snapshot_safe_v2(p_payload jsonb) não encontrada; migração interrompida.';
  end if;

  if position('v_is_stale boolean' in v_definition) = 0 then
    v_definition := replace(v_definition, '  v_field text;', '  v_field text;' || E'\n  v_is_stale boolean := false;');
  end if;

  if position(v_old_guard in v_definition) > 0 then
    v_definition := replace(v_definition, v_old_guard, v_new_guard);
  elsif position('v_is_stale := v_current_updated_at is not null' in v_definition) = 0 then
    raise exception 'Trecho de validação de versão não reconhecido; migração interrompida para evitar alteração parcial.';
  end if;

  if position(v_old_completed in v_definition) > 0 then
    v_definition := replace(v_definition, v_old_completed, v_new_completed);
  elsif position('For a stale dispatch/create request' in v_definition) = 0 then
    raise exception 'Trecho de reconciliação de OS não reconhecido; migração interrompida para evitar alteração parcial.';
  end if;

  execute v_definition;
end;
$migration$;

-- Postgres Changes is the source of Supabase Realtime table events. Add the
-- snapshot table only when the publication exists and it is not already listed.
do $realtime$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'dbs_control_snapshots'
     ) then
    alter publication supabase_realtime add table public.dbs_control_snapshots;
  end if;
end;
$realtime$;

commit;
