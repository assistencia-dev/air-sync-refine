-- Fase 1 — evidências de localização e governança de revisão da folha de ponto.
-- Migration estritamente aditiva e reaplicável. Não altera RLS nem dados existentes.

ALTER TABLE public.rh_ponto_records
  ADD COLUMN IF NOT EXISTS address_text text,
  ADD COLUMN IF NOT EXISTS address_components jsonb,
  ADD COLUMN IF NOT EXISTS address_provider text,
  ADD COLUMN IF NOT EXISTS address_resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS address_status text NOT NULL DEFAULT 'pendente',
  ADD COLUMN IF NOT EXISTS risk_flags text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'nao_requerida',
  ADD COLUMN IF NOT EXISTS review_note text,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.rh_ponto_records'::regclass
      AND conname = 'rh_ponto_records_address_status_check'
  ) THEN
    ALTER TABLE public.rh_ponto_records
      ADD CONSTRAINT rh_ponto_records_address_status_check
      CHECK (address_status IN ('ok', 'pendente', 'falha', 'sem_localizacao'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.rh_ponto_records'::regclass
      AND conname = 'rh_ponto_records_review_status_check'
  ) THEN
    ALTER TABLE public.rh_ponto_records
      ADD CONSTRAINT rh_ponto_records_review_status_check
      CHECK (review_status IN ('nao_requerida', 'pendente', 'aprovada', 'ajustada'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.rh_ponto_records'::regclass
      AND conname = 'rh_ponto_records_reviewed_by_fkey'
  ) THEN
    ALTER TABLE public.rh_ponto_records
      ADD CONSTRAINT rh_ponto_records_reviewed_by_fkey
      FOREIGN KEY (reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS rh_ponto_records_review_pending_idx
  ON public.rh_ponto_records (review_status, punched_at DESC)
  WHERE review_status = 'pendente';

CREATE OR REPLACE FUNCTION public.rh_ponto_protect_evidence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  request_role text;
BEGIN
  request_role := current_setting('request.jwt.claim.role', true);

  IF COALESCE(request_role, '') <> 'service_role'
     AND current_user <> 'service_role'
     AND (
       OLD.punched_at IS DISTINCT FROM NEW.punched_at
       OR OLD.latitude IS DISTINCT FROM NEW.latitude
       OR OLD.longitude IS DISTINCT FROM NEW.longitude
       OR OLD.gps_accuracy_m IS DISTINCT FROM NEW.gps_accuracy_m
       OR OLD.address_text IS DISTINCT FROM NEW.address_text
       OR OLD.address_components IS DISTINCT FROM NEW.address_components
       OR OLD.address_provider IS DISTINCT FROM NEW.address_provider
       OR OLD.address_resolved_at IS DISTINCT FROM NEW.address_resolved_at
     )
  THEN
    RAISE EXCEPTION 'As evidências originais da batida são imutáveis.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DO $
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.rh_ponto_records'::regclass
      AND tgname = 'rh_ponto_evidence_immutable'
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER rh_ponto_evidence_immutable
      BEFORE UPDATE ON public.rh_ponto_records
      FOR EACH ROW
      EXECUTE FUNCTION public.rh_ponto_protect_evidence();
  END IF;
END
$;

COMMENT ON FUNCTION public.rh_ponto_protect_evidence() IS
  'Impede alteração de evidências da batida por sessões que não sejam service_role; revisão permanece editável.';
