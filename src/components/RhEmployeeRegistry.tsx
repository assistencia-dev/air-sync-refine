import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, KeyRound, Pencil, Plus, Trash2, Upload, UsersRound, Eye, BriefcaseBusiness, CalendarDays, FileStack, UserRound, FileDown, FileSpreadsheet } from "lucide-react";
import {
  deactivateRhEmployeeRecord,
  reactivateRhEmployeeRecord,
  getRhEmployeeFichaUrl,
  listRhEmployeeRegistry,
  saveRhEmployeeRecord,
  uploadRhEmployeeFicha,
  saveRhEmployeeAccess,
  listRhCollaboratorUsers,
  getRhEmployee360,
} from "@/lib/rh.functions";
import { exportRhEmployeeFichaPdf, exportRhEmployeeRegistryPdf } from "@/lib/rh.exports";

type Employee = {
  id: string;
  full_name: string;
  unit: string;
  registration_data: Record<string, string> | null;
  ficha_file_name: string | null;
  is_active: boolean;
  access?: {
    employee_id: string;
    user_id: string;
    access_enabled: boolean;
    dbs_control_access_enabled?: boolean;
    login_identifier: string | null;
    user?: { username?: string | null; email?: string | null; status?: string | null } | null;
  } | null;
};
const FIELDS = [
  ["cpf", "CPF"],
  ["rg", "RG"],
  ["birth_date", "Data de nascimento"],
  ["phone", "Telefone"],
  ["address", "Endereço"],
  ["mother_name", "Nome da mãe"],
  ["father_name", "Nome do pai"],
  ["job_title", "Cargo / função"],
  ["admission_date", "Data de admissão"],
  ["salary", "Salário"],
  ["payment_type", "Tipo de pagamento"],
  ["work_hours", "Horário de trabalho"],
  ["pis", "PIS"],
  ["ctps", "CTPS"],
  ["bank", "Banco"],
  ["bank_account", "Número da conta"],
  ["notes", "Observações"],
] as const;

