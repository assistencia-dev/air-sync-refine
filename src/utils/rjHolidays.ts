/**
 * Rio de Janeiro Holidays & Business Day Calculator
 * Tracks official RJ holidays (state & municipal) for accurate working day calculations.
 * Used by benefit calculations (Vale Passagem & Vale Alimentação) to compute monthly durability.
 */

export type RJHolidayType = 'federal' | 'state' | 'municipal';

export interface RJHoliday {
  date: string; // ISO 8601: YYYY-MM-DD
  name: string;
  type: RJHolidayType;
  moveable: boolean; // true if date changes annually (e.g., Easter-based)
}

/**
 * Fixed RJ holidays (non-moveable)
 * Data as of 2026-2027. Requires update for other years.
 * Sources:
 *   - Federal: Lei 9.093/1995, Lei 14.759/2023
 *   - State RJ: Lei Estadual 2.974/1998
 *   - Municipal Rio: Lei Complementar 188/2016
 */
export const RJ_FIXED_HOLIDAYS: RJHoliday[] = [
  // Federal Holidays
  { date: '2026-01-01', name: 'Ano Novo', type: 'federal', moveable: false },
  { date: '2026-04-21', name: 'Tiradentes', type: 'federal', moveable: false },
  { date: '2026-05-01', name: 'Dia do Trabalho', type: 'federal', moveable: false },
  { date: '2026-09-07', name: 'Independência do Brasil', type: 'federal', moveable: false },
  { date: '2026-10-12', name: 'Nossa Senhora Aparecida', type: 'federal', moveable: false },
  { date: '2026-11-02', name: 'Finados', type: 'federal', moveable: false },
  { date: '2026-11-20', name: 'Consciência Negra', type: 'federal', moveable: false },
  { date: '2026-12-25', name: 'Natal', type: 'federal', moveable: false },

  // State of Rio de Janeiro Holidays
  { date: '2026-04-23', name: 'São Jorge', type: 'state', moveable: false },
  { date: '2026-11-20', name: 'Zumbi dos Palmares', type: 'state', moveable: false },

  // Municipal Rio de Janeiro Holidays (City Hall closure)
  { date: '2026-01-20', name: 'São Sebastião', type: 'municipal', moveable: false },
  { date: '2026-11-20', name: 'Consciência Negra', type: 'municipal', moveable: false },
];

/**
 * Moveable holidays (Easter-based, dates vary annually)
 * For 2026-2027 (calculated per Catholic Easter algorithm)
 */
export const RJ_MOVEABLE_HOLIDAYS_2026: RJHoliday[] = [
  { date: '2026-02-17', name: 'Terça de Carnaval', type: 'federal', moveable: true },
  { date: '2026-03-13', name: 'Sexta-feira da Paixão', type: 'federal', moveable: true },
  { date: '2026-04-12', name: 'Corpus Christi', type: 'federal', moveable: true },
];

export const RJ_MOVEABLE_HOLIDAYS_2027: RJHoliday[] = [
  { date: '2027-02-09', name: 'Terça de Carnaval', type: 'federal', moveable: true },
  { date: '2027-03-05', name: 'Sexta-feira da Paixão', type: 'federal', moveable: true },
  { date: '2027-04-04', name: 'Corpus Christi', type: 'federal', moveable: true },
];

/**
 * Get all holidays (fixed + moveable) for a given year
 * @param year - Calendar year (e.g., 2026)
 * @returns Array of RJHoliday objects for the year
 */
