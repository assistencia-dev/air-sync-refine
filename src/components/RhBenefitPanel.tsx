import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarClock,
  CircleDollarSign,
  Pencil,
  Plus,
  Receipt,
  Search,
  ShieldCheck,
  Trash2,
  UsersRound,
  WalletCards,
} from "lucide-react";
import {
  configureRhEmployeeBenefit,
  createRhTopup,
  deleteRhEmployee,
  listRhEmployees,
  listRhTopups,
  listRhEmployeeRegistryForBenefits,
  updateRhTopup,
  type RhBenefitType,
} from "@/lib/rh.functions";
import {
  addBusinessDaysRio,
  businessDaysInRioDeJaneiroMonth,
  businessDaysRemainingRio,
} from "@/utils/rhBenefitCalendar";

type Employee = {
  id: string;
  registry_employee_id: string;
  full_name: string;
  unit: string;
  fare_cents: number;
  trips_per_day: number;
  is_active: boolean;
  work_schedule?: string;
};
type Topup = {
  id: string;
  employee_id: string;
  amount_cents: number;
  paid_at: string;
  employee_full_name?: string | null;
  employee_unit?: string | null;
  employee_fare_cents?: number | null;
  employee_trips_per_day?: number | null;
  employee_active?: boolean;
};

type BenefitCoverage = {
  dailyCostCents: number;
  daysCovered: number;
  renewalDate: string | null;
  daysRemaining: number;
};

const money = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
const dateText = (value: string | null | undefined) => value
  ? new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value + "T12:00:00"))
  : "—";

