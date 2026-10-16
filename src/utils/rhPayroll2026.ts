/**
 * Motor fiscal mensal de folha — regras federais aplicáveis desde 01/2026.
 * Valores monetários recebidos e retornados em centavos inteiros.
 * A aplicação deve versionar as tabelas por competência e homologar rubricas.
 */
export function isValidCpf(value: unknown): boolean {
  const cpf = String(value ?? "").replace(/\D/g, "");
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  for (let length = 9; length <= 10; length++) {
    let sum = 0;
    for (let i = 0; i < length; i++) sum += Number(cpf[i]) * (length + 1 - i);
    let digit = (sum * 10) % 11;
    if (digit === 10) digit = 0;
    if (digit !== Number(cpf[length])) return false;
  }
  return true;
}

export function payrollInss2026(grossCents: number): number {
  const base = Math.max(0, Math.min(Math.trunc(grossCents), 847555));
  const bands: Array<[number, number]> = [
    [162100, 0.075], [290284, 0.09], [435427, 0.12], [847555, 0.14],
  ];
  let previous = 0;
  let total = 0;
  for (const [limit, rate] of bands) {
    total += Math.round(Math.max(0, Math.min(base, limit) - previous) * rate);
    previous = limit;
    if (base <= limit) break;
  }
  return Math.round(total);
}

export function payrollIrrf2026(grossCents: number, inssCents: number, dependents: number) {
  const legalBase = Math.max(0, grossCents - inssCents - Math.max(0, dependents) * 18959);
  const simplifiedBase = Math.max(0, grossCents - 60720);
  // O desconto simplificado substitui as deduções legais; seleciona-se a menor base.
  const baseCents = Math.min(legalBase, simplifiedBase);
  let taxCents = 0;
  if (baseCents > 466468) taxCents = baseCents * 0.275 - 90873;
  else if (baseCents > 375105) taxCents = baseCents * 0.225 - 67549;
  else if (baseCents > 282665) taxCents = baseCents * 0.15 - 39416;
  else if (baseCents > 242880) taxCents = baseCents * 0.075 - 18216;
  taxCents = Math.max(0, Math.round(taxCents));

  // Lei 15.270/2025: a redução usa rendimentos tributáveis mensais.
  let reductionCents = 0;
  if (grossCents <= 500000) reductionCents = Math.min(taxCents, 31289);
  else if (grossCents <= 735000) {
    reductionCents = Math.min(taxCents, Math.max(0, Math.round(97862 - 0.133145 * grossCents)));
  }
  return { taxCents: Math.max(0, taxCents - reductionCents), baseCents };
}


export function assertPayrollZeroHasJustification(grossCents: number, isActive: boolean, reason: unknown): void {
  if (isActive && grossCents === 0 && !String(reason ?? "").trim()) {
    throw new Error("Funcionário ativo com folha zerada sem motivo de afastamento cadastrado.");
  }
}


export function supportsMonthlyPayroll2026(contractType: unknown): boolean {
  const raw = String(contractType ?? "").trim();
  if (!raw) return false;
  const normalized = raw.toUpperCase().replace(/[ -]+/g, "_");
  return ["CLT", "APRENDIZ", "JOVEM_APRENDIZ"].includes(normalized);
}

export function payrollFgts2026(baseCents: number, contractType: unknown) {
  // Use the same normalization as the eligibility check so spelling variations
  // cannot accidentally apply the standard 8% rate to an apprentice.
  const normalized = String(contractType ?? "").trim().toUpperCase().replace(/[ -]+/g, "_");
  const rate = ["APRENDIZ", "JOVEM_APRENDIZ"].includes(normalized) ? 0.02 : 0.08;
  const baseCentsSafe = Math.max(0, Math.trunc(Number.isFinite(baseCents) ? baseCents : 0));
  return { baseCents: baseCentsSafe, amountCents: Math.round(baseCentsSafe * rate), rate };
}


export type PayrollRubric2026 = {
  description?: string;
  amount_cents: number;
  incidences: { inss: boolean; irrf: boolean; fgts: boolean };
};

export function calculatePayrollBases2026(
  salaryCents: number,
  rubrics: PayrollRubric2026[],
  legacyProventosCents = 0,
) {
  const salary = Math.trunc(Number(salaryCents));
  if (!Number.isFinite(salary) || salary < 0) throw new Error("Salário-base inválido.");
  if (legacyProventosCents > 0 && rubrics.length === 0) {
    throw new Error("Existem proventos sem rubricas e incidências fiscais cadastradas. Cadastre cada rubrica com incidências de INSS, IRRF e FGTS antes de calcular a folha; nenhum cálculo foi presumido.");
  }
  let totalProventos = 0, inssBase = salary, irrfTaxable = salary, fgtsBase = salary;
  for (const rubric of rubrics) {
    const amount = Number(rubric.amount_cents);
    if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("Valor inválido em rubrica de folha.");
    if (!rubric.incidences || typeof rubric.incidences.inss !== "boolean" ||
      typeof rubric.incidences.irrf !== "boolean" || typeof rubric.incidences.fgts !== "boolean") {
      throw new Error("Cada rubrica precisa definir explicitamente as incidências de INSS, IRRF e FGTS.");
    }
    totalProventos += amount;
    if (rubric.incidences.inss) inssBase += amount;
    if (rubric.incidences.irrf) irrfTaxable += amount;
    if (rubric.incidences.fgts) fgtsBase += amount;
  }
  if (legacyProventosCents > 0 && rubrics.length > 0) {
    throw new Error("Há proventos antigos e rubricas detalhadas simultaneamente. Migre os valores para as rubricas para evitar duplicidade.");
  }
  return { salaryCents: salary, proventosCents: totalProventos, grossCents: salary + totalProventos,
    inssBaseCents: inssBase, irrfTaxableCents: irrfTaxable, fgtsBaseCents: fgtsBase };
}
