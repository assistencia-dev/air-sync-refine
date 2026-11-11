-- DBS Air | Fase 2 — Migration F: orçamento relacional, catálogo comercial e vínculo com OS.
-- Aditiva: não altera snapshots, sincronização/Outbox, Compras, Financeiro ou ledger existente.
BEGIN;

CREATE TABLE IF NOT EXISTS public.dbs_control_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_key text NOT NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL REFERENCES public.dbs_control_clients(id) ON DELETE RESTRICT,
  quote_number text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','rejected','converted')),
  source_snapshot_id uuid REFERENCES public.dbs_control_snapshots(id) ON DELETE RESTRICT,
  source_quote_id text,
  service_id uuid,
  equipment_id uuid,
  description text,
  payment_terms text,
  issued_on date,
  valid_until date,
  subtotal_cents bigint NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  discount_cents bigint NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  total_cents bigint NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  work_order_id uuid REFERENCES public.dbs_control_work_orders(id) ON DELETE RESTRICT,
  approved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  idempotency_key text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(scope_key, quote_number),
  UNIQUE(source_snapshot_id, source_quote_id)
);

CREATE TABLE IF NOT EXISTS public.dbs_control_quote_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES public.dbs_control_quotes(id) ON DELETE RESTRICT,
  item_type text NOT NULL DEFAULT 'manual' CHECK (item_type IN ('manual','catalog','service')),
  part_id uuid REFERENCES public.dbs_control_parts(id) ON DELETE RESTRICT,
  description text NOT NULL,
  measure_unit text,
  quantity numeric(18,4) NOT NULL CHECK (quantity > 0),
  unit_sale_cents integer NOT NULL DEFAULT 0 CHECK (unit_sale_cents >= 0),
  total_cents bigint NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  source_item jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((item_type = 'catalog' AND part_id IS NOT NULL) OR (item_type <> 'catalog' AND part_id IS NULL))
);
CREATE INDEX IF NOT EXISTS dbs_control_quotes_scope_status_idx
  ON public.dbs_control_quotes(scope_key,status,created_at DESC);
CREATE INDEX IF NOT EXISTS dbs_control_quote_items_quote_idx
  ON public.dbs_control_quote_items(quote_id,created_at);
CREATE INDEX IF NOT EXISTS dbs_control_quotes_work_order_idx
  ON public.dbs_control_quotes(work_order_id) WHERE work_order_id IS NOT NULL;

ALTER TABLE public.dbs_control_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dbs_control_quote_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dbs_control_quotes, public.dbs_control_quote_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.dbs_control_quotes, public.dbs_control_quote_items TO service_role;
GRANT SELECT ON public.dbs_control_quotes, public.dbs_control_quote_items TO authenticated;

-- Catálogo exclusivamente comercial: nenhum custo, fornecedor ou saldo é exposto.
CREATE OR REPLACE VIEW public.dbs_control_sales_catalog
WITH (security_invoker = true) AS
SELECT p.id AS part_id, p.sku, p.name, p.description,
       p.measure_unit_id, p.sale_cents, p.status
  FROM public.dbs_control_parts p
 WHERE p.status = 'ativo' AND p.sale_cents IS NOT NULL AND p.sale_cents >= 0;
REVOKE ALL ON public.dbs_control_sales_catalog FROM PUBLIC, anon;
GRANT SELECT ON public.dbs_control_sales_catalog TO authenticated, service_role;

-- Importação preservadora: cópia relacional dos 3 orçamentos encontrados.
-- Itens com catalogoId nulo permanecem manuais e NÃO geram reserva/baixa.
DO $$
DECLARE
  s record;
  q jsonb;
  it jsonb;
  v_quote_id uuid;
  v_quote_number text;
  v_client uuid;
  v_subtotal bigint;
  v_discount bigint;
  v_total bigint;
  v_qty numeric;
  v_unit numeric;
  v_line bigint;
  v_part uuid;
