-- DBS CONTROL: observabilidade operacional e consumo seguro da outbox.
-- Nenhum dado operacional é removido; apenas adicionamos telemetria, claim
-- transacional e funções de saúde para o worker assíncrono.
begin;

create table if not exists public.dbs_control_sync_metrics (
  id uuid primary key default gen_random_uuid(),
  worker_id text not null,
  metric_name text not null check (metric_name in ('outbox_worker','delta_apply','realtime_reconcile','health_check')),
  status text not null check (status in ('ok','warning','error')),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  claimed_count integer not null default 0 check (claimed_count >= 0),
  success_count integer not null default 0 check (success_count >= 0),
  failure_count integer not null default 0 check (failure_count >= 0),
  retry_count integer not null default 0 check (retry_count >= 0),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_dbs_control_sync_metrics_created
  on public.dbs_control_sync_metrics(created_at desc);
create index if not exists idx_dbs_control_sync_metrics_worker
  on public.dbs_control_sync_metrics(worker_id, created_at desc);
create index if not exists idx_dbs_control_sync_metrics_status
  on public.dbs_control_sync_metrics(status, created_at desc);

alter table public.dbs_control_sync_metrics enable row level security;
revoke all on public.dbs_control_sync_metrics from public, anon, authenticated;
grant select, insert on public.dbs_control_sync_metrics to service_role;

comment on table public.dbs_control_sync_metrics is
  'Telemetria estruturada do worker de outbox, retries, reconciliação Realtime e verificações de saúde.';

create or replace function public.dbs_control_claim_outbox(
  p_worker_id text,
  p_limit integer default 50
)
returns setof public.dbs_control_outbox
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
  v_worker text := left(nullif(trim(p_worker_id), ''), 160);
begin
  if v_worker is null then
    raise exception 'DBS_OUTBOX_WORKER_REQUIRED: worker_id é obrigatório.' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select o.id
    from public.dbs_control_outbox o
    where (
      (o.status = 'pending' and o.available_at <= now())
      or (
        o.status = 'processing'
        and coalesce(o.locked_at, to_timestamp(0)) < now() - interval '5 minutes'
      )
    )
    order by o.created_at asc, o.id asc
    limit v_limit
    for update skip locked
  )
  update public.dbs_control_outbox o
     set status = 'processing',
         attempts = o.attempts + 1,
         locked_at = now(),
         locked_by = v_worker,
         last_error = null
    from candidates c
   where o.id = c.id
  returning o.*;
end;
$$;

create or replace function public.dbs_control_complete_outbox(
  p_outbox_id uuid,
  p_worker_id text,
  p_success boolean,
  p_error text default null,
  p_retry_seconds integer default 30
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delay integer := greatest(5, least(coalesce(p_retry_seconds, 30), 3600));
begin
  if nullif(trim(p_worker_id), '') is null then
    raise exception 'DBS_OUTBOX_WORKER_REQUIRED: worker_id é obrigatório.' using errcode = '22023';
  end if;

  update public.dbs_control_outbox o
     set status = case
       when p_success then 'published'
       when o.attempts >= 8 then 'failed'
       else 'pending'
     end,
         published_at = case when p_success then now() else o.published_at end,
         available_at = case when p_success then o.available_at else now() + make_interval(secs => v_delay) end,
         locked_at = null,
         locked_by = null,
         last_error = case when p_success then null else left(coalesce(p_error, 'Falha não especificada'), 2000) end
   where o.id = p_outbox_id
     and o.status = 'processing'
     and o.locked_by = left(trim(p_worker_id), 160);

  return found;
end;
$$;

create or replace function public.dbs_control_sync_health()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'pending', count(*) filter (where status = 'pending'),
    'processing', count(*) filter (where status = 'processing'),
    'published', count(*) filter (where status = 'published'),
    'failed', count(*) filter (where status = 'failed'),
    'oldest_pending_at', min(created_at) filter (where status = 'pending'),
    'last_published_at', max(published_at),
    'last_error_at', max(created_at) filter (where status = 'failed'),
    'last_error', max(last_error) filter (where status = 'failed')
  )
  from public.dbs_control_outbox;
$$;

revoke all on function public.dbs_control_claim_outbox(text, integer)
  from public, anon, authenticated;
revoke all on function public.dbs_control_complete_outbox(uuid, text, boolean, text, integer)
  from public, anon, authenticated;
revoke all on function public.dbs_control_sync_health()
  from public, anon, authenticated;
grant execute on function public.dbs_control_claim_outbox(text, integer) to service_role;
grant execute on function public.dbs_control_complete_outbox(uuid, text, boolean, text, integer) to service_role;
grant execute on function public.dbs_control_sync_health() to service_role;

commit;
