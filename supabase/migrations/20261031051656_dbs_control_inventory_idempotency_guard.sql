-- Guardas aditivas para o incidente de peças/compras que desapareciam após
-- retry/hidratação. Nenhuma tabela operacional é removida ou reescrita.
--
-- O RPC legado de peça atualiza version a cada chamada. Se o navegador perde
-- o ACK e reenvia a mesma intenção, isso produz uma segunda atualização ainda
-- que a primeira já tenha sido confirmada. Os wrappers abaixo registram o
-- hash da intenção e reproduzem exatamente o resultado original.

begin;

create table if not exists public.dbs_control_inventory_commands (
  id uuid primary key default gen_random_uuid(),
  scope_key text not null,
  command_type text not null check (command_type in ('part_upsert', 'purchase_receive')),
  idempotency_key text not null,
  payload_hash text not null,
  result jsonb not null,
  actor_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists dbs_control_inventory_commands_key_uq
  on public.dbs_control_inventory_commands(scope_key, command_type, idempotency_key);

create index if not exists dbs_control_inventory_commands_created_idx
  on public.dbs_control_inventory_commands(scope_key, created_at desc);

alter table public.dbs_control_inventory_commands enable row level security;
revoke all on public.dbs_control_inventory_commands from public, anon, authenticated;
grant all on public.dbs_control_inventory_commands to service_role;

create or replace function public.dbs_control_upsert_part_safe(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := nullif(p_payload->>'actor_user_id', '')::uuid;
  v_scope text := nullif(btrim(p_payload->>'scope_key'), '');
  v_key text := nullif(btrim(p_payload->>'idempotency_key'), '');
  v_hash text;
  v_existing public.dbs_control_inventory_commands%rowtype;
  v_result jsonb;
begin
  if v_actor is null or not public.dbs_control_is_admin_actor(v_actor) then
    raise exception 'DBS_INVENTORY_PERMISSION: somente a administração pode alterar o catálogo de peças.' using errcode = '42501';
  end if;
  if v_key is null or char_length(v_key) not between 8 and 240 then
    raise exception 'DBS_INVENTORY_IDEMPOTENCY_REQUIRED: idempotency_key inválida.' using errcode = '22023';
  end if;
  v_scope := coalesce(v_scope, 'user:' || v_actor::text);
  v_hash := md5(p_payload::text);

  perform pg_advisory_xact_lock(hashtextextended('inventory:part:' || v_scope || ':' || v_key, 0));
  select * into v_existing
    from public.dbs_control_inventory_commands c
   where c.scope_key = v_scope
     and c.command_type = 'part_upsert'
     and c.idempotency_key = v_key
   for update;
  if found then
    if v_existing.payload_hash <> v_hash then
      raise exception 'DBS_INVENTORY_IDEMPOTENCY_REUSE: a mesma chave foi usada para outra peça.' using errcode = '22023';
    end if;
    return v_existing.result;
  end if;

  v_result := public.dbs_control_upsert_part(p_payload);
  insert into public.dbs_control_inventory_commands (
    scope_key, command_type, idempotency_key, payload_hash, result, actor_user_id
  ) values (
    v_scope, 'part_upsert', v_key, v_hash, v_result, v_actor
  );
  return v_result;
end;
$$;

create or replace function public.dbs_control_receive_purchase_safe(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := nullif(p_payload->>'actor_user_id', '')::uuid;
  v_scope text := nullif(btrim(p_payload->>'scope_key'), '');
  v_key text := nullif(btrim(p_payload->>'idempotency_key'), '');
  v_hash text;
  v_existing public.dbs_control_inventory_commands%rowtype;
  v_result jsonb;
begin
  if v_actor is null or not public.dbs_control_is_admin_actor(v_actor) then
    raise exception 'DBS_INVENTORY_PERMISSION: somente a administração pode registrar compras.' using errcode = '42501';
  end if;
  if v_key is null or char_length(v_key) not between 8 and 240 then
    raise exception 'DBS_INVENTORY_IDEMPOTENCY_REQUIRED: idempotency_key inválida.' using errcode = '22023';
  end if;
  v_scope := coalesce(v_scope, 'user:' || v_actor::text);
  v_hash := md5(p_payload::text);

  perform pg_advisory_xact_lock(hashtextextended('inventory:purchase:' || v_scope || ':' || v_key, 0));
  select * into v_existing
    from public.dbs_control_inventory_commands c
   where c.scope_key = v_scope
     and c.command_type = 'purchase_receive'
     and c.idempotency_key = v_key
   for update;
  if found then
    if v_existing.payload_hash <> v_hash then
      raise exception 'DBS_INVENTORY_IDEMPOTENCY_REUSE: a mesma chave foi usada para outra compra.' using errcode = '22023';
    end if;
    return v_existing.result;
  end if;

  v_result := public.dbs_control_receive_purchase(p_payload);
  insert into public.dbs_control_inventory_commands (
    scope_key, command_type, idempotency_key, payload_hash, result, actor_user_id
  ) values (
    v_scope, 'purchase_receive', v_key, v_hash, v_result, v_actor
  );
  return v_result;
end;
$$;

revoke all on function public.dbs_control_upsert_part_safe(jsonb) from public, anon, authenticated;
revoke all on function public.dbs_control_receive_purchase_safe(jsonb) from public, anon, authenticated;
grant execute on function public.dbs_control_upsert_part_safe(jsonb) to service_role;
grant execute on function public.dbs_control_receive_purchase_safe(jsonb) to service_role;

comment on table public.dbs_control_inventory_commands is
  'Intenções idempotentes de catálogo/estoque; impede duplicidade e preserva o resultado confirmado após timeout do cliente.';

notify pgrst, 'reload schema';
commit;
