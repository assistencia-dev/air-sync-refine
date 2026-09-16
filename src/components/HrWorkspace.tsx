import { useState } from "react";
import { IdCard, Utensils, WalletCards, Clock3, ShieldCheck } from "lucide-react";
import { RhBenefitPanel } from "@/components/RhBenefitPanel";
import { RhEmployeeRegistry } from "@/components/RhEmployeeRegistry";
import { RhPontoWorkspace } from "@/components/RhPontoWorkspace";

type HrSection = "ponto" | "passagem" | "alimentacao" | "cadastro";

export const VALE_PASSAGEM_URL = "https://valepassagem-d8edi3fl.manus.space";

/** RH usa a sessão já autenticada do portal. Não existe mais login/usuário ADM separado dentro do módulo. */
export function HrWorkspace({ embedded = false }: { embedded?: boolean }) {
  const [section, setSection] = useState<HrSection>("ponto");
  const tabs = [
    { key: "ponto" as const, label: "Folha de Ponto", icon: <Clock3 className="h-4 w-4" /> },
    { key: "cadastro" as const, label: "Cadastro de Funcionários", icon: <IdCard className="h-4 w-4" /> },
    { key: "passagem" as const, label: "Vale Passagem", icon: <WalletCards className="h-4 w-4" /> },
    { key: "alimentacao" as const, label: "Vale Alimentação", icon: <Utensils className="h-4 w-4" /> },
  ];
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-800 bg-[#1E293B] p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[.2em] text-slate-400">Área de trabalho</p>
          <h1 className="mt-1 text-xl font-black tracking-tight text-slate-50">RH — Gestão de Pessoas</h1>
          <p className="mt-1 text-xs text-slate-400">Cadastro, benefícios e jornada em uma única área, usando a sessão do RH.</p>
        </div>
        <nav className="flex flex-wrap gap-2" aria-label="Módulos de RH">
          {tabs.map(t => <button key={t.key} onClick={() => setSection(t.key)} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition ${section === t.key ? "bg-sky-600 text-white shadow-md" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}>{t.icon}{t.label}</button>)}
        </nav>
      </div>
      {embedded && <div className="flex items-center gap-2 text-[11px] font-bold text-emerald-600"><ShieldCheck className="h-3.5 w-3.5"/> Sessão única do RH ativa</div>}
      {section === "ponto" && <RhPontoWorkspace />}
      {section === "cadastro" && <RhEmployeeRegistry />}
      {section === "alimentacao" && <RhBenefitPanel benefitType="alimentacao" />}
      {section === "passagem" && <RhBenefitPanel benefitType="passagem" />}
    </div>
  );
}
