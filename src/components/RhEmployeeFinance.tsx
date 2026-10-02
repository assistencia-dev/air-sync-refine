import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Download, Plus, WalletCards } from "lucide-react";
import { createRhEmployeeAdvance, cancelRhEmployeeAdvance, listRhEmployeeAdvances } from "@/lib/rh.finance.functions";
import { listRhEmployeeRegistry } from "@/lib/rh.functions";
import { listRhPayroll } from "@/lib/rh.dp.functions";

const money=(c:number)=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(c||0)/100);
const toCents=(v:string)=>Math.round(Number(String(v).replace(/\./g,"").replace(",",".")) * 100);
const fmtCompetence=(v:string)=>v.slice(0,7);
function downloadCsv(filename:string, rows:string[][]){
  const csv=rows.map(row=>row.map(v=>"\""+String(v??"").replace(/\"/g,'\"\"')+"\"").join(";")).join("\n");
  const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);
}

export function RhEmployeeFinance(){
  const qc=useQueryClient();
  const employees=useQuery({queryKey:["rh-finance-employees"],queryFn:()=>listRhEmployeeRegistry()});
  const advances=useQuery({queryKey:["rh-employee-advances"],queryFn:()=>listRhEmployeeAdvances()});
  const payroll=useQuery({queryKey:["rh-payroll"],queryFn:()=>listRhPayroll()});
  const [employeeId,setEmployeeId]=useState(""); const [type,setType]=useState<"VALE"|"ADIANTAMENTO"|"OUTRO">("VALE");
  const [description,setDescription]=useState(""); const [amount,setAmount]=useState(""); const [competence,setCompetence]=useState(new Date().toISOString().slice(0,7)); const [authorized,setAuthorized]=useState(false);
  const save=useMutation({mutationFn:()=>createRhEmployeeAdvance({data:{employee_id:employeeId,advance_type:type,description,amount_cents:toCents(amount),competence,authorized}}),onSuccess:()=>{qc.invalidateQueries({queryKey:["rh-employee-advances"]});setDescription("");setAmount("");}});
  const cancel=useMutation({mutationFn:(id:string)=>cancelRhEmployeeAdvance({data:{id}}),onSuccess:()=>qc.invalidateQueries({queryKey:["rh-employee-advances"]})});
  const active=useMemo(()=> (advances.data??[]).filter(a=>a.status!=="cancelado"),[advances.data]);
  const totalProgramado=active.filter(a=>a.status==="programado").reduce((n,a)=>n+Number(a.amount_cents||0),0);
  const totalDescontado=active.filter(a=>a.status==="descontado").reduce((n,a)=>n+Number(a.amount_cents||0),0);
  const selected=employees.data?.find((e:any)=>e.id===employeeId) as any;
  const salaryRaw=selected?.registration_data?.salary??"0"; const salaryCents=selected?Math.round(Number(String(salaryRaw).replace(/[^0-9,.-]/g,"").replace(/\./g,"").replace(",","."))*100):0;
  const selectedAdvances=active.filter(a=>a.employee_id===employeeId);
  const selectedNet=payroll.data?.flatMap((p:any)=>p.rh_payroll_runs??[]).find((r:any)=>r.employee_id===employeeId);
  return <section className="space-y-4">
    <div className="rounded-2xl border border-slate-800 bg-[#1E293B] p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-[10px] font-black uppercase tracking-[.18em] text-[#F59E0B]">RH · financeiro do colaborador</p><h2 className="mt-1 text-xl font-black text-slate-50">Vales e descontos em folha</h2><p className="mt-1 max-w-3xl text-xs leading-5 text-slate-400">Registre o valor que o colaborador recebeu, associe à competência e, quando houver autorização, o valor entra como desconto no cálculo da folha. O cadastro do funcionário continua sendo a fonte dos dados salariais.</p></div><button onClick={()=>downloadCsv("rh_vales_descontos.csv",[["Funcionário","Tipo","Descrição","Competência","Valor","Autorizado","Status"],...active.map((a:any)=>[a.employee?.full_name??"",a.advance_type,a.description,fmtCompetence(a.competence),money(a.amount_cents),a.authorized?"Sim":"Não",a.status])])} className="inline-flex items-center gap-2 rounded-xl bg-slate-800 px-3 py-2 text-xs font-bold text-slate-200"><Download className="h-4 w-4"/>Exportar CSV</button></div>
      <div className="mt-5 grid gap-3 sm:grid-cols-3"><Kpi label="Programado" value={money(totalProgramado)}/><Kpi label="Já descontado" value={money(totalDescontado)}/><Kpi label="Lançamentos ativos" value={active.length}/></div>
    </div>
    <div className="grid gap-4 xl:grid-cols-[1.05fr_.95fr]">
      <div className="rounded-2xl border border-slate-800 bg-[#1E293B] p-5">
        <div className="mb-4 flex items-center gap-2"><WalletCards className="h-5 w-5 text-[#F59E0B]"/><h3 className="font-black text-slate-50">Novo vale / adiantamento</h3></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-bold text-slate-300 sm:col-span-2">Funcionário<select value={employeeId} onChange={e=>setEmployeeId(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-[#141F33] px-3 py-2.5 text-sm text-slate-100"><option value="">Selecione o funcionário</option>{(employees.data??[]).filter((e:any)=>e.is_active).map((e:any)=><option key={e.id} value={e.id}>{e.full_name} · {e.unit}</option>)}</select></label>
          {selected && <div className="sm:col-span-2 rounded-xl border border-sky-500/20 bg-sky-500/5 p-4"><p className="text-[10px] font-black uppercase tracking-wider text-sky-300">Dados da ficha</p><div className="mt-2 grid gap-2 sm:grid-cols-3 text-xs"><span><b className="text-slate-500">Cargo</b><br/>{selected.registration_data?.job_title||"Não informado"}</span><span><b className="text-slate-500">Salário cadastrado</b><br/>{salaryCents?money(salaryCents):"Não informado"}</span><span><b className="text-slate-500">Unidade</b><br/>{selected.unit||"—"}</span></div>{selectedNet&&<p className="mt-3 text-xs text-slate-400">Último líquido calculado: <strong className="text-emerald-300">{money(selectedNet.net_cents)}</strong></p>}</div>}
          <label className="text-xs font-bold text-slate-300">Tipo<select value={type} onChange={e=>setType(e.target.value as any)} className="mt-1 w-full rounded-xl border border-slate-700 bg-[#141F33] px-3 py-2.5 text-sm text-slate-100"><option value="VALE">Vale</option><option value="ADIANTAMENTO">Adiantamento salarial</option><option value="OUTRO">Outro desconto autorizado</option></select></label>
          <label className="text-xs font-bold text-slate-300">Competência<input type="month" value={competence} onChange={e=>setCompetence(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-[#141F33] px-3 py-2.5 text-sm text-slate-100"/></label>
          <label className="text-xs font-bold text-slate-300">Valor (R$)<input value={amount} onChange={e=>setAmount(e.target.value)} inputMode="decimal" placeholder="0,00" className="mt-1 w-full rounded-xl border border-slate-700 bg-[#141F33] px-3 py-2.5 text-sm text-slate-100"/></label>
          <label className="text-xs font-bold text-slate-300 sm:col-span-2">Descrição<input value={description} onChange={e=>setDescription(e.target.value)} placeholder="Ex.: Vale salarial referente à quinzena" className="mt-1 w-full rounded-xl border border-slate-700 bg-[#141F33] px-3 py-2.5 text-sm text-slate-100"/></label>
          <label className="sm:col-span-2 flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs font-semibold text-slate-300"><input type="checkbox" checked={authorized} onChange={e=>setAuthorized(e.target.checked)} className="mt-0.5"/> <span>Desconto autorizado pelo colaborador e apto a entrar na folha. Sem autorização, o lançamento fica registrado, mas não é descontado.</span></label>
        </div>
        <button onClick={()=>save.mutate()} disabled={save.isPending||!employeeId||!description.trim()||toCents(amount)<=0} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#F59E0B] px-4 py-2.5 text-xs font-black text-slate-950 disabled:opacity-50"><Plus className="h-4 w-4"/>{save.isPending?"Salvando…":"Registrar vale"}</button>
        {save.error&&<p className="mt-3 text-xs font-semibold text-red-300">{save.error instanceof Error?save.error.message:"Não foi possível registrar."}</p>}
      </div>
      <div className="rounded-2xl border border-slate-800 bg-[#1E293B] p-5"><h3 className="font-black text-slate-50">Resumo do funcionário</h3>{!employeeId?<p className="mt-3 text-xs text-slate-500">Selecione um colaborador para visualizar os lançamentos dele.</p>:<><div className="mt-3 grid grid-cols-2 gap-3"><Kpi label="Lançamentos" value={selectedAdvances.length}/><Kpi label="Total" value={money(selectedAdvances.reduce((n,a)=>n+Number(a.amount_cents||0),0))}/></div><div className="mt-4 space-y-2">{selectedAdvances.map((a:any)=><div key={a.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-700 bg-[#141F33] p-3"><div><p className="text-xs font-bold text-slate-100">{a.description}</p><p className="mt-1 text-[10px] text-slate-500">{fmtCompetence(a.competence)} · {a.status} · {a.authorized?"Autorizado":"Sem autorização"}</p></div><div className="flex items-center gap-2"><b className="text-xs text-slate-200">{money(a.amount_cents)}</b>{a.status==="programado"&&<button title="Cancelar" onClick={()=>cancel.mutate(a.id)} className="rounded-lg p-2 text-red-300 hover:bg-red-500/10"><Ban className="h-4 w-4"/></button>}</div></div>)}</div></>}</div>
    </div>
  </section>
}
function Kpi({label,value}:{label:string;value:React.ReactNode}){return <div className="rounded-xl border border-slate-700 bg-[#141F33] p-4"><p className="text-[10px] font-black uppercase tracking-wider text-slate-500">{label}</p><p className="mt-1 text-lg font-black text-slate-50">{value}</p></div>}
