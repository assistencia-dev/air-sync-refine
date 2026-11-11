-- Migration B: cadastro mestre de fornecedores, unidades de medida e conversões.
-- Aditiva: mantém supplier_name e quantidades históricas; não altera estoque,
-- recebimentos, lançamentos do Treasury, RLS existente ou fluxo de sincronização.
BEGIN;

CREATE TABLE IF NOT EXISTS public.dbs_control_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE RESTRICT,
  scope_key text NOT NULL CHECK (char_length(btrim(scope_key)) BETWEEN 3 AND 240),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 180),
  normalized_name text GENERATED ALWAYS AS (lower(btrim(name))) STORED,
  legal_name text,
  trade_name text,
  cnpj text,
  state_registration text,
  email text,
  phone text,
  contact_name text,
  address_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  payment_terms_days integer NOT NULL DEFAULT 0 CHECK (payment_terms_days BETWEEN 0 AND 365),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope_key, normalized_name),
  UNIQUE (scope_key, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS dbs_control_suppliers_cnpj_scope_uidx
  ON public.dbs_control_suppliers (
    scope_key,
    regexp_replace(coalesce(cnpj, ''), '[^0-9]', '', 'g')
  )
  WHERE nullif(regexp_replace(coalesce(cnpj, ''), '[^0-9]', '', 'g'), '') IS NOT NULL;

CREATE INDEX IF NOT EXISTS dbs_control_suppliers_scope_status_name_idx
  ON public.dbs_control_suppliers(scope_key, status, normalized_name);

CREATE TABLE IF NOT EXISTS public.dbs_control_measure_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_key text NOT NULL CHECK (char_length(btrim(scope_key)) BETWEEN 3 AND 240),
  company_id uuid REFERENCES public.companies(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (char_length(btrim(code)) BETWEEN 1 AND 16),
  normalized_code text GENERATED ALWAYS AS (upper(btrim(code))) STORED,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 80),
  symbol text NOT NULL CHECK (char_length(btrim(symbol)) BETWEEN 1 AND 12),
  decimal_places smallint NOT NULL DEFAULT 3 CHECK (decimal_places BETWEEN 0 AND 6),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  is_system boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope_key, normalized_code),
  UNIQUE (scope_key, id)
);

CREATE INDEX IF NOT EXISTS dbs_control_measure_units_scope_status_idx
  ON public.dbs_control_measure_units(scope_key, status, normalized_code);

CREATE TABLE IF NOT EXISTS public.dbs_control_unit_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_key text NOT NULL CHECK (char_length(btrim(scope_key)) BETWEEN 3 AND 240),
  company_id uuid REFERENCES public.companies(id) ON DELETE RESTRICT,
  from_unit_id uuid NOT NULL,
  to_unit_id uuid NOT NULL,
  factor numeric(24,10) NOT NULL CHECK (factor > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_unit_id <> to_unit_id),
  FOREIGN KEY (scope_key, from_unit_id)
    REFERENCES public.dbs_control_measure_units(scope_key, id) ON DELETE RESTRICT,
  FOREIGN KEY (scope_key, to_unit_id)
    REFERENCES public.dbs_control_measure_units(scope_key, id) ON DELETE RESTRICT,
  UNIQUE (scope_key, from_unit_id, to_unit_id)
);

CREATE INDEX IF NOT EXISTS dbs_control_unit_conversions_lookup_idx
  ON public.dbs_control_unit_conversions(scope_key, from_unit_id, to_unit_id, status);

ALTER TABLE public.dbs_control_parts
  ADD COLUMN IF NOT EXISTS supplier_id uuid,
  ADD COLUMN IF NOT EXISTS measure_unit_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'dbs_control_parts_supplier_id_fkey'
      AND conrelid = 'public.dbs_control_parts'::regclass
  ) THEN
    ALTER TABLE public.dbs_control_parts
      ADD CONSTRAINT dbs_control_parts_supplier_id_fkey
      FOREIGN KEY (supplier_id) REFERENCES public.dbs_control_suppliers(id)
      ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'dbs_control_parts_measure_unit_id_fkey'
      AND conrelid = 'public.dbs_control_parts'::regclass
  ) THEN
    ALTER TABLE public.dbs_control_parts
      ADD CONSTRAINT dbs_control_parts_measure_unit_id_fkey
      FOREIGN KEY (measure_unit_id) REFERENCES public.dbs_control_measure_units(id)
      ON DELETE RESTRICT;
  END IF;
