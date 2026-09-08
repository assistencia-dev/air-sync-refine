/**
 * RH Employee Service
 * Central CRUD operations for employee management.
 * Single source of truth: queries rh_employees table directly.
 *
 * Responsibilities:
 *   - Create, read, update, delete employee records
 *   - Manage daily benefit rates (VT tariff, trips/day, VA daily rate, work schedule)
 *   - Enforce validation & audit logging
 *   - Provide typed employee objects to benefit calculation layer
 */

import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import type { EmployeeBenefitConfig } from './benefitCalculations';

// Type alias for rh_employees row
type RHEmployee = Database['public']['Tables']['rh_employees']['Row'];
type RHEmployeeInsert = Database['public']['Tables']['rh_employees']['Insert'];
type RHEmployeeUpdate = Database['public']['Tables']['rh_employees']['Update'];

/**
 * Enhanced employee object with calculated daily costs
 * Extends DB row with computed properties for UI/logic layer
 */
export interface EmployeeWithCosts extends RHEmployee {
  daily_vt_cost: number; // Calculated from vt_tariff_unit * vt_trips_per_day
  daily_va_cost: number; // va_daily_rate
}

/**
 * Convert DB row to EmployeeBenefitConfig for calculations
 */
export function toEmployeeBenefitConfig(emp: RHEmployee): EmployeeBenefitConfig {
  return {
    employeeId: emp.id,
    fullName: emp.full_name,
    vt_tariff_unit: emp.vt_tariff_unit ?? 4.30,
    vt_trips_per_day: emp.vt_trips_per_day ?? 2,
    va_daily_rate: emp.va_daily_rate ?? 35.0,
    work_schedule: emp.work_schedule ?? '5x2',
  };
}

/**
 * Convert DB row to EmployeeWithCosts (adds computed properties)
 */
export function toEmployeeWithCosts(emp: RHEmployee): EmployeeWithCosts {
  const vt_tariff = emp.vt_tariff_unit ?? 4.30;
  const vt_trips = emp.vt_trips_per_day ?? 2;
  const va_rate = emp.va_daily_rate ?? 35.0;

  return {
    ...emp,
    daily_vt_cost: vt_tariff * vt_trips,
    daily_va_cost: va_rate,
  };
}

/**
 * Fetch all active employees (optionally filtered by unit)
 * @param unitId - Optional: filter by unit_id
 * @returns Array of employees with costs
 */
export async function fetchActiveEmployees(unitId?: string): Promise<EmployeeWithCosts[]> {
  let query = supabase
    .from('rh_employees')
    .select('*')
    .eq('is_active', true)
    .order('full_name', { ascending: true });

  if (unitId) {
    query = query.eq('unit', unitId);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[fetchActiveEmployees] Supabase error:', error.message);
    throw new Error(`Falha ao buscar colaboradores: ${error.message}`);
  }

  return (data || []).map(toEmployeeWithCosts);
}

/**
 * Fetch a single employee by ID
 * @param employeeId - Employee ID (uuid)
 * @returns Employee with costs, or null if not found
 */
export async function fetchEmployeeById(employeeId: string): Promise<EmployeeWithCosts | null> {
  const { data, error } = await supabase
    .from('rh_employees')
    .select('*')
    .eq('id', employeeId)
    .maybeSingle();

  if (error) {
    console.error(`[fetchEmployeeById] Supabase error for ${employeeId}:`, error.message);
    throw new Error(`Falha ao buscar colaborador: ${error.message}`);
  }

  return data ? toEmployeeWithCosts(data) : null;
}

/**
 * Create a new employee record
 * @param input - Employee data
 * @returns Created employee with costs
 */
export async function createEmployee(input: {
  full_name: string;
  benefit_type: string; // 'VT', 'VA', or 'VT_VA'
  unit: string;
  vt_tariff_unit?: number;
  vt_trips_per_day?: number;
  va_daily_rate?: number;
  work_schedule?: string;
  registration_data?: Record<string, any>;
}): Promise<EmployeeWithCosts> {
  const now = new Date().toISOString();

  const insertData: RHEmployeeInsert = {
    full_name: input.full_name,
    benefit_type: input.benefit_type,
    unit: input.unit,
    fare_cents: 0, // Legacy field, deprecated
    is_active: true,
    vt_tariff_unit: input.vt_tariff_unit ?? 4.30,
    vt_trips_per_day: input.vt_trips_per_day ?? 2,
    va_daily_rate: input.va_daily_rate ?? 35.0,
    work_schedule: input.work_schedule ?? '5x2',
    is_daily_rates_configured: true,
    daily_rates_updated_at: now,
    registration_data: input.registration_data || {},
  };

  const { data, error } = await supabase
    .from('rh_employees')
    .insert([insertData])
    .select()
    .single();

  if (error) {
    console.error('[createEmployee] Supabase error:', error.message);
    throw new Error(`Falha ao criar colaborador: ${error.message}`);
  }

  // Log to audit trail
  await logAudit('CREATE_EMPLOYEE', {
    employee_id: data.id,
    employee_name: data.full_name,
    benefit_type: data.benefit_type,
  });

  return toEmployeeWithCosts(data);
}

/**
 * Update employee record
 * @param employeeId - Employee ID
 * @param updates - Fields to update
 * @returns Updated employee with costs
 */
