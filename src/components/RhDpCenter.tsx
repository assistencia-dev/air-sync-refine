import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CheckCircle2, ClipboardList, Clock3, FileWarning, HeartPulse, PlayCircle, UserPlus, WalletCards, FileDown, FileSpreadsheet } from "lucide-react";
import { RhDpTools } from "@/components/RhDpTools";
import {
  calculateRhPayroll, closeRhPayrollPeriod, createRhAdmission, createRhEmployeeRequest, createRhMedicalExam,
  createRhPayrollPeriod, createRhTermination, createRhTimeAdjustment, createRhVacationRequest, createRhVacationPeriod,
  getRhManagementDashboard, listRhPayroll, listRhTimeAdjustments, resolveRhEmployeeRequest, updateRhTimeAdjustment, updateRhVacationRequest
} from "@/lib/rh.dp.functions";
import { exportRhPayrollExcel, exportRhPayrollPdf } from "@/lib/rh.exports";

type Tab="visao"|"folha"|"ferias"|"ponto"|"admissao"|"sst"|"solicitacoes"|"estrutura";
const inputClass="mt-1 w-full rounded-xl border border-slate-700 bg-[#141F33] px-3 py-2.5 text-xs text-slate-100 outline-none focus:border-[#F59E0B]";
const buttonClass="inline-flex items-center justify-center gap-2 rounded-xl bg-[#F59E0B] px-4 py-2.5 text-xs font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButtonClass="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-200 disabled:cursor-not-allowed disabled:opacity-50";
const money=(c:number)=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(c||0)/100);
const today=()=>new Date().toISOString().slice(0,10);
const month=()=>new Date().toISOString().slice(0,7);

export function RhDpCenter(){
 const [tab,setTab]=useState<Tab>("visao");
 const qc=useQueryClient();
 const dash=useQuery({queryKey:["rh-dp-dashboard"],queryFn:()=>getRhManagementDashboard()});
 const employees:any[]=dash.data?.employeesData??[];
 const refresh=()=>qc.invalidateQueries({queryKey:["rh-dp-dashboard"]});
 const tabs:[Tab,string][]=[["visao","Visão geral"],["folha","Folha"],["ferias","Férias"],["ponto","Ponto & banco"],["admissao","Admissão / desligamento"],["sst","SST"],["solicitacoes","Solicitações"],["estrutura","Estrutura"]];
 return <section className="space-y-5">
   <header className="rounded-2xl border border-slate-800 bg-[#1E293B] p-5 shadow-sm sm:p-7">
     <p className="text-[10px] font-black uppercase tracking-[.2em] text-[#F59E0B]">RH · DP integrado</p>
     <div className="mt-1 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
       <div><h2 className="text-2xl font-black text-slate-50">Centro de Gestão RH</h2><p className="mt-1 text-xs text-slate-400">Uma única base de funcionários, com trilha de auditoria e operações persistidas no Supabase.</p></div>
       <nav className="flex flex-wrap gap-2">{tabs.map(([k,l])=><button key={k} onClick={()=>setTab(k)} className={"rounded-xl px-3 py-2 text-xs font-bold "+(tab===k?"bg-[#F59E0B] text-slate-950":"bg-slate-800 text-slate-300 hover:bg-slate-700")}>{l}</button>)}</nav>
     </div>
   </header>
   {dash.isLoading&&<Panel>Carregando dados do RH…</Panel>}
   {dash.error&&<Panel>Não foi possível carregar o RH: {dash.error instanceof Error?dash.error.message:"erro de conexão"} </Panel>}
   {dash.data&&tab==="visao"&&<Dashboard data={dash.data}/>}
   {dash.data&&tab==="folha"&&<Payroll data={dash.data} refresh={refresh}/>}
   {dash.data&&tab==="ferias"&&<Vacation employees={employees} data={dash.data} refresh={refresh}/>}
   {dash.data&&tab==="ponto"&&<TimeAdjustments employees={employees} refresh={refresh}/>}
   {dash.data&&tab==="admissao"&&<Admission employees={employees} refresh={refresh}/>}
   {dash.data&&tab==="sst"&&<Sst employees={employees} data={dash.data} refresh={refresh}/>}
   {dash.data&&tab==="solicitacoes"&&<Requests employees={employees} data={dash.data} refresh={refresh}/>}
   {dash.data&&tab==="estrutura"&&<RhDpTools/>}
 </section>
}

