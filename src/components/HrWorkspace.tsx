import { useState } from "react";
import { IdCard, Utensils, WalletCards, Clock3, Shield } from "lucide-react";
import { RhBenefitPanel } from "@/components/RhBenefitPanel";
import { RhEmployeeRegistry } from "@/components/RhEmployeeRegistry";
import { RhPontoWorkspace } from "@/components/RhPontoWorkspace";

export const VALE_PASSAGEM_URL = "https://valepassagem-d8edi3fl.manus.space";

type HrSection = "ponto" | "passagem" | "alimentacao" | "cadastro";

/**
 * Área de trabalho do RH.
 * O módulo usa a sessão já autenticada do portal; não existe login/usuário ADM separado.
 */
export function HrWorkspace({ embedded = false }: { embedded?: boolean }) {
  const [section, setSection] = useState<HrSection>("ponto");

  const tabs: { key: HrSection; label: string; icon: React.ReactNode; active: string }[] = [
    { key: "ponto", label: "Folha de Ponto", icon: <Clock3 className="h-4 w-4" />, active: "bg-sky-600 text-white shadow-md" },
    { key: "cadastro", label: "Cadastro de Funcionários", icon: <IdCard className="h-4 w-4" />, active: "bg-[#F59E0B] text-white shadow-md" },
    { key: "passagem", label: "Vale Passagem", icon: <WalletCards className="h-4 w-4" />, active: "bg-[#0F172A] text-white shadow-md" },
    { key: "alimentacao", label: "Vale Alimentação", icon: <Utensils className="h-4 w-4" />, active: "bg-[#F59E0B] text-[#102b3b] shadow-md" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-800 bg-[#1E293B] p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[.2em] text-slate-400">Área de trabalho</p>
          <h1 className="mt-1 text-xl font-black tracking-tight text-slate-50">RH — Benefícios e cadastro</h1>
          <p className="mt-1 text-xs text-slate-400">Cadastro central de colaboradores compartilhado pelas duas ferramentas de benefício.</p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <nav className="flex flex-wrap gap-2" aria-label="Módulos de RH">
            {tabs.map((t) => (
              <button key={t.key} onClick={() => setSection(t.key)} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition ${section === t.key ? t.active : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}>
                {t.icon} {t.label}
              </button>
            ))}
          </nav>
          {embedded && <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-300"><Shield className="h-3.5 w-3.5" /> Sessão única do RH</span>}
        </div>
      </div>

      {section === "ponto" && <RhPontoWorkspace />}
      {section === "cadastro" && <RhEmployeeRegistry />}
      {section === "alimentacao" && <RhBenefitPanel benefitType="alimentacao" />}
      {section === "passagem" && <RhBenefitPanel benefitType="passagem" />}
    </div>
  );
}
