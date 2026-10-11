-- DBS AIR RH · competência 2026: separar base e encargo de FGTS.
-- Migração estritamente aditiva: preserva todos os registros existentes.
ALTER TABLE public.rh_payroll_runs
  ADD COLUMN IF NOT EXISTS fgts_amount_cents bigint NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.rh_payroll_runs.fgts_base_cents IS
  'Base monetária de incidência do FGTS, em centavos.';
COMMENT ON COLUMN public.rh_payroll_runs.fgts_amount_cents IS
  'Valor do encargo patronal de FGTS, em centavos; nunca descontado do empregado.';
