-- Corrige o ciclo de aprovação financeira das compras sem misturar a fila de OS.
-- Pedido pendente não entra no contas a pagar contabilizado; aprovação cria o compromisso.
-- Rejeição de legado com AP já postado recebe estorno compensatório imutável.

BEGIN;

ALTER TABLE public.dbs_control_purchases
  ADD COLUMN IF NOT EXISTS rejection_ledger_entry_id uuid
    REFERENCES public.treasury_ledger_entries(id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.dbs_control_purchases.rejection_ledger_entry_id IS
  'Lançamento compensatório no DBS Treasury quando uma compra rejeitada já possuía AP contabilizado.';

DO $patch$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  -- 1) Corrige o outbox da compra e posterga a criação do AP até a aprovação.
  SELECT pg_get_functiondef('public.dbs_control_register_purchase(jsonb)'::regprocedure)
    INTO v_def;

  v_old := $old$  v_ledger := public.post_treasury_ledger_entry(
    v_scope,v_company,v_date,v_date,
    'purchase_registered','Compra registrada · '||v_supplier,
    left(v_key||':payable',200),'purchase-payable:'||v_purchase::text,
    v_actor,'posted',
    jsonb_build_object('source','dbs_control_purchase','purchase_id',v_purchase,'status','draft','cost_center_id',v_cost_center_id,'supplier_id',v_supplier_id),
    jsonb_build_array(
      jsonb_build_object('account_code','1.1.04','account_name','Estoque em trânsito',
        'account_type','asset','debit_cents',v_total,'credit_cents',0,'memo','Compra registrada aguardando recebimento'),
      jsonb_build_object('account_code','2.1.01','account_name','Fornecedores',
        'account_type','liability','debit_cents',0,'credit_cents',v_total,'memo','Contas a pagar da compra')
    )
  );
  v_ledger_id := nullif(v_ledger->>'entry_id','')::uuid;
  if v_ledger_id is null then
    raise exception 'DBS_PURCHASE_PAYABLE_LEDGER_FAILED' using errcode='23514';
  end if;$old$;
  v_new := $new$  -- A compra fica pendente, sem AP postado, até a aprovação financeira.
  v_ledger_id := NULL;$new$;

  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'Migration: bloco de AP do registro de compra não encontrado; nenhuma alteração aplicada.';
  END IF;
  v_def := replace(v_def, v_old, v_new);

  v_old := $old$  insert into public.dbs_control_outbox(
    idempotency_key,company_id,aggregate_type,aggregate_id,event_type,aggregate_version,payload
  ) values(
    left('purchase:registered:'||v_scope||':'||v_key,240),
    v_company,'purchase',v_purchase,'purchase.registered',1,
    jsonb_build_object('purchase_id',v_purchase,'scope_key',v_scope,'total_cents',v_total)
  ) on conflict(idempotency_key) do nothing;$old$;
  v_new := $new$  insert into public.dbs_control_inventory_outbox(
    idempotency_key,scope_key,aggregate_type,aggregate_id,event_type,payload
  ) values(
    left('purchase:registered:'||v_scope||':'||v_key,240),
    v_scope,'purchase',v_purchase,'purchase.registered',
    jsonb_build_object('purchase_id',v_purchase,'scope_key',v_scope,'total_cents',v_total)
  ) on conflict(idempotency_key) do nothing;$new$;

  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'Migration: bloco de outbox da compra não encontrado; nenhuma alteração aplicada.';
  END IF;
  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;
END;
$patch$;

