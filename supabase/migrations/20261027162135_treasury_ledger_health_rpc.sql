begin;

-- Read-only operational health for the relational treasury outbox. It is
-- intentionally exposed only to service_role so the public application never
-- receives queue internals or timing data.
create or replace function public.treasury_ledger_health()
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'pending', count(*) filter (where status = 'pending'),
    'processing', count(*) filter (where status = 'processing'),
    'published', count(*) filter (where status = 'published'),
    'failed', count(*) filter (where status = 'failed'),
    'dead_letter', count(*) filter (where status = 'dead_letter'),
    'pending_over_sla', count(*) filter (
      where status = 'pending' and created_at < now() - interval '10 minutes'
    ),
    'pending_critical', count(*) filter (
      where status = 'pending' and created_at < now() - interval '15 minutes'
    ),
    'retries_over_3', count(*) filter (where attempts > 3),
    'oldest_pending_at', min(created_at) filter (where status = 'pending'),
    'oldest_pending_age_seconds', coalesce(
      extract(epoch from now() - min(created_at) filter (where status = 'pending'))::bigint,
      0
    ),
    'last_published_at', max(published_at) filter (where status = 'published'),
    'checked_at', now()
  )
  from public.treasury_ledger_outbox;
$$;

revoke all on function public.treasury_ledger_health() from public;
revoke all on function public.treasury_ledger_health() from anon;
revoke all on function public.treasury_ledger_health() from authenticated;
grant execute on function public.treasury_ledger_health() to service_role;

notify pgrst, 'reload schema';
commit;