BEGIN
  FOR s IN
    SELECT id, scope_key, company_id, state
      FROM public.dbs_control_snapshots
     WHERE jsonb_typeof(state->'orcamentos') = 'array'
       AND jsonb_array_length(state->'orcamentos') > 0
  LOOP
    FOR q IN SELECT value FROM jsonb_array_elements(s.state->'orcamentos')
    LOOP
      v_quote_number := nullif(btrim(q->>'id'),'');
      v_client := nullif(q->>'clienteId','')::uuid;
      IF v_quote_number IS NULL OR v_client IS NULL OR
         NOT EXISTS (SELECT 1 FROM public.dbs_control_clients c WHERE c.id=v_client) THEN
        RAISE EXCEPTION 'DBS_QUOTE_LEGACY_REFERENCE_INVALID: %', coalesce(v_quote_number,'sem número')
          USING ERRCODE='23503';
      END IF;

      INSERT INTO public.dbs_control_quotes(
        scope_key,company_id,client_id,quote_number,status,source_snapshot_id,source_quote_id,
        description,payment_terms,issued_on,valid_until,subtotal_cents,discount_cents,total_cents,metadata
      ) VALUES (
        s.scope_key,s.company_id,v_client,v_quote_number,
        CASE WHEN lower(coalesce(q->>'status','')) IN ('aprovado','approved') THEN 'approved'
             WHEN lower(coalesce(q->>'status','')) IN ('rejeitado','rejected') THEN 'rejected'
             WHEN lower(coalesce(q->>'status','')) IN ('convertido em os','converted') THEN 'converted'
             ELSE 'draft' END,
        s.id,v_quote_number,nullif(q->>'desc',''),nullif(q->>'pagamento',''),
        CASE WHEN coalesce(q->>'data','') ~ '^\\d{2}/\\d{2}/\\d{4}$' THEN to_date(q->>'data','DD/MM/YYYY') END,
        CASE WHEN coalesce(q->>'validade','') ~ '^\\d{2}/\\d{2}/\\d{4}$' THEN to_date(q->>'validade','DD/MM/YYYY') END,
        round(coalesce(nullif(q->>'subtotal','')::numeric,nullif(q->>'total','')::numeric,0)*100)::bigint,
        round(coalesce(nullif(q->>'desconto','')::numeric,0)*100)::bigint,
        round(coalesce(nullif(q->>'total','')::numeric,0)*100)::bigint,
        jsonb_build_object('legacy_qtd',q->'qtd','legacy_service_id',q->'servicoId',
          'legacy_equipment_id',q->'equipamentoId','legacy_status',q->>'status')
      )
      ON CONFLICT (source_snapshot_id,source_quote_id) DO NOTHING
      RETURNING id INTO v_quote_id;

      IF v_quote_id IS NULL THEN
        SELECT id INTO v_quote_id FROM public.dbs_control_quotes
         WHERE source_snapshot_id=s.id AND source_quote_id=v_quote_number;
      END IF;

      IF NOT EXISTS (SELECT 1 FROM public.dbs_control_quote_items WHERE quote_id=v_quote_id) THEN
        IF jsonb_typeof(q->'itens')='array' AND jsonb_array_length(q->'itens')>0 THEN
          FOR it IN SELECT value FROM jsonb_array_elements(q->'itens')
          LOOP
            v_qty := greatest(coalesce(nullif(it->>'quantidade','')::numeric,1),0.0001);
            v_unit := coalesce(nullif(it->>'valorUnitario','')::numeric,
                               nullif(it->>'total','')::numeric / v_qty,0);
            v_line := round(coalesce(nullif(it->>'total','')::numeric,v_unit*v_qty)*100)::bigint;
            v_part := CASE WHEN nullif(it->>'catalogoId','') IS NOT NULL
                           THEN nullif(it->>'catalogoId','')::uuid ELSE NULL END;
            INSERT INTO public.dbs_control_quote_items(
              quote_id,item_type,part_id,description,measure_unit,quantity,unit_sale_cents,total_cents,source_item
            ) VALUES (
              v_quote_id,
              CASE WHEN v_part IS NULL THEN 'manual' ELSE 'catalog' END,
              v_part,
              coalesce(nullif(it->>'descricao',''),nullif(it->>'nome',''),nullif(q->>'desc','Orçamento legado')),
              nullif(coalesce(it->>'unidade',it->>'unidadePreco'), ''),
              v_qty,round(v_unit*100)::integer,v_line,it
            );
          END LOOP;
        ELSE
          v_qty := greatest(coalesce(nullif(q->>'qtd','')::numeric,1),0.0001);
          v_total := round(coalesce(nullif(q->>'total','')::numeric,0)*100)::bigint;
          INSERT INTO public.dbs_control_quote_items(
            quote_id,item_type,description,quantity,unit_sale_cents,total_cents,source_item
          ) VALUES (v_quote_id,'manual',coalesce(nullif(q->>'desc',''),'Item legado'),
            v_qty,round((v_total / v_qty))::integer,v_total,q);
        END IF;
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- Aprovação e conversão: uma transação, admin autenticado, OS UUID e reservas únicas.
CREATE OR REPLACE FUNCTION public.dbs_control_approve_quote_and_create_work_order(
  p_quote_id uuid, p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_quote public.dbs_control_quotes%rowtype;
  v_client public.dbs_control_clients%rowtype;
  v_os public.dbs_control_work_orders%rowtype;
  v_key text := nullif(btrim(p_idempotency_key),'');
  v_items jsonb;
  v_reservation jsonb;
BEGIN
  IF v_actor IS NULL OR NOT public.dbs_control_is_admin_actor(v_actor) THEN
    RAISE EXCEPTION 'DBS_QUOTE_APPROVAL_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF p_quote_id IS NULL OR v_key IS NULL OR char_length(v_key) NOT BETWEEN 8 AND 240 THEN
    RAISE EXCEPTION 'DBS_QUOTE_APPROVAL_INPUT_INVALID' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('quote-approve:'||p_quote_id::text,0));
  SELECT * INTO v_quote FROM public.dbs_control_quotes WHERE id=p_quote_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DBS_QUOTE_NOT_FOUND' USING ERRCODE='23503'; END IF;
  IF v_quote.work_order_id IS NOT NULL THEN
    SELECT * INTO v_os FROM public.dbs_control_work_orders WHERE id=v_quote.work_order_id;
    RETURN jsonb_build_object('ok',true,'replayed',true,'quote_id',v_quote.id,'work_order_id',v_os.id,'protocol',v_os.protocol);
  END IF;
  IF v_quote.status NOT IN ('draft','approved') THEN
    RAISE EXCEPTION 'DBS_QUOTE_STATUS_NOT_APPROVABLE' USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_client FROM public.dbs_control_clients WHERE id=v_quote.client_id AND status='ativo';
  IF NOT FOUND THEN RAISE EXCEPTION 'DBS_QUOTE_CLIENT_UNAVAILABLE' USING ERRCODE='23514'; END IF;
  IF EXISTS (SELECT 1 FROM public.users u WHERE u.id=v_actor AND u.status='ativo'
      AND u.company_id IS NOT NULL AND u.company_id IS DISTINCT FROM v_quote.company_id) THEN
    RAISE EXCEPTION 'DBS_QUOTE_SCOPE_MISMATCH' USING ERRCODE='42501';
  END IF;

  INSERT INTO public.dbs_control_work_orders(
    protocol,protocolo,client_id,created_by_user_id,type,priority,status,description,total_cents
  ) VALUES (
    v_quote.quote_number||'-'||substr(replace(gen_random_uuid()::text,'-',''),1,6),
    v_quote.quote_number,v_quote.client_id,v_actor,'corretiva','normal','aberta',
    coalesce(v_quote.description,'Orçamento aprovado '||v_quote.quote_number),v_quote.total_cents::integer
  ) RETURNING * INTO v_os;

  UPDATE public.dbs_control_quotes SET status='converted',work_order_id=v_os.id,
    approved_by=v_actor,approved_at=coalesce(approved_at,now()),idempotency_key=v_key,updated_at=now()
   WHERE id=v_quote.id;

  SELECT coalesce(jsonb_agg(jsonb_build_object('part_id',i.part_id,'quantity',i.quantity)
      ORDER BY i.part_id),'[]'::jsonb)
    INTO v_items FROM public.dbs_control_quote_items i
   WHERE i.quote_id=v_quote.id AND i.item_type='catalog' AND i.part_id IS NOT NULL;
  IF jsonb_array_length(v_items)>0 THEN
    v_reservation := public.dbs_control_reserve_work_order_parts(jsonb_build_object(
      'actor_user_id',v_actor,'work_order_id',v_os.id,
      'idempotency_key','quote:'||v_quote.id::text||':'||md5(v_key),'items',v_items
    ));
  ELSE
    v_reservation := jsonb_build_object('ok',true,'reservations','[]'::jsonb);
  END IF;
  RETURN jsonb_build_object('ok',true,'replayed',false,'quote_id',v_quote.id,
    'work_order_id',v_os.id,'protocol',v_os.protocol,'reservation',v_reservation);
