import { RhBenefitPanel } from "@/components/RhBenefitPanel";

/**
 * Vale Passagem usa o fluxo compartilhado de benefícios:
 * vínculo ao Cadastro Central, parâmetros de tarifa/viagens, recargas,
 * cobertura estimada e histórico. O cadastro do funcionário permanece no RH.
 */
export function TabValePassagem() {
  return <RhBenefitPanel benefitType="passagem" />;
}
