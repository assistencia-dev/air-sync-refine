import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  IdCard, Utensils, WalletCards, Clock3, ShieldCheck, Calculator,
  UsersRound, BriefcaseBusiness, ChevronRight, Download, RefreshCw, AlertTriangle, FileWarning, UserRoundCheck, ClipboardList
} from "lucide-react";
import { RhBenefitPanel } from "@/components/RhBenefitPanel";
import { RhEmployeeRegistry } from "@/components/RhEmployeeRegistry";
import { RhPontoWorkspace } from "@/components/RhPontoWorkspace";
import { RhDpCenter } from "@/components/RhDpCenter";
import { getRhDashboardAlerts, listRhEmployeeRegistry, listRhEmployees, listRhTopups } from "@/lib/rh.functions";
import { listRhPayroll } from "@/lib/rh.dp.functions";
import { RhEmployeeFinance } from "@/components/RhEmployeeFinance";
import { RhProductivityPanel } from "@/components/RhProductivityPanel";
import { Activity } from "lucide-react";
import { listRhPontoEmployees } from "@/lib/ponto.functions";

export const VALE_PASSAGEM_URL = "https://valepassagem-d8edi3fl.manus.space";

type HrSection = "resumo" | "custos" | "financeiro" | "ponto" | "passagem" | "alimentacao" | "cadastro" | "gestao" | "produtividade";

const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

