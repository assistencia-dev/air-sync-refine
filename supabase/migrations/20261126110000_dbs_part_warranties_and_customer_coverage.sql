-- DBS Air | Base relacional de garantias de peças e cobertura ao cliente
-- Fase 1: somente estrutura aditiva; não altera saldos, OS, compras, Ledger ou Outbox.
BEGIN;

CREATE TABLE IF NOT EXISTS public.dbs_control_supplier_warranties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE RESTRICT,
  scope_key text NOT NULL,
  part_id uuid NOT NULL REFERENCES public.dbs_control_parts(id) ON DELETE RESTRICT,
  supplier_id uuid REFERENCES public.dbs_control_suppliers(id) ON DELETE RESTRICT,
  source_receipt_item_id uuid REFERENCES public.dbs_control_purchase_receipt_items(id) ON DELETE RESTRICT,
  serial_number text,
  lot_number text,
  quantity_covered numeric(18,4) NOT NULL DEFAULT 1 CHECK (quantity_covered > 0),
  provider_name text,
  start_anchor text NOT NULL DEFAULT 'receipt_date'
    CHECK (start_anchor IN ('invoice_date','receipt_date','installation_date','manual_date')),
  starts_on date NOT NULL,
  expires_on date NOT NULL,
  duration_months integer CHECK (duration_months IS NULL OR duration_months >= 0),
  terms text NOT NULL DEFAULT '',
  document_reference text,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence) = 'array'),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','claimed','replaced','void')),
  notes text NOT NULL DEFAULT '',
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_on >= starts_on),
  CHECK (serial_number IS NULL OR char_length(btrim(serial_number)) BETWEEN 1 AND 160),
  CHECK (lot_number IS NULL OR char_length(btrim(lot_number)) BETWEEN 1 AND 160)
);

CREATE INDEX IF NOT EXISTS dbs_control_supplier_warranties_scope_expiry_idx
  ON public.dbs_control_supplier_warranties(scope_key, status, expires_on);
CREATE INDEX IF NOT EXISTS dbs_control_supplier_warranties_part_idx
  ON public.dbs_control_supplier_warranties(scope_key, part_id, starts_on DESC);
CREATE INDEX IF NOT EXISTS dbs_control_supplier_warranties_receipt_idx
  ON public.dbs_control_supplier_warranties(source_receipt_item_id)
  WHERE source_receipt_item_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS dbs_control_supplier_warranties_serial_uq
  ON public.dbs_control_supplier_warranties(scope_key, part_id, upper(btrim(serial_number)))
  WHERE serial_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.dbs_control_customer_warranties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE RESTRICT,
  scope_key text NOT NULL,
  work_order_id uuid NOT NULL REFERENCES public.dbs_control_work_orders(id) ON DELETE RESTRICT,
  work_order_part_id uuid REFERENCES public.dbs_control_work_order_parts(id) ON DELETE RESTRICT,
  part_id uuid REFERENCES public.dbs_control_parts(id) ON DELETE RESTRICT,
  coverage_type text NOT NULL
    CHECK (coverage_type IN ('part','service','work_order')),
  starts_on date NOT NULL,
  expires_on date NOT NULL,
  duration_months integer CHECK (duration_months IS NULL OR duration_months >= 0),
  terms text NOT NULL DEFAULT '',
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence) = 'array'),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','suspended','replaced','void')),
  notes text NOT NULL DEFAULT '',
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_on >= starts_on),
  CHECK (coverage_type <> 'part' OR part_id IS NOT NULL OR work_order_part_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS dbs_control_customer_warranties_scope_expiry_idx
  ON public.dbs_control_customer_warranties(scope_key, status, expires_on);
CREATE INDEX IF NOT EXISTS dbs_control_customer_warranties_os_idx
  ON public.dbs_control_customer_warranties(scope_key, work_order_id, starts_on DESC);
CREATE INDEX IF NOT EXISTS dbs_control_customer_warranties_part_idx
  ON public.dbs_control_customer_warranties(scope_key, part_id, expires_on)
  WHERE part_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.dbs_control_warranty_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE RESTRICT,
  scope_key text NOT NULL,
  claim_type text NOT NULL CHECK (claim_type IN ('supplier','customer')),
  supplier_warranty_id uuid REFERENCES public.dbs_control_supplier_warranties(id) ON DELETE RESTRICT,
  customer_warranty_id uuid REFERENCES public.dbs_control_customer_warranties(id) ON DELETE RESTRICT,
  work_order_id uuid REFERENCES public.dbs_control_work_orders(id) ON DELETE RESTRICT,
  work_order_part_id uuid REFERENCES public.dbs_control_work_order_parts(id) ON DELETE RESTRICT,
  claim_reference text,
  issue_description text NOT NULL CHECK (char_length(btrim(issue_description)) BETWEEN 5 AND 4000),
  status text NOT NULL DEFAULT 'opened'
    CHECK (status IN ('opened','under_review','approved','rejected','replaced','credited','closed')),
  resolution text NOT NULL DEFAULT '',
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence) = 'array'),
  opened_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  resolved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (claim_type = 'supplier' AND supplier_warranty_id IS NOT NULL AND customer_warranty_id IS NULL)
    OR
    (claim_type = 'customer' AND customer_warranty_id IS NOT NULL AND supplier_warranty_id IS NULL)
  ),
  CHECK (
    (status IN ('opened','under_review') AND resolved_at IS NULL)
    OR status IN ('approved','rejected','replaced','credited','closed')
  )
);

