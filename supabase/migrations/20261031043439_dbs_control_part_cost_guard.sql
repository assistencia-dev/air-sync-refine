-- O custo da peça é derivado das entradas de compra depois que existe
-- movimentação. Edição de nome/SKU não pode sobrescrever o custo médio com um
-- valor antigo do formulário legado.

begin;

create or replace function public.dbs_control_upsert_part(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := nullif(p_payload->>'actor_user_id', '')::uuid;
  v_id uuid := nullif(p_payload->>'id', '')::uuid;
  v_sku text := nullif(btrim(p_payload->>'sku'), '');
  v_name text := nullif(btrim(coalesce(p_payload->>'name', p_payload->>'nome')), '');
  v_description text := coalesce(p_payload->>'description', p_payload->>'descricao', '');
  v_cost integer := greatest(coalesce(nullif(coalesce(p_payload->>'cost_cents', p_payload->>'custo'), '')::numeric, 0), 0)::integer;
  v_sale integer := greatest(coalesce(nullif(coalesce(p_payload->>'sale_cents', p_payload->>'venda'), '')::numeric, 0), 0)::integer;
  v_status text := coalesce(nullif(lower(btrim(p_payload->>'status')), ''), 'ativo');
  v_key text := nullif(btrim(p_payload->>'idempotency_key'), '');
  v_existing public.dbs_control_parts%rowtype;
  v_has_movements boolean := false;
begin
  if v_actor is null or not public.dbs_control_is_admin_actor(v_actor) then
    raise exception 'DBS_INVENTORY_PERMISSION: somente a administração pode alterar o catálogo de peças.' using errcode = '42501';
  end if;
  if v_sku is null or v_name is null then
    raise exception 'DBS_PART_REQUIRED: SKU e nome da peça são obrigatórios.' using errcode = '22023';
  end if;
  if v_status not in ('ativo','inativo') then
    raise exception 'DBS_PART_STATUS_INVALID: status da peça inválido.' using errcode = '22023';
  end if;
  if v_key is null then v_key := 'part-upsert:' || coalesce(v_id::text, v_sku) || ':' || gen_random_uuid()::text; end if;

  select p.* into v_existing
  from public.dbs_control_parts p
  where (v_id is not null and p.id = v_id) or p.sku = v_sku
  order by (case when v_id is not null and p.id = v_id then 0 else 1 end)
  limit 1
  for update;

  if found then
    select exists (
      select 1 from public.dbs_control_inventory_movements m where m.part_id = v_existing.id
    ) into v_has_movements;
    update public.dbs_control_parts
       set sku = v_sku,
           name = v_name,
           description = v_description,
           cost_cents = case
             when coalesce(v_existing.stock_quantity, 0) = 0 and not v_has_movements then v_cost
             else v_existing.cost_cents
           end,
           sale_cents = v_sale,
           status = v_status,
           version = version + 1,
           updated_at = now()
     where id = v_existing.id
     returning * into v_existing;
  else
    insert into public.dbs_control_parts (id, sku, name, description, stock_quantity, cost_cents, sale_cents, status)
    values (coalesce(v_id, gen_random_uuid()), v_sku, v_name, v_description, 0, v_cost, v_sale, v_status)
    returning * into v_existing;
  end if;

  return jsonb_build_object(
    'ok', true, 'part_id', v_existing.id, 'sku', v_existing.sku,
    'stock_quantity', v_existing.stock_quantity, 'cost_cents', v_existing.cost_cents,
    'sale_cents', v_existing.sale_cents, 'version', v_existing.version,
    'idempotency_key', v_key
  );
end;
$$;

revoke all on function public.dbs_control_upsert_part(jsonb) from public, anon, authenticated;
grant execute on function public.dbs_control_upsert_part(jsonb) to service_role;

notify pgrst, 'reload schema';
commit;
