-- Additive execution evidence fields for DBS Control.
-- No existing rows are deleted or rewritten. The trigger copies only fields
-- explicitly present in the relational delta command payload.

ALTER TABLE public.dbs_control_work_orders
  ADD COLUMN IF NOT EXISTS execution_checklist jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS completion_status_code text,
  ADD COLUMN IF NOT EXISTS geolocation_captured_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_hardening_work_orders_completion_status
  ON public.dbs_control_work_orders (completion_status_code, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.dbs_control_capture_execution_evidence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_patch jsonb;
  v_geo text;
BEGIN
  IF NEW.idempotency_key IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(sc.payload->'patch', '{}'::jsonb)
    INTO v_patch
  FROM public.dbs_control_sync_commands sc
  WHERE sc.idempotency_key = NEW.idempotency_key
  ORDER BY sc.created_at DESC
  LIMIT 1;

  IF v_patch IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_patch ? 'execution_checklist' THEN
    NEW.execution_checklist := COALESCE(v_patch->'execution_checklist', '{}'::jsonb);
  END IF;

  IF v_patch ? 'completion_status_code' THEN
    NEW.completion_status_code := NULLIF(btrim(v_patch->>'completion_status_code'), '');
  END IF;

  IF v_patch ? 'geolocation_captured_at' THEN
    v_geo := NULLIF(btrim(v_patch->>'geolocation_captured_at'), '');
    IF v_geo IS NULL THEN
      NEW.geolocation_captured_at := NULL;
    ELSIF v_geo ~ '^\\d{4}-\\d{2}-\\d{2}T' THEN
      NEW.geolocation_captured_at := v_geo::timestamptz;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.dbs_control_work_orders'::regclass
      AND tgname = 'trg_dbs_control_capture_execution_evidence'
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER trg_dbs_control_capture_execution_evidence
      BEFORE INSERT OR UPDATE OF idempotency_key ON public.dbs_control_work_orders
      FOR EACH ROW
      EXECUTE FUNCTION public.dbs_control_capture_execution_evidence();
  END IF;
END
$$;

COMMENT ON COLUMN public.dbs_control_work_orders.execution_checklist IS
  'Checklist e evidências de execução persistidos pelo delta relacional; não é snapshot global.';
COMMENT ON COLUMN public.dbs_control_work_orders.completion_status_code IS
  'Código formal de resultado de atendimento, preservado junto à OS.';
COMMENT ON COLUMN public.dbs_control_work_orders.geolocation_captured_at IS
  'Instante UTC em que a geolocalização do atendimento foi capturada.';
