-- DBS AIR · reparo do banco RH/DP
-- Aditivo e idempotente: não remove dados.
-- Libera o acesso autenticado para a camada de dados e corrige a migração de contratos.

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'rh_departments','rh_positions','rh_employee_contracts','rh_employee_dependents',
    'rh_employee_documents','rh_work_schedules','rh_employee_schedule_assignments',
    'rh_employee_events','rh_audit_log','rh_vacation_periods','rh_vacation_requests',
    'rh_leave_records','rh_payroll_periods','rh_payroll_items','rh_payroll_runs',
    'rh_payroll_rules','rh_time_adjustments','rh_time_closures','rh_admission_processes',
    'rh_termination_processes','rh_medical_exams','rh_safety_events','rh_employee_requests'
  ] LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO authenticated', tbl);
    END IF;
  END LOOP;
END $$;

-- Gestão RH: somente usuários ativos com perfil administrativo/gestor.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'rh_departments','rh_positions','rh_employee_contracts','rh_employee_dependents',
    'rh_employee_documents','rh_work_schedules','rh_employee_schedule_assignments',
    'rh_employee_events','rh_audit_log','rh_vacation_periods','rh_vacation_requests',
    'rh_leave_records','rh_payroll_periods','rh_payroll_items','rh_payroll_runs',
    'rh_payroll_rules','rh_time_adjustments','rh_time_closures','rh_admission_processes',
    'rh_termination_processes','rh_medical_exams','rh_safety_events','rh_employee_requests'
  ] LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS rh_management_all ON public.%I', tbl);
      EXECUTE format(
        'CREATE POLICY rh_management_all ON public.%I FOR ALL TO authenticated
         USING (
           public.usuario_esta_ativo()
           AND public.current_role_key() IN (''SUPER_ADMIN'',''ADMIN_OPERACIONAL'',''GESTOR_CONTA'',''GESTOR_REGIONAL'')
         )
         WITH CHECK (
           public.usuario_esta_ativo()
           AND public.current_role_key() IN (''SUPER_ADMIN'',''ADMIN_OPERACIONAL'',''GESTOR_CONTA'',''GESTOR_REGIONAL'')
         )',
        tbl
      );
    END IF;
  END LOOP;
END $$;

-- Reforço do cadastro canônico: cada funcionário deve ter seu próprio apontamento.
UPDATE public.rh_employees
SET registry_employee_id = id
WHERE registry_employee_id IS NULL;

-- Garante contrato para quem ainda não possui um, sem duplicar.
INSERT INTO public.rh_employee_contracts (
  employee_id, contract_type, admission_date, salary_cents, salary_effective_from,
  work_regime, weekly_hours, is_current
)
SELECT
  e.id,
  'CLT',
  CASE WHEN e.registration_data->>'admission_date' ~ '^\\d{4}-\\d{2}-\\d{2}$'
       THEN (e.registration_data->>'admission_date')::date END,
  CASE
    WHEN NULLIF(TRIM(COALESCE(e.registration_data->>'salary','')), '') IS NULL THEN NULL
    WHEN regexp_replace(e.registration_data->>'salary','[^0-9,.-]','','g') ~ ','
      THEN ROUND(REPLACE(REPLACE(regexp_replace(e.registration_data->>'salary','[^0-9,.-]','','g'),'.',''),',','.')::numeric*100)::bigint
    ELSE ROUND(regexp_replace(e.registration_data->>'salary','[^0-9.-]','','g')::numeric*100)::bigint
  END,
  CASE WHEN e.registration_data->>'admission_date' ~ '^\\d{4}-\\d{2}-\\d{2}$'
       THEN (e.registration_data->>'admission_date')::date END,
  'presencial',
  CASE
    WHEN regexp_replace(COALESCE(e.registration_data->>'work_hours',''),'[^0-9,.]','','g') <> ''
    THEN replace(regexp_replace(e.registration_data->>'work_hours','[^0-9,.]','','g'),',','.')::numeric
  END,
  true
FROM public.rh_employees e
WHERE NOT EXISTS (
  SELECT 1 FROM public.rh_employee_contracts c WHERE c.employee_id=e.id
);

CREATE INDEX IF NOT EXISTS rh_employee_contracts_current_idx
  ON public.rh_employee_contracts(employee_id)
  WHERE is_current = true;

NOTIFY pgrst, 'reload schema';
