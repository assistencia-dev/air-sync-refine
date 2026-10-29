-- Additive extension of the canonical dashboard contract.
-- No operational row is updated, deleted, archived or re-written here.
-- The extra queue counters make desktop and mobile use the same database
-- result instead of deriving different numbers from local browser state.

CREATE OR REPLACE FUNCTION public.dbs_control_dashboard_summary_scoped(
  p_employee_id uuid DEFAULT NULL,
  p_base_id uuid DEFAULT NULL,
  p_company_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH base_meta AS (
    SELECT
      b.id,
      b.name,
      b.status,
      b.company_id,
      (b.status = 'ativo' AND (p_company_id IS NULL OR b.company_id = p_company_id)) AS is_valid
    FROM public.dbs_control_bases b
    WHERE p_base_id IS NOT NULL
      AND b.id = p_base_id
    LIMIT 1
  ),
  base_clients AS (
    SELECT bc.client_id
    FROM public.dbs_control_base_clients bc
    JOIN base_meta b ON b.id = bc.base_id AND b.is_valid
  ),
  scope_guard AS (
    SELECT CASE
      WHEN p_employee_id IS NULL AND p_base_id IS NULL THEN true
      WHEN p_employee_id IS NOT NULL AND p_base_id IS NULL THEN true
      WHEN p_employee_id IS NOT NULL AND p_base_id IS NOT NULL
        THEN EXISTS (SELECT 1 FROM base_meta WHERE is_valid)
      ELSE false
    END AS is_valid
  ),
  scoped_raw AS (
    SELECT
      w.id,
      w.client_id,
      w.status,
      w.priority,
      w.assigned_employee_id,
      w.deleted_at,
      w.updated_at,
      w.protocol,
      w.protocolo,
      w.diagnostico,
      w.servico_executado,
      w.execution_checklist
    FROM public.dbs_control_work_orders w
    CROSS JOIN scope_guard g
    WHERE g.is_valid
      AND (
        p_employee_id IS NULL
        OR (
          w.assigned_employee_id = p_employee_id
          AND (
            p_base_id IS NULL
            OR EXISTS (SELECT 1 FROM base_clients bc WHERE bc.client_id = w.client_id)
          )
        )
      )
  ),
  scoped AS (
    SELECT
      r.*,
      CASE
        WHEN lower(trim(coalesce(r.status, ''))) IN ('concluida', 'concluída', 'concluido', 'concluído')
          THEN 'concluida'
        WHEN lower(trim(coalesce(r.status, ''))) IN ('concluida_com_pendencia', 'concluída com pendência', 'concluida com pendencia')
          THEN 'concluida_com_pendencia'
        WHEN lower(trim(coalesce(r.status, ''))) IN ('em_atendimento', 'em atendimento', 'em_execucao', 'em execução', 'em andamento')
          THEN 'em_atendimento'
        WHEN lower(trim(coalesce(r.status, ''))) IN ('aguardando_peca', 'aguardando peça', 'aguardando peca')
          THEN 'aguardando_peca'
        WHEN lower(trim(coalesce(r.status, ''))) IN ('aguardando_aprovacao', 'aguardando aprovação', 'aguardando aprovacao')
          THEN 'aguardando_aprovacao'
        WHEN lower(trim(coalesce(r.status, ''))) IN ('retorno_necessario', 'retorno necessário', 'retorno necessario')
          THEN 'retorno_necessario'
        WHEN lower(trim(coalesce(r.status, ''))) IN ('cancelada', 'cancelado')
          THEN 'cancelada'
        WHEN lower(trim(coalesce(r.status, ''))) IN ('aguardando_cliente', 'aguardando cliente')
          THEN 'aguardando_cliente'
        WHEN nullif(trim(coalesce(r.status, '')), '') IS NULL
          THEN 'sem_status'
        ELSE lower(trim(r.status))
      END AS status_code
    FROM scoped_raw r
  ),
  operational AS (
    SELECT *
    FROM scoped
    WHERE deleted_at IS NULL
      AND status_code <> 'cancelada'
  ),
  work_queue AS (
    SELECT *
    FROM operational
    WHERE status_code NOT IN ('concluida', 'concluida_com_pendencia')
  ),
  base_client_count AS (
    SELECT count(*)::bigint AS total FROM base_clients
  ),
  client_count AS (
    SELECT count(DISTINCT c.id)::bigint AS total
    FROM public.dbs_control_clients c
    WHERE p_employee_id IS NULL AND p_base_id IS NULL
       OR p_base_id IS NOT NULL AND EXISTS (SELECT 1 FROM base_clients bc WHERE bc.client_id = c.id)
       OR p_employee_id IS NOT NULL AND p_base_id IS NULL
          AND EXISTS (SELECT 1 FROM operational o WHERE o.client_id = c.id)
  ),
  equipment_count AS (
    SELECT count(DISTINCT e.id)::bigint AS total
    FROM public.dbs_control_equipment e
    WHERE p_employee_id IS NULL AND p_base_id IS NULL
       OR p_base_id IS NOT NULL AND EXISTS (SELECT 1 FROM base_clients bc WHERE bc.client_id = e.client_id)
       OR p_employee_id IS NOT NULL AND p_base_id IS NULL
          AND EXISTS (
            SELECT 1
            FROM public.dbs_control_work_order_equipment oe
            JOIN operational o ON o.id = oe.work_order_id
            WHERE oe.equipment_id = e.id
          )
  ),
  status_counts AS (
    SELECT coalesce(jsonb_object_agg(status_code, total), '{}'::jsonb) AS value
    FROM (
      SELECT status_code, count(*)::bigint AS total
      FROM scoped
      GROUP BY status_code
    ) grouped
  ),
  recent_orders AS (
    SELECT coalesce(jsonb_agg(to_jsonb(recent) ORDER BY recent.updated_at DESC NULLS LAST, recent.id DESC), '[]'::jsonb) AS value
    FROM (
      SELECT
        o.id,
        coalesce(nullif(trim(o.protocol), ''), nullif(trim(o.protocolo), ''), o.id::text) AS protocol,
        o.status_code,
        o.updated_at,
        coalesce(nullif(trim(c.trade_name), ''), nullif(trim(c.legal_name), ''), 'Cliente sem nome') AS client_name
      FROM operational o
      LEFT JOIN public.dbs_control_clients c ON c.id = o.client_id
      ORDER BY o.updated_at DESC NULLS LAST, o.id DESC
      LIMIT 4
    ) recent
  ),
  totals AS (
    SELECT
      count(*)::bigint AS orders_total,
      count(*) FILTER (WHERE deleted_at IS NULL)::bigint AS orders_active,
      count(*) FILTER (WHERE deleted_at IS NULL AND status_code NOT IN ('concluida', 'concluida_com_pendencia', 'cancelada'))::bigint AS orders_open,
      count(*) FILTER (WHERE status_code = 'em_atendimento' AND deleted_at IS NULL)::bigint AS orders_in_service,
      count(*) FILTER (WHERE status_code IN ('aguardando_peca', 'aguardando_aprovacao', 'retorno_necessario', 'aguardando_cliente', 'concluida_com_pendencia') AND deleted_at IS NULL)::bigint AS orders_pending,
      count(*) FILTER (WHERE status_code IN ('concluida', 'concluida_com_pendencia') AND deleted_at IS NULL)::bigint AS orders_completed,
      count(*) FILTER (WHERE status_code = 'cancelada')::bigint AS orders_cancelled,
      count(*) FILTER (WHERE deleted_at IS NOT NULL)::bigint AS orders_deleted,
      max(updated_at) AS last_updated_at
    FROM scoped
  ),
  operational_totals AS (
    SELECT
      count(*)::bigint AS operational_count,
      count(*) FILTER (WHERE status_code IN ('concluida', 'concluida_com_pendencia'))::bigint AS operational_completed
    FROM operational
  ),
  queue_metrics AS (
    SELECT
      count(*) FILTER (WHERE assigned_employee_id IS NULL)::bigint AS orders_unassigned,
      count(*) FILTER (WHERE lower(trim(coalesce(priority, ''))) IN ('urgente', 'emergencia', 'emergencial'))::bigint AS orders_urgent,
      count(*) FILTER (
        WHERE (
          status_code IN ('em_atendimento', 'em_execucao', 'em_andamento')
          OR nullif(trim(coalesce(diagnostico, '')), '') IS NOT NULL
          OR nullif(trim(coalesce(servico_executado, '')), '') IS NOT NULL
          OR jsonb_array_length(
            CASE
              WHEN jsonb_typeof(coalesce(execution_checklist -> 'checklist', 'null'::jsonb)) = 'array'
                THEN execution_checklist -> 'checklist'
              ELSE '[]'::jsonb
            END
          ) > 0
        )
        AND (
          nullif(trim(coalesce(diagnostico, '')), '') IS NULL
          OR nullif(trim(coalesce(servico_executado, '')), '') IS NULL
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements(
              CASE
                WHEN jsonb_typeof(coalesce(execution_checklist -> 'checklist', 'null'::jsonb)) = 'array'
                  THEN execution_checklist -> 'checklist'
                ELSE '[]'::jsonb
              END
            ) AS checklist_item(value)
            WHERE lower(coalesce(checklist_item.value ->> 'obrigatorio', 'false')) IN ('true', '1', 'sim', 'yes')
              AND lower(coalesce(checklist_item.value ->> 'concluido', 'false')) NOT IN ('true', '1', 'sim', 'yes')
          )
        )
      )::bigint AS orders_execution_pending,
      count(*) FILTER (
        WHERE client_id IS NULL
           OR NOT EXISTS (SELECT 1 FROM public.dbs_control_clients c WHERE c.id = operational.client_id)
      )::bigint AS orders_link_issues
    FROM work_queue operational
  )
  SELECT jsonb_build_object(
    'source', 'canonical_relational_db',
    'scope_type', CASE
      WHEN p_employee_id IS NULL THEN 'company'
      WHEN p_base_id IS NULL THEN 'employee'
      ELSE 'employee_base'
    END,
    'employee_id', p_employee_id,
    'base_id', p_base_id,
    'base_active', coalesce((SELECT is_valid FROM base_meta), p_base_id IS NULL),
    'base_name', (SELECT name FROM base_meta WHERE is_valid),
    'clients_count', CASE
      WHEN p_base_id IS NOT NULL THEN (SELECT total FROM base_client_count)
      ELSE (SELECT total FROM client_count)
    END,
    'equipment_count', (SELECT total FROM equipment_count),
    'orders_total', totals.orders_total,
    'orders_active', totals.orders_active,
    'orders_open', totals.orders_open,
    'orders_in_service', totals.orders_in_service,
    'orders_pending', totals.orders_pending,
    'orders_completed', totals.orders_completed,
    'orders_cancelled', totals.orders_cancelled,
    'orders_deleted', totals.orders_deleted,
    'orders_unassigned', (SELECT orders_unassigned FROM queue_metrics),
    'orders_urgent', (SELECT orders_urgent FROM queue_metrics),
    'orders_execution_pending', (SELECT orders_execution_pending FROM queue_metrics),
    'orders_link_issues', (SELECT orders_link_issues FROM queue_metrics),
    'progress_percent', CASE
      WHEN operational_totals.operational_count = 0 THEN 0
      ELSE round((operational_totals.operational_completed::numeric / operational_totals.operational_count::numeric) * 100)::integer
    END,
    'last_updated_at', totals.last_updated_at,
    'status_counts', (SELECT value FROM status_counts),
    'recent_orders', (SELECT value FROM recent_orders)
  )
  FROM totals, operational_totals;
$$;

REVOKE ALL ON FUNCTION public.dbs_control_dashboard_summary_scoped(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dbs_control_dashboard_summary_scoped(uuid, uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.dbs_control_dashboard_summary_scoped(uuid, uuid, uuid) IS
  'Canonical read-only DBS Control dashboard contract for desktop and mobile. Scope is resolved by the authenticated server function; snapshots are not read.';
