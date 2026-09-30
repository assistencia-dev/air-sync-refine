-- DBS AIR · Compatibilidade do acesso da Folha de Ponto
-- Garante que ambientes que já marcaram migrações anteriores como aplicadas
-- também recebam os campos legados esperados pelo módulo RH.
-- A operação é somente aditiva: nenhum dado é removido ou sobrescrito.

ALTER TABLE public.rh_employees
  ADD COLUMN IF NOT EXISTS ponto_access_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ponto_portal_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ponto_base_lat numeric,
  ADD COLUMN IF NOT EXISTS ponto_base_lng numeric,
  ADD COLUMN IF NOT EXISTS ponto_raio_m integer NOT NULL DEFAULT 150,
  ADD COLUMN IF NOT EXISTS ponto_entrada_prevista time,
  ADD COLUMN IF NOT EXISTS ponto_saida_prevista time,
  ADD COLUMN IF NOT EXISTS ponto_almoco_inicio_previsto time,
  ADD COLUMN IF NOT EXISTS ponto_almoco_fim_previsto time;

CREATE INDEX IF NOT EXISTS idx_rh_employees_ponto_portal_user
  ON public.rh_employees (ponto_portal_user_id)
  WHERE ponto_portal_user_id IS NOT NULL;