function Panel({children}:{children:React.ReactNode}){return <div className="rounded-2xl border border-slate-800 bg-[#1E293B] p-6 text-sm text-slate-300">{children}</div>}
function Card({label,value,icon:Icon}:{label:string;value:React.ReactNode;icon:any}){return <article className="rounded-2xl border border-slate-800 bg-[#1E293B] p-5"><div className="flex items-center justify-between"><span className="text-[10px] font-black uppercase tracking-[.15em] text-slate-400">{label}</span><Icon className="h-4 w-4 text-[#F59E0B]"/></div><strong className="mt-2 block text-2xl font-black text-slate-50">{value}</strong></article>}
function Dashboard({data}:any){return <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Card label="Funcionários ativos" value={data.employees} icon={ClipboardList}/><Card label="Folhas abertas" value={data.payrollOpen} icon={WalletCards}/><Card label="Férias em atenção" value={data.vacationsDue} icon={CalendarDays}/><Card label="Documentos / exames" value={data.documentsExpiring+data.examsExpiring} icon={FileWarning}/></div><div className="grid gap-4 lg:grid-cols-3"><Panel><b>Admissões pendentes</b><p className="mt-2 text-2xl font-black text-slate-50">{data.admissionsPending}</p></Panel><Panel><b>Solicitações abertas</b><p className="mt-2 text-2xl font-black text-slate-50">{data.requestsOpen}</p></Panel><Panel><b>Funcionários inativos</b><p className="mt-2 text-2xl font-black text-slate-50">{data.inactive}</p></Panel></div><Panel><b className="text-slate-100">Alertas operacionais</b><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{[[data.vacationsDue,"Férias próximas"],[data.documentsExpiring,"Documentos vencendo"],[data.examsExpiring,"Exames vencendo"],[data.admissionsPending,"Admissões em andamento"]].map(([n,l])=><div key={String(l)} className="rounded-xl border border-slate-700 bg-[#141F33] p-3 text-xs"><strong className="text-[#F59E0B]">{n}</strong><span className="ml-2 text-slate-400">{l}</span></div>)}</div></Panel></div>}