END;
$$;

CREATE TABLE IF NOT EXISTS public.dbs_control_quote_installations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL UNIQUE REFERENCES public.dbs_control_work_orders(id) ON DELETE RESTRICT,
  quote_id uuid NOT NULL REFERENCES public.dbs_control_quotes(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL CHECK (char_length(trim(idempotency_key)) BETWEEN 8 AND 240),
  confirmed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  result jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.dbs_control_quote_installations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dbs_control_quote_installations FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.dbs_control_quote_installations TO service_role;

-- Leitura de itens previstos: somente admin ou técnico efetivamente vinculado à OS.
CREATE OR REPLACE FUNCTION public.dbs_control_list_work_order_quote_items(p_work_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE v_actor uuid:=auth.uid(); v_os public.dbs_control_work_orders%rowtype;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'DBS_QUOTE_ITEMS_UNAUTHENTICATED' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_os FROM public.dbs_control_work_orders WHERE id=p_work_order_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'DBS_OS_NOT_FOUND' USING ERRCODE='23503'; END IF;
  IF NOT public.dbs_control_is_admin_actor(v_actor) AND NOT EXISTS (
    SELECT 1 FROM public.users u
    LEFT JOIN public.rh_employee_access ea ON ea.user_id=u.id AND ea.access_enabled=true
    LEFT JOIN public.rh_employees re ON re.ponto_portal_user_id=u.id AND re.dbs_control_access_enabled=true AND re.is_active=true
    WHERE u.id=v_actor AND u.status='ativo' AND u.role_key::text='COLABORADOR'
      AND v_os.assigned_employee_id=coalesce(ea.employee_id,re.id)
  ) THEN RAISE EXCEPTION 'DBS_QUOTE_ITEMS_FORBIDDEN' USING ERRCODE='42501'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('id',i.id,'item_type',i.item_type,'part_id',i.part_id,
      'description',i.description,'measure_unit',i.measure_unit,'quantity',i.quantity,
      'unit_sale_cents',i.unit_sale_cents,'total_cents',i.total_cents,
      'reservation_status',coalesce(r.status,'not_reserved'),
      'installation_confirmed',ins.work_order_id IS NOT NULL,
      'installation_confirmed_at',ins.confirmed_at) ORDER BY i.created_at,i.id)
    FROM public.dbs_control_quotes q
    JOIN public.dbs_control_quote_items i ON i.quote_id=q.id
    LEFT JOIN public.dbs_control_work_order_reservations r
      ON r.work_order_id=q.work_order_id AND r.part_id=i.part_id
    LEFT JOIN public.dbs_control_quote_installations ins ON ins.work_order_id=q.work_order_id
    WHERE q.work_order_id=p_work_order_id
  ),'[]'::jsonb);
