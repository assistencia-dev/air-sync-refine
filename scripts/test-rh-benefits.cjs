const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const assert = require("node:assert/strict");

const calendarSource = fs.readFileSync("src/utils/rhBenefitCalendar.ts", "utf8");
const panel = fs.readFileSync("src/components/RhBenefitPanel.tsx", "utf8");
const rhFunctions = fs.readFileSync("src/lib/rh.functions.ts", "utf8");
const vtTab = fs.readFileSync("src/routes/admin/rh-dashboard/TabValePassagem.tsx", "utf8");
const vaTab = fs.readFileSync("src/routes/admin/rh-dashboard/TabValeAlimentacao.tsx", "utf8");
const employeeRegistry = fs.readFileSync("src/components/RhEmployeeRegistry.tsx", "utf8");

assert.match(vtTab, /RhBenefitPanel benefitType="passagem"/);
assert.match(vaTab, /RhBenefitPanel benefitType="alimentacao"/);
assert.match(panel, /Vincular do cadastro/);
assert.match(panel, /listRhEmployeeRegistryForBenefits/);
assert.match(panel, /configureRhEmployeeBenefit/);
assert.match(panel, /createRhTopup/);
assert.match(panel, /updateRhTopup/);
assert.match(panel, /listRhTopups/);
assert.match(panel, /Últimos 30 dias/);
assert.match(panel, /Histórico completo/);
assert.match(panel, /Projeção mensal/);
assert.match(panel, /Investido no período/);
assert.match(panel, /Acumulado geral/);
assert.match(panel, /buildCoverage/);
assert.match(panel, /benefitType === "passagem" \? Math\.max\(1, Number\(employee\.trips_per_day\)/);
assert.match(panel, /"VA: o valor diário configurado multiplicado pelos dias úteis de cobertura\."/);

assert.match(rhFunctions, /function isValidBenefitDate/);
assert.match(rhFunctions, /function validateBenefit/);
assert.match(rhFunctions, /const isCentralRegistry = Boolean\(registry\)/);
assert.match(rhFunctions, /Cadastros auxiliares de benefício não podem ser reutilizados/);
assert.match(rhFunctions, /O funcionário está inativo no Cadastro de Funcionários/);
assert.match(rhFunctions, /O benefício não está vinculado ao Cadastro Central/);
assert.match(rhFunctions, /BENEFICIO_CREDITO_REGISTRADO/);
assert.match(rhFunctions, /BENEFICIO_RECARGA_EDITADA/);
assert.match(employeeRegistry, /saveRhEmployeeRecord/);
assert.match(employeeRegistry, /Esta é a ficha mestre/);
assert.doesNotMatch(vtTab + vaTab, /saveRhEmployeeRecord|createRhEmployee/);
assert.doesNotMatch(panel, /saveRhEmployeeRecord|createRhEmployee/);

const sandbox = { exports: {} };
const compiled = ts.transpileModule(calendarSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
vm.runInNewContext(compiled, sandbox);
const {
  easterSunday,
  isBusinessDayRio,
  addBusinessDaysRio,
  businessDaysRemainingRio,
  businessDaysInRioDeJaneiroMonthFor,
} = sandbox.exports;
const easter2026 = easterSunday(2026);
assert.equal(easter2026.getFullYear(), 2026);
assert.equal(easter2026.getMonth(), 3);
assert.equal(easter2026.getDate(), 5);
assert.equal(isBusinessDayRio("2026-04-03"), false, "Good Friday must be excluded.");
assert.equal(isBusinessDayRio("2026-04-21"), false, "Tiradentes must be excluded.");
assert.equal(isBusinessDayRio("2026-04-23"), false, "São Jorge must be excluded.");
assert.equal(isBusinessDayRio("2026-04-06"), true);
const nextAfterGoodFriday = addBusinessDaysRio("2026-04-02", 1);
assert.equal(nextAfterGoodFriday.getFullYear(), 2026);
assert.equal(nextAfterGoodFriday.getMonth(), 3);
assert.equal(nextAfterGoodFriday.getDate(), 6);
assert.equal(businessDaysRemainingRio("2026-04-06", "2026-04-02"), 2);
assert.equal(businessDaysInRioDeJaneiroMonthFor(2026, 4), 19);

console.log("RH benefits: shared VT/VA workflow, central registry guards, audited top-ups and Rio business-day calendar passed.");
