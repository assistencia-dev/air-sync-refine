import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, KeyRound, Pencil, Plus, Trash2, Upload, UsersRound, Eye, BriefcaseBusiness, CalendarDays, FileStack, UserRound, FileDown } from "lucide-react";
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
import { exportRhEmployeeFichaPdf } from "@/lib/rh.exports";

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

export function RhEmployeeRegistry() {
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
  const refresh = () => qc.invalidateQueries({ queryKey: ["rh-employee-registry"] });
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-800 bg-[#1E293B] shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-800 bg-[#0F172A] px-5 py-5 text-white sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[.2em] text-[#F59E0B]">
            RH · cadastro central
          </p>
          <h2 className="mt-1 text-2xl font-black">Funcionários</h2>
          <p className="mt-1 text-xs text-white/65">
            Um único cadastro compartilhado pelo Vale Passagem e Vale Alimentação.
          </p>
        </div>
        <button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#F59E0B] px-4 py-2.5 text-xs font-black text-slate-50"
        >
          <Plus className="h-4 w-4" /> Novo funcionário
        </button>
      </div>
      <div className="p-5 sm:p-7">
        {error && (
          <p className="mb-4 rounded-lg bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300">
            {error}
          </p>
        )}
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-[#141F33] text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">
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
              {((employees.data ?? []) as unknown as Employee[]).map((employee: Employee) => (
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
          {!employees.isLoading && !(employees.data ?? []).length && (
            <div className="p-10 text-center">
              <UsersRound className="mx-auto h-8 w-8 text-slate-600" />
              <p className="mt-2 text-sm font-bold text-slate-600">Nenhum funcionário cadastrado</p>
              <p className="mt-1 text-xs text-slate-400">
                Cadastre uma vez e reutilize nas duas ferramentas do RH.
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
  onDelete,
  onUploaded,
}: {
  employee: Employee;
  onEdit: () => void;
  onAccess: () => void;
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
    <tr className="border-t border-slate-800 align-top">
      <td className="px-4 py-3 font-semibold text-slate-100">
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
            <p className="mt-1 text-[10px] text-slate-500">{employee.access.login_identifier ?? employee.access.user?.username ?? "Acesso vinculado"}</p>
          </div>
        ) : (
          <span className="text-[11px] text-slate-500">Sem acesso</span>
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
  const registration = data?.employee?.registration_data ?? employee.registration_data ?? {};
  const money = (c: unknown) => {
    const n = Number(c ?? 0);
    return Number.isFinite(n) ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n / 100) : "—";
  };
  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-[#02060d]/75 p-4">
      <div className="mx-auto my-6 w-full max-w-6xl overflow-hidden rounded-2xl bg-[#1E293B] shadow-2xl">
        <div className="flex flex-col gap-3 border-b border-slate-800 bg-[#0F172A] p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[.2em] text-sky-400">RH · ficha 360°</p>
            <h3 className="mt-1 text-2xl font-black text-slate-50">{employee.full_name}</h3>
            <p className="mt-1 text-xs text-slate-400">{employee.unit} · {employee.is_active ? "Ativo" : "Inativo"}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => data && exportRhEmployeeFichaPdf(employee, data)}
              disabled={!data}
              className="inline-flex items-center gap-2 rounded-lg bg-[#F59E0B] px-3 py-2 text-xs font-black text-slate-950 disabled:opacity-50"
            >
              <FileDown className="h-4 w-4" /> Exportar ficha PDF
            </button>
            <button onClick={onClose} className="rounded-lg px-4 py-2 text-xs font-bold text-slate-300 hover:bg-slate-800">Fechar</button>
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
                ["Salário cadastrado", registration.salary || (data?.contracts?.[0]?.salary_cents != null ? money(data.contracts[0].salary_cents) : "—")],
                ["Tipo de pagamento", registration.payment_type || "—"],
                ["Jornada", registration.work_hours || (data?.contracts?.[0]?.weekly_hours ? data.contracts[0].weekly_hours + " h/semana" : "—")],
                ["PIS", registration.pis || "—"],
                ["CTPS", registration.ctps || "—"],
                ["Telefone", registration.phone || "—"],
              ]} />
            </Employee360Section>
            <Employee360Section title="Acessos e operação">
              <InfoGrid items={[
                ["Folha de Ponto", data?.employee?.ponto_access_enabled ? "Liberada" : "Não liberada"],
                ["DBS CONTROL", data?.employee?.dbs_control_access_enabled ? "Liberado" : "Não liberado"],
                ["Login", data?.access?.login_identifier || "—"],
                ["Registro criado", data?.employee?.created_at ? new Date(data.employee.created_at).toLocaleDateString("pt-BR") : "—"],
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
         </div>}
      </div>
    </div>
  );
}

function MiniCard({ icon, title, value }: { icon: React.ReactNode; title: string; value: string }) {
  return <div className="rounded-xl border border-slate-700 bg-[#141F33] p-4"><div className="flex items-center gap-2 text-slate-400">{icon}<span className="text-[10px] font-black uppercase tracking-wider">{title}</span></div><p className="mt-2 truncate text-sm font-bold text-slate-100">{value}</p></div>;
}
function Employee360Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-xl border border-slate-700 bg-[#141F33] p-4"><div className="mb-3 flex items-center gap-2"><FileStack className="h-4 w-4 text-sky-400" /><h4 className="text-sm font-black text-slate-100">{title}</h4></div>{children}</section>;
}
function InfoGrid({ items }: { items: [string, string][] }) {
  return <div className="grid gap-2 sm:grid-cols-2">{items.map(([k,v]) => <div key={k} className="rounded-lg bg-[#0F172A] p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{k}</p><p className="mt-1 text-xs font-semibold text-slate-200">{v}</p></div>)}</div>;
}
function TimelineList({ items, empty }: { items: { title: string; text: string }[]; empty: string }) {
  if (!items.length) return <p className="text-xs text-slate-500">{empty}</p>;
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
  const [enabled, setEnabled] = useState(employee.access?.access_enabled ?? false);
  const [dbsControlEnabled, setDbsControlEnabled] = useState(employee.access?.dbs_control_access_enabled ?? false);
  const collaboratorUsers = useQuery({
    queryKey: ["rh-collaborator-users"],
    queryFn: () => listRhCollaboratorUsers(),
  });
  const save = useMutation({
    mutationFn: () => saveRhEmployeeAccess({ data: { employee_id: employee.id, enabled, login_identifier: login, dbs_control_enabled: dbsControlEnabled } }),
    onSuccess: onDone,
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
          <label className="block text-xs font-bold text-slate-300">
            Usuário vinculado
            <select
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              disabled={collaboratorUsers.isLoading}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0F172A] px-3 py-2.5 text-sm text-slate-100"
            >
              <option value="">Selecione o login criado em Usuários vinculados</option>
              {(collaboratorUsers.data ?? []).map((user: any) => (
                <option key={user.id} value={user.username || user.email || user.cpf || ""}>
                  {user.full_name || user.username || user.email} · {user.username || user.email}
                </option>
              ))}
              {login && !(collaboratorUsers.data ?? []).some((user: any) => (user.username || user.email || user.cpf) === login) && (
                <option value={login}>{login} · vínculo atual</option>
              )}
            </select>
            <p className="mt-1 text-[10px] font-normal text-slate-500">O login é criado e administrado exclusivamente em Usuários vinculados com o papel COLABORADOR.</p>
          </label>
          <label className="flex items-center gap-3 rounded-xl border border-slate-700 bg-[#0F172A] p-3 text-xs font-bold text-slate-300">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Acesso à Folha de Ponto liberado para este funcionário
          </label>
          <label className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs font-bold text-slate-300">
            <input type="checkbox" checked={dbsControlEnabled} onChange={(e) => { setDbsControlEnabled(e.target.checked); if (e.target.checked) setEnabled(true); }} />
            Liberar <span className="text-emerald-300">DBS CONTROL</span> para este funcionário
          </label>
          <p className="text-[10px] text-slate-500">
            O DBS CONTROL usa o mesmo login do funcionário. Desmarcar aqui remove apenas o módulo CONTROL; o cadastro e o login continuam preservados.
          </p>
        </div>
        {save.error && <p className="mt-4 rounded-lg bg-red-500/10 p-3 text-xs font-semibold text-red-300">{save.error instanceof Error ? save.error.message : "Não foi possível vincular o acesso."}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-xs font-bold text-slate-400">Cancelar</button>
          <button onClick={() => save.mutate()} disabled={save.isPending || (enabled && !login.trim())} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-xs font-black text-white disabled:opacity-50">
            <KeyRound className="h-4 w-4" /> {save.isPending ? "Vinculando..." : "Vincular acesso"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EmployeeForm({
  employee,
  onClose,
  onDone,
}: {
  employee: Employee | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(employee?.full_name ?? "");
  const [unit, setUnit] = useState(employee?.unit ?? "");
  const [values, setValues] = useState<Record<string, string>>(employee?.registration_data ?? {});
  const save = useMutation({
    mutationFn: () =>
      saveRhEmployeeRecord({
        data: { id: employee?.id, full_name: name, unit, registration_data: values },
      }),
    onSuccess: onDone,
  });
  const update = (key: string, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[#02060d]/70 p-4">
      <div className="my-6 w-full max-w-3xl rounded-2xl bg-[#1E293B] p-6 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-xl font-black text-slate-50">
              {employee ? "Editar funcionário" : "Novo funcionário"}
            </h3>
            <p className="mt-1 text-xs text-slate-400">
              Preencha manualmente conforme a ficha funcional. O PDF é apenas um anexo, sem
              interpretação automática.
            </p>
          </div>
          <button onClick={onClose} className="text-xs font-bold text-slate-400">
            Fechar
          </button>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome completo *"
            className="rounded-lg border border-slate-700 bg-[#0F172A] px-3 text-slate-100 placeholder:text-slate-400 py-2.5 text-sm sm:col-span-2"
          />
          <input
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="Unidade / setor *"
            className="rounded-lg border border-slate-700 bg-[#0F172A] px-3 text-slate-100 placeholder:text-slate-400 py-2.5 text-sm sm:col-span-2"
          />
          {FIELDS.map(([key, label]) => (
            <input
              key={key}
              value={values[key] ?? ""}
              onChange={(e) => update(key, e.target.value)}
              placeholder={label}
              type={key.includes("date") ? "date" : "text"}
              className={`rounded-lg border border-slate-700 bg-[#0F172A] px-3 text-slate-100 placeholder:text-slate-400 py-2.5 text-sm ${key === "notes" ? "sm:col-span-2" : ""}`}
            />
          ))}
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
            disabled={save.isPending || !name.trim() || !unit.trim()}
            className="rounded-lg bg-[#F59E0B] px-4 py-2 text-xs font-black text-[#0B0F19] disabled:opacity-50"
          >
            {save.isPending ? "Salvando..." : "Salvar funcionário"}
          </button>
        </div>
      </div>
    </div>
  );
}
