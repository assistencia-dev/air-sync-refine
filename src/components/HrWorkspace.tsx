import { useMemo, useState } from "react";
import { IdCard, Landmark, Utensils, WalletCards } from "lucide-react";
import { RhBenefitPanel } from "@/components/RhBenefitPanel";
import { RhEmployeeRegistry } from "@/components/RhEmployeeRegistry";
import pontoHtml from "@/assets/DBS_AIR_Ponto_v5_0_Maximo.html?raw";

export const VALE_PASSAGEM_URL = "https://valepassagem-d8edi3fl.manus.space";
type HrSection = "ponto" | "passagem" | "alimentacao" | "cadastro";

function buildPontoDocument(html: string) {
  const bootstrap = `<script>(function(){function openRh(){var l=document.getElementById('view-login');if(l)l.style.display='none';var rh=document.getElementById('view-rh');if(rh){rh.classList.remove('hidden');rh.style.display='block'}if(typeof mudarModuloRH==='function')mudarModuloRH('dashboard');if(window.lucide)window.lucide.createIcons()}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',openRh);else openRh();})();</script>`;
  return html.replace("</head>", `${bootstrap}</head>`);
}

export function HrWorkspace({ embedded = false }: { embedded?: boolean }) {
  const [section, setSection] = useState<HrSection>("ponto");
  const srcDoc = useMemo(() => buildPontoDocument(pontoHtml), []);

  const tabs = [
    { key: "ponto" as const, label: "Folha de Ponto", icon: <Landmark className="h-4 w-4" /> },
    { key: "cadastro" as const, label: "Cadastro de Funcionários", icon: <IdCard className="h-4 w-4" /> },
    { key: "passagem" as const, label: "Vale Passagem", icon: <WalletCards className="h-4 w-4" /> },
    { key: "alimentacao" as const, label: "Vale Alimentação", icon: <Utensils className="h-4 w-4" /> },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[.2em] text-slate-400">Recursos Humanos</p>
          <h1 className="mt-1 text-xl font-black tracking-tight text-slate-900">RH · Gestão de Pessoas</h1>
          <p className="mt-1 text-xs text-slate-500">Gestor já autenticado pelo sistema principal. O acesso dos colaboradores é criado pelo RH.</p>
        </div>
        <nav className="flex flex-wrap gap-2" aria-label="Módulos de RH">
          {tabs.map((tab) => (
            <button key={tab.key} onClick={() => setSection(tab.key)} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition ${section === tab.key ? "bg-[#102b3b] text-white shadow-md" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
              {tab.icon}{tab.label}
            </button>
          ))}
        </nav>
      </div>

      {section === "ponto" && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-sm">
          <iframe title="DBS AIR PONTO v5.0" srcDoc={srcDoc} sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-downloads" className="block h-[calc(100vh-190px)] min-h-[720px] w-full border-0" />
        </div>
      )}
      {section === "cadastro" && <RhEmployeeRegistry />}
      {section === "alimentacao" && <RhBenefitPanel benefitType="alimentacao" />}
      {section === "passagem" && <RhBenefitPanel benefitType="passagem" />}
      {section !== "ponto" && embedded && <p className="text-center text-[11px] text-slate-400">Sessão única do RH · autenticação herdada do sistema principal.</p>}
    </div>
  );
}
