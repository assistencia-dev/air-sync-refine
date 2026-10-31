-- Corrige a migração de saldo inicial para preservar quantidade mesmo quando
-- a planilha legada não informa custo. Nesse caso não há lançamento zerado no
-- Ledger; o movimento físico e a Outbox continuam registrados para posterior
-- regularização contábil.

begin;

create or replace function public.dbs_control_apply_opening_balance(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := nullif(p_payload->>'actor_user_id', '')::uuid;
  v_company_id uuid := nullif(p_payload->>'company_id', '')::uuid;
  v_scope_key text := nullif(btrim(p_payload->>'scope_key'), '');
  v_part_id uuid := nullif(p_payload->>'part_id', '')::uuid;
  v_key text := nullif(btrim(p_payload->>'idempotency_key'), '');
  v_quantity numeric := greatest(coalesce(nullif(p_payload->>'quantity', '')::numeric, 0), 0);
  v_unit_cost integer := greatest(coalesce(nullif(p_payload->>'unit_cost_cents', '')::numeric, 0), 0)::integer;
  v_existing public.dbs_control_inventory_movements%rowtype;
  v_part public.dbs_control_parts%rowtype;
  v_new_stock numeric;
  v_ledger jsonb;
  v_entry_id uuid;
  v_outbox_key text;
begin
  if v_actor is null or not public.dbs_control_is_admin_actor(v_actor) then
    raise exception 'DBS_INVENTORY_PERMISSION: somente a administração pode migrar saldo inicial.' using errcode = '42501';
  end if;
  if v_part_id is null or v_scope_key is null then
    raise exception 'DBS_OPENING_BALANCE_REQUIRED: peça e escopo são obrigatórios.' using errcode = '22023';
  end if;
  if v_key is null or char_length(v_key) not between 8 and 240 then
    raise exception 'DBS_INVENTORY_IDEMPOTENCY_REQUIRED: idempotency_key inválida.' using errcode = '22023';
  end if;
  if v_quantity <= 0 then
    raise exception 'DBS_OPENING_BALANCE_QUANTITY_INVALID: o saldo inicial precisa ser maior que zero.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_scope_key || ':' || v_key, 0));

  select m.* into v_existing
  from public.dbs_control_inventory_movements m
  where m.scope_key = v_scope_key and m.idempotency_key = v_key
  for update;
  if found then
    return jsonb_build_object(
      'ok', true, 'replayed', true, 'part_id', v_part_id,
      'movement_id', v_existing.id, 'balance_after', v_existing.balance_after,
      'idempotency_key', v_key
    );
  end if;

  select p.* into v_part
  from public.dbs_control_parts p
  where p.id = v_part_id
  for update;
  if not found then
    raise exception 'DBS_OS_PART_NOT_FOUND: peça não existe no catálogo relacional.' using errcode = '23503';
  end if;

  -- Não dobra um saldo já inicializado. Compras e ajustes posteriores entram
  -- pelos seus próprios comandos e continuam preservando a trilha original.
  if coalesce(v_part.stock_quantity, 0) <> 0
     or exists (
       select 1 from public.dbs_control_inventory_movements m
       where m.scope_key = v_scope_key and m.part_id = v_part_id
     ) then
    return jsonb_build_object(
      'ok', true, 'replayed', false, 'skipped', true,
      'reason', 'part_already_initialized', 'part_id', v_part_id,
      'balance_after', v_part.stock_quantity, 'idempotency_key', v_key
    );
  end if;

  v_new_stock := coalesce(v_part.stock_quantity, 0) + v_quantity;
  update public.dbs_control_parts
     set stock_quantity = v_new_stock,
         cost_cents = case when v_unit_cost > 0 then v_unit_cost else cost_cents end,
         version = version + 1,
         updated_at = now()
   where id = v_part_id;

  insert into public.dbs_control_inventory_movements (
    company_id, scope_key, part_id, movement_type, quantity_delta,
    unit_cost_cents, balance_after, idempotency_key, created_by, metadata
  ) values (
    v_company_id, v_scope_key, v_part_id, 'adjustment', v_quantity,
    v_unit_cost, v_new_stock, v_key, v_actor,
    jsonb_build_object('source', 'legacy_import_opening_balance', 'part_id', v_part_id)
  ) returning * into v_existing;

  -- Custo ausente não vira uma partida contábil artificial. A quantidade e o
  -- movimento seguem protegidos; o administrador pode regularizar o valor
  -- depois por um ajuste de estoque com custo informado.
  if v_unit_cost > 0 then
    v_ledger := public.post_treasury_ledger_entry(
      v_scope_key, v_company_id, current_date, current_date,
      'inventory_opening_balance', 'Saldo inicial de estoque · ' || v_part.name,
      left(v_key || ':ledger', 200), 'inventory-opening:' || v_part_id::text,
      v_actor, 'posted',
      jsonb_build_object('source', 'legacy_import', 'part_id', v_part_id, 'movement_id', v_existing.id),
      jsonb_build_array(
        jsonb_build_object('account_code','1.1.03','account_name','Estoque de peças','account_type','asset','debit_cents',round(v_quantity * v_unit_cost)::bigint,'credit_cents',0),
        jsonb_build_object('account_code','3.1.01','account_name','Saldo inicial de estoque','account_type','equity','debit_cents',0,'credit_cents',round(v_quantity * v_unit_cost)::bigint)
      )
    );
    v_entry_id := nullif(v_ledger->>'entry_id', '')::uuid;
  end if;

  v_outbox_key := left('inventory:opening:' || v_scope_key || ':' || v_key, 240);
  insert into public.dbs_control_outbox (
    idempotency_key, company_id, aggregate_type, aggregate_id,
    event_type, aggregate_version, payload
  ) values (
    v_outbox_key, v_company_id, 'part', null,
    'inventory.opening_balance.applied', 1,
    jsonb_build_object('part_id', v_part_id, 'movement_id', v_existing.id, 'ledger_entry_id', v_entry_id, 'quantity', v_quantity)
  ) on conflict (idempotency_key) do nothing;

  return jsonb_build_object(
    'ok', true, 'replayed', false, 'part_id', v_part_id,
    'movement_id', v_existing.id, 'ledger_entry_id', v_entry_id,
    'balance_after', v_new_stock, 'idempotency_key', v_key
  );
end;
$$;

revoke all on function public.dbs_control_apply_opening_balance(jsonb) from public, anon, authenticated;
grant execute on function public.dbs_control_apply_opening_balance(jsonb) to service_role;

notify pgrst, 'reload schema';
commit;
