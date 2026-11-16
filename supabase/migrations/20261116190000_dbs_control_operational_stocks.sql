-- DBS Control: estoques operacionais por centro de custo.
-- Aditivo: não altera saldos existentes nem executa backfill/baixas na base.
BEGIN;

CREATE TABLE IF NOT EXISTS public.dbs_control_operational_stocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE RESTRICT,
  scope_key text NOT NULL,
  cost_center_id uuid NOT NULL REFERENCES public.dbs_control_cost_centers(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 160),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(scope_key,cost_center_id),
  UNIQUE(scope_key,id)
);
CREATE TABLE IF NOT EXISTS public.dbs_control_operational_stock_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_key text NOT NULL,
  stock_id uuid NOT NULL REFERENCES public.dbs_control_operational_stocks(id) ON DELETE RESTRICT,
  part_id uuid NOT NULL REFERENCES public.dbs_control_parts(id) ON DELETE RESTRICT,
  quantity numeric(14,3) NOT NULL DEFAULT 0 CHECK(quantity>=0),
  reserved_quantity numeric(14,3) NOT NULL DEFAULT 0 CHECK(reserved_quantity>=0 AND reserved_quantity<=quantity),
  version bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(stock_id,part_id)
);
CREATE TABLE IF NOT EXISTS public.dbs_control_operational_stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE RESTRICT,
  scope_key text NOT NULL,
  part_id uuid NOT NULL REFERENCES public.dbs_control_parts(id) ON DELETE RESTRICT,
  movement_type text NOT NULL CHECK(movement_type IN ('ENTRADA','SAIDA_OS','TRANSFERENCIA_CENTRAL_OPERACIONAL','TRANSFERENCIA_OPERACIONAL_CENTRAL','TRANSFERENCIA_ENTRE_OPERACIONAIS')),
  quantity numeric(14,3) NOT NULL CHECK(quantity>0),
  source_stock_id uuid REFERENCES public.dbs_control_operational_stocks(id) ON DELETE RESTRICT,
  destination_stock_id uuid REFERENCES public.dbs_control_operational_stocks(id) ON DELETE RESTRICT,
  work_order_id uuid REFERENCES public.dbs_control_work_orders(id) ON DELETE RESTRICT,
  purchase_id uuid REFERENCES public.dbs_control_purchases(id) ON DELETE RESTRICT,
  reference text,
  idempotency_key text NOT NULL CHECK(char_length(btrim(idempotency_key)) BETWEEN 8 AND 240),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(scope_key,idempotency_key)
);
CREATE TABLE IF NOT EXISTS public.dbs_control_operational_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE RESTRICT,
  scope_key text NOT NULL,
  stock_id uuid NOT NULL REFERENCES public.dbs_control_operational_stocks(id) ON DELETE RESTRICT,
  work_order_id uuid NOT NULL REFERENCES public.dbs_control_work_orders(id) ON DELETE RESTRICT,
  part_id uuid NOT NULL REFERENCES public.dbs_control_parts(id) ON DELETE RESTRICT,
  quantity numeric(14,3) NOT NULL CHECK(quantity>0),
  purpose text NOT NULL CHECK(purpose IN ('TROCA_PECA','ATIVO_EQUIPAMENTO')),
  status text NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','released','consumed')),
  unit_cost_cents integer NOT NULL DEFAULT 0 CHECK(unit_cost_cents>=0),
  idempotency_key text NOT NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  consumed_at timestamptz,
  UNIQUE(scope_key,idempotency_key)
);

CREATE INDEX IF NOT EXISTS dbs_operational_stocks_scope_idx ON public.dbs_control_operational_stocks(scope_key,status);
CREATE INDEX IF NOT EXISTS dbs_operational_balances_stock_idx ON public.dbs_control_operational_stock_balances(stock_id,part_id);
CREATE INDEX IF NOT EXISTS dbs_operational_movements_history_idx ON public.dbs_control_operational_stock_movements(scope_key,created_at DESC);
CREATE INDEX IF NOT EXISTS dbs_operational_reservations_os_idx ON public.dbs_control_operational_reservations(scope_key,work_order_id,created_at DESC);

