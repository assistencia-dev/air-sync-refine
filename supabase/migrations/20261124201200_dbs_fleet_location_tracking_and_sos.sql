-- DBS FLEET · localização operacional e SOS
-- Acompanhamento voluntário, visível e restrito à jornada autorizada.
-- Nenhum dado de folha de ponto ou de OS existente é alterado.

CREATE TABLE IF NOT EXISTS public.rh_employee_location_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.rh_employees(id) ON DELETE RESTRICT,
  work_date date NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  consent_at timestamptz NOT NULL,
  consent_policy_version text NOT NULL DEFAULT 'fleet-2026-11-v1',
  end_reason text CHECK (end_reason IN ('punch_exit', 'lunch_break', 'employee_stop', 'expired', 'admin_stop')),
  last_latitude numeric(10,7),
  last_longitude numeric(10,7),
  last_accuracy_m numeric(10,2),
  last_position_at timestamptz,
  created_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rh_employee_location_sessions_end_after_start
    CHECK (ended_at IS NULL OR ended_at >= started_at),
  CONSTRAINT rh_employee_location_sessions_coordinate_pair
    CHECK (
      (last_latitude IS NULL AND last_longitude IS NULL)
      OR (
        last_latitude BETWEEN -90 AND 90
        AND last_longitude BETWEEN -180 AND 180
      )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS rh_employee_location_sessions_one_active_employee
  ON public.rh_employee_location_sessions(employee_id)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS rh_employee_location_sessions_work_date_idx
  ON public.rh_employee_location_sessions(work_date, started_at DESC);

CREATE TABLE IF NOT EXISTS public.rh_employee_location_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.rh_employee_location_sessions(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.rh_employees(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  latitude numeric(10,7) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric(10,7) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_m numeric(10,2) NOT NULL CHECK (accuracy_m BETWEEN 0 AND 250),
  source text NOT NULL DEFAULT 'browser' CHECK (source IN ('browser', 'pwa')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rh_employee_location_points_session_time_idx
  ON public.rh_employee_location_points(session_id, recorded_at);

CREATE INDEX IF NOT EXISTS rh_employee_location_points_employee_time_idx
  ON public.rh_employee_location_points(employee_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS public.rh_employee_sos_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.rh_employees(id) ON DELETE RESTRICT,
  session_id uuid REFERENCES public.rh_employee_location_sessions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
  message text NOT NULL DEFAULT 'Preciso de ajuda.',
  latitude numeric(10,7),
  longitude numeric(10,7),
  accuracy_m numeric(10,2),
  location_recorded_at timestamptz,
  location_source text CHECK (location_source IN ('current_sos', 'last_known_session')),
  acknowledged_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  acknowledged_at timestamptz,
  resolved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  CONSTRAINT rh_employee_sos_alerts_coordinate_pair
    CHECK (
      (latitude IS NULL AND longitude IS NULL)
      OR (
        latitude BETWEEN -90 AND 90
        AND longitude BETWEEN -180 AND 180
      )
    )
);

CREATE INDEX IF NOT EXISTS rh_employee_sos_alerts_open_idx
  ON public.rh_employee_sos_alerts(status, created_at DESC);

CREATE INDEX IF NOT EXISTS rh_employee_sos_alerts_employee_idx
  ON public.rh_employee_sos_alerts(employee_id, created_at DESC);

-- A localização nunca fica disponível diretamente no Data API para clientes.
-- Somente as funções de servidor autenticadas usam o cliente service_role.
ALTER TABLE public.rh_employee_location_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_employee_location_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_employee_sos_alerts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.rh_employee_location_sessions FROM anon, authenticated;
REVOKE ALL ON public.rh_employee_location_points FROM anon, authenticated;
REVOKE ALL ON public.rh_employee_sos_alerts FROM anon, authenticated;

GRANT ALL ON public.rh_employee_location_sessions TO service_role;
GRANT ALL ON public.rh_employee_location_points TO service_role;

GRANT ALL ON public.rh_employee_sos_alerts TO service_role;

-- Retenção automatizada: a política não depende de alguém abrir o portal.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

CREATE OR REPLACE FUNCTION public.dbs_fleet_cleanup_retention()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  DELETE FROM public.rh_employee_location_points
  WHERE recorded_at < now() - interval '30 days';

  DELETE FROM public.rh_employee_location_sessions
  WHERE ended_at IS NOT NULL
    AND ended_at < now() - interval '30 days';

  DELETE FROM public.rh_employee_sos_alerts
  WHERE created_at < now() - interval '90 days'
    AND status = 'RESOLVED';
END;
$$;

REVOKE ALL ON FUNCTION public.dbs_fleet_cleanup_retention() FROM PUBLIC, anon, authenticated, service_role;

SELECT cron.schedule(
  'dbs-fleet-retention-cleanup',
  '15 3 * * *',
  'SELECT public.dbs_fleet_cleanup_retention();'
);
