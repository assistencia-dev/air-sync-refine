export const BRAZIL_BUSINESS_TIME_ZONE = "America/Sao_Paulo";

/** Returns the operational calendar date in the company's official timezone. */
export function brazilBusinessDateKey(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BRAZIL_BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return value("year") + "-" + value("month") + "-" + value("day");
}

function parseDateKey(value: string): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ""));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const stamp = Date.UTC(year, month - 1, day);
  const checked = new Date(stamp);
  if (
    checked.getUTCFullYear() !== year
    || checked.getUTCMonth() + 1 !== month
    || checked.getUTCDate() !== day
  ) return null;
  return [year, month, day];
}

/** Adds calendar days to an ISO date without relying on the host machine's timezone. */
export function addBrazilCalendarDays(dateKey: string, offset: number): string {
  const parsed = parseDateKey(dateKey);
  if (!parsed || !Number.isInteger(offset)) throw new Error("Data ou deslocamento inválido.");
  const shifted = new Date(Date.UTC(parsed[0], parsed[1] - 1, parsed[2] + offset));
  return shifted.toISOString().slice(0, 10);
}

/** Difference in whole calendar days (to minus from), both in YYYY-MM-DD form. */
export function differenceInBrazilCalendarDays(from: string, to: string): number {
  const start = parseDateKey(from);
  const end = parseDateKey(to);
  if (!start || !end) throw new Error("Data inválida para comparação.");
  const startUtc = Date.UTC(start[0], start[1] - 1, start[2]);
  const endUtc = Date.UTC(end[0], end[1] - 1, end[2]);
  return Math.round((endUtc - startUtc) / 86_400_000);
}
