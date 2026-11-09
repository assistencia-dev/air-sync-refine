import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelRhVtTopup, createRhVtTopupsBatch, listRhVtEmployees, listRhVtTopups,
  listRhVtTopupAudit, saveRhVtEmployeeConfig, updateRhVtTopup,
} from "@/lib/rh.vt.functions";

const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};
const field = "w-full rounded-lg border border-slate-700 bg-[#0F172A] px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500";

export function RhVtPanel() {
  const qc = useQueryClient();
  const [employeeId, setEmployeeId] = useState("");
  const [lines, setLines] = useState("");
  const [fare, setFare] = useState("");
  const [trips, setTrips] = useState("2");
  const [configCostCenter, setConfigCostCenter] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(today());
  const [costCenter, setCostCenter] = useState("");
  const [receiptPath, setReceiptPath] = useState("");
  const [filterEmployee, setFilterEmployee] = useState("");
  const [filterMonth, setFilterMonth] = useState(String(new Date().getMonth()+1));
  const [filterYear, setFilterYear] = useState(String(new Date().getFullYear()));
  const [editing, setEditing] = useState<any>(null);
  const [reason, setReason] = useState("");
  const [auditId, setAuditId] = useState("");
  const [error, setError] = useState("");

  const employees = useQuery({ queryKey: ["rh-vt-employees"], queryFn: () => listRhVtEmployees() });
  const topups = useQuery({
    queryKey: ["rh-vt-topups", filterEmployee, filterMonth, filterYear],
    queryFn: () => listRhVtTopups({ data: {
      employee_id: filterEmployee || undefined,
      competence_year: Number(filterYear), competence_month: Number(filterMonth),
    }}),
  });
  const audit = useQuery({
    queryKey: ["rh-vt-audit", auditId],
    queryFn: () => listRhVtTopupAudit({ data: { topup_id: auditId } }),
    enabled: Boolean(auditId),
  });
  const rows = employees.data ?? [];
  const configured = rows.filter((e: any) => e.config?.is_active);
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["rh-vt-employees"] });
    qc.invalidateQueries({ queryKey: ["rh-vt-topups"] });
    qc.invalidateQueries({ queryKey: ["rh-vt-audit"] });
  };
  const saveConfig = useMutation({
    mutationFn: () => saveRhVtEmployeeConfig({ data: {
      employee_id: employeeId, transit_lines: lines.split(",").map(v => v.trim()).filter(Boolean),
      fare_cents: Math.round(Number(fare.replace(",", "."))*100), trips_per_day: Number(trips),
      recharge_rule: { mode: "manual", competence: "month_of_recharge" }, cost_center: configCostCenter,
    }}),
    onSuccess: () => { setError(""); invalidate(); setEmployeeId(""); setLines(""); setFare(""); },
    onError: (e: any) => setError(e.message),
  });
  const createBatch = useMutation({
    mutationFn: () => createRhVtTopupsBatch({ data: { rows: selected.map(id => ({
      employee_id: id, paid_at: paidAt, amount_cents: Math.round(Number(amount.replace(",", "."))*100),
      cost_center: costCenter || null, receipt_storage_path: receiptPath || null,
    })) }}),
    onSuccess: () => { setError(""); setSelected([]); setAmount(""); setReceiptPath(""); invalidate(); },
    onError: (e: any) => setError(e.message),
  });
  const editTopup = useMutation({
    mutationFn: () => updateRhVtTopup({ data: {
      id: editing.id, amount_cents: Math.round(Number(editing.amount)/100),
      paid_at: editing.paid_at, cost_center: editing.cost_center, receipt_storage_path: editing.receipt_storage_path,
      reason,
    }}),
    onSuccess: () => { setEditing(null); setReason(""); setError(""); invalidate(); },
    onError: (e: any) => setError(e.message),
  });
  const cancelTopup = useMutation({
    mutationFn: (id: string) => cancelRhVtTopup({ data: { id, reason } }),
    onSuccess: () => { setReason(""); setError(""); invalidate(); },
    onError: (e: any) => setError(e.message),
  });
  const total = useMemo(() => (topups.data ?? []).filter((r: any) => r.status === "ativa")
    .reduce((sum: number, r: any) => sum + Number(r.amount_cents), 0), [topups.data]);

  return <section className="space-y-6 rounded-2xl border border-slate-800 bg-[#1E293B] p-5 text-slate-100 sm:p-7">
    <header>
      <p className="text-[10px] font-bold uppercase tracking-[.2em] text-amber-400">RH · controle auditável</p>
      <h2 className="mt-1 text-2xl font-black">Vale-Transporte</h2>
      <p className="mt-1 text-xs text-slate-400">Cadastro central, configuração, recargas individuais ou em lote e histórico com auditoria.</p>
    </header>
    {error && <p className="rounded-lg bg-red-500/10 p-3 text-xs text-red-300">{error}</p>}
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-3 rounded-xl border border-slate-700 bg-[#141F33] p-4">
        <h3 className="font-bold">Configurar funcionário</h3>
        <select className={field} value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
          <option value="">Selecione do Cadastro de Funcionários</option>
          {rows.map((e: any) => <option key={e.id} value={e.id}>{e.full_name} · {e.unit}{e.config ? " · VT configurado" : ""}</option>)}
        </select>
        <input className={field} value={lines} onChange={e => setLines(e.target.value)} placeholder="Linhas de transporte (separadas por vírgula)" />
        <div className="grid grid-cols-2 gap-3">
          <input className={field} value={fare} onChange={e => setFare(e.target.value)} placeholder="Tarifa por viagem (R$)" inputMode="decimal" />
          <input className={field} type="number" min="1" max="12" value={trips} onChange={e => setTrips(e.target.value)} placeholder="Viagens/dia" />
        </div>
        <input className={field} value={configCostCenter} onChange={e => setConfigCostCenter(e.target.value)} placeholder="Centro de custo" />
        <p className="text-[11px] text-slate-400">Regra padrão: competência no mês da recarga; processamento manual.</p>
        <button disabled={!employeeId || Number(fare.replace(",", ".")) <= 0 || saveConfig.isPending} onClick={() => saveConfig.mutate()} className="rounded-lg bg-amber-400 px-4 py-2 text-xs font-black text-slate-950 disabled:opacity-50">{saveConfig.isPending ? "Salvando..." : "Salvar configuração VT"}</button>
      </div>
      <div className="space-y-3 rounded-xl border border-slate-700 bg-[#141F33] p-4">
        <h3 className="font-bold">Registrar recarga individual ou em lote</h3>
        <div className="max-h-36 space-y-2 overflow-auto rounded-lg border border-slate-700 p-3">
          {configured.map((e: any) => <label key={e.id} className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={selected.includes(e.id)} onChange={ev => setSelected(old => ev.target.checked ? [...old,e.id] : old.filter(id => id !== e.id))} />
            {e.full_name} · {e.unit}
          </label>)}
          {!configured.length && <p className="text-xs text-slate-400">Configure o VT dos funcionários antes de recarregar.</p>}
        </div>
        <input className={field} value={amount} onChange={e => setAmount(e.target.value)} placeholder="Valor por funcionário (R$)" inputMode="decimal" />
        <input className={field} type="date" value={paidAt} onChange={e => setPaidAt(e.target.value)} />
        <input className={field} value={costCenter} onChange={e => setCostCenter(e.target.value)} placeholder="Centro de custo (opcional)" />
        <input className={field} value={receiptPath} onChange={e => setReceiptPath(e.target.value)} placeholder="Caminho do comprovante (opcional)" />
        <p className="text-[11px] text-slate-400">Competência definida automaticamente pelo mês da data da recarga. {selected.length} funcionário(s) selecionado(s).</p>
        <button disabled={!selected.length || Number(amount.replace(",", ".")) <= 0 || createBatch.isPending} onClick={() => createBatch.mutate()} className="rounded-lg bg-amber-400 px-4 py-2 text-xs font-black text-slate-950 disabled:opacity-50">{createBatch.isPending ? "Registrando..." : "Registrar recarga(s)"}</button>
      </div>
    </div>
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-bold">Histórico e consulta</h3>
        <div className="flex flex-wrap gap-2">
          <select className={field+" !w-auto"} value={filterEmployee} onChange={e => setFilterEmployee(e.target.value)}><option value="">Todos os funcionários</option>{rows.map((e: any)=><option key={e.id} value={e.id}>{e.full_name}</option>)}</select>
          <select className={field+" !w-auto"} value={filterMonth} onChange={e => setFilterMonth(e.target.value)}>{Array.from({length:12},(_,i)=><option key={i+1} value={i+1}>{String(i+1).padStart(2,"0")}</option>)}</select>
          <input className={field+" !w-24"} value={filterYear} onChange={e => setFilterYear(e.target.value)} aria-label="Ano da competência" />
        </div>
      </div>
      <div className="rounded-xl border border-slate-700 bg-[#141F33] p-4">
        <p className="text-[10px] uppercase text-slate-400">Total de recargas ativas no filtro</p>
        <p className="mt-1 text-2xl font-black text-amber-400">{money(total)}</p>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-700">
        <table className="w-full text-left text-xs">
          <thead className="bg-[#0F172A] text-slate-400"><tr><th className="p-3">Funcionário</th><th className="p-3">Data / competência</th><th className="p-3">Valor</th><th className="p-3">Centro de custo</th><th className="p-3">Status</th><th className="p-3">Ações</th></tr></thead>
          <tbody>{(topups.data ?? []).map((r: any)=><tr key={r.id} className="border-t border-slate-700">
            <td className="p-3">{r.employee?.full_name ?? "Funcionário"}</td><td className="p-3">{r.paid_at} / {r.competence_month}</td><td className="p-3">{money(r.amount_cents)}</td><td className="p-3">{r.cost_center ?? "—"}</td><td className="p-3">{r.status}</td>
            <td className="p-3"><div className="flex flex-wrap gap-2"><button className="text-sky-300" onClick={()=>{setEditing({...r,amount:String(r.amount_cents)});setReason("");}}>Editar</button><button className="text-slate-300" onClick={()=>setAuditId(r.id)}>Auditoria</button>{r.status==="ativa" && <button className="text-red-300" onClick={()=>{setAuditId("");setEditing({cancel_id:r.id});setReason("");}}>Cancelar</button>}</div></td>
          </tr>)}</tbody>
        </table>
        {!(topups.data ?? []).length && <p className="p-6 text-center text-xs text-slate-400">Nenhuma recarga encontrada para o filtro.</p>}
      </div>
    </div>
    {editing && <div className="space-y-3 rounded-xl border border-slate-700 bg-[#141F33] p-4">
      {editing.cancel_id ? <h4 className="font-bold">Cancelar recarga</h4> : <h4 className="font-bold">Editar recarga</h4>}
      {!editing.cancel_id && <div className="grid gap-3 sm:grid-cols-2"><input className={field} value={editing.amount} onChange={e=>setEditing({...editing,amount:e.target.value})} placeholder="Valor em centavos" /><input className={field} type="date" value={editing.paid_at} onChange={e=>setEditing({...editing,paid_at:e.target.value})} /><input className={field} value={editing.cost_center ?? ""} onChange={e=>setEditing({...editing,cost_center:e.target.value})} placeholder="Centro de custo" /><input className={field} value={editing.receipt_storage_path ?? ""} onChange={e=>setEditing({...editing,receipt_storage_path:e.target.value})} placeholder="Caminho comprovante" /></div>}
      <textarea className={field} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Motivo da edição ou justificativa do cancelamento" />
      <div className="flex gap-2"><button disabled={!reason.trim() || editTopup.isPending || cancelTopup.isPending} onClick={()=>editing.cancel_id ? cancelTopup.mutate(editing.cancel_id) : editTopup.mutate()} className="rounded-lg bg-amber-400 px-4 py-2 text-xs font-black text-slate-950">{editing.cancel_id ? "Confirmar cancelamento" : "Salvar edição"}</button><button onClick={()=>setEditing(null)} className="rounded-lg border border-slate-600 px-4 py-2 text-xs">Fechar</button></div>
    </div>}
    {auditId && <div className="rounded-xl border border-slate-700 bg-[#141F33] p-4"><div className="mb-2 flex justify-between"><h4 className="font-bold">Trilha de auditoria</h4><button onClick={()=>setAuditId("")} className="text-xs text-slate-400">Fechar</button></div>{(audit.data ?? []).map((a:any)=><div key={a.id} className="border-t border-slate-700 py-2 text-xs"><strong>{a.action}</strong> · {new Date(a.created_at).toLocaleString("pt-BR")} · {a.reason ?? "—"}<pre className="mt-1 overflow-auto whitespace-pre-wrap text-[10px] text-slate-400">{JSON.stringify({antes:a.before_data,depois:a.after_data},null,2)}</pre></div>)}</div>}
    <p className="text-[11px] text-slate-500">Nesta fase não há lançamento financeiro. A chave de integração futura fica reservada; o Ledger não é acionado.</p>
  </section>;
}
