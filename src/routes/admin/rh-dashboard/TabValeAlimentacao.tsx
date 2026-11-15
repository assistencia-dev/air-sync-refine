import { RhBenefitPanel } from "@/components/RhBenefitPanel";

/**
 * Vale Alimentação usa o mesmo ciclo operacional do VT, com cálculo próprio:
 * valor diário por dia útil, sem tarifa por viagem ou quantidade de viagens.
 * O cadastro do funcionário permanece no RH.
 */
export function TabValeAlimentacao() {
  return <RhBenefitPanel benefitType="alimentacao" />;
}