export function RhEmployeeRegistry({ initialEmployeeId }: { initialEmployeeId?: string | null }) {
  const qc = useQueryClient();
  const employees = useQuery({
    queryKey: ["rh-employee-registry"],
    queryFn: () => listRhEmployeeRegistry(),
  });
  const [editing, setEditing] = useState<Employee | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [accessing, setAccessing] = useState<Employee | null>(null);
  const [viewing, setViewing] = useState<Employee | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"todos" | "ativos" | "inativos">("ativos");
  const [accessFilter, setAccessFilter] = useState<"todos" | "com_acesso" | "sem_acesso">("todos");
  const refresh = () => qc.invalidateQueries({ queryKey: ["rh-employee-registry"] });
  const employeeList = (employees.data ?? []) as unknown as Employee[];
  const filteredEmployees = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return employeeList.filter((employee) => {
      const matchesSearch = !term || [
        employee.full_name, employee.unit, employee.registration_data?.job_title, employee.registration_data?.cpf,
      ].filter(Boolean).join(" ").toLocaleLowerCase("pt-BR").includes(term);
      const matchesStatus = statusFilter === "todos"
        || (statusFilter === "ativos" && employee.is_active)
        || (statusFilter === "inativos" && !employee.is_active);
      const hasAccess = Boolean(employee.access?.access_enabled);
      const matchesAccess = accessFilter === "todos"
        || (accessFilter === "com_acesso" && hasAccess)
        || (accessFilter === "sem_acesso" && !hasAccess);
      return matchesSearch && matchesStatus && matchesAccess;
    });
  }, [employeeList, search, statusFilter, accessFilter]);
  useEffect(() => {
    if (!initialEmployeeId || employees.isLoading) return;
    const employee = employeeList.find((item) => item.id === initialEmployeeId);
    if (!employee) return;
    setEditing(employee);
    setFormOpen(true);
  }, [initialEmployeeId, employees.isLoading, employees.data]);
  const activeCount = employeeList.filter((employee) => employee.is_active).length;
  const inactiveCount = employeeList.length - activeCount;
  const accessCount = employeeList.filter((employee) => employee.access?.access_enabled).length;
  const exportEmployees = () => {
    const rows = [["Nome","Unidade","Cargo","CPF","Admissão","Salário","Status","Acesso"]];
    for (const e of filteredEmployees) {
      const r = e.registration_data ?? {};
      rows.push([e.full_name,e.unit,r.job_title ?? "",r.cpf ?? "",r.admission_date ?? "",r.salary_cents != null ? (Number(r.salary_cents)/100).toLocaleString("pt-BR",{minimumFractionDigits:2}) : (r.salary ?? ""),e.is_active ? "Ativo" : "Inativo",e.access?.access_enabled ? "Liberado" : "Sem acesso"]);
    }
    const csv = rows.map(row => row.map(v => "\"" + String(v ?? "").replace(/\"/g,'\"\"') + "\"").join(";")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], {type:"text/csv;charset=utf-8"});
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href=url; a.download="rh_funcionarios.csv"; a.click(); URL.revokeObjectURL(url);
  };
  return (
    <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_18px_50px_-30px_rgba(15,23,42,.35)]">
      <div className="flex flex-col gap-4 border-b border-slate-200 bg-gradient-to-br from-[#0F172A] via-[#172554] to-[#0F172A] px-5 py-6 text-white sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[.2em] text-sky-300">
            RH · cadastro central
          </p>
          <h2 className="mt-1 text-2xl font-black">Funcionários</h2>
          <p className="mt-1 text-xs text-white/65">
            Cadastro mestre utilizado pelo DP, Ponto, Folha, Vale Passagem, Vale Alimentação e acessos.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={exportEmployees} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-xs font-bold text-white"><FileSpreadsheet className="h-4 w-4"/>CSV</button>
          <button onClick={() => exportRhEmployeeRegistryPdf(filteredEmployees)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-xs font-black text-slate-900"><FileDown className="h-4 w-4"/>Relatório / PDF</button>
          <button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-xs font-black text-slate-50"
          >
            <Plus className="h-4 w-4" /> Novo funcionário
          </button>
        </div>
      </div>
      <div className="p-5 sm:p-7">
        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Ativos</p><p className="mt-1 text-2xl font-black text-emerald-700">{activeCount}</p></div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Inativos</p><p className="mt-1 text-2xl font-black text-slate-600">{inactiveCount}</p></div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Acessos vinculados</p><p className="mt-1 text-2xl font-black text-sky-700">{accessCount}</p></div>
        </div>
        <div className="mb-5 grid gap-3 lg:grid-cols-[1fr_auto_auto]">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nome, unidade, cargo ou CPF..." className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-sky-500" />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-700">
            <option value="ativos">Somente ativos</option><option value="todos">Todos os funcionários</option><option value="inativos">Somente inativos</option>
          </select>
          <select value={accessFilter} onChange={(e) => setAccessFilter(e.target.value as typeof accessFilter)} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-200">
            <option value="todos">Todos os acessos</option><option value="com_acesso">Com acesso</option><option value="sem_acesso">Sem acesso</option>
          </select>
        </div>
        {error && (
          <p className="mb-4 rounded-lg bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300">
            {error}
          </p>
        )}
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">Unidade</th>
                <th className="px-4 py-3">Cargo</th>
                <th className="px-4 py-3">Ficha</th>
                <th className="px-4 py-3">Acesso</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filteredEmployees.map((employee: Employee) => (
                <EmployeeRow
                  key={employee.id}
                  employee={employee}
                  onEdit={() => {
                    setEditing(employee);
                    setFormOpen(true);
                  }}
                  onAccess={() => setAccessing(employee)}
                  onView={() => setViewing(employee)}
                  onDelete={async () => {
                    const action = employee.is_active ? "inativar" : "reativar";
                    if (!window.confirm(`${action === "inativar" ? "Inativar" : "Reativar"} o cadastro de ${employee.full_name}? O cadastro e os dados serão preservados.`)) return;
                    try {
                      if (employee.is_active) {
                        await deactivateRhEmployeeRecord({ data: { id: employee.id } });
                      } else {
                        await reactivateRhEmployeeRecord({ data: { id: employee.id } });
                      }
                      refresh();
                    } catch (e) {
                      setError(
                        e instanceof Error
                          ? e.message
                          : "Não foi possível alterar o status do funcionário.",
                      );
                    }
                  }}
                  onUploaded={refresh}
                />
              ))}
            </tbody>
          </table>
          {!employees.isLoading && employeeList.length > 0 && !filteredEmployees.length && (
            <div className="p-10 text-center"><UsersRound className="mx-auto h-8 w-8 text-slate-600" /><p className="mt-2 text-sm font-bold text-slate-400">Nenhum funcionário encontrado</p><p className="mt-1 text-xs text-slate-400">Ajuste a busca ou os filtros para localizar o cadastro.</p></div>
          )}
          {!employees.isLoading && !employeeList.length && (
            <div className="p-10 text-center">
              <UsersRound className="mx-auto h-8 w-8 text-slate-600" />
              <p className="mt-2 text-sm font-bold text-slate-600">Nenhum funcionário cadastrado</p>
              <p className="mt-1 text-xs text-slate-400">
                Cadastre uma vez e reutilize em todo o RH/DP.
              </p>
            </div>
          )}
        </div>
      </div>
      {formOpen && (
        <EmployeeForm
          employee={editing}
          onClose={() => setFormOpen(false)}
          onDone={() => {
            setFormOpen(false);
            refresh();
          }}
        />
      )}
      {viewing && (
        <Employee360
          employee={viewing}
          onClose={() => setViewing(null)}
        />
      )}
      {accessing && (
        <EmployeeAccessForm
          employee={accessing}
          onClose={() => setAccessing(null)}
          onDone={() => {
            setAccessing(null);
            refresh();
          }}
        />
      )}
    </section>
  );
}