function Payroll({data,refresh}:{data:any;refresh:()=>void}){
 const [competence,setCompetence]=useState(month());
 const [selected,setSelected]=useState("");
 const periods:any[]=data.payroll??[];
 const employees:any[]=data.employeesData??[];
 const open=useMutation({mutationFn:()=>createRhPayrollPeriod({data:{competence}}),onSuccess:refresh});
 const calc=useMutation({mutationFn:()=>calculateRhPayroll({data:{period_id:selected}}),onSuccess:refresh});
 const close=useMutation({mutationFn:()=>closeRhPayrollPeriod({data:{period_id:selected}}),onSuccess:refresh});
 const rows=useQuery({queryKey:["rh-payroll"],queryFn:()=>listRhPayroll()});
 const selectedPeriod=periods.find((p:any)=>p.id===selected) ?? (rows.data??[]).find((p:any)=>p.id===selected);
 const exportRows=(selectedPeriod?.rh_payroll_runs??[]).map((run:any)=>({
   ...run,
   employee_name:employees.find((e:any)=>e.id===run.employee_id)?.full_name ?? "Funcionário",
   status:run.status ?? "calculada",
 }));
 const exportCompetence=selectedPeriod ? String(selectedPeriod.competence).slice(0,7) : competence;
 return <div className="space-y-4">
   <Panel>
     <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
       <div className="flex flex-col gap-3 md:flex-row md:items-end">
         <Field label="Competência"><input type="month" value={competence} onChange={e=>setCompetence(e.target.value)} className={inputClass}/></Field>
         <button onClick={()=>open.mutate()} className={buttonClass}>Abrir competência</button>
       </div>
       <div className="text-[11px] text-slate-500">A folha é calculada a partir do cadastro central e dos contratos vigentes.</div>
     </div>
     {open.error&&<ErrorText e={open.error}/>}
   </Panel>
   <Panel>
     <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
       <div>
         <b className="text-slate-100">Competências</b>
         <p className="mt-1 text-[11px] text-slate-500">Selecione uma competência para calcular, fechar ou exportar.</p>
       </div>
       <div className="flex flex-wrap gap-2">
         {periods.map((p:any)=><button key={p.id} onClick={()=>setSelected(p.id)} className={"rounded-lg px-3 py-2 text-xs font-bold "+(selected===p.id?"bg-[#F59E0B] text-slate-950":"bg-slate-800 text-slate-300")}>{String(p.competence).slice(0,7)} · {p.status}</button>)}
       </div>
     </div>
     <div className="mt-4 flex flex-wrap gap-2">
       <button disabled={!selected||calc.isPending} onClick={()=>calc.mutate()} className={buttonClass}><PlayCircle className="h-4 w-4"/>{calc.isPending?"Calculando...":"Calcular folha"}</button>
       <button disabled={!selected||close.isPending} onClick={()=>close.mutate()} className={secondaryButtonClass}><CheckCircle2 className="h-4 w-4"/>{close.isPending?"Fechando...":"Fechar competência"}</button>
       <button disabled={!selected||!exportRows.length} onClick={()=>exportRhPayrollPdf(exportCompetence,exportRows)} className={secondaryButtonClass}><FileDown className="h-4 w-4"/>Exportar PDF</button>
       <button disabled={!selected||!exportRows.length} onClick={()=>exportRhPayrollExcel(exportCompetence,exportRows)} className={secondaryButtonClass}><FileSpreadsheet className="h-4 w-4"/>Exportar Excel</button>
     </div>
     {calc.error&&<ErrorText e={calc.error}/>} {close.error&&<ErrorText e={close.error}/>}
   </Panel>
   <Panel>
     <div className="overflow-x-auto">
       <table className="w-full text-xs">
         <thead className="text-left text-slate-500"><tr><th className="p-2">Competência</th><th className="p-2">Status</th><th className="p-2">Funcionários</th><th className="p-2">Bruto</th><th className="p-2">Descontos</th><th className="p-2">Líquido</th></tr></thead>
         <tbody>{(rows.data??[]).map((p:any)=><tr key={p.id} className="border-t border-slate-800">
           <td className="p-2">{String(p.competence).slice(0,7)}</td><td className="p-2">{p.status}</td><td className="p-2">{p.rh_payroll_runs?.length??0}</td>
           <td className="p-2">{money((p.rh_payroll_runs??[]).reduce((n:number,r:any)=>n+Number(r.gross_cents||0),0))}</td>
           <td className="p-2">{money((p.rh_payroll_runs??[]).reduce((n:number,r:any)=>n+Number(r.discount_cents||0),0))}</td>
           <td className="p-2">{money((p.rh_payroll_runs??[]).reduce((n:number,r:any)=>n+Number(r.net_cents||0),0))}</td>
         </tr>)}</tbody>
       </table>
     </div>
   </Panel>
 </div>
}
function Vacation({employees,data,refresh}:{employees:any[];data:any;refresh:()=>void}){
 const [employee_id,setEmployee]=useState("");const [start_date,setStart]=useState(today());const [end_date,setEnd]=useState(today());const [days,setDays]=useState("30");
 const period=useMutation({mutationFn:()=>createRhVacationPeriod({data:{employee_id,acquisition_start:start_date,acquisition_end:end_date,days_earned:Number(days)}}),onSuccess:refresh}); const mut=useMutation({mutationFn:()=>createRhVacationRequest({data:{employee_id,start_date,end_date,days:Number(days)}}),onSuccess:refresh});
 const approve=useMutation({mutationFn:(x:any)=>updateRhVacationRequest({data:{id:x,status:"aprovada"}}),onSuccess:refresh});
 const reqs:any[]=data.vacationRequests??[];
 return <div className="space-y-4"><Panel><div className="grid gap-3 md:grid-cols-4"><Select label="Funcionário" value={employee_id} onChange={setEmployee} employees={employees}/><Field label="Início"><input type="date" value={start_date} onChange={e=>setStart(e.target.value)} className={inputClass}/></Field><Field label="Fim"><input type="date" value={end_date} onChange={e=>setEnd(e.target.value)} className={inputClass}/></Field><Field label="Dias"><input type="number" value={days} onChange={e=>setDays(e.target.value)} className={inputClass}/></Field></div><div className="mt-3 flex flex-wrap gap-2"><button onClick={()=>mut.mutate()} disabled={!employee_id} className={buttonClass}>Solicitar férias</button><button onClick={()=>period.mutate()} disabled={!employee_id} className={secondaryButtonClass}>Cadastrar período aquisitivo</button></div>{mut.error&&<ErrorText e={mut.error}/>} {period.error&&<ErrorText e={period.error}/>}</Panel><Panel><b>Períodos aquisitivos</b><div className="mt-3 grid gap-2">{(data.vacations??[]).map((v:any)=><div key={v.id} className="rounded-xl border border-slate-700 p-3 text-xs"><strong>{employeeName(employees,v.employee_id)}</strong><span className="ml-2 text-slate-400">{v.acquisition_start} → {v.acquisition_end} · {v.status} · {v.days_used}/{v.days_earned} dias</span>{v.concession_deadline&&<span className="ml-2 text-slate-500">limite {v.concession_deadline}</span>}</div>)}</div>{!(data.vacations??[]).length&&<p className="mt-3 text-xs text-slate-500">Nenhum período aquisitivo cadastrado.</p>}</Panel><Panel><b>Solicitações de férias</b><div className="mt-3 space-y-2">{(data.vacationRequests??[]).map((r:any)=><div key={r.id} className="flex flex-col gap-2 rounded-xl border border-slate-700 p-3 text-xs sm:flex-row sm:items-center sm:justify-between"><span><strong>{employeeName(employees,r.employee_id)}</strong><span className="ml-2 text-slate-400">{r.start_date} → {r.end_date} · {r.days} dias · {r.status}</span></span>{r.status==="solicitada"&&<div className="flex gap-2"><button className={buttonClass} onClick={()=>approve.mutate(r.id)}>Aprovar</button></div>}</div>)}</div></Panel></div>
}

