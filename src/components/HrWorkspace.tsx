import { useEffect, useMemo, useRef, useState } from "react";
import { IdCard, Landmark, Utensils, WalletCards, UserCheck, UserX } from "lucide-react";
import { RhBenefitPanel } from "@/components/RhBenefitPanel";
import { RhEmployeeRegistry } from "@/components/RhEmployeeRegistry";
import { createRhPontoAccess, listRhPontoEmployees, setRhPontoAccess } from "@/lib/ponto.functions";
import { saveRhEmployeeRecord } from "@/lib/rh.functions";
import pontoHtml from "@/assets/DBS_AIR_Ponto_v5_0_Maximo.html?raw";

export const VALE_PASSAGEM_URL = "https://valepassagem-d8edi3fl.manus.space";
type HrSection = "ponto" | "passagem" | "alimentacao" | "cadastro";
type PontoEmployee = {
  id: string;
  nome: string;
  pis: string;
  cpf?: string;
  matricula?: string;
  telefone?: string;
  email?: string;
  cargo?: string;
  setor?: string;
  horaPrevista?: string;
  horaSaidaPrevista?: string;
  raioMax?: number;
  endereco?: string;
  latBase?: number | null;
  lngBase?: number | null;
  baseNome?: string;
  statusAtivo?: boolean;
};

function buildPontoDocument(html: string) {
  const bootstrap = `<style id="dbs-ponto-host-fix">html,body{width:100%!important;min-width:0!important;margin:0!important}body{overflow:hidden!important}#view-rh{width:100%!important;min-height:100dvh!important}#view-rh>main{width:100%!important;min-width:0!important;margin-left:0!important;padding-left:0!important}#view-rh .mobile-main{width:100%!important;max-width:none!important}.sidebar{flex-shrink:0}@media(min-width:901px){#view-rh{display:flex!important;align-items:stretch!important}#view-rh>main{flex:1!important;min-width:0!important;overflow-y:auto!important;height:100dvh!important}#view-rh>main .mobile-main{max-width:none!important}}@media(max-width:900px){#view-rh>main{padding-left:0!important;width:100%!important}.sidebar{z-index:40!important}}</style><script>(function(){function openRh(){var l=document.getElementById('view-login');if(l)l.style.display='none';var rh=document.getElementById('view-rh');if(rh){rh.classList.remove('hidden');rh.style.display='flex';rh.style.width='100%';rh.style.minHeight='100dvh'}if(typeof mudarModuloRH==='function')mudarModuloRH('dashboard');if(window.lucide)window.lucide.createIcons()}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',openRh);else openRh();})();</script>`;
  return html.replace("</head>", `${bootstrap}</head>`);
}

function sanitizeEmployee(raw: any): PontoEmployee {
  return {
    id: String(raw.id), nome: String(raw.nome ?? ""), pis: String(raw.pis ?? ""), cpf: raw.cpf ? String(raw.cpf) : "", matricula: raw.matricula ? String(raw.matricula) : "", telefone: raw.telefone ? String(raw.telefone) : "", email: raw.email ? String(raw.email) : "", cargo: raw.cargo ? String(raw.cargo) : "", setor: raw.setor ? String(raw.setor) : "", horaPrevista: raw.horaPrevista ?? "08:00", horaSaidaPrevista: raw.horaSaidaPrevista ?? "17:00", raioMax: Number(raw.raioMax) || 500, endereco: raw.endereco ? String(raw.endereco) : "", latBase: raw.latBase == null ? null : Number(raw.latBase), lngBase: raw.lngBase == null ? null : Number(raw.lngBase), baseNome: raw.baseNome ?? "Base principal", statusAtivo: raw.statusAtivo !== false,
  };
}

