-- Completa o ciclo de auditoria: espelha recebimentos centrais e consome reservas operacionais na conclusão da OS.
BEGIN;

CREATE OR REPLACE FUNCTION public.dbs_control_mirror_central_receipt_to_operational_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.movement_type='receipt' AND NEW.quantity_delta>0 THEN
    INSERT INTO public.dbs_control_operational_stock_movements(
      company_id,scope_key,part_id,movement_type,quantity,reference,purchase_id,
      idempotency_key,created_by,metadata
    ) VALUES(
      NEW.company_id,NEW.scope_key,NEW.part_id,'ENTRADA',NEW.quantity_delta,
      'Recebimento de compra',NEW.purchase_id,
      left('central-receipt:'||NEW.id::text,240),NEW.created_by,
      jsonb_build_object('central_inventory_movement_id',NEW.id,'source','purchase_receipt')
    ) ON CONFLICT(scope_key,idempotency_key) DO NOTHING;
  END IF;
  RETURN NEW;
END $;
REVOKE ALL ON FUNCTION public.dbs_control_mirror_central_receipt_to_operational_history() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dbs_control_mirror_central_receipt_to_operational_history() TO service_role;

DROP TRIGGER IF EXISTS dbs_control_mirror_central_receipt_to_operational_history_trg ON public.dbs_control_inventory_movements;
CREATE TRIGGER dbs_control_mirror_central_receipt_to_operational_history_trg
AFTER INSERT ON public.dbs_control_inventory_movements
FOR EACH ROW EXECUTE FUNCTION public.dbs_control_mirror_central_receipt_to_operational_history();

CREATE OR REPLACE FUNCTION public.dbs_control_operational_stock_consume_work_order(
  p_actor_user_id uuid,p_work_order_id uuid,p_idempotency_key text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor_company uuid; v_scope text; v_key text:=nullif(btrim(p_idempotency_key),'');
  v_r record; v_balance public.dbs_control_operational_stock_balances%rowtype; v_os_scope record;
  v_count integer:=0; v_total numeric(14,3):=0; v_movement_id uuid;
BEGIN
  IF p_actor_user_id IS NULL OR NOT public.dbs_control_is_admin_actor(p_actor_user_id) THEN
    RAISE EXCEPTION 'DBS_OPERATIONAL_CONSUMPTION_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF p_work_order_id IS NULL OR v_key IS NULL OR char_length(v_key) NOT BETWEEN 8 AND 240 THEN
    RAISE EXCEPTION 'DBS_OPERATIONAL_CONSUMPTION_INPUT_INVALID' USING ERRCODE='22023';
  END IF;
  SELECT company_id INTO v_actor_company FROM public.users WHERE id=p_actor_user_id AND status='ativo';
  v_scope:=CASE WHEN v_actor_company IS NULL THEN 'user:'||p_actor_user_id ELSE 'company:'||v_actor_company END;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_scope||':op-consume:'||p_work_order_id::text||':'||v_key,0));
  SELECT * INTO v_os_scope FROM public.dbs_control_inventory_scope_for_work_order(p_work_order_id);
  IF NOT FOUND OR v_os_scope.scope_key IS DISTINCT FROM v_scope
     OR NOT EXISTS(SELECT 1 FROM public.dbs_control_work_orders WHERE id=p_work_order_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'DBS_OPERATIONAL_CONSUMPTION_OS_SCOPE_INVALID' USING ERRCODE='42501';
  END IF;
  FOR v_r IN
    SELECT * FROM public.dbs_control_operational_reservations
    WHERE scope_key=v_scope AND work_order_id=p_work_order_id AND status='reserved'
    ORDER BY id FOR UPDATE
  LOOP
    SELECT * INTO v_balance FROM public.dbs_control_operational_stock_balances
      WHERE stock_id=v_r.stock_id AND part_id=v_r.part_id FOR UPDATE;
    IF NOT FOUND OR v_balance.quantity<v_r.quantity OR v_balance.reserved_quantity<v_r.quantity THEN
      RAISE EXCEPTION 'DBS_OPERATIONAL_CONSUMPTION_BALANCE_INCONSISTENT' USING ERRCODE='23514';
    END IF;
    UPDATE public.dbs_control_operational_stock_balances
      SET quantity=quantity-v_r.quantity,reserved_quantity=reserved_quantity-v_r.quantity,
          version=version+1,updated_at=now() WHERE id=v_balance.id;
    UPDATE public.dbs_control_operational_reservations
      SET status='consumed',consumed_at=now() WHERE id=v_r.id;
    INSERT INTO public.dbs_control_operational_stock_movements(
      company_id,scope_key,part_id,movement_type,quantity,source_stock_id,work_order_id,
      reference,idempotency_key,created_by,metadata
    ) VALUES(
      v_r.company_id,v_r.scope_key,v_r.part_id,'SAIDA_OS',v_r.quantity,v_r.stock_id,
      p_work_order_id,'Consumo de material na conclusão da OS',
      left(v_key||':op-os:'||v_r.id::text,240),p_actor_user_id,
      jsonb_build_object('operational_reservation_id',v_r.id,'purpose',v_r.purpose)
    ) ON CONFLICT(scope_key,idempotency_key) DO NOTHING
    RETURNING id INTO v_movement_id;
    v_count:=v_count+1; v_total:=v_total+v_r.quantity;
  END LOOP;
  RETURN jsonb_build_object('ok',true,'consumed_reservations',v_count,'quantity',v_total);
END $$;

REVOKE ALL ON FUNCTION public.dbs_control_operational_stock_consume_work_order(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dbs_control_operational_stock_consume_work_order(uuid,uuid,text) TO service_role;

COMMIT;