export function HrWorkspace({ embedded = false }: { embedded?: boolean }) {
  const [section, setSection] = useState<HrSection>("resumo");

  const registry = useQuery({ queryKey: ["rh-workspace-registry"], queryFn: () => listRhEmployeeRegistry() });
  const vt = useQuery({ queryKey: ["rh-workspace-vt"], queryFn: () => listRhEmployees({ data: { benefit_type: "passagem" } }) });
  const va = useQuery({ queryKey: ["rh-workspace-va"], queryFn: () => listRhEmployees({ data: { benefit_type: "alimentacao" } }) });
  const ponto = useQuery({ queryKey: ["rh-workspace-ponto"], queryFn: () => listRhPontoEmployees() });
  const vtTopups = useQuery({ queryKey: ["rh-workspace-vt-topups"], queryFn: () => listRhTopups({ data: { benefit_type: "passagem" } }) });
  const vaTopups = useQuery({ queryKey: ["rh-workspace-va-topups"], queryFn: () => listRhTopups({ data: { benefit_type: "alimentacao" } }) });
  const payroll = useQuery({ queryKey: ["rh-workspace-payroll"], queryFn: () => listRhPayroll() });
  const alerts = useQuery({ queryKey: ["rh-workspace-alerts"], queryFn: () => getRhDashboardAlerts(), staleTime: 30_000 });

  const summary = useMemo(() => {
    const employees = registry.data ?? [];
    const vtTotal = (vtTopups.data ?? []).reduce((n, x) => n + Number(x.amount_cents ?? 0), 0);
    const vaTotal = (vaTopups.data ?? []).reduce((n, x) => n + Number(x.amount_cents ?? 0), 0);
    return {
      employees: employees.length,
      ponto: (ponto.data ?? []).filter((e: any) => e.ponto_access_enabled).length,
      vt: (vt.data ?? []).length,
      va: (va.data ?? []).length,
      month: vtTotal + vaTotal,
    };
  }, [registry.data, vt.data, va.data, ponto.data, vtTopups.data, vaTopups.data]);

  const tabs: { key: HrSection; label: string; icon: ReactNode; group: string }[] = [
    { key: "resumo", label: "Resumo", icon: <ShieldCheck className="h-4 w-4" />, group: "Visão geral" },
    { key: "cadastro", label: "Funcionários", icon: <UsersRound className="h-4 w-4" />, group: "Pessoas" },
    { key: "gestao", label: "RH / DP", icon: <BriefcaseBusiness className="h-4 w-4" />, group: "Pessoas" },
    { key: "ponto", label: "Folha de ponto", icon: <Clock3 className="h-4 w-4" />, group: "Jornada & folha" },
    { key: "custos", label: "Folha e custos", icon: <Calculator className="h-4 w-4" />, group: "Jornada & folha" },
    { key: "produtividade", label: "Produtividade OS", icon: <Activity className="h-4 w-4" />, group: "Jornada & folha" },
    { key: "financeiro", label: "Vales e descontos", icon: <WalletCards className="h-4 w-4" />, group: "Benefícios & financeiro" },
    { key: "passagem", label: "Vale passagem", icon: <WalletCards className="h-4 w-4" />, group: "Benefícios & financeiro" },
    { key: "alimentacao", label: "Vale alimentação", icon: <Utensils className="h-4 w-4" />, group: "Benefícios & financeiro" },
  ];

  const current = tabs.find(t => t.key === section) ?? tabs[0];

  const grouped = ["Visão geral", "Pessoas", "Jornada & folha", "Benefícios & financeiro"].map(group => ({
    group,
    items: tabs.filter(t => t.group === group),
  }));

  return (
    <div className="space-y-6">
      <header className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_18px_50px_-30px_rgba(15,23,42,.35)]">
        <div className="relative bg-gradient-to-br from-[#0F172A] via-[#172554] to-[#0F172A] px-5 py-6 text-white sm:px-7 sm:py-7">
          <div className="absolute right-0 top-0 h-40 w-40 rounded-full bg-sky-500/10 blur-3xl" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-black uppercase tracking-[.16em] text-sky-300">
                  <ShieldCheck className="h-3.5 w-3.5" /> Gestão de pessoas
                </span>
                {embedded && <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-bold text-emerald-300">Sessão integrada</span>}
              </div>
              <h1 className="mt-3 text-2xl font-black tracking-tight sm:text-3xl">RH — Gestão Integrada</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
                Um único ambiente para cadastro de funcionários, acessos, ponto, DP, folha, benefícios e descontos.
                <span className="text-slate-400"> As funções existentes permanecem disponíveis dentro de cada área.</span>
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <MiniHeaderStat label="Funcionários" value={summary.employees} />
              <MiniHeaderStat label="Acessos de ponto" value={summary.ponto} />
            </div>
          </div>
        </div>

        <div className="border-b border-slate-200 bg-slate-50/80 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-bold text-slate-400">RH</span>
            <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
            <span className="font-black text-slate-700">{current.label}</span>
          </div>
        </div>

        <div className="border-t border-slate-200 bg-white p-3 sm:p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-[9px] font-black uppercase tracking-[.18em] text-slate-400">Navegação do RH</p>
              <p className="mt-0.5 text-[11px] text-slate-500">Escolha uma área ou use as ações rápidas abaixo.</p>
            </div>
            <span className="hidden rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-slate-500 sm:inline-flex">Dados centralizados</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {grouped.map(({ group, items }) => (
              <div key={group} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-1.5">
                <p className="px-2 pb-1.5 pt-1 text-[9px] font-black uppercase tracking-[.14em] text-slate-400">{group}</p>
                <div className="grid gap-1">
                  {items.map(t => (
                    <button
                      key={t.key}
                      onClick={() => setSection(t.key)}
                      className={[
                        "flex min-h-10 items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-bold transition-all",
                        section === t.key
                          ? "bg-[#0F172A] text-white shadow-sm"
                          : "text-slate-600 hover:bg-white hover:text-slate-900 hover:shadow-sm",
                      ].join(" ")}
                    >
                      <span className={section === t.key ? "text-sky-300" : "text-slate-400"}>{t.icon}</span>
                      <span className="min-w-0 flex-1">{t.label}</span>
                      {section === t.key && <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </header>

      <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <QuickAction icon={<UsersRound />} title="Novo funcionário" text="Cadastro central" onClick={() => setSection("cadastro")} />
        <QuickAction icon={<Clock3 />} title="Conferir ponto" text="Espelho e jornada" onClick={() => setSection("ponto")} />
        <QuickAction icon={<BriefcaseBusiness />} title="Solicitações RH" text="Fila de atendimento" onClick={() => setSection("gestao")} />
        <QuickAction icon={<WalletCards />} title="Vale / adiantamento" text="Lançar desconto" onClick={() => setSection("financeiro")} />
      </section>

      {section === "resumo" && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard icon={<UsersRound />} label="Colaboradores" value={summary.employees} hint="Cadastro central" />
            <SummaryCard icon={<Clock3 />} label="Acessos de ponto" value={summary.ponto} hint="Colaboradores liberados" />
            <SummaryCard icon={<WalletCards />} label="Vale passagem" value={summary.vt} hint="Cadastros ativos" />
            <SummaryCard icon={<Utensils />} label="Vale alimentação" value={summary.va} hint="Cadastros ativos" />
          </div>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[.18em] text-sky-600">Painel operacional</p>
                <h2 className="mt-1 text-xl font-black text-slate-900">Visão geral do RH</h2>
                <p className="mt-1 text-sm text-slate-500">Acompanhe o estado das principais estruturas sem sair desta tela.</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Movimentação de benefícios</p>
                <strong className="mt-1 block text-lg font-black text-slate-900">{money(summary.month)}</strong>
              </div>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <StatusCard title="Cadastro central" text={registry.isError ? "Indisponível neste ambiente" : summary.employees + " colaboradores encontrados"} ok={!registry.isError} />
              <StatusCard title="Benefícios" text={vt.isError || va.isError ? "Verificar conexão do RH" : "VT e VA disponíveis"} ok={!vt.isError && !va.isError} />
              <StatusCard title="Folha de ponto" text={ponto.isError ? "Verificar acesso/configuração" : summary.ponto + " acessos liberados"} ok={!ponto.isError} />
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[.18em] text-slate-400">Acesso rápido</p>
                <h2 className="mt-1 text-lg font-black text-slate-900">Tarefas frequentes</h2>
              </div>
              <RefreshCw className="h-5 w-5 text-slate-300" />
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <QuickAction icon={<UsersRound />} title="Cadastrar funcionário" text="Abrir cadastro central" onClick={() => setSection("cadastro")} />
              <QuickAction icon={<Clock3 />} title="Conferir ponto" text="Espelho e registros" onClick={() => setSection("ponto")} />
              <QuickAction icon={<BriefcaseBusiness />} title="Tratar solicitações" text="Fila do RH / DP" onClick={() => setSection("gestao")} />
              <QuickAction icon={<WalletCards />} title="Lançar vale" text="Desconto em folha" onClick={() => setSection("financeiro")} />
            </div>
          </section>
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[.18em] text-amber-600">Controle operacional</p>
                <h2 className="mt-1 text-lg font-black text-slate-900">Pendências que merecem atenção</h2>
                <p className="mt-1 text-sm text-slate-500">O sistema cruza cadastro, acesso, documentos, solicitações e lançamentos para apontar o que precisa de ação.</p>
              </div>
              <button onClick={() => alerts.refetch()} disabled={alerts.isFetching} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-700 disabled:opacity-50">
                <RefreshCw className={"h-3.5 w-3.5 " + (alerts.isFetching ? "animate-spin" : "")}/> Atualizar
              </button>
            </div>
            {alerts.isError ? (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-semibold text-amber-800">Não foi possível atualizar o painel operacional agora. As demais áreas do RH continuam disponíveis.</div>
            ) : (
              <>
                <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <AlertKpi label="Solicitações abertas" value={alerts.data?.totals.openRequests ?? 0} icon={<ClipboardList />} tone="amber" onClick={() => setSection("gestao")} />
                  <AlertKpi label="Vales programados" value={alerts.data?.totals.pendingAdvances ?? 0} icon={<WalletCards />} tone="blue" onClick={() => setSection("financeiro")} />
                  <AlertKpi label="Sem acesso vinculado" value={(alerts.data?.totals as any)?.noAccess ?? 0} icon={<UserRoundCheck />} tone="violet" onClick={() => setSection("cadastro")} />
                  <AlertKpi label="Documentos vencendo" value={alerts.data?.totals.expiringDocuments ?? 0} icon={<FileWarning />} tone="rose" onClick={() => setSection("cadastro")} />
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-3">
                  <AlertList title="Cadastro incompleto" count={alerts.data?.totals.incompleteRegistration ?? 0} items={alerts.data?.alerts.incompleteRegistration ?? []} icon={<AlertTriangle />} onOpen={() => setSection("cadastro")} />
                  <AlertList title="Contrato incompleto" count={alerts.data?.totals.incompleteContract ?? 0} items={alerts.data?.alerts.incompleteContract ?? []} icon={<BriefcaseBusiness />} onOpen={() => setSection("cadastro")} />
                  <AlertList title="Documentos próximos do vencimento" count={alerts.data?.totals.expiringDocuments ?? 0} items={alerts.data?.alerts.documents ?? []} icon={<FileWarning />} onOpen={() => setSection("cadastro")} />
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {section === "gestao" && <RhDpCenter />}
      {section === "custos" && <RhPayrollSummary registry={registry.data ?? []} vt={vt.data ?? []} va={va.data ?? []} vtTopups={vtTopups.data ?? []} vaTopups={vaTopups.data ?? []} payroll={payroll.data ?? []} />}
      {section === "financeiro" && <RhEmployeeFinance />}
      {section === "ponto" && <RhPontoWorkspace />}
      {section === "produtividade" && <RhProductivityPanel />}
      {section === "cadastro" && <RhEmployeeRegistry />}
      {section === "alimentacao" && <RhBenefitPanel benefitType="alimentacao" />}
      {section === "passagem" && <RhBenefitPanel benefitType="passagem" />}
    </div>
  );
}

function AlertKpi({ label, value, icon, tone, onClick }: { label: string; value: number; icon: ReactNode; tone: "amber"|"blue"|"violet"|"rose"; onClick: () => void }) {
  const toneClass = {
    amber: "bg-amber-50 text-amber-700 border-amber-100",
    blue: "bg-sky-50 text-sky-700 border-sky-100",
    violet: "bg-violet-50 text-violet-700 border-violet-100",
    rose: "bg-rose-50 text-rose-700 border-rose-100",
  }[tone];
  return <button onClick={onClick} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md">
    <span className={"grid h-10 w-10 place-items-center rounded-xl border " + toneClass}>{icon}</span>
    <span><span className="block text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</span><strong className="mt-1 block text-2xl font-black text-slate-900">{value}</strong></span>
  </button>;
}

function AlertList({ title, count, items, icon, onOpen }: { title: string; count: number; items: any[]; icon: ReactNode; onOpen: () => void }) {
  return <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2"><span className="text-amber-600">{icon}</span><h3 className="text-xs font-black text-slate-900">{title}</h3></div>
      <span className="rounded-full bg-white px-2 py-1 text-[10px] font-black text-slate-500">{count}</span>
    </div>
    <div className="mt-3 space-y-2">
      {items.slice(0, 5).map((item: any) => <button key={item.id} onClick={onOpen} className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left hover:border-slate-300">
        <span className="min-w-0"><span className="block truncate text-xs font-bold text-slate-800">{item.name}</span><span className="block truncate text-[10px] text-slate-400">{item.unit || item.document_type || "Verificar cadastro"}</span></span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300"/>
      </button>)}
      {!items.length && <p className="py-4 text-center text-[11px] text-emerald-700">Nenhuma pendência encontrada.</p>}
    </div>
    {count > 5 && <button onClick={onOpen} className="mt-3 text-[10px] font-black uppercase tracking-wider text-sky-600">Abrir módulo e revisar todas</button>}
  </section>;
}

function MiniHeaderStat({ label, value }: { label: string; value: ReactNode }) {
  return <div className="min-w-[120px] rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
    <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">{label}</p>
    <strong className="mt-1 block text-xl font-black text-white">{value}</strong>
  </div>;
}

function SummaryCard({ icon, label, value, hint }: { icon: ReactNode; label: string; value: ReactNode; hint: string }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-600">{icon}</div>
        <span className="rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-emerald-700">Ativo</span>
      </div>
      <p className="mt-4 text-[10px] font-black uppercase tracking-[.15em] text-slate-400">{label}</p>
      <strong className="mt-1 block text-2xl font-black tracking-tight text-slate-900">{value}</strong>
      <p className="mt-1 text-[11px] text-slate-400">{hint}</p>
    </article>
  );
}

function StatusCard({ title, text, ok }: { title: string; text: string; ok: boolean }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-black text-slate-800">{title}</span>
        <span className={"h-2.5 w-2.5 rounded-full " + (ok ? "bg-emerald-500" : "bg-amber-500")} />
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-500">{text}</p>
    </div>
  );
}

function QuickAction({ icon, title, text, onClick }: { icon: ReactNode; title: string; text: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="group flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600 transition group-hover:bg-slate-900 group-hover:text-white">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-black text-slate-800">{title}</span>
        <span className="mt-0.5 block text-[11px] text-slate-400">{text}</span>
      </span>
      <ChevronRight className="h-4 w-4 text-slate-300 transition group-hover:text-slate-500" />
    </button>
  );
}

function RhPayrollSummary({ registry, vt, va, vtTopups, vaTopups, payroll }: { registry: any[]; vt: any[]; va: any[]; vtTopups: any[]; vaTopups: any[]; payroll: any[] }) {
  const latest = payroll[0];
  const salaryTotal = latest?.rh_payroll_runs?.length
    ? latest.rh_payroll_runs.reduce((sum: number, r: any) => sum + Number(r.gross_cents ?? 0), 0)
    : registry.reduce((sum, e) => {
      const raw = String(e.registration_data?.salary ?? "").replace(/[^0-9,.-]/g, "").replace(/\\./g, "").replace(",", ".");
      const value = Number(raw);
      return sum + (Number.isFinite(value) ? Math.round(value * 100) : 0);
    }, 0);
  const realNet = latest?.rh_payroll_runs?.reduce((sum: number, r: any) => sum + Number(r.net_cents ?? 0), 0) ?? 0;
  const benefitsMonth = [...vtTopups, ...vaTopups].filter(x => {
    const d = new Date(String(x.paid_at).length === 10 ? x.paid_at + "T12:00:00" : x.paid_at);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).reduce((sum, x) => sum + Number(x.amount_cents ?? 0), 0);
  return (
    <section className="space-y-5">
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <p className="text-[10px] font-black uppercase tracking-[.18em] text-sky-600">RH · folha e custos</p>
        <h2 className="mt-1 text-2xl font-black text-slate-900">Visão de custos da equipe</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">Cálculo consolidado usando os dados já cadastrados. Não lança valores automaticamente em folha ou financeiro.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label={latest ? "Bruto da última folha" : "Salários cadastrados"} value={money(salaryTotal)} hint="Valor de referência" icon={<Calculator />} />
        {latest && <SummaryCard label="Líquido da última folha" value={money(realNet)} hint="Após descontos calculados" icon={<WalletCards />} />}
        <SummaryCard label="Competência da folha" value={latest ? String(latest.competence).slice(0, 7) : "Sem folha calculada"} hint="Último processamento" icon={<Clock3 />} />
        <SummaryCard label="Vale/benefícios pagos no mês" value={money(benefitsMonth)} hint="Movimentação registrada" icon={<WalletCards />} />
        <SummaryCard label="Funcionários com salário" value={registry.filter(e => String(e.registration_data?.salary ?? "").trim()).length} hint="Cadastro com remuneração" icon={<UsersRound />} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <CostList title="Vale Passagem" items={vt} render={(e) => money(Number(e.fare_cents ?? 0) * Number(e.trips_per_day ?? 1)) + " / dia"} />
        <CostList title="Vale Alimentação" items={va} render={(e) => money(Number(e.fare_cents ?? 0)) + " / dia"} />
      </div>
    </section>
  );
}

function CostList({ title, items, render }: { title: string; items: any[]; render: (e: any) => string }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="font-black text-slate-900">{title}</h3>
      <div className="mt-4 divide-y divide-slate-100">
        {items.slice(0, 12).map((e) => <div key={e.id} className="flex items-center justify-between gap-3 py-3 text-xs"><span className="font-bold text-slate-700">{e.full_name}</span><span className="text-slate-400">{render(e)}</span></div>)}
        {!items.length && <p className="py-5 text-xs text-slate-500">Nenhum registro ativo.</p>}
        {items.length > 12 && <p className="pt-3 text-[11px] text-slate-500">Mostrando os primeiros 12. O cadastro completo permanece na aba do benefício.</p>}
      </div>
    </div>
  );
}
