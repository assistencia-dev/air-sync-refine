import assert from "node:assert/strict";
import { isValidIsoDate } from "../src/lib/ponto-date-validation";
import { minutesFromTime } from "../src/lib/ponto-time-calculation";

const validDates = ["2026-10-13", "2024-02-29", "2000-02-29", "2026-01-01"];
const invalidDates: unknown[] = [
  "2026-02-31",
  "2026-04-31",
  "2025-02-29",
  "2026-13-01",
  "2026-00-10",
  "13/10/2026",
  "",
  null,
  undefined,
  20261013,
];

for (const value of validDates) {
  assert.equal(isValidIsoDate(value), true, `Data válida rejeitada: ${value}`);
}
for (const value of invalidDates) {
  assert.equal(isValidIsoDate(value), false, `Data inválida aceita: ${String(value)}`);
}

console.log(`RH ponto: ${validDates.length} datas válidas e ${invalidDates.length} entradas inválidas verificadas.`);

const timeCases: Array<[string, number]> = [
  ["08:00", 480],
  ["08:30:00", 510],
  ["17:45:59", 1065],
  // 12:00 UTC corresponde a 09:00 no horário de Brasília.
  ["2026-10-13T12:00:00.000Z", 540],
  ["2026-10-13T21:15:00.000Z", 1095],
];
for (const [value, expected] of timeCases) {
  assert.equal(minutesFromTime(value), expected, `Cálculo incorreto para ${value}`);
}
assert.equal(minutesFromTime("not-a-time"), null, "Horário inválido deve ser rejeitado");
assert.equal(minutesFromTime(null), null, "Horário ausente deve ser rejeitado");

console.log(`RH ponto: ${timeCases.length} cenários de horário e fuso verificados.`);
