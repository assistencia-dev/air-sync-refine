import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { IdCard, Utensils, WalletCards, Clock3, Shield } from "lucide-react";
import { RhBenefitPanel } from "@/components/RhBenefitPanel";
import { RhEmployeeRegistry } from "@/components/RhEmployeeRegistry";
import { RhPontoWorkspace } from "@/components/RhPontoWorkspace";
import { listRhEmployeeRegistry, listRhEmployees, listRhTopups } from "@/lib/rh.functions";
import { listRhPontoEmployees } from "@/lib/ponto.functions";

export const VALE_PASSAGEM_URL = "https://valepassagem-d8edi3fl.manus.space";

type HrSection = "resumo" | "ponto" | "passagem" | "alimentacao" | "cadastro";

/**
 * Área de trabalho do RH.
 * O módulo usa a sessão já autenticada do portal; não existe login/usuário ADM separado.
 */
export function HrWorkspace({ embedded = false }: { embedded?: boolean }) {
  const [section, setSection] = useState<HrSection>("resumo");

  const registry = useQuery({ queryKey: ["rh-workspace-registry"], queryFn: () => listRhEmployeeRegistry() });
  const vt = useQuery({ queryKey: ["rh-workspace-vt"], queryFn: () => listRhEmployees({ data: { benefit_type: "passagem" } }) });
  const va = useQuery({ queryKey: ["rh-workspace-va"], queryFn: () => listRhEmployees({ data: { benefit_type: "alimentacao" } }) });
  const ponto = useQuery({ queryKey: ["rh-workspace-ponto"], queryFn: () => listRhPontoEmployees() });
  const vtTopups = useQuery({ queryKey: ["rh-workspace-vt-topups"], queryFn: () => listRhTopups({ data: { benefit_type: "passagem" } }) });
  const vaTopups = useQuery({ queryKey: ["rh-workspace-va-topups"], queryFn: () => listRhTopups({ data: { benefit_type: "alimentacao" } }) });
  const summary = useMemo(() => {
    const unique = new Set<string>();
    for (const e of [...(registry.data ?? []), ...(vt.data ?? []), ...(va.data ?? [])]) unique.add((e.full_name + "|" + e.unit).toLowerCase());
    const vtTotal = (vtTopups.data ?? []).reduce((n, x) => n + Number(x.amount_cents ?? 0), 0);
    const vaTotal = (vaTopups.data ?? []).reduce((n, x) => n + Number(x.amount_cents ?? 0), 0);
    return { employees: unique.size, ponto: (ponto.data ?? []).filter((e: any) => e.ponto_access_enabled).length, vt: (vt.data ?? []).length, va: (va.data ?? []).length, month: vtTotal + vaTotal };
  }, [registry.data, vt.data, va.data, ponto.data, vtTopups.data, vaTopups.data]);

  const tabs: { key: HrSection; label: string; icon: React.ReactNode; active: string }[] = [
    { key: "resumo", label: "Resumo do RH", icon: <Shield className="h-4 w-4" />, active: "bg-[#102b3b] text-white shadow-md" },
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

      {section === "resumo" && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard label="Colaboradores" value={summary.employees} />
            <SummaryCard label="Acessos de ponto" value={summary.ponto} />
            <SummaryCard label="VT ativo" value={summary.vt} />
            <SummaryCard label="VA ativo" value={summary.va} />
          </div>
          <div className="rounded-2xl border border-slate-800 bg-[#1E293B] p-5 shadow-sm sm:p-7">
            <p className="text-[10px] font-black uppercase tracking-[.2em] text-slate-400">Controle operacional</p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="mt-1 text-lg font-black text-slate-50">Resumo do RH</h2>
                <p className="mt-1 text-xs text-slate-400">Visão consolidada das estruturas já existentes.</p>
              </div>
              <strong className="text-lg font-black text-[#F59E0B]">{new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(summary.month / 100)}</strong>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <StatusCard title="Cadastro" text={registry.isError ? "Indisponível neste ambiente" : summary.employees + " colaboradores encontrados"} ok={!registry.isError} />
              <StatusCard title="Benefícios" text={vt.isError || va.isError ? "Verificar conexão do RH" : "VT e VA disponíveis"} ok={!vt.isError && !va.isError} />
              <StatusCard title="Folha de Ponto" text={ponto.isError ? "Verificar acesso/configuração" : summary.ponto + " acessos liberados"} ok={!ponto.isError} />
            </div>
          </div>
        </div>
      )}
      {section === "ponto" && <RhPontoWorkspace />}
      {section === "cadastro" && <RhEmployeeRegistry />}
      {section === "alimentacao" && <RhBenefitPanel benefitType="alimentacao" />}
      {section === "passagem" && <RhBenefitPanel benefitType="passagem" />}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return <article className="rounded-2xl border border-slate-800 bg-[#1E293B] p-5 shadow-sm">
    <p className="text-[10px] font-black uppercase tracking-[.16em] text-slate-400">{label}</p>
    <strong className="mt-2 block text-2xl font-black text-slate-50">{value}</strong>
  </article>;
}

function StatusCard({ title, text, ok }: { title: string; text: string; ok: boolean }) {
  return <div className="rounded-xl border border-slate-700 bg-[#141F33] p-4">
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs font-black text-slate-200">{title}</span>
      <span className={"h-2.5 w-2.5 rounded-full " + (ok ? "bg-emerald-400" : "bg-amber-400")} />
    </div>
    <p className="mt-2 text-xs leading-5 text-slate-400">{text}</p>
  </div>;
}
