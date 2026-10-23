/**
 * Converte horários de jornada para minutos.
 * - Valores TIME do banco (HH:mm[:ss]) são horários locais da escala.
 * - Timestamps de marcação são instantes absolutos e devem ser exibidos no
 *   fuso de Brasília antes de calcular atrasos, saída antecipada e horas extras.
 */
export function minutesFromTime(value: string | null | undefined): number | null {
  if (!value) return null;

  const plainTime = value.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/);
  if (plainTime) return Number(plainTime[1]) * 60 + Number(plainTime[2]);

  if (!/[T ]/.test(value)) return null;
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(timestamp);
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;
  if (hour == null || minute == null) return null;
  return Number(hour) * 60 + Number(minute);
}
