/**
 * Calendário operacional de benefícios do RH.
 * Regra alinhada ao sistema original de Vale Passagem anexado:
 * segunda a sexta, excluindo feriados oficiais do Rio de Janeiro.
 *
 * O mesmo calendário é usado para estimar VT e VA. O valor diário muda
 * conforme o benefício; a contagem de dias úteis permanece a mesma.
 */

function atLocalNoon(value: Date | string) {
  if (value instanceof Date) {
    const result = new Date(value);
    result.setHours(12, 0, 0, 0);
    return result;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const result = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0)
    : new Date(value);
  result.setHours(12, 0, 0, 0);
  return result;
}

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromLocalDate(year: number, month: number, day: number) {
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function addCalendarDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function easterSunday(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return fromLocalDate(year, month, day);
}

export function rioDeJaneiroHolidays(year: number) {
  const easter = easterSunday(year);
  const dates = [
    fromLocalDate(year, 1, 1),
    fromLocalDate(year, 1, 20),
    addCalendarDays(easter, -47),
    addCalendarDays(easter, -2),
    fromLocalDate(year, 4, 21),
    fromLocalDate(year, 4, 23),
    fromLocalDate(year, 5, 1),
    addCalendarDays(easter, 60),
    fromLocalDate(year, 9, 7),
    fromLocalDate(year, 10, 12),
    fromLocalDate(year, 11, 2),
    fromLocalDate(year, 11, 15),
    fromLocalDate(year, 11, 20),
    fromLocalDate(year, 12, 25),
  ];
  return new Set(dates.map(localDateKey));
}

export function isBusinessDayRio(date: Date | string) {
  const normalized = atLocalNoon(date);
  const weekday = normalized.getDay();
  return weekday !== 0 && weekday !== 6 && !rioDeJaneiroHolidays(normalized.getFullYear()).has(localDateKey(normalized));
}

export function addBusinessDaysRio(date: Date | string, days: number) {
  const result = atLocalNoon(date);
  let remaining = Math.max(0, Math.floor(days));
  let safety = 0;
  while (remaining > 0 && safety < 4000) {
    result.setDate(result.getDate() + 1);
    if (isBusinessDayRio(result)) remaining -= 1;
    safety += 1;
  }
  return result;
}

export function businessDaysRemainingRio(renewalDate: Date | string, reference: Date | string = new Date()) {
  const cursor = atLocalNoon(reference);
  const target = atLocalNoon(renewalDate);
  if (target <= cursor) return 0;
  let remaining = 0;
  while (cursor < target) {
    if (isBusinessDayRio(cursor)) remaining += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return remaining;
}

export function businessDaysInRioDeJaneiroMonth(reference = new Date()) {
  const year = reference.getFullYear();
  const month = reference.getMonth();
  const lastDay = new Date(year, month + 1, 0).getDate();
  let total = 0;
  for (let day = 1; day <= lastDay; day += 1) {
    if (isBusinessDayRio(new Date(year, month, day, 12, 0, 0, 0))) total += 1;
  }
  return total;
}

export function businessDaysInRioDeJaneiroMonthFor(year: number, month: number) {
  return businessDaysInRioDeJaneiroMonth(new Date(year, month - 1, 1, 12, 0, 0, 0));
}
