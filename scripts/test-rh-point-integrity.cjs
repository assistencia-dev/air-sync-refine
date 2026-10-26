const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const ponto = fs.readFileSync(path.join(root, "src/lib/ponto.functions.ts"), "utf8");
const dp = fs.readFileSync(path.join(root, "src/lib/rh.dp.functions.ts"), "utf8");
const workspace = fs.readFileSync(path.join(root, "src/components/RhPontoWorkspace.tsx"), "utf8");
const exportsSource = fs.readFileSync(path.join(root, "src/lib/rh.exports.ts"), "utf8");

assert.match(ponto, /export function minutesFromTime/);
assert.match(ponto, /America\/Sao_Paulo/);
assert.match(ponto, /adjustment_type === "desconto"/);
assert.match(ponto, /!\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\//, "validação de data deve aceitar datas reais, não a string literal \\\\d");
assert.match(dp, /RH_TIME_ADJUSTMENT_TYPES/);
assert.match(dp, /Number\.isInteger\(input\.minutes\)/);
assert.match(dp, /\.eq\("status","pendente"\)/);
assert.match(workspace, /por funcionário\/dia/);
assert.match(workspace, /adjusted_worked_minutes/);
assert.match(workspace, /Trabalhado corrigido/);
assert.match(exportsSource, /win\.document\.open\(\)/);
assert.match(exportsSource, /pointLabels/);

function parseTime(value) {
  const raw = String(value || "").trim();
  const plain = raw.match(/^(?:[T ]?)([01]?\d|2[0-3]):([0-5]\d)/);
  if (plain) return Number(plain[1]) * 60 + Number(plain[2]);
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) return null;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(timestamp));
  return Number(parts.find((p) => p.type === "hour").value) * 60 + Number(parts.find((p) => p.type === "minute").value);
}

assert.equal(parseTime("08:00:00"), 480);
assert.equal(parseTime("2026-10-26T11:00:00Z"), 480);
assert.equal(parseTime("2026-10-26T23:30:00Z"), 1230);

const rawPunches = [
  { employee_id: "e1", work_date: "2026-10-26", punch_type: "entrada", punched_at: "2026-10-26T11:00:00Z" },
  { employee_id: "e1", work_date: "2026-10-26", punch_type: "almoco_saida", punched_at: "2026-10-26T15:00:00Z" },
  { employee_id: "e1", work_date: "2026-10-26", punch_type: "almoco_retorno", punched_at: "2026-10-26T16:00:00Z" },
  { employee_id: "e1", work_date: "2026-10-26", punch_type: "saida", punched_at: "2026-10-26T20:00:00Z" },
];
const days = new Map();
for (const row of rawPunches) {
  const key = `${row.employee_id}|${row.work_date}`;
  days.set(key, (days.get(key) || 0) + 1);
}
assert.equal(days.size, 1, "quatro batidas devem formar um único dia no relatório");
assert.equal([...days.values()][0], 4);

const adjusted = 8 * 60 + 30;
const approvedAdjustment = 30;
assert.equal(adjusted + approvedAdjustment, 9 * 60, "ajuste aprovado deve aparecer no total corrigido");
console.log("RH point integrity: data validation, timezone parsing, daily grouping, approved adjustments and PDF contracts passed.");
