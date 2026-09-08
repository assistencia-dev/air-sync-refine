/**
 * Benefit Calculations Module
 * Handles all business logic for Vale Passagem (VT) and Vale Alimentação (VA).
 *
 * Supports:
 * - Recharge durability estimation (how many days a topup lasts)
 * - Daily cost calculations per employee
 * - Monthly benefit requirement totals
 * - Batch allocation across multiple employees
 *
 * All calculations use Rio de Janeiro business day calendar.
 */

import { countRJBusinessDays, countBusinessDaysBetween } from './rjHolidays';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface EmployeeBenefitConfig {
  employeeId: string;
  fullName: string;
  /** Vale Transporte: cost per trip unit (e.g., 4.30 BRL from BUI tariff) */
  vt_tariff_unit: number;
  /** Vale Transporte: trips per working day (e.g., 2 or 4) */
  vt_trips_per_day: number;
  /** Vale Alimentação: daily allowance (e.g., 35.00 BRL) */
  va_daily_rate: number;
  /** Work schedule pattern: '5x2' (Mon-Fri), '6x1' (Mon-Sat), '12x36' */
  work_schedule: string;
}

export interface DailyCosts {
  vt_daily_cost: number; // in BRL
  va_daily_cost: number; // in BRL
  vt_daily_cost_cents: number; // in cents (for DB storage)
  va_daily_cost_cents: number; // in cents (for DB storage)
}

export interface MonthlyCosts {
  year: number;
  month: number;
  business_days: number;
  vt_monthly_requirement: number; // total BRL needed for month
  va_monthly_requirement: number; // total BRL needed for month
  combined_monthly_requirement: number; // VT + VA total
}

export interface RechargeDurability {
  recharge_amount_brl: number;
  benefit_type: 'VT' | 'VA'; // Vale Transporte or Vale Alimentação
  daily_cost: number;
  estimated_duration_days: number;
  coverage_until_date: string; // ISO 8601 date when recharge is exhausted
}

export interface BatchAllocationResult {
  benefit_type: 'VT' | 'VA';
  month: number;
  year: number;
  employees: {
    employeeId: string;
    fullName: string;
    daily_cost: number;
    business_days: number;
    monthly_required: number;
    allocation_recommendation: number; // suggested topup amount in BRL
  }[];
  total_allocation_required: number; // sum of all employee requirements
  total_employees_covered: number;
}

// ============================================================================
// DAILY COST CALCULATIONS
// ============================================================================

/**
 * Calculate daily costs (VT and VA) for an employee
 * @param config - Employee benefit configuration
 * @returns DailyCosts object with BRL and cents representations
 */
export function calculateDailyCosts(config: EmployeeBenefitConfig): DailyCosts {
  const vt_daily_cost = config.vt_tariff_unit * config.vt_trips_per_day;
  const va_daily_cost = config.va_daily_rate;

  return {
    vt_daily_cost,
    va_daily_cost,
    vt_daily_cost_cents: Math.floor(vt_daily_cost * 100),
    va_daily_cost_cents: Math.floor(va_daily_cost * 100),
  };
}

// ============================================================================
// MONTHLY REQUIREMENT CALCULATIONS
// ============================================================================

/**
 * Calculate total monthly benefit requirements for a single employee
 * @param config - Employee benefit configuration
 * @param year - Calendar year
 * @param month - Month number (1-12)
 * @returns MonthlyCosts breakdown for the month
 */
export function calculateMonthlyCosts(
  config: EmployeeBenefitConfig,
  year: number,
  month: number
): MonthlyCosts {
  const business_days = countRJBusinessDays(year, month, config.work_schedule);
  const { vt_daily_cost, va_daily_cost } = calculateDailyCosts(config);

  return {
    year,
    month,
    business_days,
    vt_monthly_requirement: vt_daily_cost * business_days,
    va_monthly_requirement: va_daily_cost * business_days,
    combined_monthly_requirement: (vt_daily_cost + va_daily_cost) * business_days,
  };
}