function EmployeeRow({
  employee,
  onEdit,
  onAccess,
  onView,
  onDelete,
  onUploaded,
}: {
  employee: Employee;
  onEdit: () => void;
  onAccess: () => void;
  onView: () => void;
  onDelete: () => void;
  onUploaded: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function upload(file?: File) {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setError("A ficha deve ser PDF.");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.onerror = () => reject(new Error("Não foi possível ler a ficha."));
        reader.readAsDataURL(file);
      });
      await uploadRhEmployeeFicha({
        data: { employee_id: employee.id, file_name: file.name, data_base64: base64 },
      });
      onUploaded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao anexar a ficha.");
    } finally {
      setUploading(false);
    }
  }
  async function download() {
    try {
      const result = await getRhEmployeeFichaUrl({ data: { employee_id: employee.id } });
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao baixar a ficha.");
    }
  }
  return (
    <tr className="border-t border-slate-200 align-top">
      <td className="px-4 py-3 font-semibold text-slate-800">
        {employee.full_name}
        {!employee.is_active && <span className="ml-2 inline-flex rounded-full bg-slate-500/15 px-2 py-0.5 text-[10px] font-bold text-slate-400">Inativo</span>}
      </td>
      <td className="px-4 py-3 text-slate-600">{employee.unit}</td>
      <td className="px-4 py-3 text-slate-600">{employee.registration_data?.job_title || "—"}</td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1.5">
          {employee.ficha_file_name ? (
            <button
              onClick={download}
              className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-2 py-1 text-[11px] font-bold text-slate-200"
            >
              <Download className="h-3 w-3" /> Baixar ficha
            </button>
          ) : (
            <span className="text-[11px] text-slate-400">Sem ficha</span>
          )}
          <input
            ref={input}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              void upload(e.target.files?.[0]);
              e.currentTarget.value = "";
            }}
          />
          <button
            onClick={() => input.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1 rounded-md border border-dashed border-sky-500/40 bg-sky-500/10 px-2 py-1 text-[11px] font-bold text-sky-300"
          >
            <Upload className="h-3 w-3" /> {uploading ? "Enviando" : "Anexar PDF"}
          </button>
        </div>
        {error && <p className="mt-1 text-[11px] text-red-300">{error}</p>}
      </td>
      <td className="px-4 py-3">
        {employee.access?.access_enabled ? (
          <div>
            <span className="inline-flex rounded-full bg-emerald-500/10 px-2 py-1 text-[11px] font-bold text-emerald-300">Liberado</span>
            <p className="mt-1 text-[10px] text-slate-400">{employee.access.login_identifier ?? employee.access.user?.username ?? "Acesso vinculado"}</p>
          </div>
        ) : (
          <span className="text-[11px] text-slate-400">Sem acesso</span>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <button onClick={onView} title="Abrir ficha 360" className="mr-2 inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] font-bold text-emerald-300">
          <Eye className="h-3 w-3" /> Ficha
        </button>
        <button onClick={onAccess} title="Gerenciar acesso" className="mr-2 inline-flex items-center gap-1 rounded-lg border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-[11px] font-bold text-sky-300">
          <KeyRound className="h-3 w-3" /> Acesso
        </button>
        <button onClick={onEdit} className="mr-2 text-sky-300">
          <Pencil className="inline h-4 w-4" />
        </button>
        <button onClick={onDelete} className="text-red-300">
          <Trash2 className="inline h-4 w-4" />
        </button>
      </td>
    </tr>
  );
}


function Employee360({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["rh-employee-360", employee.id],
    queryFn: () => getRhEmployee360({ data: { employee_id: employee.id } }),
  });
  const data = q.data;
  const registration = (data?.employee?.registration_data ?? employee.registration_data ?? {}) as Record<string, any>;
  const money = (c: unknown) => {
    const n = Number(c ?? 0);
    return Number.isFinite(n) ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n / 100) : "—";
  };
  const registrationMoney = (value: unknown) => {
    const raw = String(value ?? "").trim();
    if (!raw) return "—";
    const n = Number(raw.replace(/[^0-9,.-]/g, "").replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n) : raw;
  };
  const dateText = (value: unknown) => {
    const raw = String(value ?? "");
    if (!raw) return "—";
    const d = new Date(raw.includes("T") ? raw : raw + "T12:00:00");
    return Number.isNaN(d.getTime()) ? raw : d.toLocaleDateString("pt-BR");
  };
  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-[#02060d]/75 p-4">
      <div className="mx-auto my-6 w-full max-w-6xl overflow-hidden rounded-2xl bg-[#1E293B] shadow-2xl">
        <div className="flex flex-col gap-3 border-b border-slate-200 bg-[#0F172A] p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[.2em] text-sky-400">RH · ficha 360°</p>
            <h3 className="mt-1 text-2xl font-black text-slate-50">{employee.full_name}</h3>
            <p className="mt-1 text-xs text-slate-400">{employee.unit} · {employee.is_active ? "Ativo" : "Inativo"}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => data && exportRhEmployeeFichaPdf(employee, data)}
              disabled={!data}
              className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-3 py-2 text-xs font-black text-slate-950 disabled:opacity-50"
            >
              <FileDown className="h-4 w-4" /> Exportar ficha PDF
            </button>
            <button onClick={onClose} className="rounded-lg px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-800">Fechar</button>
          </div>
        </div>
        {q.isLoading ? <div className="p-10 text-center text-sm text-slate-400">Carregando ficha completa...</div> :
         q.isError ? <div className="p-10 text-center text-sm text-red-300">{q.error instanceof Error ? q.error.message : "Falha ao carregar a ficha."}</div> :
         <div className="space-y-5 p-5 sm:p-7">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MiniCard icon={<UserRound className="h-4 w-4" />} title="Cadastro" value={registration.cpf || "CPF não informado"} />
            <MiniCard icon={<BriefcaseBusiness className="h-4 w-4" />} title="Cargo" value={registration.job_title || "Não informado"} />
            <MiniCard icon={<CalendarDays className="h-4 w-4" />} title="Admissão" value={registration.admission_date || "Não informada"} />
            <MiniCard icon={<KeyRound className="h-4 w-4" />} title="Acesso" value={data?.access?.access_enabled ? "Liberado" : "Não vinculado"} />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <Employee360Section title="Dados funcionais">
              <InfoGrid items={[
                ["Salário cadastrado", registration.salary ? registrationMoney(registration.salary) : (data?.contracts?.[0]?.salary_cents != null ? money(data.contracts[0].salary_cents) : "—")],
                ["Valor hora", (() => { const salary = Number(registration.salary_cents ?? data?.contracts?.[0]?.salary_cents ?? 0); const hours = Number(registration.weekly_hours ?? data?.contracts?.[0]?.weekly_hours ?? 44); return salary > 0 && hours > 0 ? money(Math.round(salary / (hours * 5))) : "—"; })()],
                ["Valor dia", (() => { const salary = Number(registration.salary_cents ?? data?.contracts?.[0]?.salary_cents ?? 0); return salary > 0 ? money(Math.round(salary / 30)) : "—"; })()],
                ["Tipo de pagamento", registration.payment_type || "—"],
                ["Jornada semanal", registration.weekly_hours ? String(registration.weekly_hours).replace(".", ",") + " h/semana" : (data?.contracts?.[0]?.weekly_hours ? String(data.contracts[0].weekly_hours).replace(".", ",") + " h/semana" : "—")],
                ["PIS", registration.pis || "—"],
                ["CTPS", registration.ctps || "—"],
                ["Entrada", registration.entry_time || "—"],
                ["Almoço", registration.lunch_start && registration.lunch_end ? registration.lunch_start + " às " + registration.lunch_end : "—"],
                ["Saída", registration.exit_time || "—"],
                ["Telefone", registration.phone || "—"],
              ]} />
            </Employee360Section>
            <Employee360Section title="Acessos e operação">
              <InfoGrid items={[
                ["Folha de Ponto", data?.employee?.ponto_access_enabled ? "Liberada" : "Não liberada"],
                ["DBS CONTROL", data?.employee?.dbs_control_access_enabled ? "Liberado" : "Não liberado"],
                ["Login", data?.access?.login_identifier || "—"],
                ["Registro criado", data?.employee?.created_at ? dateText(data.employee.created_at) : "—"],
              ]} />
            </Employee360Section>
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <Employee360Section title={`Contratos (${data?.contracts?.length ?? 0})`}><TimelineList empty="Nenhum contrato registrado." items={(data?.contracts ?? []).map((x: any) => ({ title: x.contract_type || "Contrato", text: [x.admission_date && "Admissão: " + x.admission_date, x.termination_date && "Saída: " + x.termination_date, x.salary_cents != null && "Salário: " + money(x.salary_cents)].filter(Boolean).join(" · ") || "Sem detalhes adicionais" }))} /></Employee360Section>
            <Employee360Section title={`Dependentes (${data?.dependents?.length ?? 0})`}><TimelineList empty="Nenhum dependente cadastrado." items={(data?.dependents ?? []).map((x: any) => ({ title: x.full_name, text: [x.relationship, x.birth_date, x.is_ir_dependent && "Dependente IR"].filter(Boolean).join(" · ") }))} /></Employee360Section>
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <Employee360Section title={`Documentos (${data?.documents?.length ?? 0})`}><TimelineList empty="Nenhum documento registrado." items={(data?.documents ?? []).map((x: any) => ({ title: x.document_type, text: [x.file_name, x.expires_at && "Validade: " + x.expires_at, x.status].filter(Boolean).join(" · ") }))} /></Employee360Section>
            <Employee360Section title={`Histórico (${data?.events?.length ?? 0})`}><TimelineList empty="Nenhum evento registrado." items={(data?.events ?? []).map((x: any) => ({ title: x.event_type, text: [x.event_date, x.status].filter(Boolean).join(" · ") }))} /></Employee360Section>
          </div>
          <Employee360Section title={`Auditoria (${data?.auditLog?.length ?? 0})`}>
            <TimelineList
              empty="Nenhuma alteração auditada."
              items={(data?.auditLog ?? []).map((x: any) => ({
                title: auditLabel(x.action),
                text: [x.created_at ? new Date(x.created_at).toLocaleString("pt-BR") : "", x.entity_type].filter(Boolean).join(" · "),
              }))}
            />
          </Employee360Section>
          <div className="grid gap-5 lg:grid-cols-3">
            <Employee360Section title={`Benefícios (${data?.benefits?.length ?? 0})`}>
              <TimelineList empty="Nenhum benefício vinculado." items={(data?.benefits ?? []).map((x: any) => ({
                title: x.benefit_type === "passagem" ? "Vale Passagem" : "Vale Alimentação",
                text: [x.benefit_configured ? "Configurado" : "Pendente de configuração", x.fare_cents != null && new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(x.fare_cents)/100), x.trips_per_day && x.benefit_type === "passagem" && x.trips_per_day + " viagens/dia"].filter(Boolean).join(" · ")
              }))} />
            </Employee360Section>
            <Employee360Section title={`Ponto (${data?.pointRecords?.length ?? 0})`}>
              <TimelineList empty="Nenhuma batida registrada." items={(data?.pointRecords ?? []).slice(0,12).map((x: any) => ({
                title: x.punch_type,
                text: [x.work_date, x.punched_at ? new Date(x.punched_at).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}) : "", x.inside_radius === true ? "GPS dentro da base" : x.inside_radius === false ? "GPS fora da base" : ""].filter(Boolean).join(" · ")
              }))} />
            </Employee360Section>
            <Employee360Section title={`Folha (${data?.payrollRuns?.length ?? 0})`}>
              <TimelineList empty="Nenhuma folha calculada para este funcionário." items={(data?.payrollRuns ?? []).slice(0,12).map((x: any) => ({
                title: String(x.calculated_at ?? "").slice(0,7) || "Competência",
                text: [
                  "Bruto: " + new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(x.gross_cents ?? 0)/100),
                  "Líquido: " + new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(x.net_cents ?? 0)/100),
                  x.status
                ].join(" · ")
              }))} />
            </Employee360Section>
          </div>
         </div>}
      </div>
    </div>
  );
}

