-- DBS AIR · preenchimento seguro dos contratos RH
-- Somente acrescenta contratos quando o funcionário ainda não possui contrato.
INSERT INTO public.rh_employee_contracts (
  employee_id, contract_type, admission_date, salary_cents, salary_effective_from,
  work_regime, weekly_hours, work_shift, is_current
)
SELECT
  e.id,
  'CLT',
  CASE
    WHEN e.registration_data->>'admission_date' ~ '^\d{4}-\d{2}-\d{2}$'
      THEN (e.registration_data->>'admission_date')::date
    ELSE NULL
  END,
  CASE
    WHEN NULLIF(TRIM(COALESCE(e.registration_data->>'salary','')), '') IS NULL THEN NULL
    WHEN regexp_replace(e.registration_data->>'salary','[^0-9,.-]','','g') ~ ','
      THEN ROUND(
        REPLACE(
          REPLACE(
            regexp_replace(e.registration_data->>'salary','[^0-9,.-]','','g'),
            '.',''
          ),
          ',','.'
        )::numeric * 100
      )::bigint
    WHEN regexp_replace(e.registration_data->>'salary','[^0-9,.-]','','g') ~ '^[-]?[0-9]+
  CASE
    WHEN e.registration_data->>'admission_date' ~ '^\d{4}-\d{2}-\d{2}$'
      THEN (e.registration_data->>'admission_date')::date
    ELSE CURRENT_DATE
  END,
  'presencial',
  CASE
    WHEN regexp_replace(COALESCE(e.registration_data->>'work_hours',''),'[^0-9,.]','','g') <> ''
      THEN replace(regexp_replace(e.registration_data->>'work_hours','[^0-9,.]','','g'),',','.')::numeric
    ELSE NULL
  END,
  NULL,
  true
FROM public.rh_employees e
WHERE NOT EXISTS (
  SELECT 1 FROM public.rh_employee_contracts c WHERE c.employee_id=e.id
);

      THEN (regexp_replace(e.registration_data->>'salary','[^0-9-]','','g')::numeric * 100)::bigint
    ELSE ROUND(
      regexp_replace(e.registration_data->>'salary','[^0-9.-]','','g')::numeric * 100
    )::bigint
  END,
  CASE
    WHEN e.registration_data->>'admission_date' ~ '^\d{4}-\d{2}-\d{2}$'
      THEN (e.registration_data->>'admission_date')::date
    ELSE CURRENT_DATE
  END,
  'presencial',
  CASE
    WHEN regexp_replace(COALESCE(e.registration_data->>'work_hours',''),'[^0-9,.]','','g') <> ''
      THEN replace(regexp_replace(e.registration_data->>'work_hours','[^0-9,.]','','g'),',','.')::numeric
    ELSE NULL
  END,
  NULL,
  true
FROM public.rh_employees e
WHERE NOT EXISTS (
  SELECT 1 FROM public.rh_employee_contracts c WHERE c.employee_id=e.id
);
