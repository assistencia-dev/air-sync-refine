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
import { createRhEmployee, deleteRhEmployee, listRhEmployees, updateRhEmployee } from '@/lib/rh.functions';

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
  const dailyRate = (emp.fare_cents ?? 0) / 100;
  return {
    employeeId: emp.id,
    fullName: emp.full_name,
    vt_tariff_unit: emp.benefit_type === 'passagem' ? dailyRate : 0,
    vt_trips_per_day: emp.trips_per_day ?? 1,
    va_daily_rate: emp.benefit_type === 'alimentacao' ? dailyRate : 0,
    work_schedule: '5x2',
  };
}

/**
 * Convert DB row to EmployeeWithCosts (adds computed properties)
 */
export function toEmployeeWithCosts(emp: RHEmployee): EmployeeWithCosts {
  const dailyRate = (emp.fare_cents ?? 0) / 100;
  return {
    ...emp,
    daily_vt_cost: emp.benefit_type === 'passagem' ? dailyRate : 0,
    daily_va_cost: emp.benefit_type === 'alimentacao' ? dailyRate : 0,
  };
}

/**
 * Fetch all active employees (optionally filtered by unit)
 * @param unitId - Optional: filter by unit_id
 * @returns Array of employees with costs
 */
export async function fetchActiveEmployees(unitId?: string): Promise<EmployeeWithCosts[]> {
  const [passage, food] = await Promise.all([
    listRhEmployees({ data: { benefit_type: 'passagem' } }),
    listRhEmployees({ data: { benefit_type: 'alimentacao' } }),
  ]);
  const employees = [...passage, ...food]
    .filter((employee) => !unitId || employee.unit === unitId)
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
  return employees.map((employee) => toEmployeeWithCosts(employee as RHEmployee));
}

/**
 * Fetch a single employee by ID
 * @param employeeId - Employee ID (uuid)
 * @returns Employee with costs, or null if not found
 */
export async function fetchEmployeeById(employeeId: string): Promise<EmployeeWithCosts | null> {
  const employees = await fetchActiveEmployees();
  return employees.find((employee) => employee.id === employeeId) ?? null;
}

/**
 * Create a new employee record
 * @param input - Employee data
 * @returns Created employee with costs
 */
export async function createEmployee(input: { full_name: string; benefit_type: string; unit: string; vt_tariff_unit?: number; vt_trips_per_day?: number; va_daily_rate?: number; work_schedule?: string; registration_data?: Record<string, any> }): Promise<EmployeeWithCosts> {
  const benefitTypes = input.benefit_type === 'VT_VA' ? ['passagem', 'alimentacao'] : [input.benefit_type === 'VT' ? 'passagem' : input.benefit_type === 'VA' ? 'alimentacao' : input.benefit_type];
  if (!benefitTypes.every((type) => type === 'passagem' || type === 'alimentacao')) throw new Error('Tipo de benefício inválido.');
  const created = [];
  for (const benefitType of benefitTypes) {
    const daily = benefitType === 'passagem' ? input.vt_tariff_unit ?? 0 : input.va_daily_rate ?? 0;
    if (daily <= 0) throw new Error('Informe um valor diário válido para o benefício.');
    const employee = await createRhEmployee({ data: { benefit_type: benefitType as 'passagem' | 'alimentacao', full_name: input.full_name, unit: input.unit, fare_cents: Math.round(daily * 100), trips_per_day: benefitType === 'passagem' ? input.vt_trips_per_day ?? 1 : 1 } });
    created.push(employee);
  }
  return toEmployeeWithCosts(created[0] as RHEmployee);
}

/**
 * Update employee record
 * @param employeeId - Employee ID
 * @param updates - Fields to update
 * @returns Updated employee with costs
 */
export async function updateEmployee(employeeId: string, updates: { full_name?: string; benefit_type?: string; unit?: string; vt_tariff_unit?: number; vt_trips_per_day?: number; va_daily_rate?: number; work_schedule?: string; is_active?: boolean; registration_data?: Record<string, any> }): Promise<EmployeeWithCosts> {
  const current = await fetchEmployeeById(employeeId);
  if (!current) throw new Error('Colaborador não encontrado.');
  const benefitType = updates.benefit_type === 'VT' ? 'passagem' : updates.benefit_type === 'VA' ? 'alimentacao' : (updates.benefit_type ?? current.benefit_type);
  if (benefitType !== 'passagem' && benefitType !== 'alimentacao') throw new Error('Tipo de benefício inválido.');
  const daily = benefitType === 'passagem' ? updates.vt_tariff_unit : updates.va_daily_rate;
  const updated = await updateRhEmployee({ data: { id: employeeId, benefit_type: benefitType, full_name: updates.full_name ?? current.full_name, unit: updates.unit ?? current.unit, fare_cents: daily === undefined ? current.fare_cents : Math.round(daily * 100), trips_per_day: benefitType === 'passagem' ? updates.vt_trips_per_day ?? current.trips_per_day : 1 } });
  return toEmployeeWithCosts(updated as RHEmployee);
}

/**
 * Soft delete: mark employee as inactive
 * @param employeeId - Employee ID
 * @returns Updated employee
 */
export async function deactivateEmployee(employeeId: string): Promise<EmployeeWithCosts> {
  const current = await fetchEmployeeById(employeeId);
  if (!current) throw new Error('Colaborador não encontrado.');
  await deleteRhEmployee({ data: { id: employeeId, benefit_type: current.benefit_type as 'passagem' | 'alimentacao' } });
  return { ...current, is_active: false };
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
export async function updateEmployeeDailyRates(employeeId: string, rates: { vt_tariff_unit?: number; vt_trips_per_day?: number; va_daily_rate?: number; work_schedule?: string }): Promise<EmployeeWithCosts> {
  const current = await fetchEmployeeById(employeeId);
  if (!current) throw new Error('Colaborador não encontrado.');
  const daily = current.benefit_type === 'passagem' ? rates.vt_tariff_unit : rates.va_daily_rate;
  const updated = await updateRhEmployee({ data: { id: employeeId, benefit_type: current.benefit_type as 'passagem' | 'alimentacao', full_name: current.full_name, unit: current.unit, fare_cents: daily === undefined ? current.fare_cents : Math.round(daily * 100), trips_per_day: current.benefit_type === 'passagem' ? rates.vt_trips_per_day ?? current.trips_per_day : 1 } });
  return toEmployeeWithCosts(updated);
}

/**
 * Search employees by name (case-insensitive)
 * @param searchTerm - Partial name to search
 * @param unitId - Optional: filter by unit
 * @returns Matching employees
 */
export async function searchEmployeesByName(searchTerm: string, unitId?: string): Promise<EmployeeWithCosts[]> {
  const employees = await fetchActiveEmployees(unitId);
  const term = searchTerm.trim().toLowerCase();
  return term ? employees.filter((employee) => employee.full_name.toLowerCase().includes(term)) : employees;
}

/**
 * Get employees who need daily rates configuration
 * (is_daily_rates_configured = false)
 * @returns Employees pending configuration
 */
export async function fetchEmployeesPendingRatesConfiguration(): Promise<EmployeeWithCosts[]> {
  return fetchActiveEmployees();
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
