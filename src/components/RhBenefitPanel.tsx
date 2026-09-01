import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Pencil, Plus, Receipt, Trash2, UsersRound, WalletCards } from "lucide-react";
import {
  createRhEmployee,
  createRhTopup,
  deleteRhEmployee,
  deleteRhTopup,
  listRhEmployees,
  listRhTopups,
  updateRhEmployee,
  type RhBenefitType,
} from "@/lib/rh.functions";

type Employee = {
  id: string;
  full_name: string;
  unit: string;
  fare_cents: number;
  trips_per_day: number;
  is_active: boolean;
};
type Topup = { id: string; employee_id: string; amount_cents: number; paid_at: string };

const money = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
const dateText = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).format(
    new Date(`${value}T12:00:00`),
  );
function coverageDays(amount: number, fare: number, trips: number) {
  return fare > 0 && trips > 0 ? Math.floor(amount / (fare * trips)) : 0;
}

function addBusinessDays(date: string, days: number) {
  const result = new Date(`${date}T12:00:00`);
  let remaining = days;
  while (remaining > 0) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return result.toLocaleDateString("pt-BR");
}

export function RhBenefitPanel({ benefitType }: { benefitType: RhBenefitType }) {
  const qc = useQueryClient();
  const [section, setSection] = useState<"overview" | "employees" | "topups" | "history">(
    "overview",
  );
  const [employeeModal, setEmployeeModal] = useState<"new" | Employee | null>(null);
  const [topupOpen, setTopupOpen] = useState(false);
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
  const totalMonth = (topups.data ?? [])
    .filter((item: Topup) => new Date(item.paid_at).getMonth() === new Date().getMonth())
    .reduce((sum: number, item: Topup) => sum + item.amount_cents, 0);
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["rh-employees", benefitType] });
    qc.invalidateQueries({ queryKey: ["rh-topups", benefitType] });
  };
  const title = benefitType === "alimentacao" ? "Vale Alimentação" : "Vale Passagem";

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-4 border-b border-slate-200 bg-[#102b3b] px-5 py-5 text-white sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.2em] text-[#f7c945]">
            Módulo RH · operação
          </p>
          <h2 className="mt-1 text-2xl font-black tracking-tight">{title}</h2>
          <p className="mt-1 text-xs text-white/65">
            Controle de colaboradores, recargas e histórico em um único ambiente.
          </p>
        </div>
        <button
          onClick={() => setTopupOpen(true)}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#f7c945] px-4 py-2.5 text-xs font-black text-[#102b3b] shadow-lg transition hover:bg-[#ffd967]"
        >
          <Plus className="h-4 w-4" /> Nova recarga
        </button>
      </div>
      <div className="flex flex-wrap gap-2 border-b border-slate-200 px-5 py-3 sm:px-7">
        {(
          [
            ["overview", "Visão geral", WalletCards],
            ["employees", "Colaboradores", UsersRound],
            ["topups", "Nova recarga", Plus],
            ["history", "Histórico", Receipt],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setSection(key)}
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition ${section === key ? "bg-[#102b3b] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>
      {error && (
        <div className="mx-5 mt-4 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 sm:mx-7">
          {error}
        </div>
      )}
      {(employees.isError || topups.isError) && (
        <div className="mx-5 mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-xs leading-5 text-amber-900 sm:mx-7">
          O cadastro do RH ainda não está disponível neste ambiente. Nenhum dado foi alterado;
          publique a migração do Supabase para liberar esta área.
        </div>
      )}
      <div className="p-5 sm:p-7">
        {(employees.isLoading || topups.isLoading) && (
          <p className="mb-5 rounded-xl bg-slate-50 p-6 text-center text-xs font-semibold text-slate-500">
            Carregando dados do RH...
          </p>
        )}
        {section === "overview" && !employees.isLoading && !topups.isLoading && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Metric
              label="Colaboradores ativos"
              value={String(activeEmployees.length)}
              icon={<UsersRound className="h-4 w-4" />}
            />
            <Metric
              label="Recargas no mês"
              value={String(
                (topups.data ?? []).filter(
                  (item: Topup) => new Date(item.paid_at).getMonth() === new Date().getMonth(),
                ).length,
              )}
              icon={<Receipt className="h-4 w-4" />}
            />
            <Metric
              label="Total movimentado"
              value={money(totalMonth)}
              icon={<WalletCards className="h-4 w-4" />}
            />
          </div>
        )}
        {section === "employees" && (
          <EmployeeList
            employees={activeEmployees}
            onNew={() => setEmployeeModal("new")}
            onEdit={setEmployeeModal}
            onDelete={async (id) => {
              setError(null);
              try {
                await deleteRhEmployee({ data: { id, benefit_type: benefitType } });
                invalidate();
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Não foi possível remover o colaborador.",
                );
              }
            }}
          />
        )}
        {section === "topups" && (
          <TopupForm
            employees={activeEmployees}
            benefitType={benefitType}
            onDone={() => {
              invalidate();
              setSection("history");
            }}
          />
        )}
        {section === "history" && (
          <HistoryList employees={activeEmployees} topups={(topups.data ?? []) as Topup[]} />
        )}
      </div>
      {employeeModal && (
        <EmployeeModal
          benefitType={benefitType}
          employee={employeeModal === "new" ? undefined : employeeModal}
          onClose={() => setEmployeeModal(null)}
          onDone={() => {
            invalidate();
            setEmployeeModal(null);
          }}
        />
      )}
      {topupOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#102b3b]/45 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h3 className="text-xl font-black text-[#102b3b]">Nova recarga</h3>
              <button
                onClick={() => setTopupOpen(false)}
                className="text-xs font-bold text-slate-500"
              >
                Fechar
              </button>
            </div>
            <TopupForm
              employees={activeEmployees}
              benefitType={benefitType}
              onDone={() => {
                invalidate();
                setTopupOpen(false);
                setSection("history");
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}

function Metric({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center justify-between text-slate-500">
        <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-white text-[#1E8F66]">
          {icon}
        </span>
      </div>
      <strong className="mt-4 block text-2xl font-black tracking-tight text-[#102b3b]">
        {value}
      </strong>
    </article>
  );
}

function EmployeeList({
  employees,
  onNew,
  onEdit,
  onDelete,
}: {
  employees: Employee[];
  onNew: () => void;
  onEdit: (employee: Employee) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-black text-[#102b3b]">Colaboradores</h3>
          <p className="text-xs text-slate-500">Cadastros usados nos cálculos de cobertura.</p>
        </div>
        <button
          onClick={onNew}
          className="inline-flex items-center gap-2 rounded-lg bg-[#1E8F66] px-3 py-2 text-xs font-bold text-white"
        >
          <Plus className="h-3.5 w-3.5" /> Novo colaborador
        </button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">Unidade</th>
              <th className="px-4 py-3">Valor unitário</th>
              <th className="px-4 py-3">Viagens/dia</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((employee) => (
              <tr key={employee.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-semibold text-slate-800">{employee.full_name}</td>
                <td className="px-4 py-3 text-slate-600">{employee.unit}</td>
                <td className="px-4 py-3">{money(employee.fare_cents)}</td>
                <td className="px-4 py-3">{employee.trips_per_day}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => onEdit(employee)} className="mr-2 text-sky-700">
                    <Pencil className="inline h-4 w-4" />
                  </button>
                  <button onClick={() => onDelete(employee.id)} className="text-red-700">
                    <Trash2 className="inline h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!employees.length && (
          <p className="p-8 text-center text-xs text-slate-500">
            Nenhum colaborador cadastrado ainda.
          </p>
        )}
      </div>
    </div>
  );
}

function EmployeeModal({
  benefitType,
  employee,
  onClose,
  onDone,
}: {
  benefitType: RhBenefitType;
  employee?: Employee;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(employee?.full_name ?? "");
  const [unit, setUnit] = useState(employee?.unit ?? "");
  const [fare, setFare] = useState(
    employee ? (employee.fare_cents / 100).toFixed(2).replace(".", ",") : "",
  );
  const [trips, setTrips] = useState(String(employee?.trips_per_day ?? 1));
  const save = useMutation({
    mutationFn: () =>
      employee
        ? updateRhEmployee({
            data: {
              id: employee.id,
              benefit_type: benefitType,
              full_name: name,
              unit,
              fare_cents: Math.round(Number(fare.replace(",", ".")) * 100),
              trips_per_day: Number(trips),
            },
          })
        : createRhEmployee({
            data: {
              benefit_type: benefitType,
              full_name: name,
              unit,
              fare_cents: Math.round(Number(fare.replace(",", ".")) * 100),
              trips_per_day: Number(trips),
            },
          }),
    onSuccess: onDone,
  });
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#102b3b]/45 p-4">
      <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl">
        <h3 className="text-xl font-black text-[#102b3b]">
          {employee ? "Editar colaborador" : "Novo colaborador"}
        </h3>
        <div className="mt-5 grid gap-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome completo"
            className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
          />
          <input
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="Unidade / setor"
            className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
          />
          <div className="grid grid-cols-2 gap-4">
            <input
              value={fare}
              onChange={(e) => setFare(e.target.value)}
              placeholder="Valor unitário"
              className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
            />
            <input
              value={trips}
              onChange={(e) => setTrips(e.target.value)}
              type="number"
              min="1"
              max="12"
              placeholder="Viagens por dia"
              className="rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
            />
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-xs font-bold text-slate-600"
          >
            Cancelar
          </button>
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="rounded-lg bg-[#1E8F66] px-4 py-2 text-xs font-bold text-white"
          >
            {save.isPending ? "Salvando..." : "Salvar colaborador"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TopupForm({
  employees,
  benefitType,
  onDone,
}: {
  employees: Employee[];
  benefitType: RhBenefitType;
  onDone: () => void;
}) {
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const employee = employees.find((item) => item.id === employeeId);
  const amountCents = Math.round(Number(amount.replace(",", ".")) * 100);
  const days = employee
    ? coverageDays(amountCents, employee.fare_cents, employee.trips_per_day)
    : 0;
  const create = useMutation({
    mutationFn: () =>
      createRhTopup({
        data: {
          benefit_type: benefitType,
          employee_id: employeeId,
          amount_cents: amountCents,
          paid_at: paidAt,
        },
      }),
    onSuccess: onDone,
  });
  return (
    <div className="space-y-4">
      <select
        value={employeeId}
        onChange={(e) => setEmployeeId(e.target.value)}
        className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
      >
        <option value="">Selecione um colaborador</option>
        {employees.map((item) => (
          <option value={item.id} key={item.id}>
            {item.full_name} · {item.unit}
          </option>
        ))}
      </select>
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="Valor da recarga"
        inputMode="decimal"
        className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
      />
      <input
        value={paidAt}
        onChange={(e) => setPaidAt(e.target.value)}
        type="date"
        className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
      />
      {employee && amountCents > 0 && (
        <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-xs text-emerald-800">
          <strong>Cobertura estimada: {days} dias úteis.</strong>
          <span className="block mt-1">Renovação prevista em {addBusinessDays(paidAt, days)}.</span>
        </div>
      )}
      <button
        onClick={() => create.mutate()}
        disabled={create.isPending || !employeeId || amountCents <= 0}
        className="rounded-lg bg-[#1E8F66] px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50"
      >
        {create.isPending ? "Registrando..." : "Registrar recarga"}
      </button>
    </div>
  );
}

function HistoryList({ employees, topups }: { employees: Employee[]; topups: Topup[] }) {
  const byId = useMemo(() => new Map(employees.map((item) => [item.id, item])), [employees]);
  return (
    <div>
      <h3 className="text-lg font-black text-[#102b3b]">Histórico de recargas</h3>
      <p className="mb-4 text-xs text-slate-500">
        Acompanhe valores, cobertura e data de cada movimentação.
      </p>
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-3">Colaborador</th>
              <th className="px-4 py-3">Data</th>
              <th className="px-4 py-3">Valor</th>
              <th className="px-4 py-3">Cobertura</th>
            </tr>
          </thead>
          <tbody>
            {topups.map((item) => {
              const employee = byId.get(item.employee_id);
              return (
                <tr key={item.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-semibold">
                    {employee?.full_name ?? "Colaborador inativo"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{dateText(item.paid_at)}</td>
                  <td className="px-4 py-3">{money(item.amount_cents)}</td>
                  <td className="px-4 py-3">
                    {employee
                      ? `${coverageDays(item.amount_cents, employee.fare_cents, employee.trips_per_day)} dias úteis`
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!topups.length && (
          <p className="p-8 text-center text-xs text-slate-500">
            Nenhuma recarga registrada ainda.
          </p>
        )}
      </div>
    </div>
  );
}
