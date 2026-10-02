import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, CheckCircle2, Clock3, FileText, PenLine, Plus, Send, WalletCards, X, Eraser } from "lucide-react";
import { createMyRhEmployeeRequest, createMyRhEmployeeValeRequest, listMyRhEmployeeRequests } from "@/lib/rh.employee.functions";

const TYPES = [
  ["atestado", "Atestado / afastamento"],
  ["correcao_ponto", "Correção de ponto"],
  ["ferias", "Férias"],
  ["beneficio", "Benefício / vale"],
  ["documento", "Documento / ficha"],
  ["pagamento", "Pagamento / folha"],
  ["outros", "Outra solicitação"],
] as const;
const statusLabel: Record<string, string> = { aberta: "Aberta", em_analise: "Em análise", resolvida: "Resolvida", cancelada: "Cancelada" };
const statusClass: Record<string, string> = {
  aberta: "bg-amber-50 text-amber-700 border-amber-200",
  em_analise: "bg-sky-50 text-sky-700 border-sky-200",
  resolvida: "bg-emerald-50 text-emerald-700 border-emerald-200",
  cancelada: "bg-slate-100 text-slate-600 border-slate-200",
};

function localCompetence() { const d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0"); }
function money(c:number){return new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(c/100);}

export function EmployeeRhRequestsPanel() {
  const qc = useQueryClient();
  const requests = useQuery({ queryKey: ["my-rh-requests"], queryFn: () => listMyRhEmployeeRequests(), retry: false });
  const [open, setOpen] = useState(false);
  const [valeOpen, setValeOpen] = useState(false);
  const [type, setType] = useState("correcao_ponto");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState("");
  const [priority, setPriority] = useState("normal");
  const [amount, setAmount] = useState("");
  const [competence, setCompetence] = useState(localCompetence());
  const [valeType, setValeType] = useState<"VALE"|"ADIANTAMENTO">("VALE");
  const [signatureName, setSignatureName] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  const save = useMutation({
    mutationFn: () => createMyRhEmployeeRequest({ data: { request_type: type, title, description, reference_date: date || undefined, priority } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["my-rh-requests"] }); setOpen(false); setTitle(""); setDescription(""); setDate(""); setPriority("normal"); },
  });
  const vale = useMutation({
    mutationFn: () => {
      const canvas=canvasRef.current;
      if(!canvas) throw new Error("Área de assinatura indisponível.");
      return createMyRhEmployeeValeRequest({data:{
        advance_type: valeType,
        amount_cents: Math.round(Number(amount.replace(/\./g,"").replace(",", "."))*100),
        competence,
        reason: description,
        signature_name: signatureName,
        signature_data: canvas.toDataURL("image/png"),
      }});
    },
    onSuccess:()=>{qc.invalidateQueries({queryKey:["my-rh-requests"]});setValeOpen(false);setAmount("");setDescription("");setSignatureName("");clearSignature();},
  });

  useEffect(()=>{ if(!valeOpen) return; const canvas=canvasRef.current; if(!canvas)return; const ratio=window.devicePixelRatio||1; canvas.width=700*ratio; canvas.height=180*ratio; canvas.style.width="100%"; canvas.style.height="180px"; const ctx=canvas.getContext("2d"); if(ctx){ctx.scale(ratio,ratio);ctx.lineWidth=2;ctx.lineCap="round";ctx.strokeStyle="#0f172a";}},[valeOpen]);
  const point=(e:PointerEvent)=>{const canvas=canvasRef.current;if(!canvas)return;const rect=canvas.getBoundingClientRect();return{x:e.clientX-rect.left,y:e.clientY-rect.top};};
  const start=(e:ReactPointerEvent<HTMLCanvasElement>)=>{drawing.current=true;const p=point(e.nativeEvent);if(!p)return;const ctx=canvasRef.current?.getContext("2d");ctx?.beginPath();ctx?.moveTo(p.x,p.y);canvasRef.current?.setPointerCapture(e.pointerId);};
  const move=(e:ReactPointerEvent<HTMLCanvasElement>)=>{if(!drawing.current)return;const p=point(e.nativeEvent);if(!p)return;const ctx=canvasRef.current?.getContext("2d");ctx?.lineTo(p.x,p.y);ctx?.stroke();};
  const end=()=>{drawing.current=false;};
  function clearSignature(){const canvas=canvasRef.current;if(!canvas)return;const ctx=canvas.getContext("2d");if(ctx)ctx.clearRect(0,0,canvas.width,canvas.height);}

  const formatDate = (v: string) => new Date(v).toLocaleDateString("pt-BR");
  return (
    <section className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-col gap-3 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-sky-100 text-sky-700"><BellRing className="h-5 w-5" /></div><div><p className="text-[10px] font-black uppercase tracking-[.18em] text-sky-600">Atendimento interno</p><h2 className="text-lg font-black text-slate-900">Solicitações ao RH</h2><p className="text-xs text-slate-500">Acompanhe ponto, documentos, benefícios e valores solicitados.</p></div></div>
        <div className="flex flex-wrap gap-2"><button onClick={()=>setValeOpen(true)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white shadow-sm hover:bg-emerald-700"><WalletCards className="h-4 w-4"/> Solicitar vale</button><button onClick={()=>setOpen(true)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-xs font-black text-white shadow-sm hover:bg-sky-700"><Plus className="h-4 w-4"/> Nova solicitação</button></div>
      </header>
      <div className="p-5">
        {requests.isError ? <p className="rounded-xl bg-slate-50 p-4 text-xs text-slate-500">O atendimento ao RH será liberado assim que seu usuário estiver vinculado ao cadastro central.</p> :
        requests.isLoading ? <p className="p-4 text-xs text-slate-500">Carregando solicitações…</p> :
        !(requests.data ?? []).length ? <div className="rounded-xl border border-dashed border-slate-200 p-7 text-center"><FileText className="mx-auto h-7 w-7 text-slate-300" /><p className="mt-2 text-sm font-bold text-slate-700">Nenhuma solicitação registrada</p><p className="mt-1 text-xs text-slate-400">Quando precisar do RH, registre aqui e acompanhe o andamento.</p></div> :
        <div className="grid gap-3 md:grid-cols-2">{(requests.data ?? []).map((r:any) => <article key={r.id} className="rounded-xl border border-slate-200 p-4">
          <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{TYPES.find(x=>x[0]===r.request_type)?.[1] ?? (r.request_type==="vale"?"Solicitação de vale":r.request_type)}</p><h3 className="mt-1 text-sm font-black text-slate-800">{r.payload?.title ?? "Solicitação ao RH"}</h3></div><span className={"rounded-full border px-2 py-1 text-[10px] font-black "+(statusClass[r.status]??statusClass.aberta)}>{statusLabel[r.status]??r.status}</span></div>
          <p className="mt-2 line-clamp-3 text-xs leading-5 text-slate-500">{r.payload?.description ?? "—"}</p>
          {r.request_type==="vale" && <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-black text-emerald-700"><span>{money(Number(r.payload?.amount_cents||0))}</span><span>· {r.payload?.competence}</span><span>· Assinado por {r.payload?.signature_name||"colaborador"}</span></div>}
          <div className="mt-3 flex flex-wrap gap-3 text-[10px] font-semibold text-slate-400"><span>Aberta em {formatDate(r.requested_at)}</span>{r.payload?.reference_date && <span>Referência: {new Date(r.payload.reference_date+"T12:00:00").toLocaleDateString("pt-BR")}</span>}</div>
        </article>)}</div>}
      </div>

      {open && <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/60 p-4"><div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between"><div><p className="text-[10px] font-black uppercase tracking-[.18em] text-sky-600">RH · nova solicitação</p><h3 className="mt-1 text-xl font-black text-slate-900">Como podemos ajudar?</h3></div><button onClick={()=>setOpen(false)}><X className="h-5 w-5 text-slate-400"/></button></div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="text-xs font-bold text-slate-700">Tipo<select value={type} onChange={e=>setType(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm">{TYPES.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
          <label className="text-xs font-bold text-slate-700">Prioridade<select value={priority} onChange={e=>setPriority(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"><option value="normal">Normal</option><option value="alta">Alta</option></select></label>
          <label className="text-xs font-bold text-slate-700 sm:col-span-2">Título<input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Ex.: Corrigir batida de 01/10" className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-sky-500"/></label>
          <label className="text-xs font-bold text-slate-700">Data relacionada<input type="date" value={date} onChange={e=>setDate(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"/></label>
          <label className="text-xs font-bold text-slate-700 sm:col-span-2">Descrição<textarea value={description} onChange={e=>setDescription(e.target.value)} rows={5} placeholder="Explique o que aconteceu e o que você precisa do RH." className="mt-1 w-full resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-sky-500"/></label>
        </div>
        {save.error && <p className="mt-3 rounded-xl bg-red-50 p-3 text-xs font-semibold text-red-700">{save.error instanceof Error?save.error.message:"Não foi possível enviar."}</p>}
        <div className="mt-5 flex justify-end gap-2"><button onClick={()=>setOpen(false)} className="rounded-xl px-4 py-2.5 text-xs font-bold text-slate-500">Cancelar</button><button onClick={()=>save.mutate()} disabled={save.isPending||!title.trim()||description.trim().length<10} className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-5 py-2.5 text-xs font-black text-white disabled:opacity-50"><Send className="h-4 w-4"/>{save.isPending?"Enviando…":"Enviar ao RH"}</button></div>
      </div></div>}

      {valeOpen && <div className="fixed inset-0 z-[90] overflow-y-auto bg-slate-950/70 p-3 sm:p-4"><div className="mx-auto my-2 w-full max-w-3xl max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl sm:my-4 sm:max-h-[calc(100dvh-2rem)] sm:p-6">
        <div className="flex items-start justify-between"><div><p className="text-[10px] font-black uppercase tracking-[.18em] text-emerald-600">RH · solicitação financeira</p><h3 className="mt-1 text-xl font-black text-slate-900">Solicitar vale</h3><p className="mt-1 text-xs text-slate-500">O pedido será enviado ao RH e só entra na folha depois da autorização.</p></div><button onClick={()=>setValeOpen(false)}><X className="h-5 w-5 text-slate-400"/></button></div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="text-xs font-bold text-slate-700">Tipo<select value={valeType} onChange={e=>setValeType(e.target.value as "VALE"|"ADIANTAMENTO")} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"><option value="VALE">Vale</option><option value="ADIANTAMENTO">Adiantamento salarial</option></select></label>
          <label className="text-xs font-bold text-slate-700">Valor solicitado (R$)<input value={amount} onChange={e=>setAmount(e.target.value)} inputMode="decimal" placeholder="0,00" className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"/></label>
          <label className="text-xs font-bold text-slate-700">Competência<input type="month" value={competence} onChange={e=>setCompetence(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"/></label>
          <label className="text-xs font-bold text-slate-700 sm:col-span-2">Mensagem (opcional)<textarea value={description} onChange={e=>setDescription(e.target.value)} rows={3} placeholder="Se quiser, deixe uma mensagem para o RH (opcional)." className="mt-1 w-full resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm"/></label>
          <label className="text-xs font-bold text-slate-700 sm:col-span-2">Nome completo para assinatura<input value={signatureName} onChange={e=>setSignatureName(e.target.value)} placeholder="Digite seu nome completo" className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"/></label>
          <div className="sm:col-span-2 rounded-2xl border border-slate-200 bg-slate-50 p-3"><div className="flex items-center justify-between"><div><p className="flex items-center gap-2 text-xs font-black text-slate-800"><PenLine className="h-4 w-4"/> Assinatura digital</p><p className="mt-1 text-[10px] text-slate-500">Desenhe sua assinatura no quadro.</p></div><button onClick={clearSignature} type="button" className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-bold text-slate-500"><Eraser className="h-3 w-3"/> Limpar</button></div><canvas ref={canvasRef} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} className="mt-3 h-[180px] w-full touch-none rounded-xl border border-dashed border-slate-300 bg-white"/></div>
          <div className="sm:col-span-2 rounded-xl bg-amber-50 p-3 text-[11px] leading-5 text-amber-800"><strong>Confirmação:</strong> ao enviar, você confirma que as informações e o valor solicitados são verdadeiros. O RH fará a análise e autorização.</div>
        </div>
        {vale.error && <p className="mt-3 rounded-xl bg-red-50 p-3 text-xs font-semibold text-red-700">{vale.error instanceof Error?vale.error.message:"Não foi possível enviar o vale."}</p>}
        <div className="mt-5 flex justify-end gap-2"><button onClick={()=>setValeOpen(false)} className="rounded-xl px-4 py-2.5 text-xs font-bold text-slate-500">Cancelar</button><button onClick={()=>vale.mutate()} disabled={vale.isPending||!signatureName.trim()||Number(amount.replace(/\./g,"").replace(",","."))<=0} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-black text-white disabled:opacity-50"><CheckCircle2 className="h-4 w-4"/>{vale.isPending?"Enviando…":"Assinar e enviar ao RH"}</button></div>
      </div></div>}
    </section>
  );
}