ALTER TABLE public.dbs_control_operational_stocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dbs_control_operational_stock_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dbs_control_operational_stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dbs_control_operational_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dbs_control_operational_stocks,public.dbs_control_operational_stock_balances,
  public.dbs_control_operational_stock_movements,public.dbs_control_operational_reservations FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.dbs_control_operational_stocks,public.dbs_control_operational_stock_balances,
  public.dbs_control_operational_stock_movements,public.dbs_control_operational_reservations TO service_role;

ALTER TABLE public.dbs_control_parts
  ADD COLUMN IF NOT EXISTS purchase_measure_unit_id uuid REFERENCES public.dbs_control_measure_units(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION public.dbs_control_operational_stock_transfer(
  p_actor_user_id uuid,p_part_id uuid,p_quantity numeric,p_source_stock_id uuid,
  p_destination_stock_id uuid,p_idempotency_key text,p_reference text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_actor_company uuid; v_scope text; v_company uuid; v_part public.dbs_control_parts%rowtype;
  v_source record; v_destination record; v_source_balance public.dbs_control_operational_stock_balances%rowtype;
  v_dest_balance public.dbs_control_operational_stock_balances%rowtype; v_type text;
  v_key text:=nullif(btrim(p_idempotency_key),''); v_existing uuid;
BEGIN
  IF p_actor_user_id IS NULL OR NOT public.dbs_control_is_admin_actor(p_actor_user_id) THEN
    RAISE EXCEPTION 'DBS_OPERATIONAL_STOCK_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF p_part_id IS NULL OR p_quantity IS NULL OR p_quantity<=0 OR v_key IS NULL OR char_length(v_key) NOT BETWEEN 8 AND 240
     OR (p_source_stock_id IS NULL AND p_destination_stock_id IS NULL)
     OR p_source_stock_id IS NOT DISTINCT FROM p_destination_stock_id THEN
    RAISE EXCEPTION 'DBS_OPERATIONAL_STOCK_INPUT_INVALID' USING ERRCODE='22023';
  END IF;
  SELECT company_id INTO v_actor_company FROM public.users WHERE id=p_actor_user_id AND status='ativo';
  IF NOT FOUND THEN RAISE EXCEPTION 'DBS_OPERATIONAL_STOCK_ACTOR_INVALID' USING ERRCODE='42501'; END IF;
  v_scope:=CASE WHEN v_actor_company IS NULL THEN 'user:'||p_actor_user_id ELSE 'company:'||v_actor_company END;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_scope||':op-transfer:'||v_key,0));
  SELECT id INTO v_existing FROM public.dbs_control_operational_stock_movements WHERE scope_key=v_scope AND idempotency_key=v_key;
  IF v_existing IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'replayed',true,'movement_id',v_existing); END IF;
  SELECT * INTO v_part FROM public.dbs_control_parts WHERE id=p_part_id FOR UPDATE;
  IF NOT FOUND OR v_part.status<>'ativo' THEN RAISE EXCEPTION 'DBS_OPERATIONAL_STOCK_PART_INVALID' USING ERRCODE='23503'; END IF;
  IF p_source_stock_id IS NOT NULL THEN
    SELECT s.id,s.scope_key,s.company_id,s.status INTO v_source FROM public.dbs_control_operational_stocks s WHERE s.id=p_source_stock_id AND s.scope_key=v_scope FOR UPDATE;
    IF NOT FOUND OR v_source.status<>'active' THEN RAISE EXCEPTION 'DBS_OPERATIONAL_STOCK_SOURCE_INVALID' USING ERRCODE='23503'; END IF;
  END IF;
  IF p_destination_stock_id IS NOT NULL THEN
    SELECT s.id,s.scope_key,s.company_id,s.status INTO v_destination FROM public.dbs_control_operational_stocks s WHERE s.id=p_destination_stock_id AND s.scope_key=v_scope FOR UPDATE;
    IF NOT FOUND OR v_destination.status<>'active' THEN RAISE EXCEPTION 'DBS_OPERATIONAL_STOCK_DESTINATION_INVALID' USING ERRCODE='23503'; END IF;
  END IF;
  IF p_source_stock_id IS NOT NULL THEN
    SELECT * INTO v_source_balance FROM public.dbs_control_operational_stock_balances
      WHERE stock_id=p_source_stock_id AND part_id=p_part_id FOR UPDATE;
    IF NOT FOUND OR v_source_balance.quantity-v_source_balance.reserved_quantity<p_quantity THEN
      RAISE EXCEPTION 'DBS_OPERATIONAL_STOCK_INSUFFICIENT' USING ERRCODE='23514';
    END IF;
  ELSIF coalesce(v_part.stock_quantity,0)-coalesce(v_part.reserved_quantity,0)<p_quantity THEN
    RAISE EXCEPTION 'DBS_CENTRAL_STOCK_INSUFFICIENT' USING ERRCODE='23514';
  END IF;
  IF p_destination_stock_id IS NOT NULL THEN
    INSERT INTO public.dbs_control_operational_stock_balances(scope_key,stock_id,part_id,quantity)
    VALUES(v_scope,p_destination_stock_id,p_part_id,0) ON CONFLICT(stock_id,part_id) DO NOTHING;
    SELECT * INTO v_dest_balance FROM public.dbs_control_operational_stock_balances
      WHERE stock_id=p_destination_stock_id AND part_id=p_part_id FOR UPDATE;
  END IF;
  IF p_source_stock_id IS NULL AND p_destination_stock_id IS NOT NULL THEN
    UPDATE public.dbs_control_parts SET stock_quantity=stock_quantity-p_quantity,version=version+1,updated_at=now() WHERE id=p_part_id;
    UPDATE public.dbs_control_operational_stock_balances SET quantity=quantity+p_quantity,version=version+1,updated_at=now() WHERE id=v_dest_balance.id;
    v_type:='TRANSFERENCIA_CENTRAL_OPERACIONAL';
  ELSIF p_source_stock_id IS NOT NULL AND p_destination_stock_id IS NULL THEN
    UPDATE public.dbs_control_operational_stock_balances SET quantity=quantity-p_quantity,version=version+1,updated_at=now() WHERE id=v_source_balance.id;
    UPDATE public.dbs_control_parts SET stock_quantity=stock_quantity+p_quantity,version=version+1,updated_at=now() WHERE id=p_part_id;
    v_type:='TRANSFERENCIA_OPERACIONAL_CENTRAL';
  ELSE
    UPDATE public.dbs_control_operational_stock_balances SET quantity=quantity-p_quantity,version=version+1,updated_at=now() WHERE id=v_source_balance.id;
    UPDATE public.dbs_control_operational_stock_balances SET quantity=quantity+p_quantity,version=version+1,updated_at=now() WHERE id=v_dest_balance.id;
    v_type:='TRANSFERENCIA_ENTRE_OPERACIONAIS';
  END IF;
  INSERT INTO public.dbs_control_operational_stock_movements(company_id,scope_key,part_id,movement_type,quantity,source_stock_id,destination_stock_id,reference,idempotency_key,created_by)
  VALUES(v_actor_company,v_scope,p_part_id,v_type,p_quantity,p_source_stock_id,p_destination_stock_id,nullif(btrim(p_reference),''),v_key,p_actor_user_id)
  RETURNING id INTO v_existing;
  RETURN jsonb_build_object('ok',true,'replayed',false,'movement_id',v_existing,'movement_type',v_type);
