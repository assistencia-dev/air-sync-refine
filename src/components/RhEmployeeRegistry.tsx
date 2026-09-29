import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, FileText, KeyRound, Pencil, Plus, Trash2, Upload, UsersRound } from "lucide-react";
import {
  deactivateRhEmployeeRecord,
  getRhEmployeeFichaUrl,
  listRhEmployeeRegistry,
  saveRhEmployeeRecord,
  uploadRhEmployeeFicha,
  saveRhEmployeeAccess,
} from "@/lib/rh.functions";

type Employee = {
  id: string;
  full_name: string;
  unit: string;
  registration_data: Record<string, string> | null;
  ficha_file_name: string | null;
  access?: {
    employee_id: string;
    user_id: string;
    access_enabled: boolean;
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
                  onDelete={async () => {
                    if (!window.confirm(`Desativar o cadastro de ${employee.full_name}?`)) return;
                    try {
                      await deactivateRhEmployeeRecord({ data: { id: employee.id } });
                      refresh();
                    } catch (e) {
                      setError(
                        e instanceof Error
                          ? e.message
                          : "Não foi possível desativar o funcionário.",
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
      <td className="px-4 py-3 font-semibold text-slate-100">{employee.full_name}</td>
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
  const [password, setPassword] = useState("");
  const [createdPassword, setCreatedPassword] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(employee.access?.access_enabled ?? false);
  const save = useMutation({
    mutationFn: () =>
      saveRhEmployeeAccess({
        data: {
          employee_id: employee.id,
          enabled,
          login_identifier: login,
          initial_password: password || undefined,
        },
      }),
    onSuccess: (result) => {
      if (result.initial_password) {
        setCreatedPassword(result.initial_password);
        setPassword("");
        return;
      }
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
            <p className="mt-1 text-xs text-slate-400">Este acesso usa o login único e direciona o funcionário exclusivamente para a Folha de Ponto.</p>
          </div>
          <button onClick={onClose} className="text-xs font-bold text-slate-400">Fechar</button>
        </div>
        <div className="mt-5 space-y-4">
          <label className="block text-xs font-bold text-slate-300">
            Login do funcionário
            <input value={login} onChange={(e) => setLogin(e.target.value)} placeholder="ex.: joao.silva" className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0F172A] px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500" />
          </label>
          <label className="block text-xs font-bold text-slate-300">
            Senha inicial
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={employee.access ? "Deixe vazio para não alterar" : "Será gerada automaticamente com segurança"}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-[#0F172A] px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500"
            />
            {!employee.access && (
              <p className="mt-1 text-[10px] font-normal text-slate-500">
                Ao criar um novo acesso, o sistema gera uma senha forte automaticamente. A senha digitada aqui não é necessária.
              </p>
            )}
          </label>
          {createdPassword && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
              <p className="text-xs font-black uppercase tracking-wide text-emerald-300">Acesso criado</p>
              <p className="mt-1 text-xs text-slate-300">Entregue estas credenciais ao funcionário. A senha é exibida somente agora.</p>
              <div className="mt-3 grid gap-2">
                <div className="rounded-lg bg-[#0F172A] px-3 py-2 text-xs text-slate-300">
                  <span className="font-bold">Login:</span> {login}
                </div>
                <div className="flex items-center gap-2 rounded-lg bg-[#0F172A] px-3 py-2">
                  <code className="min-w-0 flex-1 break-all text-xs font-bold text-emerald-300">{createdPassword}</code>
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard?.writeText(createdPassword)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md bg-slate-700 px-2 py-1 text-[11px] font-bold text-slate-200"
                  >
                    <Copy className="h-3 w-3" /> Copiar
                  </button>
                </div>
              </div>
            </div>
          )}
          <label className="flex items-center gap-3 rounded-xl border border-slate-700 bg-[#0F172A] p-3 text-xs font-bold text-slate-300">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Acesso liberado para este funcionário
          </label>
        </div>
        {save.error && <p className="mt-4 rounded-lg bg-red-500/10 p-3 text-xs font-semibold text-red-300">{save.error instanceof Error ? save.error.message : "Não foi possível salvar o acesso."}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={createdPassword ? onDone : onClose} className="rounded-lg px-4 py-2 text-xs font-bold text-slate-400">{createdPassword ? "Concluir" : "Cancelar"}</button>
          <button onClick={() => save.mutate()} disabled={save.isPending || Boolean(createdPassword) || (enabled && !login.trim())} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-xs font-black text-white disabled:opacity-50">
            <KeyRound className="h-4 w-4" /> {save.isPending ? "Salvando..." : "Salvar acesso"}
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