function localISODate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseMoneyCents(value: string) {
  const raw = value.trim().replace(/R\$\s?/gi, "").replace(/\s/g, "");
  if (!raw) return 0;
  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function scheduleKind(value: unknown): "5x2" | "6x1" | "12x36" {
  const raw = String(value ?? "").toLowerCase().replace(/\s+/g, "");
  if (raw.includes("12x36")) return "12x36";
  if (raw.includes("6x1")) return "6x1";
  return "5x2";
}

function buildCoverage(
  amountCents: number,
  dailyCostCents: number,
  paidAt: string,
): BenefitCoverage {
  const daysCovered = dailyCostCents > 0 ? Math.floor(amountCents / dailyCostCents) : 0;
  const renewalDate = daysCovered > 0 ? localISODate(addBusinessDaysRio(paidAt, daysCovered)) : null;
  return {
    dailyCostCents,
    daysCovered,
    renewalDate,
    daysRemaining: renewalDate ? businessDaysRemainingRio(renewalDate) : 0,
  };
}

function getDailyCostCents(employee: Pick<Employee, "fare_cents" | "trips_per_day">, benefitType: RhBenefitType) {
  return Math.max(0, Number(employee.fare_cents) || 0) *
    (benefitType === "passagem" ? Math.max(1, Number(employee.trips_per_day) || 1) : 1);
}

function buildCoverage(
  amountCents: number,
  dailyCostCents: number,
  paidAt: string,
  schedule = "5x2",
): BenefitCoverage {
  const daysCovered = dailyCostCents > 0 ? Math.floor(amountCents / dailyCostCents) : 0;
  const renewalDate = daysCovered > 0 ? addScheduledDays(paidAt, daysCovered, schedule) : null;
  return {
    dailyCostCents,
    daysCovered,
    renewalDate,
    daysRemaining: renewalDate ? scheduledDaysRemaining(paidAt, renewalDate, schedule) : 0,
  };
}

function isSameMonth(value: string, reference: Date) {
  return value.slice(0, 7) === `${reference.getFullYear()}-${String(reference.getMonth() + 1).padStart(2, "0")}`;
}

export function RhBenefitPanel({ benefitType }: { benefitType: RhBenefitType }) {
  const qc = useQueryClient();
  const [section, setSection] = useState<"overview" | "employees" | "topups" | "history" | "finance">("overview");
  const [employeeModal, setEmployeeModal] = useState<"new" | Employee | null>(null);
  const [topupOpen, setTopupOpen] = useState(false);
  const [topupEdit, setTopupEdit] = useState<Topup | null>(null);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [financePeriod, setFinancePeriod] = useState<"month" | "last30" | "all">("month");
  const [financeEmployeeId, setFinanceEmployeeId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const employees = useQuery({
    queryKey: ["rh-employees", benefitType],
    queryFn: () => listRhEmployees({ data: { benefit_type: benefitType } }),
  });
  const topups = useQuery({
    queryKey: ["rh-topups", benefitType],
    queryFn: () => listRhTopups({ data: { benefit_type: benefitType } }),
  });
  const activeEmployees = (employees.data ?? []).filter((item: Employee) => item.is_active);
  const rows = (topups.data ?? []) as Topup[];
  const monthRows = rows.filter((item) => isSameMonth(item.paid_at, new Date()));
  const monthTotal = monthRows.reduce((sum, item) => sum + item.amount_cents, 0);
  const totalMoved = rows.reduce((sum, item) => sum + item.amount_cents, 0);
  const financeSummary = useMemo(() => {
    const today = new Date();
    const todayIso = localISODate(today);
    const last30 = new Date(today);
    last30.setDate(last30.getDate() - 29);
    const last30Iso = localISODate(last30);
    const periodRows = rows.filter((item) => {
      if (financePeriod === "all") return true;
      if (financePeriod === "month") return isSameMonth(item.paid_at, today);
      return item.paid_at >= last30Iso && item.paid_at <= todayIso;
    }).filter((item) => !financeEmployeeId || item.employee_id === financeEmployeeId);
    const selectedEmployees = activeEmployees.filter((employee) => !financeEmployeeId || employee.id === financeEmployeeId);
    const periodTotalCents = periodRows.reduce((sum, item) => sum + item.amount_cents, 0);
    const accumulatedTotalCents = rows
      .filter((item) => !financeEmployeeId || item.employee_id === financeEmployeeId)
      .reduce((sum, item) => sum + item.amount_cents, 0);
    const daysInMonth = businessDaysInRioDeJaneiroMonth();
    const collaborators = selectedEmployees.map((employee) => {
      const employeeRows = rows.filter((item) => item.employee_id === employee.id);
      const periodItems = periodRows.filter((item) => item.employee_id === employee.id);
      const periodInvestedCents = periodItems.reduce((sum, item) => sum + item.amount_cents, 0);
      const dailyCostCents = getDailyCostCents(employee, benefitType);
      const lastTopUpAt = employeeRows.reduce<string | null>((latest, item) =>
        !latest || item.paid_at > latest ? item.paid_at : latest, null);
      return {
        id: employee.id,
        fullName: employee.full_name,
        unit: employee.unit,
        dailyCostCents,
        projectedMonthlyCents: dailyCostCents * daysInMonth,
        topUpCount: periodItems.length,
        periodInvestedCents,
        totalInvestedCents: employeeRows.reduce((sum, item) => sum + item.amount_cents, 0),
        lastTopUpAt,
      };
    }).sort((a, b) => b.periodInvestedCents - a.periodInvestedCents || a.fullName.localeCompare(b.fullName));
    const dailyCostTotalCents = selectedEmployees.reduce((sum, employee) => sum + getDailyCostCents(employee, benefitType), 0);
    return {
      periodTotalCents,
      accumulatedTotalCents,
      dailyCostTotalCents,
      projectedMonthlyCents: selectedEmployees.reduce((sum, employee) => sum + getDailyCostCents(employee, benefitType) * daysInMonth, 0),
      topUpCount: periodRows.length,
      daysInMonth,
      collaborators: collaborators.map((item) => ({
        ...item,
        sharePercent: periodTotalCents > 0 ? Math.round((item.periodInvestedCents / periodTotalCents) * 100) : 0,
      })),
    };
  }, [activeEmployees, benefitType, financeEmployeeId, financePeriod, rows]);
  const title = benefitType === "alimentacao" ? "Vale Alimentação" : "Vale Passagem";
  const description = benefitType === "alimentacao"
    ? "Crédito diário × dias de trabalho cadastrados no calendário."
    : "Tarifa por viagem × viagens por dia × dias de trabalho.";
  const dailyLabel = benefitType === "alimentacao" ? "Valor diário" : "Custo diário";
  const latestCoverage = useMemo(() => {
    const latest = new Map<string, Topup>();
    for (const item of rows) {
      const current = latest.get(item.employee_id);
      if (!current || item.paid_at > current.paid_at) latest.set(item.employee_id, item);
    }
    return activeEmployees.map((employee) => {
      const lastTopup = latest.get(employee.id);
      const dailyCostCents = getDailyCostCents(employee, benefitType);
      const schedule = scheduleKind(employee.work_schedule);
      const coverage = lastTopup
        ? buildCoverage(lastTopup.amount_cents, dailyCostCents, lastTopup.paid_at, schedule)
        : null;
      return { employee, lastTopup, coverage, schedule };
    }).sort((a, b) => {
      const aDays = a.coverage?.daysRemaining ?? -1;
      const bDays = b.coverage?.daysRemaining ?? -1;
      return aDays - bDays || a.employee.full_name.localeCompare(b.employee.full_name);
    });
  }, [activeEmployees, benefitType, rows]);
  const renewalSoon = latestCoverage.filter((item) =>
    !item.lastTopup || !item.coverage?.renewalDate || item.coverage.daysRemaining <= 2
  );
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["rh-employees", benefitType] });
    qc.invalidateQueries({ queryKey: ["rh-topups", benefitType] });
    qc.invalidateQueries({ queryKey: ["rh-workspace-vt"] });
    qc.invalidateQueries({ queryKey: ["rh-workspace-va"] });
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-800 bg-[#1E293B] shadow-sm">
      <div className="flex flex-col gap-4 border-b border-slate-800 bg-[#0F172A] px-5 py-5 text-white sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.2em] text-[#F59E0B]">Módulo RH · benefícios</p>
          <h2 className="mt-1 text-2xl font-black tracking-tight">{title}</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-white/65">{description}</p>
          <p className="mt-2 inline-flex items-center gap-1.5 text-[10px] font-bold text-emerald-300">
            <ShieldCheck className="h-3.5 w-3.5" /> Colaboradores vinculados exclusivamente ao Cadastro Central
          </p>
        </div>
        <button
          onClick={() => { setTopupEdit(null); setTopupOpen(true); }}
          disabled={!activeEmployees.length}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#F59E0B] px-4 py-2.5 text-xs font-black text-slate-950 shadow-lg transition hover:bg-[#ffd967] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="h-4 w-4" /> Registrar crédito
        </button>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-800 px-5 py-3 sm:px-7">
        {([
          ["overview", "Visão geral", WalletCards],
          ["employees", "Colaboradores", UsersRound],
          ["topups", "Novo lançamento", Plus],
          ["history", "Histórico", Receipt],
          ["finance", "Financeiro", CircleDollarSign],
        ] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setSection(key)}
            className={`inline-flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition ${section === key ? "bg-[#0F172A] text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      {error && (
        <div role="alert" className="mx-5 mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-3 text-xs font-semibold text-red-200 sm:mx-7">
          {error}
          <button type="button" className="ml-2 underline" onClick={() => setError(null)}>Fechar</button>
        </div>
      )}
      {(employees.isError || topups.isError) && (
        <div role="alert" className="mx-5 mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-xs leading-5 text-amber-200 sm:mx-7">
          Não foi possível carregar os dados do benefício. Nenhum cadastro ou lançamento foi alterado.
          <button type="button" onClick={() => { void employees.refetch(); void topups.refetch(); }} className="ml-2 font-black underline">Tentar novamente</button>
        </div>
      )}

      <div className="p-5 sm:p-7">
        {(employees.isLoading || topups.isLoading) && (
          <p className="mb-5 rounded-xl bg-[#141F33] p-6 text-center text-xs font-semibold text-slate-400">Carregando dados do RH...</p>
        )}

        {section === "overview" && !employees.isLoading && !topups.isLoading && (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="Colaboradores ativos" value={String(activeEmployees.length)} icon={<UsersRound className="h-4 w-4" />} />
              <Metric label="Precisam renovar" value={String(renewalSoon.length)} icon={<CalendarClock className="h-4 w-4" />} />
              <Metric label="Lançamentos no mês" value={String(monthRows.length)} icon={<Receipt className="h-4 w-4" />} />
              <Metric label="Movimentado no mês" value={money(monthTotal)} icon={<CircleDollarSign className="h-4 w-4" />} />
              <Metric label="Projeção mensal" value={money(financeSummary.projectedMonthlyCents)} icon={<CalendarClock className="h-4 w-4" />} />
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
              <section className="rounded-xl border border-slate-800 bg-[#141F33] p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-700 pb-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[.15em] text-amber-300">Radar de cobertura</p>
                    <h3 className="mt-1 text-base font-black text-slate-100">Próximas renovações</h3>
                    <p className="mt-1 text-[11px] text-slate-400">Cobertura calculada com o valor configurado para cada colaborador.</p>
                  </div>
                  <span className="rounded-full bg-amber-500/10 px-3 py-1.5 text-[10px] font-black text-amber-200">Atenção: até 2 dias</span>
                </div>
                {latestCoverage.length ? (
                  <div className="divide-y divide-slate-700/70">
                    {latestCoverage.slice(0, 8).map(({ employee, lastTopup, coverage }) => (
                      <div key={employee.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                        <div className="min-w-0 flex-1">
                          <strong className="block truncate text-sm text-slate-100">{employee.full_name}</strong>
                          <span className="text-[11px] text-slate-500">{employee.unit} · {lastTopup ? `último crédito em ${dateText(lastTopup.paid_at)}` : "sem lançamento registrado"}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <strong className="block text-xs text-slate-200">{coverage?.renewalDate ? dateText(coverage.renewalDate) : "Sem cobertura"}</strong>
                            <span className={`text-[10px] font-black ${!lastTopup || !coverage?.renewalDate || coverage.daysRemaining <= 0 ? "text-rose-300" : coverage.daysRemaining <= 2 ? "text-amber-300" : "text-emerald-300"}`}>
                              {!lastTopup || !coverage?.renewalDate ? "Registrar crédito" : coverage.daysRemaining <= 0 ? "Renovar hoje" : `${coverage.daysRemaining} dias úteis`}
                            </span>
                          </div>
                          {lastTopup && <span className="rounded-lg bg-slate-900 px-2.5 py-1.5 text-[10px] font-bold text-slate-300">{coverage?.daysCovered ?? 0} dias cobertos</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="Nenhum colaborador vinculado" text="Vincule os funcionários ativos do Cadastro Central para começar a controlar as coberturas." action="Vincular colaborador" onAction={() => { setSection("employees"); setEmployeeModal("new"); }} />
                )}
              </section>

              <section className="rounded-xl border border-slate-800 bg-[#141F33] p-4 sm:p-5">
                <p className="text-[10px] font-black uppercase tracking-[.15em] text-sky-300">Resumo financeiro</p>
                <h3 className="mt-1 text-base font-black text-slate-100">Movimentação do benefício</h3>
                <div className="mt-5 space-y-4">
                  <div className="border-l-2 border-amber-400 pl-3">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Acumulado no histórico</span>
                    <strong className="mt-1 block text-xl font-black text-slate-100">{money(totalMoved)}</strong>
                  </div>
                  <div className="border-l-2 border-sky-400 pl-3">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Custo diário configurado</span>
                    <strong className="mt-1 block text-xl font-black text-slate-100">{money(activeEmployees.reduce((sum, employee) => sum + getDailyCostCents(employee, benefitType), 0))}</strong>
                  </div>
                  <div className="border-l-2 border-emerald-400 pl-3">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Projeção mensal do time</span>
                    <strong className="mt-1 block text-xl font-black text-slate-100">{money(financeSummary.projectedMonthlyCents)}</strong>
                    <span className="mt-1 block text-[10px] text-slate-500">{financeSummary.daysInMonth} dias úteis no calendário do Rio</span>
                  </div>
                  <p className="text-[11px] leading-5 text-slate-400">
                    {benefitType === "passagem"
                      ? "VT: tarifa por viagem multiplicada pelas viagens diárias cadastradas."
                      : "VA: valor diário configurado multiplicado pelos dias úteis de cobertura."}
                    {" "}Feriados do calendário do Rio de Janeiro são excluídos da estimativa.
                  </p>
                  <button onClick={() => setSection("history")} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-slate-800">
                    <Receipt className="h-4 w-4" /> Consultar histórico
                  </button>
                </div>
              </section>
            </div>
          </div>
        )}

        {section === "employees" && (
          <EmployeeList
            employees={activeEmployees}
            benefitType={benefitType}
            search={employeeSearch}
            onSearchChange={setEmployeeSearch}
            onNew={() => setEmployeeModal("new")}
            onEdit={setEmployeeModal}
            onDelete={async (id) => {
              const employee = activeEmployees.find((item) => item.id === id);
              if (!employee || !window.confirm(`Desativar somente o vínculo de ${employee.full_name} com ${title}? O cadastro central e o histórico serão preservados.`)) return;
              setError(null);
              try {
                await deleteRhEmployee({ data: { id, benefit_type: benefitType } });
                invalidate();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Não foi possível desativar o benefício.");
              }
            }}
          />
        )}

        {section === "topups" && (
          <section className="mx-auto max-w-2xl rounded-xl border border-slate-800 bg-[#141F33] p-4 sm:p-6">
            <div className="mb-5">
              <p className="text-[10px] font-black uppercase tracking-[.15em] text-amber-300">Novo lançamento</p>
              <h3 className="mt-1 text-lg font-black text-slate-100">Registrar crédito de {benefitType === "passagem" ? "Vale Passagem" : "Vale Alimentação"}</h3>
              <p className="mt-1 text-xs leading-5 text-slate-400">O lançamento só pode ser associado a colaborador ativo, previamente vinculado ao Cadastro Central.</p>
            </div>
            {activeEmployees.length ? (
              <TopupForm
                employees={activeEmployees}
                benefitType={benefitType}
                onDone={() => { invalidate(); setSection("history"); }}
              />
            ) : (
              <EmptyState title="Nenhum colaborador com benefício ativo" text="Primeiro cadastre o funcionário na ficha central do RH e depois vincule este benefício." action="Vincular do Cadastro Central" onAction={() => { setSection("employees"); setEmployeeModal("new"); }} />
            )}
          </section>
        )}

        {section === "history" && (
          <HistoryList
            benefitType={benefitType}
            employees={activeEmployees}
            topups={rows}
            search={historySearch}
            onSearchChange={setHistorySearch}
            onEdit={(item) => { setTopupEdit(item); setTopupOpen(true); }}
          />
        )}

        {section === "finance" && (
          <FinancePanel
            benefitType={benefitType}
            period={financePeriod}
            employeeId={financeEmployeeId}
            onPeriodChange={setFinancePeriod}
            onEmployeeChange={setFinanceEmployeeId}
            employees={activeEmployees}
            summary={financeSummary}
          />
        )}
      </div>

      {employeeModal && (
        <BenefitConfigModal
          benefitType={benefitType}
          employees={activeEmployees}
          employee={employeeModal === "new" ? undefined : employeeModal}
          onClose={() => setEmployeeModal(null)}
          onDone={() => { invalidate(); setEmployeeModal(null); }}
        />
      )}

      {topupOpen && (
        <div className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-[#02060d]/75 p-4">
          <div className="my-auto w-full max-w-xl rounded-2xl border border-slate-700 bg-[#1E293B] p-5 shadow-2xl sm:p-6">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[.15em] text-amber-300">{topupEdit ? "Correção de histórico" : "Lançamento de benefício"}</p>
                <h3 className="mt-1 text-xl font-black text-slate-50">{topupEdit ? "Editar crédito" : "Novo crédito"}</h3>
              </div>
              <button onClick={() => { setTopupOpen(false); setTopupEdit(null); }} className="min-h-10 rounded-lg px-3 text-xs font-bold text-slate-400 hover:bg-slate-800">Fechar</button>
            </div>
            <TopupForm
              employees={activeEmployees}
              benefitType={benefitType}
              topup={topupEdit ?? undefined}
              onDone={() => { invalidate(); setTopupOpen(false); setTopupEdit(null); setSection("history"); }}
            />
          </div>
        </div>
      )}
    </section>
  );
}

function Metric({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <article className="rounded-xl border border-slate-800 bg-[#141F33] p-4">
      <div className="flex items-center justify-between text-slate-400">
        <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-900 text-[#F59E0B]">{icon}</span>
      </div>
      <strong className="mt-4 block text-2xl font-black tracking-tight text-slate-50">{value}</strong>
    </article>
  );
}

function EmptyState({ title, text, action, onAction }: { title: string; text: string; action?: string; onAction?: () => void }) {
  return (
    <div className="grid justify-items-center gap-2 px-4 py-8 text-center">
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-slate-900 text-slate-400"><AlertTriangle className="h-5 w-5" /></span>
      <strong className="text-sm font-black text-slate-200">{title}</strong>
      <p className="max-w-md text-xs leading-5 text-slate-400">{text}</p>
      {action && onAction && <button onClick={onAction} className="mt-2 min-h-10 rounded-lg bg-[#F59E0B] px-4 py-2 text-xs font-black text-slate-950">{action}</button>}
    </div>
  );
}

function EmployeeList({
  employees,
  benefitType,
  search,
  onSearchChange,
  onNew,
  onEdit,
  onDelete,
}: {
  employees: Employee[];
  benefitType: RhBenefitType;
  search: string;
  onSearchChange: (value: string) => void;
  onNew: () => void;
  onEdit: (employee: Employee) => void;
  onDelete: (id: string) => void;
}) {
  const filtered = employees.filter((employee) =>
    `${employee.full_name} ${employee.unit}`.toLocaleLowerCase("pt-BR").includes(search.trim().toLocaleLowerCase("pt-BR"))
  );
  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h3 className="text-lg font-black text-slate-50">Colaboradores com benefício</h3>
          <p className="text-xs text-slate-400">A pessoa é cadastrada uma vez no RH. Esta área apenas vincula e configura o benefício.</p>
        </div>
        <button onClick={onNew} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#F59E0B] px-3 py-2 text-xs font-black text-[#0B0F19]">
          <Plus className="h-3.5 w-3.5" /> Vincular do cadastro
        </button>
      </div>
      <label className="mb-3 flex min-h-10 max-w-lg items-center gap-2 rounded-lg border border-slate-700 bg-[#0F172A] px-3 text-slate-400">
        <Search className="h-4 w-4" /><input value={search} onChange={(e) => onSearchChange(e.target.value)} placeholder="Buscar por nome ou unidade" className="w-full bg-transparent text-xs text-slate-100 outline-none placeholder:text-slate-500" />
      </label>
      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-[#141F33] text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">Unidade</th>
              <th className="px-4 py-3">{benefitType === "passagem" ? "Tarifa por viagem" : "Valor diário"}</th>
              {benefitType === "passagem" && <th className="px-4 py-3">Viagens/dia</th>}
              <th className="px-4 py-3">Custo diário</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((employee) => (
              <tr key={employee.id} className="border-t border-slate-800">
                <td className="px-4 py-3 font-semibold text-slate-100">{employee.full_name}</td>
                <td className="px-4 py-3 text-slate-300">{employee.unit}</td>
                <td className="px-4 py-3 text-slate-300">{money(employee.fare_cents)}</td>
                {benefitType === "passagem" && <td className="px-4 py-3 text-slate-300">{employee.trips_per_day}</td>}
                <td className="px-4 py-3 font-bold text-slate-100">{money(getDailyCostCents(employee, benefitType))}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => onEdit(employee)} className="mr-3 min-h-9 text-sky-300" title="Editar parâmetros do benefício" aria-label={`Editar benefício de ${employee.full_name}`}><Pencil className="inline h-4 w-4" /></button>
                  <button onClick={() => onDelete(employee.id)} className="min-h-9 text-rose-300" title="Desativar somente o vínculo do benefício" aria-label={`Desativar benefício de ${employee.full_name}`}><Trash2 className="inline h-4 w-4" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && <p className="p-8 text-center text-xs text-slate-400">{employees.length ? "Nenhum colaborador encontrado para esta busca." : "Nenhum benefício configurado. Vincule alguém do Cadastro Central."}</p>}
      </div>
    </div>
  );
}

function BenefitConfigModal({
  benefitType,
  employees,
  employee,
  onClose,
  onDone,
}: {
  benefitType: RhBenefitType;
  employees: Employee[];
  employee?: Employee;
  onClose: () => void;
  onDone: () => void;
}) {
  const registry = useQuery({
    queryKey: ["rh-employee-registry-for-benefit"],
    queryFn: () => listRhEmployeeRegistryForBenefits(),
    enabled: !employee,
  });
  const [employeeId, setEmployeeId] = useState(employee?.registry_employee_id ?? "");
  const [fare, setFare] = useState(employee ? (employee.fare_cents / 100).toFixed(2).replace(".", ",") : "");
  const [trips, setTrips] = useState(String(employee?.trips_per_day ?? 2));
  const [localError, setLocalError] = useState<string | null>(null);
  const title = benefitType === "passagem" ? "Vale Passagem" : "Vale Alimentação";
  const linkedIds = new Set(employees.map((item) => item.registry_employee_id));
  const available = (registry.data ?? []).filter((item: any) => item.is_active && !linkedIds.has(item.id));
  const save = useMutation({
    mutationFn: () => configureRhEmployeeBenefit({
      data: {
        registry_employee_id: employeeId,
        benefit_type: benefitType,
        fare_cents: parseMoneyCents(fare),
        trips_per_day: benefitType === "passagem" ? Number(trips) : 1,
      },
    }),
    onSuccess: onDone,
  });
  const submit = () => {
    setLocalError(null);
    const amountCents = parseMoneyCents(fare);
    if (!employee && !employeeId) return setLocalError("Selecione um funcionário do Cadastro Central.");
    if (amountCents <= 0) return setLocalError("Informe um valor maior que zero.");
    if (benefitType === "passagem" && (!Number.isInteger(Number(trips)) || Number(trips) < 1 || Number(trips) > 12)) {
      return setLocalError("Informe de 1 a 12 viagens por dia.");
    }
    save.mutate();
  };

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-[#02060d]/75 p-4">
      <div className="my-auto w-full max-w-xl rounded-2xl border border-slate-700 bg-[#1E293B] p-5 shadow-2xl sm:p-6">
        <h3 className="text-xl font-black text-slate-50">{employee ? "Editar parâmetros" : `Vincular ${title}`}</h3>
        <p className="mt-1 text-xs leading-5 text-slate-400">Não crie o funcionário aqui. O cadastro, nome, unidade e situação vêm da ficha central do RH.</p>
        <div className="mt-5 grid gap-4">
          {!employee ? (
            <label className="grid gap-1.5 text-xs font-bold text-slate-300">
              Funcionário ativo no Cadastro Central
              <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="min-h-11 rounded-lg border border-slate-700 bg-[#0F172A] px-3 text-sm text-slate-100">
                <option value="">Selecione o funcionário</option>
                {available.map((item: any) => <option key={item.id} value={item.id}>{item.full_name} · {item.unit}</option>)}
              </select>
            </label>
          ) : (
            <div className="rounded-lg border border-slate-700 bg-[#0F172A] px-3 py-3">
              <p className="text-sm font-bold text-slate-100">{employee.full_name}</p>
              <p className="text-xs text-slate-500">{employee.unit}</p>
            </div>
          )}
          <label className="grid gap-1.5 text-xs font-bold text-slate-300">
            {benefitType === "passagem" ? "Tarifa por viagem (R$)" : "Crédito diário de alimentação (R$)"}
            <input value={fare} onChange={(e) => setFare(e.target.value)} placeholder={benefitType === "passagem" ? "Ex.: 5,00" : "Ex.: 35,00"} inputMode="decimal" className="min-h-11 rounded-lg border border-slate-700 bg-[#0F172A] px-3 text-sm text-slate-100 placeholder:text-slate-500" />
          </label>
          {benefitType === "passagem" && (
            <label className="grid gap-1.5 text-xs font-bold text-slate-300">
              Viagens por dia
              <input value={trips} onChange={(e) => setTrips(e.target.value)} type="number" min="1" max="12" className="min-h-11 rounded-lg border border-slate-700 bg-[#0F172A] px-3 text-sm text-slate-100" />
              <span className="font-normal text-slate-500">Ida e volta normalmente corresponde a 2 viagens.</span>
            </label>
          )}
          {benefitType === "alimentacao" && <p className="rounded-lg bg-emerald-500/10 p-3 text-xs text-emerald-200">O VA usa somente o valor diário. Não utiliza tarifa nem viagens por dia.</p>}
          {!employee && registry.isSuccess && available.length === 0 && (
            <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-xs leading-5 text-amber-200">Todos os funcionários ativos já estão vinculados a este benefício ou ainda não há funcionários cadastrados. Faça o cadastro primeiro na área Funcionários.</p>
          )}
        </div>
        {(localError || save.error) && <p role="alert" className="mt-4 rounded-lg bg-red-500/10 p-3 text-xs font-semibold text-red-300">{localError ?? (save.error instanceof Error ? save.error.message : "Não foi possível configurar o benefício.")}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="min-h-10 rounded-lg px-4 py-2 text-xs font-bold text-slate-400">Cancelar</button>
          <button onClick={submit} disabled={save.isPending || registry.isLoading || (!employee && available.length === 0)} className="min-h-10 rounded-lg bg-[#F59E0B] px-4 py-2 text-xs font-black text-[#0B0F19] disabled:opacity-50">
            {save.isPending ? "Salvando..." : "Salvar benefício"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TopupForm({
  employees,
  benefitType,
  topup,
  onDone,
}: {
  employees: Employee[];
  benefitType: RhBenefitType;
  topup?: Topup;
  onDone: () => void;
}) {
  const defaultEmployeeId = topup?.employee_id ?? employees[0]?.id ?? "";
  const [employeeId, setEmployeeId] = useState(defaultEmployeeId);
  const [amount, setAmount] = useState(topup ? (topup.amount_cents / 100).toFixed(2).replace(".", ",") : "");
  const [paidAt, setPaidAt] = useState(topup?.paid_at ?? localISODate());
  const [localError, setLocalError] = useState<string | null>(null);
  const employee = employees.find((item) => item.id === employeeId);
  const dailyCostCents = employee ? getDailyCostCents(employee, benefitType) : 0;
  const amountCents = parseMoneyCents(amount);
  const coverage = dailyCostCents > 0 && amountCents > 0
    ? buildCoverage(amountCents, dailyCostCents, paidAt, scheduleKind(employee?.work_schedule))
    : null;
  const mutation = useMutation({
    mutationFn: () => topup
      ? updateRhTopup({ data: { id: topup.id, benefit_type: benefitType, amount_cents: amountCents, paid_at: paidAt } })
      : createRhTopup({ data: { benefit_type: benefitType, employee_id: employeeId, amount_cents: amountCents, paid_at: paidAt } }),
    onSuccess: onDone,
  });
  const submit = () => {
    setLocalError(null);
    if (!employeeId) return setLocalError("Selecione um colaborador.");
    if (amountCents <= 0) return setLocalError("Informe um valor maior que zero.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidAt) || !Number.isFinite(new Date(paidAt + "T12:00:00").getTime())) {
      return setLocalError("Informe uma data válida.");
    }
    mutation.mutate();
  };

  return (
    <div className="space-y-4">
      <label className="grid gap-1.5 text-xs font-bold text-slate-300">
        Colaborador
        <select
          value={employeeId}
          disabled={Boolean(topup)}
          onChange={(e) => setEmployeeId(e.target.value)}
          className="min-h-11 w-full rounded-lg border border-slate-700 bg-[#0F172A] px-3 text-sm text-slate-100 disabled:opacity-70"
        >
          <option value="">Selecione um colaborador</option>
          {employees.map((item) => <option value={item.id} key={item.id}>{item.full_name} · {item.unit}</option>)}
          {topup && !employees.some((item) => item.id === topup.employee_id) && (
            <option value={topup.employee_id}>{topup.employee_full_name ?? "Colaborador inativo"} · histórico</option>
          )}
        </select>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1.5 text-xs font-bold text-slate-300">
          {benefitType === "passagem" ? "Valor da recarga (R$)" : "Valor do crédito VA (R$)"}
          <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Ex.: 220,00" inputMode="decimal" className="min-h-11 w-full rounded-lg border border-slate-700 bg-[#0F172A] px-3 text-sm text-slate-100 placeholder:text-slate-500" />
        </label>
        <label className="grid gap-1.5 text-xs font-bold text-slate-300">
          Data do crédito
          <input value={paidAt} onChange={(e) => setPaidAt(e.target.value)} type="date" className="min-h-11 w-full rounded-lg border border-slate-700 bg-[#0F172A] px-3 text-sm text-slate-100" />
        </label>
      </div>
      {employee && amountCents > 0 && coverage && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs text-emerald-200">
          <strong>Previsão de cobertura: {coverage.daysCovered} dias de trabalho.</strong>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
            <span>{dailyLabelFor(benefitType)}: {money(coverage.dailyCostCents)}</span>
            <span>Renovação estimada: {coverage.renewalDate ? dateText(coverage.renewalDate) : "—"}</span>
          </div>
          {scheduleKind(employee.work_schedule) === "12x36" && <p className="mt-2 text-[10px] text-emerald-100/80">Escala 12x36: estimativa por alternância a partir da data do crédito.</p>}
        </div>
      )}
      {(localError || mutation.error) && <p role="alert" className="rounded-lg bg-red-500/10 p-3 text-xs font-semibold text-red-300">{localError ?? (mutation.error instanceof Error ? mutation.error.message : "Não foi possível salvar o crédito.")}</p>}
      <div className="flex justify-end">
        <button onClick={submit} disabled={mutation.isPending || !employeeId || amountCents <= 0} className="min-h-11 rounded-lg bg-[#F59E0B] px-5 py-2.5 text-xs font-black text-[#0B0F19] disabled:opacity-50">
          {mutation.isPending ? "Salvando..." : topup ? "Salvar correção" : "Registrar crédito"}
        </button>
      </div>
    </div>
  );
}

function dailyLabelFor(benefitType: RhBenefitType) {
  return benefitType === "passagem" ? "Custo por dia" : "Crédito por dia";
}

function HistoryList({
  benefitType,
  employees,
  topups,
  search,
  onSearchChange,
  onEdit,
}: {
  benefitType: RhBenefitType;
  employees: Employee[];
  topups: Topup[];
  search: string;
  onSearchChange: (value: string) => void;
  onEdit: (topup: Topup) => void;
}) {
  const employeeById = useMemo(() => new Map(employees.map((item) => [item.id, item])), [employees]);
  const filtered = topups.filter((item) =>
    `${item.employee_full_name ?? employeeById.get(item.employee_id)?.full_name ?? ""} ${item.employee_unit ?? employeeById.get(item.employee_id)?.unit ?? ""}`
      .toLocaleLowerCase("pt-BR").includes(search.trim().toLocaleLowerCase("pt-BR"))
  );
  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-lg font-black text-slate-50">Histórico de créditos</h3>
          <p className="text-xs text-slate-400">Lançamentos preservados, com previsão de cobertura e correção auditada.</p>
        </div>
        <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">{filtered.length} lançamentos</span>
      </div>
      <label className="mb-3 flex min-h-10 max-w-lg items-center gap-2 rounded-lg border border-slate-700 bg-[#0F172A] px-3 text-slate-400">
        <Search className="h-4 w-4" /><input value={search} onChange={(e) => onSearchChange(e.target.value)} placeholder="Buscar por colaborador ou unidade" className="w-full bg-transparent text-xs text-slate-100 outline-none placeholder:text-slate-500" />
      </label>
      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-[#141F33] text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-4 py-3">Colaborador</th>
              <th className="px-4 py-3">Data do crédito</th>
              <th className="px-4 py-3">Valor</th>
              <th className="px-4 py-3">Cobertura</th>
              <th className="px-4 py-3">Renovação</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => {
              const employee = employeeById.get(item.employee_id);
              const fare = Number(item.employee_fare_cents ?? employee?.fare_cents ?? 0);
              const trips = Number(item.employee_trips_per_day ?? employee?.trips_per_day ?? 1);
              const dailyCost = fare * (benefitType === "passagem" ? Math.max(1, trips) : 1);
              const schedule = scheduleKind(employee?.work_schedule);
              const coverage = dailyCost > 0 ? buildCoverage(item.amount_cents, dailyCost, item.paid_at, schedule) : null;
              const status = !coverage?.renewalDate ? "Sem parâmetro" : coverage.daysRemaining <= 0 ? "Renovar hoje" : coverage.daysRemaining <= 2 ? "Renovar em breve" : "Em dia";
              const statusClass = status === "Em dia" ? "text-emerald-300" : status === "Renovar em breve" ? "text-amber-300" : "text-rose-300";
              return (
                <tr key={item.id} className="border-t border-slate-800">
                  <td className="px-4 py-3">
                    <strong className="block text-slate-100">{item.employee_full_name ?? employee?.full_name ?? "Colaborador não disponível"}</strong>
                    <small className="text-slate-500">{item.employee_unit ?? employee?.unit ?? (item.employee_active === false ? "Cadastro inativo" : "—")}</small>
                  </td>
                  <td className="px-4 py-3 text-slate-300">{dateText(item.paid_at)}</td>
                  <td className="px-4 py-3 font-bold text-slate-100">{money(item.amount_cents)}</td>
                  <td className="px-4 py-3">
                    <strong className="block text-slate-200">{coverage ? `${coverage.daysCovered} dias` : "—"}</strong>
                    <small className="text-slate-500">{dailyCost > 0 ? `${money(dailyCost)}/dia` : "Parâmetro indisponível"}</small>
                  </td>
                  <td className="px-4 py-3">
                    <strong className="block text-slate-200">{dateText(coverage?.renewalDate)}</strong>
                    <small className={`font-bold ${statusClass}`}>{status}</small>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {item.employee_active !== false ? (
                      <button onClick={() => onEdit(item)} className="min-h-9 rounded-lg px-2 text-sky-300 hover:bg-slate-800" title="Corrigir crédito" aria-label="Corrigir crédito"><Pencil className="inline h-4 w-4" /></button>
                    ) : <span className="text-[10px] text-slate-600">Somente histórico</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!filtered.length && (
          <p className="p-8 text-center text-xs text-slate-400">{topups.length ? "Nenhum lançamento encontrado para esta busca." : "Nenhum crédito registrado. Faça o primeiro lançamento para iniciar o histórico."}</p>
        )}
      </div>
      <p className="mt-3 flex items-start gap-2 text-[10px] leading-5 text-slate-500"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Corrigir um lançamento preserva o registro de auditoria. Desativar um benefício não exclui o funcionário nem seu histórico.</p>
    </div>
  );
}

function FinancePanel({
  benefitType,
  period,
  employeeId,
  onPeriodChange,
  onEmployeeChange,
  employees,
  summary,
}: {
  benefitType: RhBenefitType;
  period: "month" | "last30" | "all";
  employeeId: string;
  onPeriodChange: (value: "month" | "last30" | "all") => void;
  onEmployeeChange: (value: string) => void;
  employees: Employee[];
  summary: {
    periodTotalCents: number;
    accumulatedTotalCents: number;
    dailyCostTotalCents: number;
    projectedMonthlyCents: number;
    topUpCount: number;
    daysInMonth: number;
    collaborators: Array<{
      id: string;
      fullName: string;
      unit: string;
      dailyCostCents: number;
      projectedMonthlyCents: number;
      topUpCount: number;
      periodInvestedCents: number;
      totalInvestedCents: number;
      lastTopUpAt: string | null;
      sharePercent: number;
    }>;
  };
}) {
  const periodLabel = period === "month" ? "Mês atual" : period === "last30" ? "Últimos 30 dias" : "Histórico completo";
  return (
    <div>
      <div className="mb-5">
        <p className="text-[10px] font-black uppercase tracking-[.15em] text-amber-300">Controle financeiro</p>
        <h3 className="mt-1 text-lg font-black text-slate-50">Investimento e projeção</h3>
        <p className="mt-1 text-xs text-slate-400">Recargas efetivamente lançadas, custo diário configurado e previsão para o mês.</p>
      </div>
      <div className="mb-5 grid gap-3 rounded-xl border border-slate-800 bg-[#141F33] p-4 sm:grid-cols-2">
        <label className="grid gap-1.5 text-[10px] font-black uppercase tracking-wider text-slate-400">
          Período
          <select value={period} onChange={(event) => onPeriodChange(event.target.value as "month" | "last30" | "all")} className="min-h-10 rounded-lg border border-slate-700 bg-[#0F172A] px-3 text-xs font-semibold text-slate-100">
            <option value="month">Mês atual</option>
            <option value="last30">Últimos 30 dias</option>
            <option value="all">Histórico completo</option>
          </select>
        </label>
        <label className="grid gap-1.5 text-[10px] font-black uppercase tracking-wider text-slate-400">
          Colaborador
          <select value={employeeId} onChange={(event) => onEmployeeChange(event.target.value)} className="min-h-10 rounded-lg border border-slate-700 bg-[#0F172A] px-3 text-xs font-semibold text-slate-100">
            <option value="">Todos os colaboradores</option>
            {employees.map((employee) => <option value={employee.id} key={employee.id}>{employee.full_name} · {employee.unit}</option>)}
          </select>
        </label>
      </div>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label={`Investido · ${periodLabel}`} value={money(summary.periodTotalCents)} icon={<WalletCards className="h-4 w-4" />} />
        <Metric label="Acumulado geral" value={money(summary.accumulatedTotalCents)} icon={<CircleDollarSign className="h-4 w-4" />} />
        <Metric label="Custo diário do time" value={money(summary.dailyCostTotalCents)} icon={<UsersRound className="h-4 w-4" />} />
        <Metric label="Projeção mensal" value={money(summary.projectedMonthlyCents)} icon={<CalendarClock className="h-4 w-4" />} />
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-[#141F33] text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-4 py-3">Colaborador</th>
              <th className="px-4 py-3">Lançamentos</th>
              <th className="px-4 py-3">Investido no período</th>
              <th className="px-4 py-3">Acumulado</th>
              <th className="px-4 py-3">Projeção mensal</th>
              <th className="px-4 py-3">Último crédito</th>
            </tr>
          </thead>
          <tbody>
            {summary.collaborators.map((item) => (
              <tr key={item.id} className="border-t border-slate-800">
                <td className="px-4 py-3">
                  <strong className="block text-slate-100">{item.fullName}</strong>
                  <small className="text-slate-500">{item.unit} · {money(item.dailyCostCents)}/dia</small>
                </td>
                <td className="px-4 py-3 text-slate-300">{item.topUpCount}</td>
                <td className="px-4 py-3">
                  <strong className="text-slate-100">{money(item.periodInvestedCents)}</strong>
                  <small className="block text-slate-500">{item.sharePercent}% do período</small>
                </td>
                <td className="px-4 py-3 font-semibold text-slate-300">{money(item.totalInvestedCents)}</td>
                <td className="px-4 py-3">
                  <strong className="text-slate-100">{money(item.projectedMonthlyCents)}</strong>
                  <small className="block text-slate-500">{summary.daysInMonth} dias úteis</small>
                </td>
                <td className="px-4 py-3 text-slate-300">{dateText(item.lastTopUpAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!summary.collaborators.length && <p className="p-8 text-center text-xs text-slate-400">Nenhum colaborador ativo neste benefício para o filtro selecionado.</p>}
      </div>
      <p className="mt-3 text-[10px] leading-5 text-slate-500">
        O investimento corresponde aos créditos registrados; a projeção é calculada pelo custo diário dos cadastros ativos multiplicado pelos {summary.daysInMonth} dias úteis do calendário do Rio de Janeiro no mês atual. {benefitType === "passagem" ? "No VT, o custo diário é tarifa × viagens por dia." : "No VA, o custo diário é o valor diário configurado."}
      </p>
    </div>
  );
}