export async function updateEmployee(
  employeeId: string,
  updates: {
    full_name?: string;
    benefit_type?: string;
    vt_tariff_unit?: number;
    vt_trips_per_day?: number;
    va_daily_rate?: number;
    work_schedule?: string;
    is_active?: boolean;
    registration_data?: Record<string, any>;
  }
): Promise<EmployeeWithCosts> {
  const now = new Date().toISOString();

  const updateData: RHEmployeeUpdate = {
    ...updates,
    daily_rates_updated_at: updates.vt_tariff_unit || updates.vt_trips_per_day || updates.va_daily_rate || updates.work_schedule ? now : undefined,
    updated_at: now,
  };

  const { data, error } = await supabase
    .from('rh_employees')
    .update(updateData)
    .eq('id', employeeId)
    .select()
    .single();

  if (error) {
    console.error(`[updateEmployee] Supabase error for ${employeeId}:`, error.message);
    throw new Error(`Falha ao atualizar colaborador: ${error.message}`);
  }

  // Log to audit trail
  await logAudit('UPDATE_EMPLOYEE', {
    employee_id: employeeId,
    fields_updated: Object.keys(updates),
  });

  return toEmployeeWithCosts(data);
}

/**
 * Soft delete: mark employee as inactive
 * @param employeeId - Employee ID
 * @returns Updated employee
 */
export async function deactivateEmployee(employeeId: string): Promise<EmployeeWithCosts> {
  return updateEmployee(employeeId, { is_active: false });
}

/**
 * Reactivate a previously deactivated employee
 * @param employeeId - Employee ID
 * @returns Updated employee
 */
export async function reactivateEmployee(employeeId: string): Promise<EmployeeWithCosts> {
  return updateEmployee(employeeId, { is_active: true });
}

/**
 * Update only daily benefit rates (common operation)
 * @param employeeId - Employee ID
 * @param rates - Daily rate updates
 * @returns Updated employee
 */
export async function updateEmployeeDailyRates(
  employeeId: string,
  rates: {
    vt_tariff_unit?: number;
    vt_trips_per_day?: number;
    va_daily_rate?: number;
    work_schedule?: string;
  }
): Promise<EmployeeWithCosts> {
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('rh_employees')
    .update({
      ...rates,
      is_daily_rates_configured: true,
      daily_rates_updated_at: now,
      updated_at: now,
    })
    .eq('id', employeeId)
    .select()
    .single();

  if (error) {
    console.error(`[updateEmployeeDailyRates] Supabase error for ${employeeId}:`, error.message);
    throw new Error(`Falha ao atualizar tarifa do colaborador: ${error.message}`);
  }

  await logAudit('UPDATE_EMPLOYEE_DAILY_RATES', {
    employee_id: employeeId,
    rates_updated: Object.keys(rates),
  });

  return toEmployeeWithCosts(data);
}

/**
 * Search employees by name (case-insensitive)
 * @param searchTerm - Partial name to search
 * @param unitId - Optional: filter by unit
 * @returns Matching employees
 */
export async function searchEmployeesByName(searchTerm: string, unitId?: string): Promise<EmployeeWithCosts[]> {
  let query = supabase
    .from('rh_employees')
    .select('*')
    .ilike('full_name', `%${searchTerm}%`)
    .eq('is_active', true);

  if (unitId) {
    query = query.eq('unit', unitId);
  }

  const { data, error } = await query.order('full_name', { ascending: true });

  if (error) {
    console.error('[searchEmployeesByName] Supabase error:', error.message);
    throw new Error(`Falha ao buscar colaboradores: ${error.message}`);
  }

  return (data || []).map(toEmployeeWithCosts);
}

/**
 * Get employees who need daily rates configuration
 * (is_daily_rates_configured = false)
 * @returns Employees pending configuration
 */
export async function fetchEmployeesPendingRatesConfiguration(): Promise<EmployeeWithCosts[]> {
  const { data, error } = await supabase
    .from('rh_employees')
    .select('*')
    .eq('is_active', true)
    .eq('is_daily_rates_configured', false)
    .order('full_name', { ascending: true });

  if (error) {
    console.error('[fetchEmployeesPendingRatesConfiguration] Supabase error:', error.message);
    throw new Error(`Falha ao buscar configurações pendentes: ${error.message}`);
  }

  return (data || []).map(toEmployeeWithCosts);
}

// ============================================================================
// AUDIT LOGGING
// ============================================================================

/**
 * Log an action to the audit trail
 * @param action - Action name (e.g., 'CREATE_EMPLOYEE', 'UPDATE_EMPLOYEE_DAILY_RATES')
 * @param metadata - Additional context
 */
async function logAudit(action: string, metadata: Record<string, any> = {}): Promise<void> {
  try {
    await supabase.from('audit_log').insert({
      action,
      metadata_json: metadata,
    });
  } catch (err) {
    // Non-blocking: log errors but don't fail the operation
    console.warn(`[logAudit] Failed to log audit for action "${action}":`, err);
  }
}

/**
 * Fetch audit log for an employee
 * @param employeeId - Employee ID
 * @param limit - Number of recent entries to fetch
 * @returns Array of audit log entries
 */
export async function fetchEmployeeAuditLog(
  employeeId: string,
  limit: number = 50
): Promise<Database['public']['Tables']['audit_log']['Row'][]> {
  const { data, error } = await supabase
    .from('audit_log')
    .select('*')
    .contains('metadata_json', { employee_id: employeeId })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error(`[fetchEmployeeAuditLog] Supabase error for ${employeeId}:`, error.message);
    return [];
  }

  return data || [];
}
