import { describe, expect, test } from "bun:test";
import { assertPayrollZeroHasJustification, isValidCpf, payrollFgts2026, payrollInss2026, payrollIrrf2026, supportsMonthlyPayroll2026 } from "../src/utils/rhPayroll2026";

describe("Motor fiscal da folha — tabelas 2026", () => {
  test("INSS progressivo no salário mínimo de 2026", () => {
    expect(payrollInss2026(162100)).toBe(12158);
  });

  test("INSS calcula as faixas fatiadas e respeita o teto", () => {
    expect(payrollInss2026(500000)).toBe(50152);
    expect(payrollInss2026(847555)).toBe(98810);
    expect(payrollInss2026(900000)).toBe(98810);
  });

  test("IRRF aplica dependente, dedução mais vantajosa e redução de 2026", () => {
    const inss = payrollInss2026(650000);
    expect(inss).toBe(71152);
    expect(payrollIrrf2026(650000, inss, 1)).toEqual({
      taxCents: 51778,
      baseCents: 559889,
    });
  });

  test("IRRF fica zerado para rendimento de R$ 4.000 após redução legal de 2026", () => {
    const inss = payrollInss2026(400000);
    expect(payrollIrrf2026(400000, inss, 0).taxCents).toBe(0);
  });

  test("motor mensal só aceita CLT e aprendizagem; bloqueia vínculos sem regra homologada", () => {
    expect(supportsMonthlyPayroll2026("CLT")).toBe(true);
    expect(supportsMonthlyPayroll2026("JOVEM APRENDIZ")).toBe(true);
    expect(supportsMonthlyPayroll2026("ESTÁGIO")).toBe(false);
    expect(supportsMonthlyPayroll2026("PJ")).toBe(false);
    expect(supportsMonthlyPayroll2026("INTERMITENTE")).toBe(false);
  });

  test("FGTS é encargo patronal de 8% ou 2% para aprendiz", () => {
    expect(payrollFgts2026(162100, "CLT")).toEqual({ baseCents: 162100, amountCents: 12968, rate: 0.08 });
    expect(payrollFgts2026(162100, "JOVEM_APRENDIZ")).toEqual({ baseCents: 162100, amountCents: 3242, rate: 0.02 });
  });

  test("valida CPF estrutural e dígitos verificadores", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCpf("")).toBe(false);
  });

  test("bloqueia folha zerada ativa sem justificativa e permite afastamento justificado", () => {
    expect(() => assertPayrollZeroHasJustification(0, true, "")).toThrow();
    expect(() => assertPayrollZeroHasJustification(0, true, "Licença maternidade")).not.toThrow();
    expect(() => assertPayrollZeroHasJustification(0, false, "")).not.toThrow();
  });
});
