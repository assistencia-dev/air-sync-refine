import assert from "node:assert/strict";
import { isValidIsoDate } from "../src/lib/ponto-date-validation";

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