END $$;

CREATE OR REPLACE FUNCTION public.dbs_control_operational_stock_reserve(
  p_actor_user_id uuid,p_work_order_id uuid,p_cost_center_id uuid,p_part_id uuid,
  p_quantity numeric,p_purpose text,p_idempotency_key text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_actor_company uuid; v_scope text; v_stock public.dbs_control_operational_stocks%rowtype;
  v_balance public.dbs_control_operational_stock_balances%rowtype; v_os record; v_reservation uuid;
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
  SELECT wo.id,wo.client_id,wo.status,wo.company_id INTO v_os FROM public.dbs_control_work_orders wo
    WHERE wo.id=p_work_order_id AND wo.deleted_at IS NULL;
  IF NOT FOUND OR lower(coalesce(v_os.status,'')) IN ('concluida','concluída','completed','complete','cancelada','cancelado','cancelled') THEN
    RAISE EXCEPTION 'DBS_OPERATIONAL_RESERVATION_OS_INVALID' USING ERRCODE='23514';
  END IF;
  IF v_os.company_id IS DISTINCT FROM v_actor_company AND v_actor_company IS NOT NULL THEN
    RAISE EXCEPTION 'DBS_OPERATIONAL_RESERVATION_SCOPE_MISMATCH' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_stock FROM public.dbs_control_operational_stocks
    WHERE scope_key=v_scope AND cost_center_id=p_cost_center_id AND status='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DBS_OPERATIONAL_STOCK_NOT_CONFIGURED' USING ERRCODE='23503'; END IF;
  SELECT * INTO v_part FROM public.dbs_control_parts WHERE id=p_part_id AND status='ativo' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DBS_OPERATIONAL_RESERVATION_PART_INVALID' USING ERRCODE='23503'; END IF;
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

CREATE OR REPLACE FUNCTION public.dbs_control_operational_stock_release_reservation(
  p_actor_user_id uuid,p_reservation_id uuid,p_idempotency_key text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_r public.dbs_control_operational_reservations%rowtype; v_balance public.dbs_control_operational_stock_balances%rowtype;
  v_actor_company uuid; v_key text:=nullif(btrim(p_idempotency_key),'');
BEGIN
  IF p_actor_user_id IS NULL OR NOT public.dbs_control_is_admin_actor(p_actor_user_id) THEN RAISE EXCEPTION 'DBS_OPERATIONAL_RESERVATION_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF v_key IS NULL OR char_length(v_key) NOT BETWEEN 8 AND 240 THEN RAISE EXCEPTION 'DBS_OPERATIONAL_RESERVATION_IDEMPOTENCY_REQUIRED' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_r FROM public.dbs_control_operational_reservations WHERE id=p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DBS_OPERATIONAL_RESERVATION_NOT_FOUND' USING ERRCODE='23503'; END IF;
  SELECT company_id INTO v_actor_company FROM public.users WHERE id=p_actor_user_id AND status='ativo';
  IF v_actor_company IS DISTINCT FROM v_r.company_id THEN RAISE EXCEPTION 'DBS_OPERATIONAL_RESERVATION_SCOPE_MISMATCH' USING ERRCODE='42501'; END IF;
  IF v_r.status<>'reserved' THEN RETURN jsonb_build_object('ok',true,'replayed',true,'reservation_id',v_r.id,'status',v_r.status); END IF;
  SELECT * INTO v_balance FROM public.dbs_control_operational_stock_balances WHERE stock_id=v_r.stock_id AND part_id=v_r.part_id FOR UPDATE;
  IF NOT FOUND OR v_balance.reserved_quantity<v_r.quantity THEN RAISE EXCEPTION 'DBS_OPERATIONAL_RESERVATION_BALANCE_INCONSISTENT' USING ERRCODE='23514'; END IF;
  UPDATE public.dbs_control_operational_stock_balances SET reserved_quantity=reserved_quantity-v_r.quantity,version=version+1,updated_at=now() WHERE id=v_balance.id;
  UPDATE public.dbs_control_operational_reservations SET status='released',released_at=now() WHERE id=v_r.id;
  RETURN jsonb_build_object('ok',true,'replayed',false,'reservation_id',v_r.id,'status','released');
END $$;

REVOKE ALL ON FUNCTION public.dbs_control_operational_stock_transfer(uuid,uuid,numeric,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.dbs_control_operational_stock_reserve(uuid,uuid,uuid,uuid,numeric,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.dbs_control_operational_stock_release_reservation(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dbs_control_operational_stock_transfer(uuid,uuid,numeric,uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.dbs_control_operational_stock_reserve(uuid,uuid,uuid,uuid,numeric,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.dbs_control_operational_stock_release_reservation(uuid,uuid,text) TO service_role;

COMMIT;
