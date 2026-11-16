-- Permite múltiplos estoques operacionais vinculados ao mesmo centro de custo.
BEGIN;
ALTER TABLE public.dbs_control_operational_stocks
  DROP CONSTRAINT IF EXISTS dbs_control_operational_stocks_scope_key_cost_center_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS dbs_control_operational_stocks_name_per_center_uidx
  ON public.dbs_control_operational_stocks(scope_key,cost_center_id,lower(btrim(name)));

DROP FUNCTION IF EXISTS public.dbs_control_operational_stock_reserve(uuid,uuid,uuid,uuid,numeric,text,text);
CREATE OR REPLACE FUNCTION public.dbs_control_operational_stock_reserve(
  p_actor_user_id uuid,p_work_order_id uuid,p_cost_center_id uuid,p_stock_id uuid,
  p_part_id uuid,p_quantity numeric,p_purpose text,p_idempotency_key text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_actor_company uuid; v_scope text; v_stock public.dbs_control_operational_stocks%rowtype;
  v_balance public.dbs_control_operational_stock_balances%rowtype; v_os record; v_os_scope record; v_reservation uuid;
  v_key text:=nullif(btrim(p_idempotency_key),''); v_existing uuid; v_part public.dbs_control_parts%rowtype;
BEGIN
  IF p_actor_user_id IS NULL OR NOT public.dbs_control_is_admin_actor(p_actor_user_id) THEN
    RAISE EXCEPTION 'DBS_OPERATIONAL_RESERVATION_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF p_quantity IS NULL OR p_quantity<=0 OR p_purpose NOT IN ('TROCA_PECA','ATIVO_EQUIPAMENTO')
     OR v_key IS NULL OR char_length(v_key) NOT BETWEEN 8 AND 240 THEN
    RAISE EXCEPTION 'DBS_OPERATIONAL_RESERVATION_INPUT_INVALID' USING ERRCODE='22023';
  END IF;
  SELECT company_id INTO v_actor_company FROM public.users WHERE id=p_actor_user_id AND status='ativo';
  v_scope:=CASE WHEN v_actor_company IS NULL THEN 'user:'||p_actor_user_id ELSE 'company:'||v_actor_company END;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_scope||':op-reserve:'||v_key,0));
  SELECT id INTO v_existing FROM public.dbs_control_operational_reservations WHERE scope_key=v_scope AND idempotency_key=v_key;
  IF v_existing IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'replayed',true,'reservation_id',v_existing); END IF;
  SELECT wo.id,wo.status INTO v_os FROM public.dbs_control_work_orders wo
    WHERE wo.id=p_work_order_id AND wo.deleted_at IS NULL;
  IF NOT FOUND OR lower(coalesce(v_os.status,'')) IN ('concluida','concluída','completed','complete','cancelada','cancelado','cancelled') THEN
    RAISE EXCEPTION 'DBS_OPERATIONAL_RESERVATION_OS_INVALID' USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_os_scope FROM public.dbs_control_inventory_scope_for_work_order(p_work_order_id);
  IF NOT FOUND OR v_os_scope.scope_key IS DISTINCT FROM v_scope THEN
    RAISE EXCEPTION 'DBS_OPERATIONAL_RESERVATION_SCOPE_MISMATCH' USING ERRCODE='42501';
  END IF;
  -- Global lock order shared with transfer: part -> operational stock -> balance.
  -- This prevents a reserve/transfer cycle from taking the same rows in opposite order.
  SELECT * INTO v_part FROM public.dbs_control_parts WHERE id=p_part_id AND status='ativo' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DBS_OPERATIONAL_RESERVATION_PART_INVALID' USING ERRCODE='23503'; END IF;
  SELECT * INTO v_stock FROM public.dbs_control_operational_stocks
    WHERE id=p_stock_id AND scope_key=v_scope AND cost_center_id=p_cost_center_id AND status='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DBS_OPERATIONAL_STOCK_NOT_CONFIGURED' USING ERRCODE='23503'; END IF;
  SELECT * INTO v_balance FROM public.dbs_control_operational_stock_balances
    WHERE stock_id=v_stock.id AND part_id=p_part_id FOR UPDATE;
  IF NOT FOUND OR v_balance.quantity-v_balance.reserved_quantity<p_quantity THEN
    RAISE EXCEPTION 'DBS_OPERATIONAL_STOCK_INSUFFICIENT' USING ERRCODE='23514';
  END IF;
  UPDATE public.dbs_control_operational_stock_balances SET reserved_quantity=reserved_quantity+p_quantity,version=version+1,updated_at=now() WHERE id=v_balance.id;
  INSERT INTO public.dbs_control_operational_reservations(company_id,scope_key,stock_id,work_order_id,part_id,quantity,purpose,unit_cost_cents,idempotency_key,created_by)
  VALUES(v_actor_company,v_scope,v_stock.id,p_work_order_id,p_part_id,p_quantity,p_purpose,coalesce(v_part.cost_cents,0),v_key,p_actor_user_id)
  RETURNING id INTO v_reservation;
  RETURN jsonb_build_object('ok',true,'replayed',false,'reservation_id',v_reservation,'stock_id',v_stock.id);
END $$;

REVOKE ALL ON FUNCTION public.dbs_control_operational_stock_reserve(uuid,uuid,uuid,uuid,uuid,numeric,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dbs_control_operational_stock_reserve(uuid,uuid,uuid,uuid,uuid,numeric,text,text) TO service_role;
COMMIT;