END;
$$;

ALTER TABLE public.dbs_control_purchases
  ADD COLUMN IF NOT EXISTS supplier_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'dbs_control_purchases_supplier_id_fkey'
      AND conrelid = 'public.dbs_control_purchases'::regclass
  ) THEN
    ALTER TABLE public.dbs_control_purchases
      ADD CONSTRAINT dbs_control_purchases_supplier_id_fkey
      FOREIGN KEY (supplier_id) REFERENCES public.dbs_control_suppliers(id)
      ON DELETE RESTRICT;
  END IF;
END;
$$;

ALTER TABLE public.dbs_control_purchase_items
  ADD COLUMN IF NOT EXISTS purchase_unit_id uuid,
  ADD COLUMN IF NOT EXISTS conversion_factor numeric(24,10) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS base_quantity numeric;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'dbs_control_purchase_items_purchase_unit_id_fkey'
      AND conrelid = 'public.dbs_control_purchase_items'::regclass
  ) THEN
    ALTER TABLE public.dbs_control_purchase_items
      ADD CONSTRAINT dbs_control_purchase_items_purchase_unit_id_fkey
      FOREIGN KEY (purchase_unit_id) REFERENCES public.dbs_control_measure_units(id)
      ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'dbs_control_purchase_items_conversion_factor_check'
      AND conrelid = 'public.dbs_control_purchase_items'::regclass
  ) THEN
    ALTER TABLE public.dbs_control_purchase_items
      ADD CONSTRAINT dbs_control_purchase_items_conversion_factor_check
      CHECK (conversion_factor > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'dbs_control_purchase_items_base_quantity_check'
      AND conrelid = 'public.dbs_control_purchase_items'::regclass
  ) THEN
    ALTER TABLE public.dbs_control_purchase_items
      ADD CONSTRAINT dbs_control_purchase_items_base_quantity_check
      CHECK (base_quantity IS NULL OR base_quantity > 0);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS dbs_control_parts_supplier_idx
  ON public.dbs_control_parts(supplier_id) WHERE supplier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS dbs_control_parts_measure_unit_idx
  ON public.dbs_control_parts(measure_unit_id) WHERE measure_unit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS dbs_control_purchases_supplier_idx
  ON public.dbs_control_purchases(supplier_id, purchase_date DESC)
  WHERE supplier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS dbs_control_purchase_items_unit_idx
  ON public.dbs_control_purchase_items(purchase_unit_id)
  WHERE purchase_unit_id IS NOT NULL;

COMMENT ON TABLE public.dbs_control_suppliers IS
  'Cadastro mestre de fornecedores do DBS Control. Compras legadas preservam supplier_name.';
COMMENT ON TABLE public.dbs_control_measure_units IS
  'Unidades de medida de estoque/compras; distinta da tabela units que representa unidades/filiais da empresa.';
COMMENT ON TABLE public.dbs_control_unit_conversions IS
  'Conversões direcionais: 1 unidade from_unit_id equivale a factor unidades to_unit_id.';
COMMENT ON COLUMN public.dbs_control_parts.measure_unit_id IS
  'Unidade-base da quantidade armazenada no estoque.';
COMMENT ON COLUMN public.dbs_control_purchase_items.purchase_unit_id IS
  'Unidade comercial usada na linha da compra; opcional para preservar itens legados.';
COMMENT ON COLUMN public.dbs_control_purchase_items.conversion_factor IS
  'Fator para converter quantidade comercial em unidade-base; não altera o cálculo legado até a fase de recebimento.';
COMMENT ON COLUMN public.dbs_control_purchase_items.base_quantity IS
  'Quantidade já convertida para a unidade-base; nullable para registros legados.';

ALTER TABLE public.dbs_control_suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dbs_control_measure_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dbs_control_unit_conversions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.dbs_control_suppliers FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.dbs_control_measure_units FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.dbs_control_unit_conversions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.dbs_control_suppliers TO service_role;
GRANT ALL ON TABLE public.dbs_control_measure_units TO service_role;
GRANT ALL ON TABLE public.dbs_control_unit_conversions TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