/**
 * Calculate total company spending for a benefit type across all employees for a month
 * @param employees - Array of employee configurations
 * @param benefitType - 'VT' or 'VA'
 * @param year - Calendar year
 * @param month - Month number (1-12)
 * @returns Total spending in BRL
 */
export function calculateCompanyMonthlySpending(
  employees: EmployeeBenefitConfig[],
  benefitType: 'VT' | 'VA',
  year: number,
  month: number
): number {
  return employees.reduce((total, emp) => {
    const monthly = calculateMonthlyCosts(emp, year, month);
    const cost = benefitType === 'VT' ? monthly.vt_monthly_requirement : monthly.va_monthly_requirement;
    return total + cost;
  }, 0);
}

// ============================================================================
// RECHARGE DURABILITY ESTIMATION
// ============================================================================

/**
 * Estimate how long a recharge (topup) will last for an employee
 * Formula: durationInDays = Math.floor(rechargeAmount / dailyCost)
 *
 * @param config - Employee benefit configuration
 * @param rechargeAmountBrl - Topup amount in BRL
 * @param benefitType - 'VT' or 'VA'
 * @param startDate - Date when recharge is applied (ISO 8601 or Date)
 * @returns RechargeDurability with estimated coverage end date
 */
export function estimateRechargeDurability(
  config: EmployeeBenefitConfig,
  rechargeAmountBrl: number,
  benefitType: 'VT' | 'VA',
  startDate: string | Date = new Date()
): RechargeDurability {
  const { vt_daily_cost, va_daily_cost } = calculateDailyCosts(config);
  const daily_cost = benefitType === 'VT' ? vt_daily_cost : va_daily_cost;

  const estimated_duration_days = Math.floor(rechargeAmountBrl / daily_cost);

  // Calculate coverage end date by counting business days (respecting RJ calendar)
  let coverageDate = typeof startDate === 'string' ? new Date(startDate) : startDate;
  let daysRemaining = estimated_duration_days;

  while (daysRemaining > 0) {
    coverageDate.setDate(coverageDate.getDate() + 1);
    const dayOfWeek = coverageDate.getDay();

    // Respect work schedule when counting days
    if (config.work_schedule === '5x2' && dayOfWeek >= 1 && dayOfWeek <= 5) {
      daysRemaining--;
    } else if (config.work_schedule === '6x1' && dayOfWeek >= 1 && dayOfWeek <= 6) {
      daysRemaining--;
    } else if (config.work_schedule === '12x36' && dayOfWeek >= 1 && dayOfWeek <= 5) {
      // 12x36: every other day (simplified)
      daysRemaining -= 0.5;
    }
  }

  return {
    recharge_amount_brl: rechargeAmountBrl,
    benefit_type: benefitType,
    daily_cost,
    estimated_duration_days,
    coverage_until_date: coverageDate.toISOString().split('T')[0],
  };
}

/**
 * Estimate recharge amount needed to cover a specific number of days
 * Inverse of durability estimation.
 *
 * @param config - Employee benefit configuration
 * @param daysToC over - Number of business days to cover
 * @param benefitType - 'VT' or 'VA'
 * @returns Recommended recharge amount in BRL (rounded up to nearest 0.01)
 */
export function estimateRechargeSizeForDays(
  config: EmployeeBenefitConfig,
  daysToCover: number,
  benefitType: 'VT' | 'VA'
): number {
  const { vt_daily_cost, va_daily_cost } = calculateDailyCosts(config);
  const daily_cost = benefitType === 'VT' ? vt_daily_cost : va_daily_cost;
  return Math.ceil((daily_cost * daysToCover) * 100) / 100; // Round up to nearest 0.01
}

// ============================================================================
// BATCH ALLOCATION & PLANNING
// ============================================================================

/**
 * Plan benefit allocation for a month across multiple employees
 * Used for budgeting and recharge batch requests.
 *
 * @param employees - Array of employee configurations
 * @param benefitType - 'VT' or 'VA'
 * @param year - Calendar year
 * @param month - Month number (1-12)
 * @returns BatchAllocationResult with per-employee breakdown and totals
 */