function auditLabel(action: string) {
  const labels: Record<string, string> = {
    CADASTRO_FUNCIONARIO_CRIADO: "Cadastro criado",
    CADASTRO_FUNCIONARIO_ATUALIZADO: "Cadastro atualizado",
    CONTRATO_CRIADO: "Contrato criado",
    CONTRATO_ATUALIZADO: "Contrato atualizado",
    ACESSO_FUNCIONARIO_LIBERADO: "Acesso liberado",
    ACESSO_FUNCIONARIO_REVOGADO: "Acesso revogado",
    VALE_SOLICITADO_PELO_COLABORADOR: "Vale solicitado pelo colaborador",
    VALE_AUTORIZADO_E_VINCULADO_A_FOLHA: "Vale autorizado e vinculado à folha",
    VALE_RECUSADO_PELO_RH: "Vale recusado pelo RH",
    VALE_DESCONTO_CRIADO: "Vale/desconto lançado",
    VALE_DESCONTO_CANCELADO: "Vale/desconto cancelado",
  };
  return labels[action] ?? action.replaceAll("_", " ").toLowerCase().replace(/^./, (x) => x.toUpperCase());
}

function MiniCard({ icon, title, value }: { icon: ReactNode; title: string; value: string }) {
  return <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><div className="flex items-center gap-2 text-slate-400">{icon}<span className="text-[10px] font-black uppercase tracking-wider">{title}</span></div><p className="mt-2 truncate text-sm font-bold text-slate-800">{value}</p></div>;
}
function Employee360Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="rounded-xl border border-slate-200 bg-slate-50 p-4"><div className="mb-3 flex items-center gap-2"><FileStack className="h-4 w-4 text-sky-400" /><h4 className="text-sm font-black text-slate-800">{title}</h4></div>{children}</section>;
}
function InfoGrid({ items }: { items: [string, string][] }) {
  return <div className="grid gap-2 sm:grid-cols-2">{items.map(([k,v]) => <div key={k} className="rounded-lg bg-[#0F172A] p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{k}</p><p className="mt-1 text-xs font-semibold text-slate-200">{v}</p></div>)}</div>;
}
function TimelineList({ items, empty }: { items: { title: string; text: string }[]; empty: string }) {
  if (!items.length) return <p className="text-xs text-slate-400">{empty}</p>;
  return <div className="space-y-2">{items.slice(0,8).map((x,i) => <div key={i} className="rounded-lg bg-[#0F172A] p-3"><p className="text-xs font-bold text-slate-200">{x.title}</p><p className="mt-1 text-[11px] text-slate-400">{x.text}</p></div>)}</div>;
}

function EmployeeAccessForm({
  employee,
  onClose,
  onDone,
}: {
  employee: Employee;
  onClose: () => void;
  onDone: () => void;
}) {
  const [login, setLogin] = useState(employee.access?.login_identifier ?? employee.access?.user?.username ?? "");
  const [linkedUserId, setLinkedUserId] = useState(employee.access?.user_id ?? "");
  const [enabled, setEnabled] = useState(employee.access?.access_enabled ?? false);
  const [dbsControlEnabled, setDbsControlEnabled] = useState(employee.access?.dbs_control_access_enabled ?? false);
   const [confirmed, setConfirmed] = useState(Boolean(employee.access?.access_enabled && employee.access?.user_id));
   const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const collaboratorUsers = useQuery({
    queryKey: ["rh-collaborator-users"],
    queryFn: () => listRhCollaboratorUsers(),
  });   const selectedUser = (collaboratorUsers.data ?? []).find((user: any) => user.id === linkedUserId);
   const save = useMutation({
     mutationFn: () => saveRhEmployeeAccess({ data: { employee_id: employee.id, enabled, login_identifier: login, user_id: linkedUserId, dbs_control_enabled: dbsControlEnabled } }),
     onSuccess: (result: any) => {
       setConfirmed(Boolean(result?.enabled));
       setSuccessMessage(result?.already_linked ? "Vínculo já estava confirmado. Nenhum novo vínculo foi criado." : "Vínculo confirmado com sucesso. Este login agora está ligado a este funcionário.");
       onDone();
     },
   });

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-[#02060d]/70 p-4">
      <div className="my-6 w-full max-w-lg rounded-2xl bg-[#1E293B] p-6 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[.2em] text-sky-400">RH · acesso do funcionário</p>
            <h3 className="mt-1 text-xl font-black text-slate-50">{employee.full_name}</h3>
            <p className="mt-1 text-xs text-slate-400">O login é criado e administrado em Usuários vinculados. Aqui o RH apenas vincula esse usuário ao funcionário e libera a Folha de Ponto.</p>
          </div>
          <button onClick={onClose} className="text-xs font-bold text-slate-400">Fechar</button>
        </div>
        <div className="mt-5 space-y-4">
          <label className="block text-xs font-bold text-slate-600">
            Usuário vinculado
            <select
              value={linkedUserId}
              onChange={(e) => {
                const selectedId = e.target.value;
                const selected = (collaboratorUsers.data ?? []).find((user: any) => user.id === selectedId);
                setLinkedUserId(selectedId);
                setLogin(selected?.username || selected?.email || selected?.cpf || "");
              }}
              disabled={collaboratorUsers.isLoading}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0F172A] px-3 py-2.5 text-sm text-slate-800"
            >
              <option value="">Selecione o login criado em Usuários vinculados</option>
              {(collaboratorUsers.data ?? []).map((user: any) => (
                <option key={user.id} value={user.id}>
                  {user.full_name || user.username || user.email} · {user.username || user.email}
                </option>
              ))}
              {linkedUserId && !(collaboratorUsers.data ?? []).some((user: any) => user.id === linkedUserId) && (
                <option value={linkedUserId}>{login} · vínculo atual</option>
              )}
            </select>
            <p className="mt-1 text-[10px] font-normal text-slate-400">O login é criado e administrado exclusivamente em Usuários vinculados com o papel COLABORADOR.</p>
           </label>
           {confirmed && linkedUserId && (
             <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-4">
               <div className="flex items-start gap-3">
                 <div className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,.12)]" />
                 <div className="min-w-0">
                   <p className="text-xs font-black uppercase tracking-wider text-emerald-300">Vínculo confirmado</p>
                   <p className="mt-1 text-sm font-bold text-white">{selectedUser?.full_name || login}</p>
                   <p className="mt-1 text-[11px] text-emerald-100/70">Login: {selectedUser?.username || selectedUser?.email || login}</p>
                   <p className="mt-1 text-[10px] text-emerald-100/60">Este funcionário já possui um vínculo ativo. Para trocar o login, selecione outro usuário e salve uma única vez.</p>
                 </div>
               </div>
             </div>
           )}
           {successMessage && <p className="rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-200">{successMessage}</p>}
          <label className="flex items-center gap-3 rounded-xl border border-slate-700 bg-[#0F172A] p-3 text-xs font-bold text-slate-600">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Acesso à Folha de Ponto liberado para este funcionário
          </label>
          <label className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs font-bold text-slate-600">
            <input type="checkbox" checked={dbsControlEnabled} onChange={(e) => { setDbsControlEnabled(e.target.checked); if (e.target.checked) setEnabled(true); }} />
            Liberar <span className="text-emerald-300">DBS CONTROL</span> para este funcionário
          </label>
          <p className="text-[10px] text-slate-400">
            O DBS CONTROL usa o mesmo login do funcionário. Desmarcar aqui remove apenas o módulo CONTROL; o cadastro e o login continuam preservados.
          </p>
        </div>
        {save.error && <p className="mt-4 rounded-lg bg-red-500/10 p-3 text-xs font-semibold text-red-300">{save.error instanceof Error ? save.error.message : "Não foi possível vincular o acesso."}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-xs font-bold text-slate-400">Cancelar</button>
          <button onClick={() => save.mutate()} disabled={save.isPending || !enabled || !login.trim() || !linkedUserId || (confirmed && linkedUserId === employee.access?.user_id && employee.access?.access_enabled)} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-xs font-black text-white disabled:opacity-50">
             <KeyRound className="h-4 w-4" /> {save.isPending ? "Confirmando..." : (confirmed && linkedUserId === employee.access?.user_id && employee.access?.access_enabled ? "Vínculo já confirmado" : (confirmed ? "Trocar vínculo" : "Confirmar vínculo"))}
          </button>
        </div>
      </div>
    </div>
  );
}

