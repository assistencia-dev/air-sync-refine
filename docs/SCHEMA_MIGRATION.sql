-- ============================================================================
-- SCHEMA MIGRATION: Add Daily Benefit Rate Fields to rh_employees
-- ============================================================================
-- Purpose: Enable single source of truth for employee benefit calculations
-- (Vale Passagem & Vale Alimentação) per the refactoring directive.
--
-- This migration adds atomic daily rate fields, replacing the vague "fare_cents"
-- and enabling precise cost calculations per employee & work schedule.
--
-- EXECUTION: Run this in Supabase SQL Editor for your project.
-- ============================================================================

BEGIN;

-- Step 1: Add new columns to rh_employees table
ALTER TABLE public.rh_employees
ADD COLUMN IF NOT EXISTS vt_tariff_unit NUMERIC(10,2) DEFAULT 4.30,
ADD COLUMN IF NOT EXISTS vt_trips_per_day INTEGER DEFAULT 2,
ADD COLUMN IF NOT EXISTS va_daily_rate NUMERIC(10,2) DEFAULT 35.00,
ADD COLUMN IF NOT EXISTS work_schedule TEXT DEFAULT '5x2',
ADD COLUMN IF NOT EXISTS vt_daily_cost_cents INTEGER GENERATED ALWAYS AS (
  FLOOR(vt_tariff_unit * vt_trips_per_day * 100)
) STORED,
ADD COLUMN IF NOT EXISTS va_daily_cost_cents INTEGER GENERATED ALWAYS AS (
  FLOOR(va_daily_rate * 100)
) STORED,
ADD COLUMN IF NOT EXISTS is_daily_rates_configured BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS daily_rates_updated_at TIMESTAMP WITH TIME ZONE;

-- Step 2: Create index for active employees (optimization)
CREATE INDEX IF NOT EXISTS idx_rh_employees_active_configured
ON public.rh_employees(is_active, is_daily_rates_configured)
WHERE is_active = TRUE AND is_daily_rates_configured = TRUE;

-- Step 3: Add comments for documentation
COMMENT ON COLUMN public.rh_employees.vt_tariff_unit IS 'Vale Transporte: cost per trip unit (e.g., BUI tariff R$ 4.30)';
COMMENT ON COLUMN public.rh_employees.vt_trips_per_day IS 'Vale Transporte: trips per working day (typically 2 or 4)';
COMMENT ON COLUMN public.rh_employees.va_daily_rate IS 'Vale Alimentação: daily allowance in BRL (e.g., R$ 35.00)';
COMMENT ON COLUMN public.rh_employees.work_schedule IS 'Work schedule pattern (e.g., "5x2", "6x1", "12x36")';
COMMENT ON COLUMN public.rh_employees.vt_daily_cost_cents IS 'Cached daily VT cost in cents (vt_tariff_unit * vt_trips_per_day * 100)';
COMMENT ON COLUMN public.rh_employees.va_daily_cost_cents IS 'Cached daily VA cost in cents (va_daily_rate * 100)';
COMMENT ON COLUMN public.rh_employees.is_daily_rates_configured IS 'Flag: true when all daily rates have been explicitly set';
COMMENT ON COLUMN public.rh_employees.daily_rates_updated_at IS 'Timestamp of last daily rates update';

-- Step 4: Update audit log to track schema changes
INSERT INTO public.audit_log (action, metadata_json, created_at)
VALUES (
  'SCHEMA_MIGRATION_RHED_DAILY_RATES',
  jsonb_build_object(
    'description', 'Added daily benefit rate fields to enable single source of truth',
    'fields_added', jsonb_build_array(
      'vt_tariff_unit',
      'vt_trips_per_day',
      'va_daily_rate',
      'work_schedule',
      'vt_daily_cost_cents',
      'va_daily_cost_cents',
      'is_daily_rates_configured',
      'daily_rates_updated_at'
    ),
    'migration_date', NOW()
  ),
  NOW()
);

COMMIT;
