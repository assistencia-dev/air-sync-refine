import { describe, expect, test } from "bun:test";
import { assertPayrollZeroHasJustification, isValidCpf, payrollInss2026, payrollIrrf2026 } from "../src/utils/rhPayroll2026";

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
