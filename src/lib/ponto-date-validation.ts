/**
 * Valida datas de trabalho no formato ISO (YYYY-MM-DD), incluindo a existência
 * real do dia no calendário. Evita aceitar datas como 2026-02-31.
 */
export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
