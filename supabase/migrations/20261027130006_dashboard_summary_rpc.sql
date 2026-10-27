-- Additive dashboard aggregation. The UI may request operational KPIs without
-- transferring the complete OS collection. It never writes data.
CREATE OR REPLACE FUNCTION public.dbs_control_dashboard_summary(
  p_employee_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH scoped AS (
    SELECT
      w.id,
      w.client_id,
      w.status,
      w.assigned_employee_id,
      w.deleted_at,
      w.updated_at
    FROM public.dbs_control_work_orders w
    WHERE p_employee_id IS NULL
       OR w.assigned_employee_id = p_employee_id
  ),
  status_totals AS (
    SELECT
      COALESCE(NULLIF(lower(trim(status)), ''), 'sem_status') AS status_key,
      count(*)::bigint AS total
    FROM scoped
    GROUP BY 1
  ),
  client_totals AS (
    SELECT count(DISTINCT client_id)::bigint AS total
    FROM scoped
    WHERE deleted_at IS NULL
      AND client_id IS NOT NULL
  ),
  equipment_totals AS (
    SELECT count(DISTINCT l.equipment_id)::bigint AS total
    FROM public.dbs_control_work_order_equipment l
    JOIN scoped s ON s.id = l.work_order_id
    WHERE s.deleted_at IS NULL
      AND l.equipment_id IS NOT NULL
  )
  SELECT jsonb_build_object(
    'clients_count',
      CASE
        WHEN p_employee_id IS NULL THEN (SELECT count(*)::bigint FROM public.dbs_control_clients)
        ELSE (SELECT total FROM client_totals)
      END,
    'equipment_count',
      CASE
        WHEN p_employee_id IS NULL THEN (SELECT count(*)::bigint FROM public.dbs_control_equipment)
        ELSE (SELECT total FROM equipment_totals)
      END,
    'orders_total', (SELECT count(*)::bigint FROM scoped),
    'orders_active', (SELECT count(*)::bigint FROM scoped WHERE deleted_at IS NULL),
    'orders_open', (SELECT count(*)::bigint FROM scoped
      WHERE deleted_at IS NULL
        AND COALESCE(lower(trim(status)), '') NOT IN
          ('concluida','concluído','concluida_com_pendencia','cancelada','cancelado')),
    'orders_in_service', (SELECT count(*)::bigint FROM scoped
      WHERE deleted_at IS NULL
        AND COALESCE(lower(trim(status)), '') IN
          ('em_atendimento','em atendimento','em_execucao','em execução','em andamento')),
    'orders_completed', (SELECT count(*)::bigint FROM scoped
      WHERE deleted_at IS NULL
        AND COALESCE(lower(trim(status)), '') IN
          ('concluida','concluído','concluida_com_pendencia')),
    'orders_cancelled', (SELECT count(*)::bigint FROM scoped
      WHERE COALESCE(lower(trim(status)), '') IN ('cancelada','cancelado')),
    'orders_deleted', (SELECT count(*)::bigint FROM scoped WHERE deleted_at IS NOT NULL),
    'last_updated_at', (SELECT max(updated_at) FROM scoped),
    'status_counts', COALESCE(
      (SELECT jsonb_object_agg(status_key, total) FROM status_totals),
      '{}'::jsonb
    )
  );
$$;

REVOKE ALL ON FUNCTION public.dbs_control_dashboard_summary(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dbs_control_dashboard_summary(uuid) TO service_role;

COMMENT ON FUNCTION public.dbs_control_dashboard_summary(uuid) IS
  'Read-only aggregated DBS Control KPIs. Operational writes remain relational deltas.';
