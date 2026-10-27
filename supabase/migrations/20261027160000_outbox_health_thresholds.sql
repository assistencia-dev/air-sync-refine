-- Additive Outbox health thresholds. This migration only replaces the
-- JSON health projection and preserves all tables, rows, and function signatures.

CREATE OR REPLACE FUNCTION public.dbs_control_sync_health()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
  SELECT jsonb_build_object(
    'pending', count(*) FILTER (WHERE status = 'pending'),
    'processing', count(*) FILTER (WHERE status = 'processing'),
    'published', count(*) FILTER (WHERE status = 'published'),
    'failed', count(*) FILTER (WHERE status = 'failed'),
    'oldest_pending_at', min(created_at) FILTER (WHERE status IN ('pending', 'processing')),
    'oldest_pending_age_seconds',
      coalesce(extract(epoch FROM now() - min(created_at) FILTER (WHERE status IN ('pending', 'processing'))), 0),
    'pending_over_sla',
      count(*) FILTER (
        WHERE status IN ('pending', 'processing')
          AND created_at < now() - interval '10 minutes'
      ),
    'pending_critical',
      count(*) FILTER (
        WHERE status IN ('pending', 'processing')
          AND created_at < now() - interval '15 minutes'
      ),
    'retries_over_3',
      count(*) FILTER (
        WHERE status <> 'published'
          AND attempts > 3
      ),
    'last_published_at', max(published_at),
    'last_error_at', max(created_at) FILTER (WHERE status = 'failed'),
    'last_error', max(last_error) FILTER (WHERE status = 'failed'),
    'dead_letter', (SELECT count(*) FROM public.dbs_control_outbox_dlq),
    'dead_letter_latest_at', (SELECT max(failed_at) FROM public.dbs_control_outbox_dlq)
  )
  FROM public.dbs_control_outbox;
$function$;

ALTER FUNCTION public.dbs_control_sync_health()
  SET search_path TO public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.dbs_control_sync_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dbs_control_sync_health() TO service_role;