export function HrWorkspace({ embedded = false }: { embedded?: boolean }) {
  const [section, setSection] = useState<HrSection>("ponto");
  const [pontoEmployee, setPontoEmployee] = useState<PontoEmployee | null>(null);
  const [savingAccess, setSavingAccess] = useState(false);
  const [accessError, setAccessError] = useState("");
  const [accessSuccess, setAccessSuccess] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [radius, setRadius] = useState("150");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [entrada, setEntrada] = useState("08:00");
  const [saida, setSaida] = useState("17:00");
  const [almocoIni, setAlmocoIni] = useState("");
  const [almocoFim, setAlmocoFim] = useState("");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const srcDoc = useMemo(() => buildPontoDocument(pontoHtml), []);

  const openPontoAccess = (employee: PontoEmployee) => {
    setPontoEmployee(employee); setAccessError(""); setAccessSuccess(""); setLogin(""); setPassword(""); setRadius(String(employee.raioMax ?? 150)); setLat(employee.latBase == null ? "" : String(employee.latBase)); setLng(employee.lngBase == null ? "" : String(employee.lngBase)); setEntrada(employee.horaPrevista ?? "08:00"); setSaida(employee.horaSaidaPrevista ?? "17:00"); setAlmocoIni(""); setAlmocoFim("");
  };

  useEffect(() => {
    const w = iframeRef.current?.contentWindow as any;
    if (!w) return;
    w.__DBS_RH_OPEN_PONTO_ACCESS = (employee: any) => openPontoAccess(sanitizeEmployee(employee));
    if (w.__dbsPontoAccessPatched || typeof w.renderColaboradores !== "function") return;
    const original = w.renderColaboradores.bind(w);
    w.renderColaboradores = function () {
      original();
      const list = typeof w.getColaboradores === "function" ? w.getColaboradores() : [];
      const rows = Array.from(w.document.querySelectorAll("#colaboradores-body tr")) as HTMLTableRowElement[];
      rows.forEach((row, index) => {
        const employee = list[index];
        if (!employee || !row.cells.length || row.dataset.dbsAccessReady === "1") return;
        const cell = row.cells[row.cells.length - 1];
        const button = w.document.createElement("button");
        button.type = "button";
        button.textContent = "Acesso Portal";
        button.className = "px-2 py-1.5 rounded-lg bg-sky-50 text-sky-700 text-[10px] font-black";
        button.onclick = () => w.parent.__DBS_RH_OPEN_PONTO_ACCESS(sanitizeEmployee(employee));
        cell.appendChild(button);
        row.dataset.dbsAccessReady = "1";
      });
    };
    w.__dbsPontoAccessPatched = true;
    w.renderColaboradores();
  }, [pontoEmployee]);

  const saveAccess = async () => {
    if (!pontoEmployee) return;
    setSavingAccess(true); setAccessError(""); setAccessSuccess("");
    try {
      const registry = await listRhPontoEmployees();
      const cpf = String(pontoEmployee.cpf ?? "").replace(/\D/g, "");
      const pis = String(pontoEmployee.pis ?? "").trim();
      const match = (registry as any[]).find((e) => {
        const data = e.registration_data ?? {};
        const ec = String(data.cpf ?? "").replace(/\D/g, "");
        return (cpf && ec && cpf === ec) || (pis && String(data.pis ?? "").trim() === pis) || (String(e.full_name).trim().toUpperCase() === pontoEmployee.nome.trim().toUpperCase() && String(e.unit).trim().toUpperCase() === String(pontoEmployee.setor || pontoEmployee.unit || "").trim().toUpperCase());
      });
      let employeeId = match?.id as string | undefined;
      if (!employeeId) {
        const created = await saveRhEmployeeRecord({ data: { full_name: pontoEmployee.nome, unit: pontoEmployee.setor || "Não informado", registration_data: { cpf: pontoEmployee.cpf ?? "", pis: pontoEmployee.pis, matricula: pontoEmployee.matricula ?? "", telefone: pontoEmployee.telefone ?? "", email: pontoEmployee.email ?? "", job_title: pontoEmployee.cargo ?? "", setor: pontoEmployee.setor ?? "", address: pontoEmployee.endereco ?? "" } } });
        employeeId = created.id;
      }
      const common = { employee_id: employeeId, base_lat: Number(lat), base_lng: Number(lng), radius_m: Number(radius), entrada_prevista: entrada || null, saida_prevista: saida || null, almoco_inicio_previsto: almocoIni || null, almoco_fim_previsto: almocoFim || null };
      if (match?.ponto_portal_user_id) {
        await setRhPontoAccess({ data: { ...common, enabled: true, portal_identifier: match.portal_user?.username || match.portal_user?.email } });
        setAccessSuccess("Acesso já existente atualizado e liberado. O funcionário continua usando o login normal do sistema.");
      } else {
        if (!login.trim() || password.length < 6) throw new Error("Informe login e uma senha de pelo menos 6 caracteres.");
        const result = await createRhPontoAccess({ data: { ...common, username: login, password } });
        setAccessSuccess(`Acesso criado: ${result.username}. Entregue a senha ao funcionário. Ele entra pela tela normal de login do sistema.`);
      }
      const frame = iframeRef.current?.contentWindow as any;
      if (frame && typeof frame.getColaboradores === "function" && typeof frame.saveColaboradores === "function") {
        const list = frame.getColaboradores(); const idx = list.findIndex((e: any) => String(e.id) === String(pontoEmployee.id));
        if (idx >= 0) { list[idx].rhEmployeeId = employeeId; frame.saveColaboradores(list); }
      }
      setPassword("");
    } catch (e) {
      setAccessError(e instanceof Error ? e.message : "Não foi possível configurar o acesso.");
    } finally { setSavingAccess(false); }
  };

  const tabs = [
    { key: "ponto" as const, label: "Folha de Ponto", icon: <Landmark className="h-4 w-4" /> },
    { key: "cadastro" as const, label: "Cadastro de Funcionários", icon: <IdCard className="h-4 w-4" /> },
    { key: "passagem" as const, label: "Vale Passagem", icon: <WalletCards className="h-4 w-4" /> },
    { key: "alimentacao" as const, label: "Vale Alimentação", icon: <Utensils className="h-4 w-4" /> },
  ];

  return <div className={embedded ? "fixed inset-0 z-0 bg-white" : "flex min-h-[calc(100dvh-80px)] w-full flex-col"}>
    {!embedded && <div className="flex shrink-0 flex-col gap-4 border-b border-slate-200 bg-white px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-[10px] font-black uppercase tracking-[.2em] text-slate-400">Recursos Humanos</p><h1 className="mt-1 text-xl font-black tracking-tight text-slate-900">RH · Gestão de Pessoas</h1><p className="mt-1 text-xs text-slate-500">Gestor já autenticado pelo sistema principal. O acesso dos colaboradores é criado pelo RH.</p></div><nav className="flex flex-wrap gap-2">{tabs.map(tab => <button key={tab.key} onClick={() => setSection(tab.key)} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold ${section === tab.key ? "bg-[#102b3b] text-white" : "bg-slate-100 text-slate-600"}`}>{tab.icon}{tab.label}</button>)}</nav></div>}
    {(!embedded && section === "cadastro") ? <div className="flex-1 p-4 lg:p-6"><RhEmployeeRegistry /></div> : (!embedded && section === "passagem") ? <div className="flex-1 p-4 lg:p-6"><RhBenefitPanel benefitType="passagem" /></div> : (!embedded && section === "alimentacao") ? <div className="flex-1 p-4 lg:p-6"><RhBenefitPanel benefitType="alimentacao" /></div> : <iframe ref={iframeRef} onLoad={() => { const w = iframeRef.current?.contentWindow as any; if (w) { w.__DBS_RH_OPEN_PONTO_ACCESS = (employee: any) => openPontoAccess(sanitizeEmployee(employee)); } }} title="DBS AIR PONTO v5.0" srcDoc={srcDoc} sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-downloads" allow="camera; geolocation" className="block h-[100dvh] min-h-screen w-full border-0 bg-white" />}

    {pontoEmployee && <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/70 p-4"><div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between"><div><p className="text-[10px] font-black uppercase tracking-wider text-sky-600">RH · acesso do colaborador</p><h2 className="mt-1 text-xl font-black text-slate-900">{pontoEmployee.nome}</h2><p className="mt-1 text-xs text-slate-500">Este é o vínculo entre a Folha de Ponto e o login normal do sistema.</p></div><button onClick={() => setPontoEmployee(null)} className="text-xs font-bold text-slate-500">Fechar</button></div>
      {accessSuccess && <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800"><UserCheck className="mr-2 inline h-4 w-4"/>{accessSuccess}</div>}
      {accessError && <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{accessError}</div>}
      <div className="mt-5 grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold text-slate-600">Login<input value={login} onChange={e => setLogin(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5" placeholder="Ex.: JOAO.SILVA" /></label><label className="text-xs font-bold text-slate-600">Senha inicial<input type="password" value={password} onChange={e => setPassword(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5" placeholder="mínimo 6 caracteres" /></label><label className="text-xs font-bold text-slate-600">Raio GPS (m)<input value={radius} onChange={e => setRadius(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5" /></label><label className="text-xs font-bold text-slate-600">Latitude da base<input value={lat} onChange={e => setLat(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5" /></label><label className="text-xs font-bold text-slate-600">Longitude da base<input value={lng} onChange={e => setLng(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5" /></label><div className="sm:col-span-2 rounded-xl bg-slate-50 p-4"><p className="mb-3 text-xs font-black text-slate-700">Jornada prevista</p><div className="grid gap-3 sm:grid-cols-4"><input aria-label="Entrada prevista" type="time" value={entrada} onChange={e => setEntrada(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-2"/><input aria-label="Início almoço" type="time" value={almocoIni} onChange={e => setAlmocoIni(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-2"/><input aria-label="Fim almoço" type="time" value={almocoFim} onChange={e => setAlmocoFim(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-2"/><input aria-label="Saída prevista" type="time" value={saida} onChange={e => setSaida(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-2"/></div></div></div>
      <div className="mt-6 flex justify-end gap-2"><button onClick={() => setPontoEmployee(null)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-black text-slate-600">Cancelar</button><button onClick={() => void saveAccess()} disabled={savingAccess} className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-5 py-2.5 text-xs font-black text-white disabled:opacity-50">{savingAccess ? "Salvando..." : <><UserCheck className="h-4 w-4"/>Criar / liberar acesso</>}</button></div>
      <p className="mt-3 text-[11px] text-slate-400">O colaborador não recebe perfil de RH. Ele permanece como usuário comum do sistema e só enxerga a própria folha quando o RH libera o acesso.</p></div></div>}
  </div>;
}
