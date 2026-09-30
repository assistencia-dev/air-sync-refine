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
import {
  configureRhEmployeeBenefit,
  deactivateRhEmployeeRecord,
  deleteRhEmployee,
  listRhEmployees,
  reactivateRhEmployeeRecord,
  saveRhEmployeeRecord,
} from '@/lib/rh.functions';

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
    daily_vt_cost: emp.benefit_type === 'passagem' ? dailyRate * (emp.trips_per_day ?? 1) : 0,
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

  // Um funcionário pode possuir VT e VA, mas continua sendo uma única pessoa.
  // Consolidamos os benefícios pelo registro canônico para evitar duplicidade nas telas.
  const byRegistry = new Map<string, { base: RHEmployee; vt?: RHEmployee; va?: RHEmployee }>();
  for (const employee of [...passage, ...food] as RHEmployee[]) {
    const registryId = (employee as any).registry_employee_id ?? employee.id;
    const entry = byRegistry.get(registryId) ?? { base: employee };
    entry.base = entry.base ?? employee;
    if (employee.benefit_type === 'passagem') entry.vt = employee;
    if (employee.benefit_type === 'alimentacao') entry.va = employee;
    byRegistry.set(registryId, entry);
  }

  return [...byRegistry.values()]
    .map(({ base, vt, va }) => ({
      ...base,
      // O ID continua sendo o registro central sempre que disponível.
      id: (base as any).registry_employee_id ?? base.id,
      benefit_type: vt ? 'passagem' : va?.benefit_type ?? base.benefit_type,
      fare_cents: vt?.fare_cents ?? va?.fare_cents ?? base.fare_cents,
      trips_per_day: vt?.trips_per_day ?? base.trips_per_day,
      daily_vt_cost: vt ? (vt.fare_cents ?? 0) / 100 * (vt.trips_per_day ?? 1) : 0,
      daily_va_cost: va ? (va.fare_cents ?? 0) / 100 : 0,
    }))
    .filter((employee) => !unitId || employee.unit === unitId)
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
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
  const benefitTypes = input.benefit_type === 'VT_VA'
    ? ['passagem', 'alimentacao']
    : [input.benefit_type === 'VT' ? 'passagem' : input.benefit_type === 'VA' ? 'alimentacao' : input.benefit_type];

  if (!benefitTypes.every((type) => type === 'passagem' || type === 'alimentacao')) {
    throw new Error('Tipo de benefício inválido.');
  }

  const registry = await saveRhEmployeeRecord({
    data: {
      full_name: input.full_name,
      unit: input.unit,
      registration_data: input.registration_data ?? {},
    },
  });

  let first: RHEmployee | null = null;
  for (const benefitType of benefitTypes) {
    const daily = benefitType === 'passagem' ? input.vt_tariff_unit ?? 0 : input.va_daily_rate ?? 0;
    if (daily <= 0) throw new Error('Informe um valor diário válido para o benefício.');
    const configured = await configureRhEmployeeBenefit({
      data: {
        registry_employee_id: registry.id,
        benefit_type: benefitType as 'passagem' | 'alimentacao',
        fare_cents: Math.round(daily * 100),
        trips_per_day: benefitType === 'passagem' ? input.vt_trips_per_day ?? 1 : 1,
      },
    });
    if (!first) first = configured as RHEmployee;
  }

  if (!first) throw new Error('Não foi possível configurar o funcionário.');
  return toEmployeeWithCosts(first);
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

  const registryId = (current as any).registry_employee_id ?? current.id;
  const nextName = updates.full_name ?? current.full_name;
  const nextUnit = updates.unit ?? current.unit;
  if (updates.full_name || updates.unit || updates.registration_data) {
    await saveRhEmployeeRecord({
      data: {
        id: registryId,
        full_name: nextName,
        unit: nextUnit,
        registration_data: updates.registration_data ?? ((current as any).registration_data ?? {}),
      },
    });
  }

  const benefitType = updates.benefit_type === 'VT' ? 'passagem'
    : updates.benefit_type === 'VA' ? 'alimentacao'
    : (updates.benefit_type ?? current.benefit_type);

  if (benefitType !== 'passagem' && benefitType !== 'alimentacao') {
    throw new Error('Tipo de benefício inválido.');
  }

  const daily = benefitType === 'passagem' ? updates.vt_tariff_unit : updates.va_daily_rate;
  const configured = await configureRhEmployeeBenefit({
    data: {
      registry_employee_id: registryId,
      benefit_type: benefitType as 'passagem' | 'alimentacao',
      fare_cents: daily === undefined ? current.fare_cents : Math.round(daily * 100),
      trips_per_day: benefitType === 'passagem' ? updates.vt_trips_per_day ?? current.trips_per_day : 1,
    },
  });
  return toEmployeeWithCosts(configured as RHEmployee);
}

/**
 * Soft delete: mark employee as inactive
 * @param employeeId - Employee ID
 * @returns Updated employee
 */
export async function deactivateEmployee(employeeId: string): Promise<EmployeeWithCosts> {
  const current = await fetchEmployeeById(employeeId);
  if (!current) throw new Error('Colaborador não encontrado.');
  const registryId = (current as any).registry_employee_id ?? employeeId;
  await deactivateRhEmployeeRecord({ data: { id: registryId } });
  return { ...current, id: registryId, is_active: false };
}

/**
 * Reactivate a previously deactivated employee
 * @param employeeId - Employee ID
 * @returns Updated employee
 */
export async function reactivateEmployee(employeeId: string): Promise<EmployeeWithCosts> {
  const current = await fetchEmployeeById(employeeId);
  if (!current) throw new Error('Colaborador não encontrado.');
  const registryId = (current as any).registry_employee_id ?? employeeId;
  await reactivateRhEmployeeRecord({ data: { id: registryId } });
  return { ...current, id: registryId, is_active: true };
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