function TimeAdjustments({employees,refresh}:{employees:any[];refresh:()=>void}){
 const [employee_id,setEmployee]=useState("");const [reference_date,setDate]=useState(today());const [adjustment_type,setType]=useState("acrescimo");const [minutes,setMinutes]=useState("0");const [reason,setReason]=useState("");
 const adjustments=useQuery({queryKey:["rh-time-adjustments"],queryFn:()=>listRhTimeAdjustments()}); const decision=useMutation({mutationFn:(x:{id:string;status:"aprovado"|"reprovado"})=>updateRhTimeAdjustment({data:x}),onSuccess:()=>{refresh();adjustments.refetch();}}); const mut=useMutation({mutationFn:()=>createRhTimeAdjustment({data:{employee_id,reference_date,adjustment_type,minutes:Number(minutes),reason}}),onSuccess:()=>{refresh();adjustments.refetch();}});
 return <div className="space-y-4"><Panel><div className="grid gap-3 md:grid-cols-3"><Select label="Funcionário" value={employee_id} onChange={setEmployee} employees={employees}/><Field label="Data"><input type="date" value={reference_date} onChange={e=>setDate(e.target.value)} className={inputClass}/></Field><Field label="Minutos"><input type="number" value={minutes} onChange={e=>setMinutes(e.target.value)} className={inputClass}/></Field></div><div className="mt-3 grid gap-3 md:grid-cols-2"><Field label="Tipo"><select value={adjustment_type} onChange={e=>setType(e.target.value)} className={inputClass}><option value="acrescimo">Acréscimo</option><option value="desconto">Desconto</option><option value="abono">Abono</option></select></Field><Field label="Motivo"><input value={reason} onChange={e=>setReason(e.target.value)} className={inputClass} placeholder="Motivo obrigatório"/></Field></div><button onClick={()=>mut.mutate()} disabled={!employee_id||!reason} className={buttonClass+" mt-3"}><Clock3 className="h-4 w-4"/>Registrar ajuste</button>{mut.error&&<ErrorText e={mut.error}/>}</Panel><Panel><p className="text-xs text-slate-400">As batidas originais permanecem intactas. Ajustes são eventos separados, com motivo, responsável e aprovação.</p><div className="mt-4 space-y-2">{(adjustments.data??[]).slice(0,20).map((a:any)=><div key={a.id} className="flex flex-col gap-2 rounded-xl border border-slate-700 bg-[#141F33] p-3 text-xs sm:flex-row sm:items-center sm:justify-between"><span><strong className="text-slate-100">{employeeName(employees,a.employee_id)}</strong><span className="ml-2 text-slate-400">{a.reference_date} · {a.minutes} min · {a.adjustment_type} · {a.status}</span><span className="ml-2 text-slate-500">{a.reason}</span></span><div className="flex items-center gap-2"><span className={"rounded-full px-2 py-1 text-[10px] font-black "+(a.status==="aprovado"?"bg-emerald-500/10 text-emerald-300":a.status==="reprovado"?"bg-red-500/10 text-red-300":"bg-amber-500/10 text-amber-300")}>{a.status}</span>{a.status==="pendente"&&<><button className={buttonClass} onClick={()=>decision.mutate({id:a.id,status:"aprovado"})}>Aprovar</button><button className={secondaryButtonClass} onClick={()=>decision.mutate({id:a.id,status:"reprovado"})}>Reprovar</button></>}</div></div>)}</div></Panel></div>
}

