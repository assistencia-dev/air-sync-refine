import { useMemo, useState } from "react";
import { IdCard, Landmark, Utensils, WalletCards } from "lucide-react";
import { RhBenefitPanel } from "@/components/RhBenefitPanel";
import { RhEmployeeRegistry } from "@/components/RhEmployeeRegistry";
import pontoHtml from "@/assets/DBS_AIR_Ponto_v5_0_Maximo.html?raw";

export const VALE_PASSAGEM_URL = "https://valepassagem-d8edi3fl.manus.space";
type HrSection = "ponto" | "passagem" | "alimentacao" | "cadastro";

function buildPontoDocument(html: string) {
  const bootstrap = `<style id="dbs-ponto-host-fix">html,body{width:100%!important;min-width:0!important;margin:0!important}body{overflow:hidden!important}#view-rh{width:100%!important;min-height:100dvh!important}#view-rh>main{width:100%!important;min-width:0!important;margin-left:0!important;padding-left:0!important}#view-rh .mobile-main{width:100%!important;max-width:none!important}#view-rh .sidebar{flex-shrink:0}@media(min-width:901px){#view-rh{display:flex!important;align-items:stretch!important}#view-rh>main{flex:1!important;min-width:0!important;overflow-y:auto!important;height:100dvh!important}#view-rh>main .mobile-main{max-width:none!important}}@media(max-width:900px){#view-rh>main{padding-left:0!important;width:100%!important}.sidebar{z-index:40!important}}</style><script>(function(){function openRh(){var l=document.getElementById('view-login');if(l)l.style.display='none';var rh=document.getElementById('view-rh');if(rh){rh.classList.remove('hidden');rh.style.display='flex';rh.style.width='100%';rh.style.minHeight='100dvh'}if(typeof mudarModuloRH==='function')mudarModuloRH('dashboard');if(window.lucide)window.lucide.createIcons()}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',openRh);else openRh();})();</script>`;
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

  if (embedded) {
    return (
      <div className="fixed inset-0 z-0 bg-white">
        <iframe
          title="DBS AIR PONTO v5.0"
          srcDoc={srcDoc}
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-downloads"
          allow="camera; geolocation"
          className="block h-[100dvh] min-h-screen w-full border-0 bg-white"
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100dvh-80px)] w-full flex-col">
      <div className="flex shrink-0 flex-col gap-4 border-b border-slate-200 bg-white px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
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
        <div className="min-h-0 flex-1 overflow-hidden bg-slate-50">
          <iframe title="DBS AIR PONTO v5.0" srcDoc={srcDoc} sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-downloads" allow="camera; geolocation" className="block h-[calc(100dvh-150px)] min-h-[760px] w-full border-0 bg-white" />
        </div>
      )}
      {section === "cadastro" && <div className="flex-1 p-4 lg:p-6"><RhEmployeeRegistry /></div>}
      {section === "alimentacao" && <div className="flex-1 p-4 lg:p-6"><RhBenefitPanel benefitType="alimentacao" /></div>}
      {section === "passagem" && <div className="flex-1 p-4 lg:p-6"><RhBenefitPanel benefitType="passagem" /></div>}
    </div>
  );
}
