import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CheckCircle2, Clock3, MapPin, ShieldCheck, UserCheck, UserX, AlertTriangle, BriefcaseBusiness, ChevronRight, ClipboardCheck, Filter, History, Save, Search, XCircle } from "lucide-react";
import { getMyProfile } from "@/lib/auth.functions";
import { getMyPonto, listRhPontoEmployees, listRhPontoRecords, listRhPontoDayManagement, registerMyPonto, setRhPontoAccess, setRhPontoDayManagement, type RhPontoDayStatus } from "@/lib/ponto.functions";

const labels: Record<string, string> = { entrada: "Entrada", almoco_saida: "Saída almoço", almoco_retorno: "Retorno almoço", saida: "Saída" };
const localDateISO = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};
const nextType = (records: any[]) => {
  const today = localDateISO();
  const done = records.filter(r => r.work_date === today).map(r => r.punch_type);
  return (["entrada", "almoco_saida", "almoco_retorno", "saida"] as const).find(t => !done.includes(t)) ?? null;
};

export function RhPontoWorkspace() {
  const profile = useQuery({ queryKey: ["me"], queryFn: () => getMyProfile() });
  const isRh = profile.data?.role_key === "SUPER_ADMIN" || profile.data?.role_key === "ADMIN_OPERACIONAL" || ["DBS123", "DBSASSISTENCIA123"].includes(profile.data?.username ?? "");
  return isRh ? <PontoRh /> : <PontoColaborador />;
}

export function RhPontoEmployeePortal() {
  return <PontoColaborador />;
}


