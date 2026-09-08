-- ============================================================================
-- SECURITY HARDENING: RLS & RBAC Policies for RH Module
-- ============================================================================
-- Purpose: Implement Row Level Security (RLS) for all RH tables
-- Ensures users can only access their own data based on role and unit assignment
-- 
-- This script MUST be run by a Supabase admin/owner with FULL PERMISSIONS
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Enable RLS on all RH tables
-- ============================================================================

ALTER TABLE public.rh_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_benefit_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_topups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_request_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_request_audit ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- STEP 2: RLS Policies for rh_employees
-- ============================================================================

-- SUPER_ADMIN & ADMIN_OPERACIONAL: can view/edit ALL employees
CREATE POLICY rh_employees_admin_access ON public.rh_employees
  FOR ALL
  USING (
    current_role_key() IN ('SUPER_ADMIN', 'ADMIN_OPERACIONAL')
  )
  WITH CHECK (
    current_role_key() IN ('SUPER_ADMIN', 'ADMIN_OPERACIONAL')
  );

-- GESTOR_CONTA: can view employees in their company only
CREATE POLICY rh_employees_gestor_conta_view ON public.rh_employees
  FOR SELECT
  USING (
    current_role_key() = 'GESTOR_CONTA'
    AND unit IN (
      SELECT name FROM public.units
      WHERE company_id = (
        SELECT company_id FROM public.users
        WHERE auth_id = auth.uid()
      )
    )
  );

-- GESTOR_REGIONAL: can view/edit employees in their assigned unit
CREATE POLICY rh_employees_gestor_regional_access ON public.rh_employees
  FOR ALL
  USING (
    current_role_key() = 'GESTOR_REGIONAL'
    AND unit = (
      SELECT name FROM public.units
      WHERE id = (
        SELECT unit_id FROM public.users
        WHERE auth_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    current_role_key() = 'GESTOR_REGIONAL'
    AND unit = (
      SELECT name FROM public.units
      WHERE id = (
        SELECT unit_id FROM public.users
        WHERE auth_id = auth.uid()
      )
    )
  );

-- ============================================================================
-- STEP 3: RLS Policies for rh_benefit_requests
-- ============================================================================

-- SUPER_ADMIN & ADMIN_OPERACIONAL: full access
CREATE POLICY rh_benefit_requests_admin_access ON public.rh_benefit_requests
  FOR ALL
  USING (
    current_role_key() IN ('SUPER_ADMIN', 'ADMIN_OPERACIONAL')
  )
  WITH CHECK (
    current_role_key() IN ('SUPER_ADMIN', 'ADMIN_OPERACIONAL')
  );

-- GESTOR_CONTA: can view requests for employees in their company
CREATE POLICY rh_benefit_requests_gestor_conta_view ON public.rh_benefit_requests
  FOR SELECT
  USING (
    current_role_key() = 'GESTOR_CONTA'
    AND employee_id IN (
      SELECT id FROM public.rh_employees
      WHERE unit IN (
        SELECT name FROM public.units
        WHERE company_id = (
          SELECT company_id FROM public.users
          WHERE auth_id = auth.uid()
        )
      )
    )
  );

-- ============================================================================
-- STEP 4: RLS Policies for rh_topups
-- ============================================================================

-- SUPER_ADMIN & ADMIN_OPERACIONAL: full access
CREATE POLICY rh_topups_admin_access ON public.rh_topups
  FOR ALL
  USING (
    current_role_key() IN ('SUPER_ADMIN', 'ADMIN_OPERACIONAL')
  )
  WITH CHECK (
    current_role_key() IN ('SUPER_ADMIN', 'ADMIN_OPERACIONAL')
  );

-- ============================================================================
-- STEP 5: RLS Policies for audit tables (read-only for authorized roles)
-- ============================================================================

CREATE POLICY rh_request_audit_view ON public.rh_request_audit
  FOR SELECT
  USING (
    current_role_key() IN ('SUPER_ADMIN', 'ADMIN_OPERACIONAL', 'GESTOR_CONTA', 'GESTOR_REGIONAL')
  );

-- ============================================================================
-- STEP 6: Secure bucket policies (Storage)
-- ============================================================================

-- Enable RLS on storage auth
-- Note: Storage buckets use separate RLS system via storage.objects table
-- Create policies in Supabase dashboard under Storage > Policies

-- ============================================================================
-- STEP 7: Create audit log entry
-- ============================================================================

INSERT INTO public.audit_log (action, metadata_json, created_at)
VALUES (
  'SECURITY_RLS_HARDENING_APPLIED',
  jsonb_build_object(
    'description', 'RLS policies implemented for all RH tables',
    'tables_protected', jsonb_build_array(
      'rh_employees',
      'rh_benefit_requests',
      'rh_topups',
      'rh_request_attachments',
      'rh_request_audit'
    ),
    'roles_enforced', jsonb_build_array(
      'SUPER_ADMIN',
      'ADMIN_OPERACIONAL',
      'GESTOR_CONTA',
      'GESTOR_REGIONAL'
    ),
    'timestamp', NOW()
  ),
  NOW()
);

COMMIT;