CREATE INDEX IF NOT EXISTS dbs_control_warranty_claims_scope_status_idx
  ON public.dbs_control_warranty_claims(scope_key, status, opened_at DESC);
CREATE INDEX IF NOT EXISTS dbs_control_warranty_claims_supplier_idx
  ON public.dbs_control_warranty_claims(supplier_warranty_id, opened_at DESC)
  WHERE supplier_warranty_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS dbs_control_warranty_claims_customer_idx
  ON public.dbs_control_warranty_claims(customer_warranty_id, opened_at DESC)
  WHERE customer_warranty_id IS NOT NULL;

ALTER TABLE public.dbs_control_supplier_warranties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dbs_control_customer_warranties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dbs_control_warranty_claims ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.dbs_control_supplier_warranties,
  public.dbs_control_customer_warranties,
  public.dbs_control_warranty_claims
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.dbs_control_supplier_warranties,
  public.dbs_control_customer_warranties,
  public.dbs_control_warranty_claims
  TO service_role;

COMMENT ON TABLE public.dbs_control_supplier_warranties IS
  'Garantia de fornecedor/fabricante por peça, lote ou série. A origem pode ser vinculada a um item de recebimento físico.';
COMMENT ON TABLE public.dbs_control_customer_warranties IS
  'Cobertura concedida pela DBS ao cliente, separada da garantia do fornecedor e rastreável à OS/peça/serviço.';
COMMENT ON TABLE public.dbs_control_warranty_claims IS
  'Histórico de solicitações e decisões de garantia. Cada solicitação pertence a uma garantia de fornecedor ou de cliente, nunca às duas.';
COMMENT ON COLUMN public.dbs_control_supplier_warranties.start_anchor IS
  'Origem da data inicial conforme documento/termo real: nota fiscal, recebimento, instalação ou data informada manualmente. Não presume prazo legal.';
COMMENT ON COLUMN public.dbs_control_supplier_warranties.source_receipt_item_id IS
  'Item do recebimento que originou a peça. O serviço de gravação valida que o item pertence ao mesmo SKU e escopo.';
COMMENT ON COLUMN public.dbs_control_customer_warranties.terms IS
  'Termos informados e aprovados para a cobertura da DBS; nenhum prazo padrão é presumido pelo banco.';

NOTIFY pgrst, 'reload schema';
COMMIT;