function PontoRh() {
  const qc = useQueryClient();
  const [reportDate, setReportDate] = useState(localDateISO().slice(0, 7));
  const [selectedDay, setSelectedDay] = useState(localDateISO());
  const [employeeFilter, setEmployeeFilter] = useState("todos");
  const [statusFilter, setStatusFilter] = useState("todos");
  const [search, setSearch] = useState("");
  const [dayEmployee, setDayEmployee] = useState<any>(null);
  const [occurrenceStatus, setOccurrenceStatus] = useState<RhPontoDayStatus>("PRESENCA");
  const [occurrenceNote, setOccurrenceNote] = useState("");
  const [view, setView] = useState<"gestao" | "acessos">("gestao");
  const [selected, setSelected] = useState<any>(null);
  const [identifier, setIdentifier] = useState("");
  const [radius, setRadius] = useState("150");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [entrada, setEntrada] = useState("");
  const [saida, setSaida] = useState("");
  const [almocoIni, setAlmocoIni] = useState("");
  const [almocoFim, setAlmocoFim] = useState("");

  const reportStart = reportDate + "-01";
  const reportEnd = reportDate + "-" + String(new Date(Number(reportDate.slice(0,4)), Number(reportDate.slice(5,7)), 0).getDate()).padStart(2, "0");
  const employees = useQuery({ queryKey: ["rh-ponto-employees"], queryFn: () => listRhPontoEmployees() });
  const report = useQuery({ queryKey: ["rh-ponto-report", reportStart, reportEnd], queryFn: () => listRhPontoRecords({ data: { start_date: reportStart, end_date: reportEnd } }) });
  const management = useQuery({ queryKey: ["rh-ponto-day-management", reportStart, reportEnd], queryFn: () => listRhPontoDayManagement({ data: { start_date: reportStart, end_date: reportEnd } }) });

  const dayRecords = useMemo(() => (report.data ?? []).filter((r:any) => r.work_date === selectedDay), [report.data, selectedDay]);
  const latest = useMemo(() => {
    const map = new Map<string, any>();
    for (const row of (management.data ?? []) as any[]) {
      if (row.details?.work_date) map.set(row.employee_id + "|" + row.details.work_date, row);
    }
    return map;
  }, [management.data]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (employees.data ?? []).filter((e:any) => employeeFilter === "todos" || e.id === employeeFilter)
      .filter((e:any) => !q || e.full_name.toLowerCase().includes(q) || String(e.unit ?? "").toLowerCase().includes(q))
      .map((e:any) => {
        const records = dayRecords.filter((r:any) => r.employee_id === e.id);
        const s = records[0]?.day_summary ?? { worked_minutes:0, late_minutes:0, early_leave_minutes:0, overtime_minutes:0, missing_punches:["entrada","almoco_saida","almoco_retorno","saida"] };
        const saved = latest.get(e.id + "|" + selectedDay);
        const status = saved?.details?.status ?? (records.length === 0 ? "SEM_MARCACAO" : s.late_minutes ? "ATRASO" : s.early_leave_minutes ? "SAIDA_ANTECIPADA" : s.missing_punches?.length ? "PONTO_INCOMPLETO" : "PRESENCA");
        return { employee:e, records, summary:s, status, note:saved?.details?.note ?? null };
      })
      .filter((r:any) => statusFilter === "todos" || r.status === statusFilter);
  }, [employees.data, dayRecords, employeeFilter, search, latest, selectedDay, statusFilter]);

  const stats = {
    total: rows.length,
    presence: rows.filter((r:any)=>r.status==="PRESENCA").length,
    attention: rows.filter((r:any)=>["ATRASO","SAIDA_ANTECIPADA"].includes(r.status)).length,
    absence: rows.filter((r:any)=>r.status==="FALTA").length,
    pending: rows.filter((r:any)=>r.status==="SEM_MARCACAO").length,
    justified: rows.filter((r:any)=>["FALTA_JUSTIFICADA","ATESTADO","FOLGA","FERIAS","COMPENSACAO","HOME_OFFICE","ABONO"].includes(r.status)).length,
  };

  const statusLabel:Record<string,string> = { PRESENCA:"Presença", ATRASO:"Atraso", SAIDA_ANTECIPADA:"Saída antecipada", FALTA:"Falta", FALTA_JUSTIFICADA:"Falta justificada", SEM_MARCACAO:"Sem marcação", PONTO_INCOMPLETO:"Ponto incompleto", ATESTADO:"Atestado", FOLGA:"Folga", FERIAS:"Férias", COMPENSACAO:"Compensação", HOME_OFFICE:"Home office", ABONO:"Abono" };
  const statusClass:Record<string,string> = {
    PRESENCA:"bg-emerald-50 text-emerald-700 border-emerald-100", ATRASO:"bg-amber-50 text-amber-700 border-amber-100",
    SAIDA_ANTECIPADA:"bg-orange-50 text-orange-700 border-orange-100", FALTA:"bg-red-50 text-red-700 border-red-100",
    FALTA_JUSTIFICADA:"bg-sky-50 text-sky-700 border-sky-100", ATESTADO:"bg-violet-50 text-violet-700 border-violet-100",
    FOLGA:"bg-slate-100 text-slate-700 border-slate-200", SEM_MARCACAO:"bg-slate-100 text-slate-500 border-slate-200", PONTO_INCOMPLETO:"bg-rose-50 text-rose-700 border-rose-100", FERIAS:"bg-indigo-50 text-indigo-700 border-indigo-100",
    COMPENSACAO:"bg-cyan-50 text-cyan-700 border-cyan-100", HOME_OFFICE:"bg-teal-50 text-teal-700 border-teal-100", ABONO:"bg-blue-50 text-blue-700 border-blue-100"
  };
  const fmt = (m:number|null|undefined) => m == null ? "—" : Math.floor(m/60) + "h " + String(m%60).padStart(2,"0") + "m";
  const punchTime = (r:any) => r ? new Date(r.punched_at).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}) : "—";

  const accessMutation = useMutation({
    mutationFn: (enabled:boolean) => setRhPontoAccess({ data:{ employee_id:selected.id, enabled, portal_identifier:identifier, radius_m:Number(radius), base_lat:lat?Number(lat):null, base_lng:lng?Number(lng):null, entrada_prevista:entrada||null, saida_prevista:saida||null, almoco_inicio_previsto:almocoIni||null, almoco_fim_previsto:almocoFim||null } }),
    onSuccess:()=>{ qc.invalidateQueries({queryKey:["rh-ponto-employees"]}); setSelected(null); }
  });
  const occurrence = useMutation({
    mutationFn:()=>setRhPontoDayManagement({data:{employee_id:dayEmployee.employee.id,work_date:selectedDay,status:occurrenceStatus,note:occurrenceNote}}),
    onSuccess:()=>{ qc.invalidateQueries({queryKey:["rh-ponto-day-management"]}); setDayEmployee(null); setOccurrenceNote(""); }
  });
  const monthlySummary = useMemo(() => {
    const byEmployee = new Map<string, any>();
    for (const e of (employees.data ?? []) as any[]) {
      byEmployee.set(e.id, { employee: e, days: 0, worked: 0, expected: 0, overtime: 0, late: 0, early: 0, incomplete: 0, absences: 0, justified: 0 });
    }
    for (const r of (report.data ?? []) as any[]) {
      const item = byEmployee.get(r.employee_id);
      if (!item) continue;
      const s = r.day_summary ?? {};
      item.days += 1;
      item.worked += Number(s.worked_minutes || 0);
      item.expected += Number(s.expected_minutes || 0);
      item.overtime += Number(s.overtime_minutes || 0);
      item.late += Number(s.late_minutes || 0);
      item.early += Number(s.early_leave_minutes || 0);
      if (s.missing_punches?.length) item.incomplete += 1;
    }
    for (const row of (management.data ?? []) as any[]) {
      const d = row.details ?? {};
      const item = byEmployee.get(row.employee_id);
      if (!item || !d.work_date || !String(d.work_date).startsWith(reportDate)) continue;
      if (d.status === "FALTA") item.absences += 1;
      if (["FALTA_JUSTIFICADA","ATESTADO","FOLGA","FERIAS","COMPENSACAO","HOME_OFFICE","ABONO"].includes(d.status)) item.justified += 1;
    }
    return [...byEmployee.values()].sort((a,b)=>a.employee.full_name.localeCompare(b.employee.full_name,"pt-BR"));
  }, [employees.data, report.data, management.data, reportDate]);

  const openMonthlyReport = () => {
    const monthLabel = new Date(reportDate + "-15T12:00:00").toLocaleDateString("pt-BR",{month:"long",year:"numeric"});
    const moneyTime = (m:number) => Math.floor(m/60) + "h " + String(Math.abs(m)%60).padStart(2,"0") + "m";
    const totalWorked = monthlySummary.reduce((a,r)=>a+r.worked,0);
    const totalExpected = monthlySummary.reduce((a,r)=>a+r.expected,0);
    const totalExtra = monthlySummary.reduce((a,r)=>a+r.overtime,0);
    const totalLate = monthlySummary.reduce((a,r)=>a+r.late,0);
    const rowsHtml = monthlySummary.map(r => `<tr><td><strong>${r.employee.full_name}</strong><br><small>${r.employee.unit||"Sem unidade"}</small></td><td>${r.days}</td><td>${moneyTime(r.expected)}</td><td>${moneyTime(r.worked)}</td><td>${moneyTime(r.overtime)}</td><td>${moneyTime(r.late)}</td><td>${r.early ? moneyTime(r.early) : "—"}</td><td>${r.absences}</td><td>${r.justified}</td><td>${r.incomplete}</td></tr>`).join("");
    const w = window.open("", "_blank", "width=1200,height=800");
    if (!w) return;
    w.document.write(`<!doctype html><html><head><title>Espelho RH - ${monthLabel}</title><style>
      body{font-family:Arial,sans-serif;color:#172033;padding:32px}h1{margin:0;font-size:24px}h2{font-size:14px;margin:4px 0 24px;color:#64748b;text-transform:capitalize}
      .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:20px 0}.kpi{border:1px solid #e2e8f0;border-radius:10px;padding:12px}.kpi b{display:block;font-size:20px;margin-top:5px}.kpi span{font-size:10px;color:#64748b;text-transform:uppercase;font-weight:bold}
      table{width:100%;border-collapse:collapse;font-size:11px}th{background:#f1f5f9;text-align:left;text-transform:uppercase;font-size:9px}th,td{padding:9px;border-bottom:1px solid #e2e8f0}small{color:#64748b}.footer{margin-top:25px;font-size:10px;color:#64748b}
      @media print{body{padding:12px}.no-print{display:none}}
    </style></head><body><h1>DBS AIR REFRIGERAÇÃO LTDA</h1><h2>Relatório Gerencial de Folha de Ponto · ${monthLabel}</h2>
    <div class="kpis"><div class="kpi"><span>Horas previstas</span><b>${moneyTime(totalExpected)}</b></div><div class="kpi"><span>Horas trabalhadas</span><b>${moneyTime(totalWorked)}</b></div><div class="kpi"><span>Horas extras</span><b>${moneyTime(totalExtra)}</b></div><div class="kpi"><span>Atrasos</span><b>${moneyTime(totalLate)}</b></div></div>
    <table><thead><tr><th>Colaborador</th><th>Dias</th><th>Previsto</th><th>Trabalhado</th><th>Extra</th><th>Atraso</th><th>Saída ant.</th><th>Faltas</th><th>Justif.</th><th>Incompleto</th></tr></thead><tbody>${rowsHtml}</tbody></table>
    <p class="footer">Relatório gerado pelo módulo RH. As marcações originais permanecem preservadas; ocorrências administrativas são tratadas separadamente.</p>
    <button class="no-print" onclick="window.print()" style="margin-top:20px;padding:10px 16px">Imprimir / Salvar PDF</button></body></html>`);
    w.document.close();
  };

  const active=(employees.data??[]).filter((e:any)=>e.ponto_access_enabled).length;
  const openAccess=(e:any)=>{setSelected(e);setIdentifier(e.portal_user?.username??e.portal_user?.email??"");setRadius(String(e.ponto_raio_m??150));setLat(e.ponto_base_lat?String(e.ponto_base_lat):"");setLng(e.ponto_base_lng?String(e.ponto_base_lng):"");setEntrada(e.ponto_entrada_prevista??"");setSaida(e.ponto_saida_prevista??"");setAlmocoIni(e.ponto_almoco_inicio_previsto??"");setAlmocoFim(e.ponto_almoco_fim_previsto??"");};
  const openDay=(r:any)=>{setDayEmployee(r);setOccurrenceStatus(r.status as RhPontoDayStatus);setOccurrenceNote(r.note??"");};

  return <div className="space-y-5">
    <header className="rounded-3xl bg-slate-950 p-6 text-white shadow-sm">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div><p className="text-[10px] font-black uppercase tracking-[.22em] text-sky-300">RH · gestão de jornada</p><h2 className="mt-2 text-3xl font-black">Folha de Ponto</h2><p className="mt-1 max-w-2xl text-sm text-slate-400">Acompanhe cada dia, identifique desvios e registre a ocorrência sem apagar a marcação original.</p></div>
        <button onClick={openMonthlyReport} className="mr-2 inline-flex items-center gap-2 rounded-xl bg-sky-400 px-4 py-2 text-xs font-black text-slate-950"><ClipboardCheck className="h-4 w-4"/>Relatório mensal</button><div className="flex rounded-xl bg-white/10 p-1"><button onClick={()=>setView("gestao")} className={"rounded-lg px-4 py-2 text-xs font-black "+(view==="gestao"?"bg-white text-slate-900":"text-white/70")}>Gestão diária</button><button onClick={()=>setView("acessos")} className={"rounded-lg px-4 py-2 text-xs font-black "+(view==="acessos"?"bg-white text-slate-900":"text-white/70")}>Acessos e jornada</button></div>
      </div>
    </header>

    {view==="gestao" ? <>
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[170px_170px_1fr_210px]">
          <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Dia<input type="date" value={selectedDay} onChange={e=>{setSelectedDay(e.target.value);setReportDate(e.target.value.slice(0,7));}} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-bold"/></label>
          <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Fechamento<input type="month" value={reportDate} onChange={e=>{setReportDate(e.target.value);setSelectedDay(e.target.value+"-01");}} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-bold"/></label>
          <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Pesquisar<div className="relative mt-1"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Nome ou unidade..." className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm"/></div></label>
          <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Funcionário<select value={employeeFilter} onChange={e=>setEmployeeFilter(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-bold"><option value="todos">Todos</option>{(employees.data??[]).map((e:any)=><option key={e.id} value={e.id}>{e.full_name}</option>)}</select></label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3"><Filter className="h-4 w-4 text-slate-400"/>{["todos","PRESENCA","SEM_MARCACAO","PONTO_INCOMPLETO","ATRASO","SAIDA_ANTECIPADA","FALTA","FALTA_JUSTIFICADA","ATESTADO","FOLGA","FERIAS","COMPENSACAO","HOME_OFFICE","ABONO"].map(s=><button key={s} onClick={()=>setStatusFilter(s)} className={"rounded-full border px-3 py-1.5 text-[11px] font-black "+(statusFilter===s?"border-slate-900 bg-slate-900 text-white":"border-slate-200 bg-white text-slate-500")}>{s==="todos"?"Todas":statusLabel[s]}</button>)}</div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[["Colaboradores",stats.total,"text-slate-900",ClipboardCheck],["Pendências",stats.pending,"text-slate-600",History],["Presença",stats.presence,"text-emerald-700",CheckCircle2],["Atenção",stats.attention,"text-amber-700",AlertTriangle],["Faltas",stats.absence,"text-red-700",XCircle],["Justificados",stats.justified,"text-violet-700",BriefcaseBusiness]].map(([label,value,color,Icon]:any)=><div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><span className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</span><Icon className={"h-4 w-4 "+color}/></div><p className={"mt-2 text-2xl font-black "+color}>{value}</p></div>)}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-black uppercase tracking-[.18em] text-sky-600">Controle do dia</p><h3 className="mt-1 text-xl font-black text-slate-900">{new Date(selectedDay+"T12:00:00").toLocaleDateString("pt-BR",{weekday:"long",day:"2-digit",month:"long"})}</h3></div><div className="flex items-center gap-2 text-xs font-bold text-slate-400"><History className="h-4 w-4"/>Marcações originais preservadas</div></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-sm"><thead className="bg-slate-50 text-left text-[10px] font-black uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3">Colaborador</th><th className="px-4 py-3">Situação</th><th className="px-4 py-3">Entrada</th><th className="px-4 py-3">Almoço</th><th className="px-4 py-3">Saída</th><th className="px-4 py-3">Trabalhado</th><th className="px-4 py-3">Ocorrência</th><th className="px-4 py-3 text-right">Ação</th></tr></thead>
        <tbody>{rows.map((row:any)=>{const a=row.records.find((r:any)=>r.punch_type==="entrada"),b=row.records.find((r:any)=>r.punch_type==="almoco_saida"),c=row.records.find((r:any)=>r.punch_type==="almoco_retorno"),d=row.records.find((r:any)=>r.punch_type==="saida");return <tr key={row.employee.id} className="border-t border-slate-100 hover:bg-slate-50/70"><td className="px-5 py-4"><div className="font-black text-slate-800">{row.employee.full_name}</div><div className="text-[11px] text-slate-400">{row.employee.unit||"Sem unidade"}</div></td><td className="px-4 py-4"><span className={"inline-flex rounded-full border px-2.5 py-1 text-[11px] font-black "+(statusClass[row.status]??"")}>{statusLabel[row.status]??row.status}</span></td><td className="px-4 py-4 font-bold">{punchTime(a)}</td><td className="px-4 py-4 text-slate-500">{punchTime(b)} · {punchTime(c)}</td><td className="px-4 py-4 font-bold">{punchTime(d)}</td><td className="px-4 py-4 font-black">{fmt(row.summary.worked_minutes)}<div className="text-[10px] font-bold text-slate-400">{row.summary.late_minutes?"Atraso "+fmt(row.summary.late_minutes):row.summary.overtime_minutes?"Extra "+fmt(row.summary.overtime_minutes):row.summary.early_leave_minutes?"Saída antecipada":"Jornada ok"}</div></td><td className="max-w-[220px] truncate px-4 py-4 text-xs text-slate-500">{row.note||"—"}</td><td className="px-4 py-4 text-right"><button onClick={()=>openDay(row)} className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-xs font-black text-white">Gerir <ChevronRight className="h-3.5 w-3.5"/></button></td></tr>})}</tbody></table>{!rows.length&&<div className="p-10 text-center text-sm text-slate-400">Nenhum funcionário encontrado com os filtros.</div>}</div>
      </section>
    </> : <section className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-[10px] font-black uppercase tracking-wider text-sky-600">Configuração</p><h3 className="mt-1 text-xl font-black text-slate-900">Acessos e jornada</h3><p className="mt-1 text-xs text-slate-500">{active} acessos liberados · login, GPS e horários previstos continuam aqui.</p></div>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-[10px] font-black uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3">Colaborador</th><th className="px-5 py-3">Unidade</th><th className="px-5 py-3">Login</th><th className="px-5 py-3">Acesso</th><th className="px-5 py-3 text-right">Configurar</th></tr></thead><tbody>{(employees.data??[]).map((e:any)=><tr key={e.id} className="border-t border-slate-100"><td className="px-5 py-4 font-bold text-slate-800">{e.full_name}</td><td className="px-5 py-4 text-slate-500">{e.unit}</td><td className="px-5 py-4 text-slate-500">{e.portal_user?.username??e.portal_user?.email??"—"}</td><td className="px-5 py-4">{e.ponto_access_enabled?<span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700"><CheckCircle2 className="mr-1 h-3.5 w-3.5"/>Liberado</span>:<span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-500"><UserX className="mr-1 h-3.5 w-3.5"/>Bloqueado</span>}</td><td className="px-5 py-4 text-right"><button onClick={()=>openAccess(e)} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-black text-white">{e.ponto_access_enabled?"Editar":"Liberar acesso"}</button></td></tr>)}</tbody></table></div></section>
    </section>}

    {dayEmployee&&<div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4"><div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl">
      <div className="flex items-start justify-between"><div><p className="text-[10px] font-black uppercase tracking-wider text-sky-600">Gestão do dia</p><h3 className="mt-1 text-2xl font-black text-slate-900">{dayEmployee.employee.full_name}</h3><p className="text-xs text-slate-500">{selectedDay} · {dayEmployee.employee.unit}</p></div><button onClick={()=>setDayEmployee(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100">×</button></div>
      <div className="mt-5 grid gap-3 sm:grid-cols-4">{["entrada","almoco_saida","almoco_retorno","saida"].map((t:string)=>{const r=dayEmployee.records.find((x:any)=>x.punch_type===t);return <div key={t} className="rounded-xl border border-slate-100 bg-slate-50 p-3"><p className="text-[10px] font-black uppercase text-slate-400">{labels[t]}</p><p className="mt-1 text-lg font-black text-slate-900">{punchTime(r)}</p>{r?.inside_radius===false&&<p className="text-[10px] font-bold text-red-600">Fora do raio</p>}</div>})}</div>
      <div className="mt-4 grid gap-3 sm:grid-cols-4">{[["Trabalhado",fmt(dayEmployee.summary.worked_minutes),""],["Atraso",fmt(dayEmployee.summary.late_minutes),"text-amber-700"],["Saída antecipada",fmt(dayEmployee.summary.early_leave_minutes),""],["Hora extra",fmt(dayEmployee.summary.overtime_minutes),"text-emerald-700"]].map((x:any)=><div key={x[0]} className="rounded-xl border border-slate-100 p-3"><p className="text-[10px] font-black uppercase text-slate-400">{x[0]}</p><p className={"mt-1 font-black "+x[2]}>{x[1]}</p></div>)}</div>
      <div className="mt-5 rounded-2xl border border-slate-200 p-4"><div className="flex items-center gap-2"><ClipboardCheck className="h-4 w-4 text-sky-600"/><h4 className="text-sm font-black text-slate-900">Classificar ocorrência</h4></div><p className="mt-1 text-xs text-slate-500">O sistema registra a decisão administrativa e preserva todas as marcações originais.</p><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-[10px] font-black uppercase text-slate-500">Situação<select value={occurrenceStatus} onChange={e=>setOccurrenceStatus(e.target.value as RhPontoDayStatus)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-bold">{["PRESENCA","SEM_MARCACAO","ATRASO","SAIDA_ANTECIPADA","FALTA","FALTA_JUSTIFICADA","ATESTADO","FOLGA","FERIAS","COMPENSACAO","HOME_OFFICE","ABONO"].map(s=><option key={s} value={s}>{statusLabel[s]}</option>)}</select></label><label className="text-[10px] font-black uppercase text-slate-500">Motivo / observação<textarea value={occurrenceNote} onChange={e=>setOccurrenceNote(e.target.value)} rows={3} placeholder="Ex.: atestado recebido, falta comunicada, compensação aprovada..." className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"/></label></div><div className="mt-3 flex justify-end"><button onClick={()=>occurrence.mutate()} disabled={occurrence.isPending} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black text-white"><Save className="h-4 w-4"/>{occurrence.isPending?"Registrando...":"Registrar situação"}</button></div>{occurrence.error&&<p className="mt-3 rounded-lg bg-red-50 p-3 text-xs font-bold text-red-700">{occurrence.error instanceof Error?occurrence.error.message:"Não foi possível registrar."}</p>}</div>
      <div className="mt-5 rounded-2xl border border-slate-200 p-4"><div className="flex items-center gap-2"><History className="h-4 w-4 text-slate-500"/><h4 className="text-sm font-black text-slate-900">Histórico administrativo</h4></div><div className="mt-3 space-y-2">{(management.data??[]).filter((r:any)=>r.employee_id===dayEmployee.employee.id&&r.details?.work_date===selectedDay).slice().reverse().map((r:any,i:number)=><div key={r.created_at+"-"+i} className="rounded-xl bg-slate-50 p-3"><div className="flex justify-between gap-3"><span className={"rounded-full border px-2 py-1 text-[10px] font-black "+(statusClass[r.details?.status]??"")}>{statusLabel[r.details?.status]??r.details?.status}</span><span className="text-[10px] text-slate-400">{new Date(r.created_at).toLocaleString("pt-BR")}</span></div><p className="mt-1 text-xs text-slate-600">{r.details?.note||"Sem observação."}</p></div>)}{!(management.data??[]).some((r:any)=>r.employee_id===dayEmployee.employee.id&&r.details?.work_date===selectedDay)&&<p className="text-xs text-slate-400">Nenhuma ocorrência administrativa registrada.</p>}</div></div>
    </div></div>}

    {selected&&<div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4"><div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between"><div><h3 className="text-xl font-black text-slate-900">Folha de Ponto · {selected.full_name}</h3><p className="mt-1 text-xs text-slate-500">O colaborador usa o login central já cadastrado.</p></div><button onClick={()=>setSelected(null)} className="text-xs font-bold text-slate-500">Fechar</button></div><div className="mt-5 grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold text-slate-600 sm:col-span-2">Usuário / e-mail / CPF<input value={identifier} onChange={e=>setIdentifier(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5" placeholder="ex.: joao.silva"/></label><label className="text-xs font-bold text-slate-600">Raio GPS (m)<input value={radius} onChange={e=>setRadius(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5"/></label><label className="text-xs font-bold text-slate-600">Latitude base<input value={lat} onChange={e=>setLat(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5" placeholder="-22.xxxxxxx"/></label><label className="text-xs font-bold text-slate-600">Longitude base<input value={lng} onChange={e=>setLng(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5" placeholder="-43.xxxxxxx"/></label><div className="sm:col-span-2 rounded-xl bg-slate-50 p-4"><p className="mb-3 flex items-center gap-2 text-xs font-black text-slate-700"><Clock3 className="h-4 w-4"/>Jornada prevista</p><div className="grid gap-3 sm:grid-cols-4"><input type="time" value={entrada} onChange={e=>setEntrada(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-2"/><input type="time" value={almocoIni} onChange={e=>setAlmocoIni(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-2"/><input type="time" value={almocoFim} onChange={e=>setAlmocoFim(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-2"/><input type="time" value={saida} onChange={e=>setSaida(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-2"/></div></div></div><div className="mt-6 flex justify-end gap-2"><button onClick={()=>accessMutation.mutate(false)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-black text-slate-700"><UserX className="mr-1 inline h-4 w-4"/>Revogar acesso</button><button onClick={()=>accessMutation.mutate(true)} disabled={accessMutation.isPending} className="rounded-xl bg-sky-600 px-4 py-2.5 text-xs font-black text-white">{accessMutation.isPending?"Salvando...":"Salvar e liberar"}</button></div>{accessMutation.error&&<p className="mt-3 text-xs font-bold text-red-600">{accessMutation.error instanceof Error?accessMutation.error.message:"Falha ao salvar."}</p>}</div></div>}
  </div>;
}
function PontoColaborador() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["my-ponto"], queryFn: () => getMyPonto(), retry: false });
  const [status, setStatus] = useState<{type:"success"|"error"|"info"; text:string}|null>(null);

  const friendlyError = (e: unknown) => {
    const raw = e instanceof Error ? e.message : String(e ?? "");
    if (/permission|denied|not allowed|permiss/i.test(raw)) return "A localização do dispositivo foi bloqueada. Libere a localização no navegador e tente novamente.";
    if (/timeout|timed out/i.test(raw)) return "O GPS demorou para responder. Verifique o sinal de localização e tente novamente.";
    if (/position|gps|geolocation|location/i.test(raw)) return "Não foi possível obter sua localização. Ative o GPS/localização e tente novamente.";
    if (/raio|radius|fora do raio/i.test(raw)) return "Você está fora do raio permitido para registrar a entrada. Aproxime-se da base cadastrada pelo RH.";
    if (/próxima marcação|marcação inválida|nenhuma/i.test(raw)) return raw;
    return raw || "Não foi possível registrar a marcação agora.";
  };

  const punch = useMutation({
    mutationFn: async (type: any) => {
      const workDate = localDateISO();
      if (!navigator.geolocation) throw new Error("Seu dispositivo não disponibiliza localização.");
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 })
      );
      const baseLat = query.data?.employee.ponto_base_lat;
      const baseLng = query.data?.employee.ponto_base_lng;
      const R = 6371000;
      const rad = (n: number) => n * Math.PI / 180;
      const distance = baseLat != null && baseLng != null
        ? 2 * R * Math.asin(Math.sqrt(
            Math.sin((rad(pos.coords.latitude - Number(baseLat)) / 2)) ** 2 +
            Math.cos(rad(Number(baseLat))) * Math.cos(rad(pos.coords.latitude)) *
            Math.sin((rad(pos.coords.longitude - Number(baseLng)) / 2)) ** 2
          ))
        : null;
      const inside = distance == null ? true : distance <= Number(query.data?.employee.ponto_raio_m ?? 150);
      return registerMyPonto({
        data: {
          punch_type: type,
          work_date: workDate,
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          gps_accuracy_m: pos.coords.accuracy,
          distance_m: distance,
          inside_radius: inside
        }
      });
    },
    onSuccess: () => {
      setStatus({type:"success", text:"Marcação registrada com sucesso. Sua evidência de localização foi gravada."});
      qc.invalidateQueries({ queryKey: ["my-ponto"] });
    },
    onError: e => setStatus({type:"error", text:friendlyError(e)})
  });

  const records = query.data?.records ?? [];
  const todayDate = localDateISO();
  const today = records.filter((r: any) => r.work_date === todayDate);
  const next = useMemo(() => nextType(records), [records]);
  const completed = today.length >= 4;
  const nextLabel = next ? labels[next] : "Jornada completa";

  const formatDate = (value: string) => new Date(value + "T12:00:00").toLocaleDateString("pt-BR", {
    weekday:"long", day:"2-digit", month:"long"
  });
  const formatTime = (value: string) => new Date(value).toLocaleTimeString("pt-BR", {
    hour:"2-digit", minute:"2-digit"
  });

  if (query.isLoading) {
    return <div className="mx-auto max-w-4xl rounded-3xl border border-slate-200 bg-white p-10 text-center shadow-sm">
      <Clock3 className="mx-auto h-9 w-9 animate-pulse text-sky-600"/>
      <p className="mt-3 text-sm font-black text-slate-800">Carregando sua folha de ponto</p>
      <p className="mt-1 text-xs text-slate-500">Estamos buscando suas marcações com segurança.</p>
    </div>;
  }

  if (query.error) {
    return <div className="mx-auto max-w-4xl rounded-3xl border border-amber-200 bg-white p-8 shadow-sm">
      <ShieldCheck className="h-10 w-10 text-amber-600"/>
      <h2 className="mt-4 text-xl font-black text-slate-900">Folha de ponto indisponível</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">Seu acesso ainda não está liberado pelo RH ou houve uma falha momentânea de comunicação. Nenhum registro foi alterado.</p>
      <p className="mt-4 rounded-2xl bg-slate-50 p-4 text-xs font-bold text-slate-600">{friendlyError(query.error)}</p>
    </div>;
  }

  const cards = (["entrada","almoco_saida","almoco_retorno","saida"] as const).map(t => {
    const r = today.find((x:any) => x.punch_type === t);
    return { type:t, record:r };
  });

  return <div className="mx-auto max-w-4xl space-y-5">
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="bg-slate-950 px-6 py-7 text-white sm:px-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[.22em] text-sky-300">DBS AIR · jornada individual</p>
            <h1 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">Olá, {query.data?.employee.full_name}</h1>
            <p className="mt-2 text-sm text-slate-300">Registre sua jornada pelo celular ou computador com validação de localização.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left sm:min-w-[170px]">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Hoje</p>
            <p className="mt-1 text-sm font-black capitalize">{formatDate(todayDate)}</p>
          </div>
        </div>
      </div>

      <div className="p-5 sm:p-7">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map(({type,record},index) => (
            <div key={type} className={"rounded-2xl border p-4 transition "+(record ? "border-emerald-100 bg-emerald-50/60" : index === today.length ? "border-sky-200 bg-sky-50" : "border-slate-200 bg-slate-50")}>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">{labels[type]}</span>
                {record ? <CheckCircle2 className="h-4 w-4 text-emerald-600"/> : <Clock3 className="h-4 w-4 text-slate-400"/>}
              </div>
              <p className="mt-3 text-2xl font-black text-slate-900">{record ? formatTime(record.punched_at) : "—"}</p>
              <p className={"mt-1 text-[11px] font-bold "+(record ? "text-emerald-700" : "text-slate-400")}>{record ? "Registrado" : index === today.length ? "Próxima marcação" : "Aguardando"}</p>
            </div>
          ))}
        </div>

        <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:flex sm:items-center sm:justify-between sm:gap-5">
          <div>
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Próxima ação</p>
            <p className="mt-1 text-lg font-black text-slate-900">{nextLabel}</p>
            <p className="mt-1 text-xs text-slate-500">{completed ? "Todas as quatro marcações de hoje foram registradas." : "O sistema aceita somente a próxima etapa da jornada."}</p>
          </div>
          <button
            type="button"
            disabled={!next || punch.isPending}
            onClick={() => next && punch.mutate(next)}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-sky-600 px-5 py-4 text-sm font-black text-white shadow-sm transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-45 sm:mt-0 sm:w-auto"
          >
            <MapPin className="h-5 w-5"/>
            {punch.isPending ? "Validando localização..." : next ? "Registrar "+labels[next] : "Jornada completa"}
          </button>
        </div>

        {status && <div className={"mt-4 rounded-2xl border p-4 text-sm font-bold "+(status.type==="success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : status.type==="error" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-sky-200 bg-sky-50 text-sky-800")}>{status.text}</div>}
      </div>
    </section>

    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Registro pessoal</p>
          <h2 className="mt-1 text-lg font-black text-slate-900">Histórico de marcações</h2>
        </div>
        <History className="h-5 w-5 text-slate-400"/>
      </div>
      <div className="mt-4 divide-y divide-slate-100">
        {records.length === 0 && <div className="rounded-2xl bg-slate-50 p-6 text-center text-sm text-slate-500">Ainda não há marcações registradas.</div>}
        {records.slice(0,40).map((r:any) => (
          <div key={r.id} className="grid gap-2 py-4 sm:grid-cols-[1fr_auto_auto] sm:items-center">
            <div>
              <p className="text-sm font-black text-slate-800">{labels[r.punch_type] ?? r.punch_type}</p>
              <p className="text-xs text-slate-400">{new Date(r.work_date+"T12:00:00").toLocaleDateString("pt-BR")} · {formatTime(r.punched_at)}</p>
            </div>
            <span className={"inline-flex w-fit rounded-full border px-2.5 py-1 text-[10px] font-black "+(r.inside_radius === false ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700")}>{r.inside_radius === false ? "Fora do raio" : "GPS OK"}</span>
            <span className="text-[11px] font-bold text-slate-400">{r.gps_accuracy_m != null ? "Precisão "+Math.round(Number(r.gps_accuracy_m))+"m" : ""}</span>
          </div>
        ))}
      </div>
    </section>
  </div>;
}