END;
$$;

-- A UI nunca fornece o actor_id. O wrapper vincula a operação à sessão JWT real.
CREATE OR REPLACE FUNCTION public.dbs_control_confirm_quote_installation(
  p_work_order_id uuid, p_idempotency_key text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE
  v_actor uuid:=auth.uid();
  v_quote_id uuid;
  v_existing public.dbs_control_quote_installations%rowtype;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'DBS_QUOTE_CONFIRM_UNAUTHENTICATED' USING ERRCODE='42501'; END IF;
  IF p_idempotency_key IS NULL OR char_length(btrim(p_idempotency_key)) NOT BETWEEN 8 AND 220 THEN
    RAISE EXCEPTION 'DBS_QUOTE_CONFIRM_IDEMPOTENCY_REQUIRED' USING ERRCODE='22023';
  END IF;
  SELECT q.id INTO v_quote_id FROM public.dbs_control_quotes q
   WHERE q.work_order_id=p_work_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DBS_QUOTE_CONFIRM_NO_APPROVED_ITEMS' USING ERRCODE='23503'; END IF;
  SELECT * INTO v_existing FROM public.dbs_control_quote_installations
   WHERE work_order_id=p_work_order_id FOR UPDATE;
  IF FOUND THEN
    RETURN coalesce(v_existing.result,'{}'::jsonb)||jsonb_build_object(
      'ok',true,'replayed',true,'installation_confirmed',true,'work_order_id',p_work_order_id);
  END IF;
  -- Esta RPC existente valida admin/técnico atribuído e consome somente reservas já criadas.
  v_result := public.dbs_control_consume_work_order_reservations(
    p_work_order_id,v_actor,'quote-install:'||p_idempotency_key
  );
  INSERT INTO public.dbs_control_quote_installations(
    work_order_id,quote_id,idempotency_key,confirmed_by,result
  ) VALUES (p_work_order_id,v_quote_id,p_idempotency_key,v_actor,v_result);
  RETURN v_result||jsonb_build_object('installation_confirmed',true,'work_order_id',p_work_order_id);
END;
$$;

REVOKE ALL ON FUNCTION public.dbs_control_approve_quote_and_create_work_order(uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.dbs_control_list_work_order_quote_items(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.dbs_control_confirm_quote_installation(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.dbs_control_approve_quote_and_create_work_order(uuid,text) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.dbs_control_list_work_order_quote_items(uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.dbs_control_confirm_quote_installation(uuid,text) TO authenticated,service_role;


-- Adaptador estável para o módulo legado: o navegador envia apenas o número visível.
CREATE OR REPLACE FUNCTION public.dbs_control_approve_quote_by_number(
  p_quote_number text, p_idempotency_key text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $
DECLARE v_actor uuid:=auth.uid(); v_quote_id uuid;
BEGIN
  IF v_actor IS NULL OR NOT public.dbs_control_is_admin_actor(v_actor) THEN
    RAISE EXCEPTION 'DBS_QUOTE_APPROVAL_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  SELECT q.id INTO v_quote_id
    FROM public.dbs_control_quotes q
    JOIN public.users u ON u.id=v_actor AND u.status='ativo'
   WHERE q.quote_number=nullif(btrim(p_quote_number),'')
     AND (u.company_id IS NULL OR q.company_id IS NULL OR q.company_id=u.company_id)
   ORDER BY q.created_at DESC LIMIT 1 FOR UPDATE OF q;
  IF NOT FOUND THEN RAISE EXCEPTION 'DBS_QUOTE_NOT_FOUND' USING ERRCODE='23503'; END IF;
  RETURN public.dbs_control_approve_quote_and_create_work_order(v_quote_id,p_idempotency_key);
END;
$;
REVOKE ALL ON FUNCTION public.dbs_control_approve_quote_by_number(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.dbs_control_approve_quote_by_number(text,text) TO authenticated,service_role;

COMMIT;