-- 2) Aprovação específica: SUPER_ADMIN e Financeiro podem decidir; somente a
-- aprovação cria o AP. Rejeição estorna AP legado já postado, sem apagar Ledger.
CREATE OR REPLACE FUNCTION public.dbs_control_decide_purchase_approval(
  p_purchase_id uuid,
  p_actor_user_id uuid,
  p_decision text,
  p_reason text DEFAULT NULL,
  p_expected_version bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_purchase public.dbs_control_purchases%rowtype;
  v_actor_company uuid;
  v_actor_role text;
  v_decision text := lower(btrim(coalesce(p_decision,'')));
  v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
  v_ledger jsonb;
  v_ledger_id uuid;
  v_reversal jsonb;
  v_reversal_id uuid;
  v_entry_status text;
BEGIN
  SELECT company_id, role_key
    INTO v_actor_company, v_actor_role
    FROM public.users
   WHERE id = p_actor_user_id AND status = 'ativo';

  IF p_actor_user_id IS NULL OR v_actor_role IS NULL OR v_actor_role NOT IN (
    'SUPER_ADMIN','ADMIN_OPERACIONAL','GESTOR_CONTA','GESTOR_REGIONAL','FINANCEIRO_LEITURA'
  ) THEN
    RAISE EXCEPTION 'DBS_PURCHASE_APPROVAL_FORBIDDEN' USING errcode='42501';
  END IF;

  IF p_purchase_id IS NULL OR v_decision NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'DBS_PURCHASE_APPROVAL_INPUT_INVALID' USING errcode='22023';
  END IF;
  IF v_decision = 'rejected' AND (v_reason IS NULL OR char_length(v_reason) < 5 OR char_length(v_reason) > 1000) THEN
    RAISE EXCEPTION 'DBS_PURCHASE_REJECTION_REASON_REQUIRED' USING errcode='22023';
  END IF;

  SELECT * INTO v_purchase
    FROM public.dbs_control_purchases
   WHERE id = p_purchase_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DBS_PURCHASE_NOT_FOUND' USING errcode='23503';
  END IF;
  IF v_actor_company IS NOT NULL AND v_actor_company IS DISTINCT FROM v_purchase.company_id THEN
    RAISE EXCEPTION 'DBS_PURCHASE_SCOPE_MISMATCH' USING errcode='42501';
  END IF;
  IF v_purchase.status = 'cancelled' THEN
    RAISE EXCEPTION 'DBS_PURCHASE_CANCELLED' USING errcode='23514';
  END IF;
  IF v_purchase.status IN ('received','partially_received')
     OR v_purchase.approval_status = 'legacy_received' THEN
    RAISE EXCEPTION 'DBS_PURCHASE_ALREADY_RECEIVED' USING errcode='23514';
  END IF;
  IF p_expected_version IS NOT NULL AND p_expected_version <> v_purchase.version THEN
    RAISE EXCEPTION 'DBS_PURCHASE_VERSION_CONFLICT' USING errcode='40001';
  END IF;

  IF v_purchase.approval_status = v_decision THEN
    RETURN jsonb_build_object(
      'ok',true,'replayed',true,'purchase_id',p_purchase_id,
      'approval_status',v_purchase.approval_status,
      'ledger_entry_id',v_purchase.ledger_entry_id,
      'rejection_ledger_entry_id',v_purchase.rejection_ledger_entry_id,
      'version',v_purchase.version
    );
  END IF;
  IF v_purchase.approval_status <> 'pending' THEN
    RAISE EXCEPTION 'DBS_PURCHASE_APPROVAL_ALREADY_DECIDED' USING errcode='23514';
  END IF;

  IF v_decision = 'approved' THEN
    v_ledger_id := v_purchase.ledger_entry_id;
    IF v_ledger_id IS NULL THEN
      v_ledger := public.post_treasury_ledger_entry(
        v_purchase.scope_key, v_purchase.company_id, v_purchase.purchase_date, v_purchase.purchase_date,
        'purchase_registered', 'Compra aprovada · ' || v_purchase.supplier_name,
        left('purchase-approved:' || p_purchase_id::text, 200),
        'purchase-payable:' || p_purchase_id::text,
        p_actor_user_id, 'posted',
        jsonb_build_object(
          'source','dbs_control_purchase_approval',
          'purchase_id',p_purchase_id,
          'status','approved',
          'cost_center_id',v_purchase.cost_center_id,
          'supplier_id',v_purchase.supplier_id
        ),
        jsonb_build_array(
          jsonb_build_object(
            'account_code','1.1.04','account_name','Estoque em trânsito',
            'account_type','asset','debit_cents',v_purchase.total_cents,'credit_cents',0,
            'memo','Compra aprovada aguardando recebimento físico'
          ),
          jsonb_build_object(
            'account_code','2.1.01','account_name','Fornecedores',
            'account_type','liability','debit_cents',0,'credit_cents',v_purchase.total_cents,
            'memo','Contas a pagar da compra aprovada'
          )
        )
      );
      v_ledger_id := nullif(v_ledger->>'entry_id','')::uuid;
      IF v_ledger_id IS NULL THEN
        RAISE EXCEPTION 'DBS_PURCHASE_PAYABLE_LEDGER_FAILED' USING errcode='23514';
      END IF;
    ELSE
      SELECT status INTO v_entry_status
        FROM public.treasury_ledger_entries
       WHERE id = v_ledger_id;
      IF v_entry_status IS DISTINCT FROM 'posted' THEN
        RAISE EXCEPTION 'DBS_PURCHASE_EXISTING_PAYABLE_NOT_POSTED' USING errcode='23514';
      END IF;
    END IF;

    UPDATE public.dbs_control_purchases
       SET approval_status='approved',
           approved_by=p_actor_user_id,
           approved_at=now(),
           rejected_by=NULL,
           rejected_at=NULL,
           rejection_reason=NULL,
           ledger_entry_id=v_ledger_id,
           rejection_ledger_entry_id=NULL,
           version=version+1,
           updated_at=now()
     WHERE id=p_purchase_id;
  ELSE
    IF coalesce(v_purchase.paid_cents,0) > 0 THEN
      RAISE EXCEPTION 'DBS_PURCHASE_ALREADY_PAID_CANNOT_REJECT' USING errcode='23514';
    END IF;

    v_reversal_id := v_purchase.rejection_ledger_entry_id;
    IF v_purchase.ledger_entry_id IS NOT NULL AND v_reversal_id IS NULL THEN
      SELECT status INTO v_entry_status
        FROM public.treasury_ledger_entries
       WHERE id = v_purchase.ledger_entry_id;
      IF v_entry_status = 'posted' THEN
        v_reversal := public.post_treasury_ledger_entry(
          v_purchase.scope_key, v_purchase.company_id, current_date, current_date,
          'purchase_rejection_reversal', 'Estorno de compra rejeitada · ' || v_purchase.supplier_name,
          left('purchase-rejection:' || p_purchase_id::text, 200),
          'purchase-rejection:' || p_purchase_id::text,
          p_actor_user_id, 'posted',
          jsonb_build_object(
            'source','dbs_control_purchase_approval',
            'purchase_id',p_purchase_id,
            'reverses_ledger_entry_id',v_purchase.ledger_entry_id,
            'rejection_reason',v_reason
          ),
          jsonb_build_array(
            jsonb_build_object(
              'account_code','2.1.01','account_name','Fornecedores',
              'account_type','liability','debit_cents',v_purchase.total_cents,'credit_cents',0,
              'memo','Estorno da obrigação de compra rejeitada'
            ),
            jsonb_build_object(
              'account_code','1.1.04','account_name','Estoque em trânsito',
              'account_type','asset','debit_cents',0,'credit_cents',v_purchase.total_cents,
              'memo','Estorno da compra rejeitada'
            )
          )
        );
        v_reversal_id := nullif(v_reversal->>'entry_id','')::uuid;
        IF v_reversal_id IS NULL THEN
          RAISE EXCEPTION 'DBS_PURCHASE_REJECTION_REVERSAL_FAILED' USING errcode='23514';
        END IF;
      END IF;
    END IF;

    UPDATE public.dbs_control_purchases
       SET approval_status='rejected',
           rejected_by=p_actor_user_id,
           rejected_at=now(),
           rejection_reason=v_reason,
           rejection_ledger_entry_id=v_reversal_id,
           version=version+1,
           updated_at=now()
     WHERE id=p_purchase_id;
  END IF;

  INSERT INTO public.dbs_control_inventory_outbox(
    idempotency_key,scope_key,aggregate_type,aggregate_id,event_type,payload
  ) VALUES (
    left('purchase:approval:'||p_purchase_id::text||':'||v_decision,240),
    v_purchase.scope_key,'purchase',p_purchase_id,
    CASE WHEN v_decision='approved' THEN 'purchase.approved' ELSE 'purchase.rejected' END,
    jsonb_build_object(
      'purchase_id',p_purchase_id,
      'approval_status',v_decision,
      'actor_user_id',p_actor_user_id,
      'ledger_entry_id',CASE WHEN v_decision='approved' THEN v_ledger_id ELSE NULL END,
      'rejection_ledger_entry_id',CASE WHEN v_decision='rejected' THEN v_reversal_id ELSE NULL END
    )
  ) ON CONFLICT(idempotency_key) DO NOTHING;

  SELECT * INTO v_purchase
    FROM public.dbs_control_purchases WHERE id=p_purchase_id;

  RETURN jsonb_build_object(
    'ok',true,'replayed',false,'purchase_id',p_purchase_id,
    'approval_status',v_purchase.approval_status,
    'approved_by',v_purchase.approved_by,'approved_at',v_purchase.approved_at,
    'rejected_by',v_purchase.rejected_by,'rejected_at',v_purchase.rejected_at,
    'rejection_reason',v_purchase.rejection_reason,
    'ledger_entry_id',v_purchase.ledger_entry_id,
    'rejection_ledger_entry_id',v_purchase.rejection_ledger_entry_id,
    'version',v_purchase.version
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.dbs_control_decide_purchase_approval(uuid,uuid,text,text,bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dbs_control_decide_purchase_approval(uuid,uuid,text,text,bigint)
  TO service_role;

-- 3) Impede pagamento de pedido não aprovado ou rejeitado.
DO $patch$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef('public.dbs_control_settle_purchase(uuid,uuid,bigint,text,text)'::regprocedure)
    INTO v_def;
  v_old := $old$  if v_purchase.status = 'cancelled' then
    raise exception 'DBS_PURCHASE_CANCELLED' using errcode = '23514';
  end if;$old$;
  v_new := $new$  if v_purchase.status = 'cancelled' then
    raise exception 'DBS_PURCHASE_CANCELLED' using errcode = '23514';
  end if;
  if v_purchase.approval_status not in ('approved','legacy_received') then
    raise exception 'DBS_PURCHASE_APPROVAL_REQUIRED' using errcode = '23514';
  end if;$new$;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'Migration: trava de pagamento da compra não encontrada.';
  END IF;
  EXECUTE replace(v_def,v_old,v_new);
END;
$patch$;

-- 4) Contas a pagar considera somente compras aprovadas ou registros recebidos legados.
DO $patch$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef('public.dbs_control_inventory_financial_overview(uuid)'::regprocedure)
    INTO v_def;
  v_old := $old$  select coalesce(sum(greatest(total_cents - paid_cents, 0)), 0)::bigint
    into v_accounts_payable
    from public.dbs_control_purchases
   where scope_key = v_scope_key and status <> 'cancelled';$old$;
  v_new := $new$  select coalesce(sum(greatest(total_cents - paid_cents, 0)), 0)::bigint
    into v_accounts_payable
    from public.dbs_control_purchases
   where scope_key = v_scope_key
     and status <> 'cancelled'
     and approval_status in ('approved','legacy_received');$new$;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'Migration: agregação de contas a pagar não encontrada.';
  END IF;
  EXECUTE replace(v_def,v_old,v_new);
END;
$patch$;

NOTIFY pgrst, 'reload schema';
COMMIT;