function Admission({employees,refresh}:{employees:any[];refresh:()=>void}){
 const [employee_id,setEmployee]=useState("");const [expected_start,setStart]=useState(today());const [termination_date,setTerm]=useState(today());const [reason,setReason]=useState("");
 const adm=useMutation({mutationFn:()=>createRhAdmission({data:{employee_id,expected_start}}),onSuccess:refresh});
 const term=useMutation({mutationFn:()=>createRhTermination({data:{employee_id,termination_date,reason}}),onSuccess:refresh});
 return <div className="grid gap-4 lg:grid-cols-2"><Panel><UserPlus className="h-5 w-5 text-[#F59E0B]"/><h3 className="mt-2 font-black text-slate-50">Admissão</h3><Select label="Funcionário do cadastro central" value={employee_id} onChange={setEmployee} employees={employees}/><Field label="Previsão de início"><input type="date" value={expected_start} onChange={e=>setStart(e.target.value)} className={inputClass}/></Field><button onClick={()=>adm.mutate()} disabled={!employee_id} className={buttonClass+" mt-3"}>Abrir processo</button>{adm.error&&<ErrorText e={adm.error}/>}</Panel><Panel><ClipboardList className="h-5 w-5 text-[#F59E0B]"/><h3 className="mt-2 font-black text-slate-50">Desligamento</h3><Select label="Funcionário" value={employee_id} onChange={setEmployee} employees={employees}/><Field label="Data"><input type="date" value={termination_date} onChange={e=>setTerm(e.target.value)} className={inputClass}/></Field><Field label="Motivo"><input value={reason} onChange={e=>setReason(e.target.value)} className={inputClass}/></Field><button onClick={()=>term.mutate()} disabled={!employee_id} className={buttonClass+" mt-3"}>Abrir desligamento</button>{term.error&&<ErrorText e={term.error}/>}</Panel></div>
}