function EmployeeForm({ employee, onClose, onDone }: { employee: Employee | null; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(employee?.full_name ?? "");
  const [unit, setUnit] = useState(employee?.unit ?? "");
  const [values, setValues] = useState<Record<string, any>>(employee?.registration_data ?? {});
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => saveRhEmployeeRecord({ data: { id: employee?.id, full_name: name, unit, registration_data: values } }),
    onSuccess: onDone,
    onError: (e) => setError(e instanceof Error ? e.message : "Não foi possível salvar o funcionário."),
  });
  const update = (key: string, value: any) => setValues((current) => ({ ...current, [key]: value }));
  const money = (value: string) => {
    const digits = value.replace(/\D/g, "");
    if (!digits) return "";
    return (Number(digits) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const weeklyHours = Number(values.weekly_hours || 0);
  const salaryCents = Number(values.salary_cents || 0) || (() => {
    const n = Number(String(values.salary || "").replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
  })();
  const monthlyDivisor = weeklyHours > 0 ? weeklyHours * 5 : 220;
  const hourlyCents = monthlyDivisor > 0 ? Math.round(salaryCents / monthlyDivisor) : 0;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[#02060d]/75 p-4">
      <div className="my-6 w-full max-w-5xl rounded-2xl bg-[#1E293B] p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-black uppercase tracking-[.2em] text-sky-400">RH · cadastro central</p><h3 className="mt-1 text-xl font-black text-slate-50">{employee ? "Editar funcionário" : "Novo funcionário"}</h3><p className="mt-1 max-w-3xl text-xs leading-5 text-slate-400">Esta é a ficha mestre. Salário, jornada e horários alimentam contrato, ponto e cálculos do RH.</p></div><button onClick={onClose} className="text-xs font-bold text-slate-400">Fechar</button></div>
        {error && <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs font-semibold text-red-200">{error}</div>}
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="Nome completo *" value={name} onChange={setName} className="sm:col-span-2" />
          <Field label="Unidade / setor *" value={unit} onChange={setUnit} className="sm:col-span-2" />
          <div className="sm:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-[10px] font-black uppercase tracking-wider text-sky-300">Dados pessoais</p><div className="mt-3 grid gap-3 sm:grid-cols-2">
            {FIELDS.filter(([key]) => ["cpf","rg","birth_date","phone","address","mother_name","father_name"].includes(key)).map(([key,label]) => <label key={key} className="text-xs font-bold text-slate-400">{label}<input value={values[key] ?? ""} onChange={(e)=>update(key,e.target.value)} type={key==="birth_date"?"date":"text"} placeholder={key==="cpf"?"000.000.000-00":key==="phone"?"(00) 00000-0000":""} className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0F172A] px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400"/></label>)}
          </div></div>
          <div className="sm:col-span-2 rounded-xl border border-emerald-500/20 bg-[#141F33] p-4"><p className="text-[10px] font-black uppercase tracking-wider text-emerald-300">Remuneração e contrato</p><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs font-bold text-slate-400">Salário base (R$)<input value={values.salary ?? ""} onChange={e=>{const formatted=money(e.target.value); update("salary",formatted); update("salary_cents",formatted?Math.round(Number(formatted.replace(/\./g,"").replace(",","."))*100):0)}} inputMode="numeric" placeholder="0,00" className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0F172A] px-3 py-2.5 text-sm text-slate-800"/></label>
            <label className="text-xs font-bold text-slate-400">Jornada semanal (h)<input value={values.weekly_hours ?? ""} onChange={e=>update("weekly_hours",e.target.value.replace(/[^0-9,.]/g,"").replace(",","."))} inputMode="decimal" placeholder="44" className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0F172A] px-3 py-2.5 text-sm text-slate-800"/></label>
            <label className="text-xs font-bold text-slate-400">Admissão<input type="date" value={values.admission_date ?? ""} onChange={e=>update("admission_date",e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0F172A] px-3 py-2.5 text-sm text-slate-800"/></label>
            <label className="text-xs font-bold text-slate-400">Pagamento<select value={values.payment_type ?? ""} onChange={e=>update("payment_type",e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0F172A] px-3 py-2.5 text-sm text-slate-800"><option value="">Selecione…</option><option>Mensal</option><option>Quinzenal</option><option>Semanal</option></select></label>
            <label className="text-xs font-bold text-slate-400 lg:col-span-2">Regime<select value={values.work_regime ?? "presencial"} onChange={e=>update("work_regime",e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0F172A] px-3 py-2.5 text-sm text-slate-800"><option value="presencial">Presencial</option><option value="hibrido">Híbrido</option><option value="remoto">Remoto</option></select></label>
            <label className="text-xs font-bold text-slate-400 lg:col-span-2">Cargo / função<input value={values.job_title ?? ""} onChange={e=>update("job_title",e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0F172A] px-3 py-2.5 text-sm text-slate-800"/></label>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{([["entry_time","Entrada"],["lunch_start","Saída almoço"],["lunch_end","Retorno almoço"],["exit_time","Saída"]] as const).map(([key,label])=><label key={key} className="text-xs font-bold text-slate-400">{label}<input type="time" value={values[key] ?? ""} onChange={e=>update(key,e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0F172A] px-3 py-2.5 text-sm text-slate-800"/></label>)}</div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs font-bold text-slate-400">Intervalo (min)<input type="number" min="0" value={values.break_minutes ?? ""} onChange={e=>update("break_minutes",e.target.value)} placeholder="60" className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0F172A] px-3 py-2.5 text-sm text-slate-800"/></label>
            <label className="text-xs font-bold text-slate-400">Tolerância (min)<input type="number" min="0" value={values.tolerance_minutes ?? 5} onChange={e=>update("tolerance_minutes",e.target.value)} placeholder="5" className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0F172A] px-3 py-2.5 text-sm text-slate-800"/></label>
            <label className="text-xs font-bold text-slate-400 lg:col-span-2">Escala / turno<input value={values.work_shift ?? ""} onChange={e=>update("work_shift",e.target.value)} placeholder="Ex.: 5x2 · Administrativo" className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0F172A] px-3 py-2.5 text-sm text-slate-800"/></label>
          </div></div>
          <div className="sm:col-span-2 grid gap-3 sm:grid-cols-3"><Calc label="Valor hora de referência" value={hourlyCents ? "R$ " + (hourlyCents/100).toLocaleString("pt-BR",{minimumFractionDigits:2}) : "—"} /><Calc label="Valor dia de referência" value={salaryCents ? "R$ " + (salaryCents/100/30).toLocaleString("pt-BR",{minimumFractionDigits:2}) : "—"} /><Calc label="Hora extra +50% de referência" value={hourlyCents ? "R$ " + (hourlyCents*1.5/100).toLocaleString("pt-BR",{minimumFractionDigits:2}) : "—"} /></div>
          <div className="sm:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-[10px] font-black uppercase tracking-wider text-violet-300">Documentação e observações</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold text-slate-400">CPF<input value={values.cpf ?? ""} onChange={e=>update("cpf",e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0F172A] px-3 py-2.5 text-sm text-slate-800"/></label><label className="text-xs font-bold text-slate-400">PIS<input value={values.pis ?? ""} onChange={e=>update("pis",e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0F172A] px-3 py-2.5 text-sm text-slate-800"/></label><label className="text-xs font-bold text-slate-400 sm:col-span-2">Observações<textarea value={values.notes ?? ""} onChange={e=>update("notes",e.target.value)} rows={3} className="mt-1 w-full resize-none rounded-lg border border-slate-700 bg-[#0F172A] px-3 py-2.5 text-sm text-slate-800"/></label></div></div>
        </div>
        <div className="mt-6 flex justify-end gap-2"><button onClick={onClose} className="rounded-lg px-4 py-2 text-xs font-bold text-slate-400">Cancelar</button><button onClick={()=>save.mutate()} disabled={save.isPending||!name.trim()||!unit.trim()} className="rounded-lg bg-sky-600 px-5 py-2.5 text-xs font-black text-slate-950">{save.isPending?"Salvando…":"Salvar funcionário"}</button></div>
      </div>
    </div>
  );
}
function Field({label,value,onChange,className=""}:{label:string;value:string;onChange:(v:string)=>void;className?:string}){return <label className={className+" text-xs font-bold text-slate-400"}>{label}<input value={value} onChange={e=>onChange(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0F172A] px-3 py-2.5 text-sm text-slate-800"/></label>}
function Calc({label,value}:{label:string;value:string}){return <div className="rounded-xl border border-slate-700 bg-[#0F172A] p-4"><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</p><p className="mt-1 text-lg font-black text-slate-800">{value}</p></div>}