export function planBatchAllocation(
  employees: EmployeeBenefitConfig[],
  benefitType: 'VT' | 'VA',
  year: number,
  month: number
): BatchAllocationResult {
  const employeeResults = employees.map((emp) => {
    const monthly = calculateMonthlyCosts(emp, year, month);
    const monthlyRequired = benefitType === 'VT' ? monthly.vt_monthly_requirement : monthly.va_monthly_requirement;

    return {
      employeeId: emp.employeeId,
      fullName: emp.fullName,
      daily_cost: benefitType === 'VT' ? monthly.vt_monthly_requirement / monthly.business_days : monthly.va_monthly_requirement / monthly.business_days,
      business_days: monthly.business_days,
      monthly_required: monthlyRequired,
      allocation_recommendation: monthlyRequired, // 1:1 allocation for exact needs
    };
  });

  const total_allocation_required = employeeResults.reduce((sum, emp) => sum + emp.allocation_recommendation, 0);

  return {
    benefit_type: benefitType,
    month,
    year,
    employees: employeeResults,
    total_allocation_required,
    total_employees_covered: employees.length,
  };
}

/**
 * Generate allocation variance report (useful for budget variance analysis)
 * Compares actual spend vs. allocated amount.
 *
 * @param allocation - BatchAllocationResult from planBatchAllocation()
 * @param actualSpend - Total actual spending in BRL
 * @returns Variance summary and per-employee variances
 */
export function calculateAllocationVariance(allocation: BatchAllocationResult, actualSpend: number) {
  const budgeted = allocation.total_allocation_required;
  const variance = actualSpend - budgeted;
  const variancePercent = ((variance / budgeted) * 100).toFixed(2);

  return {
    budgeted,
    actual_spend: actualSpend,
    variance,
    variance_percent: parseFloat(variancePercent),
    status: actualSpend <= budgeted ? 'UNDER_BUDGET' : 'OVER_BUDGET',
  };
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Format currency value for display (BRL)
 * @param amount - Amount in BRL
 * @param precision - Decimal places (default: 2)
 * @returns Formatted string: "R$ 1.234,56"
 */
export function formatCurrencyBRL(amount: number, precision: number = 2): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  }).format(amount);
}

/**
 * Parse currency string (BRL) back to number
 * @param formatted - Formatted string: "R$ 1.234,56"
 * @returns Amount in BRL as number
 */
export function parseCurrencyBRL(formatted: string): number {
  return parseFloat(formatted.replace(/[^\d,-]/g, '').replace('.', '').replace(',', '.'));
}

/**
 * Get month name in Portuguese
 * @param month - Month number (1-12)
 * @param short - If true, return 3-letter abbreviation
 * @returns Month name
 */
export function getMonthNamePT(month: number, short: boolean = false): string {
  const months = [
    'Janeiro',
    'Fevereiro',
    'Março',
    'Abril',
    'Maio',
    'Junho',
    'Julho',
    'Agosto',
    'Setembro',
    'Outubro',
    'Novembro',
    'Dezembro',
  ];
  const monthName = months[month - 1];
  return short ? monthName.substring(0, 3) : monthName;
}

/**
 * Validate employee benefit configuration
 * @param config - Configuration to validate
 * @returns Array of error messages (empty if valid)
 */
export function validateEmployeeConfig(config: EmployeeBenefitConfig): string[] {
  const errors: string[] = [];

  if (!config.employeeId) errors.push('employeeId is required');
  if (!config.fullName) errors.push('fullName is required');
  if (config.vt_tariff_unit <= 0) errors.push('vt_tariff_unit must be > 0');
  if (config.vt_trips_per_day <= 0) errors.push('vt_trips_per_day must be > 0');
  if (config.va_daily_rate <= 0) errors.push('va_daily_rate must be > 0');
  if (!['5x2', '6x1', '12x36'].includes(config.work_schedule)) {
    errors.push('work_schedule must be one of: 5x2, 6x1, 12x36');
  }

  return errors;
}