function Sst({employees,data,refresh}:{employees:any[];data:any;refresh:()=>void}){
 const [employee_id,setEmployee]=useState("");const [exam_type,setType]=useState("ASO");const [exam_date,setDate]=useState(today());const [valid_until,setValid]=useState("");const [result,setResult]=useState("Apto");const [provider,setProvider]=useState("");
 const mut=useMutation({mutationFn:()=>createRhMedicalExam({data:{employee_id,exam_type,exam_date,valid_until,result,provider}}),onSuccess:refresh});
 return <div className="space-y-4"><Panel><HeartPulse className="h-5 w-5 text-[#F59E0B]"/><h3 className="mt-2 font-black text-slate-50">Exames e SST</h3><div className="grid gap-3 md:grid-cols-3"><Select label="Funcionário" value={employee_id} onChange={setEmployee} employees={employees}/><Field label="Tipo"><input value={exam_type} onChange={e=>setType(e.target.value)} className={inputClass}/></Field><Field label="Resultado"><input value={result} onChange={e=>setResult(e.target.value)} className={inputClass}/></Field><Field label="Data"><input type="date" value={exam_date} onChange={e=>setDate(e.target.value)} className={inputClass}/></Field><Field label="Validade"><input type="date" value={valid_until} onChange={e=>setValid(e.target.value)} className={inputClass}/></Field><Field label="Prestador"><input value={provider} onChange={e=>setProvider(e.target.value)} className={inputClass}/></Field></div><button onClick={()=>mut.mutate()} disabled={!employee_id} className={buttonClass+" mt-3"}>Registrar exame</button>{mut.error&&<ErrorText e={mut.error}/>}</Panel><Panel><b>Exames próximos do vencimento</b><div className="mt-3 space-y-2">{(data.exams??[]).filter((e:any)=>e.valid_until).slice(0,12).map((e:any)=><div key={e.id} className="rounded-xl border border-slate-700 p-3 text-xs"><strong>{employeeName(employees,e.employee_id)}</strong><span className="ml-2 text-slate-400">{e.exam_type} · validade {e.valid_until}</span></div>)}</div></Panel></div>
}

function Requests({employees,data,refresh}:{employees:any[];data:any;refresh:()=>void}){
 const [employee_id,setEmployee]=useState("");const [request_type,setType]=useState("atestado");const mut=useMutation({mutationFn:()=>createRhEmployeeRequest({data:{employee_id,request_type}}),onSuccess:refresh});const resolve=useMutation({mutationFn:(id:string)=>resolveRhEmployeeRequest({data:{id,status:"resolvida"}}),onSuccess:refresh});
 return <div className="space-y-4"><Panel><div className="grid gap-3 md:grid-cols-2"><Select label="Funcionário" value={employee_id} onChange={setEmployee} employees={employees}/><Field label="Tipo"><input value={request_type} onChange={e=>setType(e.target.value)} className={inputClass}/></Field></div><button onClick={()=>mut.mutate()} disabled={!employee_id} className={buttonClass+" mt-3"}>Abrir solicitação</button>{mut.error&&<ErrorText e={mut.error}/>}</Panel><Panel><b>Fila de solicitações</b><div className="mt-3 space-y-2">{(data.requests??[]).map((r:any)=><div key={r.id} className="flex flex-col gap-2 rounded-xl border border-slate-700 p-3 text-xs sm:flex-row sm:items-center sm:justify-between"><span><strong>{employeeName(employees,r.employee_id)}</strong><span className="ml-2 text-slate-400">{r.request_type} · {r.status}</span></span>{r.status!=="resolvida"&&<button className={secondaryButtonClass} onClick={()=>resolve.mutate(r.id)}>Resolver</button>}</div>)}</div></Panel></div>
}

function employeeName(employees:any[],id:string){return employees.find(e=>e.id===id)?.full_name??"Funcionário"}
function Field({label,children}:{label:string;children:React.ReactNode}){return <label className="mt-3 block text-xs font-bold text-slate-300">{label}{children}</label>}
function Select({label,value,onChange,employees}:{label:string;value:string;onChange:(v:string)=>void;employees:any[]}){return <Field label={label}><select value={value} onChange={e=>onChange(e.target.value)} className={inputClass}><option value="">Selecione…</option>{employees.filter(e=>e.is_active).map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}</select></Field>}
function ErrorText({e}:{e:unknown}){return <p className="mt-3 text-xs font-semibold text-red-300">{e instanceof Error?e.message:"Não foi possível concluir a operação."}</p>}