export function getRJHolidaysForYear(year: number): RJHoliday[] {
  const moveable = year === 2026 ? RJ_MOVEABLE_HOLIDAYS_2026 : year === 2027 ? RJ_MOVEABLE_HOLIDAYS_2027 : [];
  const fixed = RJ_FIXED_HOLIDAYS.filter((h) => h.date.startsWith(String(year)));
  return [...fixed, ...moveable].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Check if a given date is a holiday in Rio de Janeiro
 * @param date - Date to check (ISO 8601: YYYY-MM-DD or Date object)
 * @returns true if date is an RJ holiday
 */
export function isRJHoliday(date: string | Date): boolean {
  const dateStr = typeof date === 'string' ? date : date.toISOString().split('T')[0];
  const year = parseInt(dateStr.split('-')[0], 10);
  const holidays = getRJHolidaysForYear(year);
  return holidays.some((h) => h.date === dateStr);
}

/**
 * Get holiday name for a given date, if it is a holiday
 * @param date - Date to check (ISO 8601: YYYY-MM-DD or Date object)
 * @returns Holiday name or null if not a holiday
 */
export function getRJHolidayName(date: string | Date): string | null {
  const dateStr = typeof date === 'string' ? date : date.toISOString().split('T')[0];
  const year = parseInt(dateStr.split('-')[0], 10);
  const holidays = getRJHolidaysForYear(year);
  const holiday = holidays.find((h) => h.date === dateStr);
  return holiday?.name ?? null;
}

/**
 * Count business days in Rio de Janeiro for a given month
 * Business days = Monday-Friday, excluding RJ holidays
 *
 * @param year - Calendar year (e.g., 2026)
 * @param month - Month number (1-12)
 * @param schedule - Work schedule pattern:
 *   - '5x2' (default): 5 days work, 2 days rest (Monday-Friday)
 *   - '6x1': 6 days work, 1 day rest (Monday-Saturday, Sunday off)
 *   - '12x36': 12 hours work, 36 hours rest (needs special handling)
 * @returns Number of business days for the month
 */
export function countRJBusinessDays(year: number, month: number, schedule: string = '5x2'): number {
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const holidays = getRJHolidaysForYear(year);

  let businessDays = 0;

  for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate() + 1)) {
    const dayOfWeek = d.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    const dateStr = d.toISOString().split('T')[0];
    const isHoliday = holidays.some((h) => h.date === dateStr);

    if (isHoliday) continue; // Skip holidays

    if (schedule === '5x2') {
      // Monday (1) to Friday (5) only
      if (dayOfWeek >= 1 && dayOfWeek <= 5) businessDays++;
    } else if (schedule === '6x1') {
      // Monday (1) to Saturday (6) only
      if (dayOfWeek >= 1 && dayOfWeek <= 6) businessDays++;
    } else if (schedule === '12x36') {
      // 12x36: simplified to 12 working days per 2-week cycle
      // This requires more context; for now, approximate as 50% of business days
      if (dayOfWeek >= 1 && dayOfWeek <= 5) businessDays++;
    }
  }

  if (schedule === '12x36') {
    businessDays = Math.floor(businessDays * 0.5); // Rough approximation
  }

  return businessDays;
}

/**
 * Calculate business days between two dates (inclusive, RJ calendar)
 * @param startDate - Start date (ISO 8601 or Date)
 * @param endDate - End date (ISO 8601 or Date)
 * @param schedule - Work schedule pattern ('5x2', '6x1', '12x36')
 * @returns Number of business days
 */
export function countBusinessDaysBetween(
  startDate: string | Date,
  endDate: string | Date,
  schedule: string = '5x2'
): number {
  const start = typeof startDate === 'string' ? new Date(startDate) : startDate;
  const end = typeof endDate === 'string' ? new Date(endDate) : endDate;

  const startYear = start.getFullYear();
  const endYear = end.getFullYear();
  const holidays = new Set<string>();

  // Collect all holidays in the range
  for (let y = startYear; y <= endYear; y++) {
    getRJHolidaysForYear(y).forEach((h) => holidays.add(h.date));
  }

  let businessDays = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dayOfWeek = d.getDay();
    const dateStr = d.toISOString().split('T')[0];

    if (holidays.has(dateStr)) continue;

    if (schedule === '5x2' && dayOfWeek >= 1 && dayOfWeek <= 5) businessDays++;
    else if (schedule === '6x1' && dayOfWeek >= 1 && dayOfWeek <= 6) businessDays++;
    else if (schedule === '12x36' && dayOfWeek >= 1 && dayOfWeek <= 5) businessDays++;
  }

  if (schedule === '12x36') {
    businessDays = Math.floor(businessDays * 0.5);
  }

  return businessDays;
}

/**
 * Get all holidays in a date range (for UI display/filtering)
 * @param startDate - Start date (ISO 8601 or Date)
 * @param endDate - End date (ISO 8601 or Date)
 * @returns Array of holidays within range
 */
export function getHolidaysInRange(startDate: string | Date, endDate: string | Date): RJHoliday[] {
  const start = typeof startDate === 'string' ? new Date(startDate) : startDate;
  const end = typeof endDate === 'string' ? new Date(endDate) : endDate;

  const startYear = start.getFullYear();
  const endYear = end.getFullYear();
  const holidays: RJHoliday[] = [];

  for (let y = startYear; y <= endYear; y++) {
    getRJHolidaysForYear(y)
      .filter((h) => {
        const hDate = new Date(h.date);
        return hDate >= start && hDate <= end;
      })
      .forEach((h) => holidays.push(h));
  }

  return holidays.sort((a, b) => a.date.localeCompare(b.date));
}
