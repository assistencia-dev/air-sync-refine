-- Additive function hardening. Signatures and existing service grants are preserved.

DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT n.nspname AS schema_name, p.proname AS function_name,
           pg_get_function_identity_arguments(p.oid) AS identity_args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %I.%I(%s) SET search_path TO public, pg_temp',
      f.schema_name, f.function_name, f.identity_args
    );
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM PUBLIC',
      f.schema_name, f.function_name, f.identity_args
    );
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION public.dbs_control_complete_outbox(
  p_outbox_id uuid, p_worker_id text, p_success boolean,
  p_error text DEFAULT NULL, p_retry_seconds integer DEFAULT 30
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_delay integer := greatest(5, least(coalesce(p_retry_seconds, 30), 3600));
BEGIN
  IF nullif(trim(p_worker_id), '') IS NULL THEN
    RAISE EXCEPTION 'DBS_OUTBOX_WORKER_REQUIRED: worker_id é obrigatório.' USING errcode = '22023';
  END IF;

  IF NOT p_success THEN
    INSERT INTO public.dbs_control_outbox_dlq
      (outbox_id, idempotency_key, aggregate_type, aggregate_id, event_type,
       attempts, payload, last_error, failed_at)
    SELECT o.id, o.idempotency_key, o.aggregate_type, o.aggregate_id, o.event_type,
           o.attempts, o.payload, left(coalesce(p_error, 'Falha não especificada'), 2000), now()
    FROM public.dbs_control_outbox o
    WHERE o.id = p_outbox_id
      AND o.status = 'processing'
      AND o.locked_by = left(trim(p_worker_id), 160)
      AND o.attempts >= 4
    ON CONFLICT (outbox_id) DO UPDATE SET
      attempts = EXCLUDED.attempts, last_error = EXCLUDED.last_error, failed_at = EXCLUDED.failed_at;
  END IF;

  UPDATE public.dbs_control_outbox o
     SET status = CASE
       WHEN p_success THEN 'published'
       WHEN o.attempts >= 4 THEN 'failed'
       ELSE 'pending'
     END,
         published_at = CASE WHEN p_success THEN now() ELSE o.published_at END,
         available_at = CASE WHEN p_success THEN o.available_at ELSE now() + make_interval(secs => v_delay) END,
         locked_at = NULL,
         locked_by = NULL,
         last_error = CASE WHEN p_success THEN NULL ELSE left(coalesce(p_error, 'Falha não especificada'), 2000) END
   WHERE o.id = p_outbox_id
     AND o.status = 'processing'
     AND o.locked_by = left(trim(p_worker_id), 160);
  RETURN found;
END;
$function$;

CREATE OR REPLACE FUNCTION public.dbs_control_sync_health()
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
  SELECT jsonb_build_object(
    'pending', count(*) FILTER (WHERE status = 'pending'),
    'processing', count(*) FILTER (WHERE status = 'processing'),
    'published', count(*) FILTER (WHERE status = 'published'),
    'failed', count(*) FILTER (WHERE status = 'failed'),
    'oldest_pending_at', min(created_at) FILTER (WHERE status = 'pending'),
    'oldest_pending_age_seconds',
      coalesce(extract(epoch FROM now() - min(created_at) FILTER (WHERE status = 'pending')), 0),
    'last_published_at', max(published_at),
    'last_error_at', max(created_at) FILTER (WHERE status = 'failed'),
    'last_error', max(last_error) FILTER (WHERE status = 'failed'),
    'dead_letter', (SELECT count(*) FROM public.dbs_control_outbox_dlq),
    'dead_letter_latest_at', (SELECT max(failed_at) FROM public.dbs_control_outbox_dlq)
  )
  FROM public.dbs_control_outbox;
$function$;

ALTER FUNCTION public.dbs_control_complete_outbox(uuid, text, boolean, text, integer)
  SET search_path TO public, pg_temp;
ALTER FUNCTION public.dbs_control_sync_health() SET search_path TO public, pg_temp;
REVOKE EXECUTE ON FUNCTION public.dbs_control_complete_outbox(uuid, text, boolean, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.dbs_control_sync_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dbs_control_complete_outbox(uuid, text, boolean, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.dbs_control_sync_health() TO service_role;