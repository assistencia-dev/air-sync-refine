import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Download, FileText, Plus, WalletCards } from "lucide-react";
import { createRhEmployeeAdvance, cancelRhEmployeeAdvance, listRhEmployeeAdvances } from "@/lib/rh.finance.functions";
import { listRhEmployeeRegistry } from "@/lib/rh.functions";
import { listRhPayroll } from "@/lib/rh.dp.functions";
import { openRhPrint } from "@/lib/rh.exports";

const money = (c: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(c || 0) / 100);

function toCents(value: string) {
  const raw = String(value ?? "").trim().replace(/\s/g, "");
  if (!raw) return 0;
  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw.replace(/,/g, "");
  const number = Number(normalized);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

const fmtCompetence = (value: string) => String(value ?? "").slice(0, 7);

function localCompetence() {
  const now = new Date();
  return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows
    .map((row) => row.map((v) => '"' + String(v ?? "").replace(/"/g, '""') + '"').join(";"))
    .join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function RhEmployeeFinance() {
  const qc = useQueryClient();
  const employees = useQuery({ queryKey: ["rh-finance-employees"], queryFn: () => listRhEmployeeRegistry() });
  const advances = useQuery({ queryKey: ["rh-employee-advances"], queryFn: () => listRhEmployeeAdvances() });
  const payroll = useQuery({ queryKey: ["rh-payroll"], queryFn: () => listRhPayroll() });

  const [employeeId, setEmployeeId] = useState("");
  const [type, setType] = useState<"VALE" | "ADIANTAMENTO" | "OUTRO">("VALE");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [competence, setCompetence] = useState(localCompetence());
  const [authorized, setAuthorized] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      createRhEmployeeAdvance({
        data: {
          employee_id: employeeId,
          advance_type: type,
          description,
          amount_cents: toCents(amount),
          competence,
          authorized,
        },
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["rh-employee-advances"] });
      setDescription("");
      setAmount("");
      setSuccess("Vale registrado e vinculado ao cadastro central do funcionário.");
    },
  });

  const cancel = useMutation({
    mutationFn: (id: string) => cancelRhEmployeeAdvance({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rh-employee-advances"] }),
  });

  const active = useMemo(
    () => (advances.data ?? []).filter((a) => a.status !== "cancelado"),
    [advances.data],
  );
  const totalProgramado = active
    .filter((a) => a.status === "programado")
    .reduce((n, a) => n + Number(a.amount_cents || 0), 0);
  const totalDescontado = active
    .filter((a) => a.status === "descontado")
    .reduce((n, a) => n + Number(a.amount_cents || 0), 0);
  const selected = employees.data?.find((e: any) => e.id === employeeId) as any;
  const salaryRaw = selected?.registration_data?.salary ?? "0";
  const salaryCents = selected
    ? toCents(String(salaryRaw))
    : 0;
  const selectedAdvances = active.filter((a) => a.employee_id === employeeId);
  const selectedNet = payroll.data
    ?.flatMap((p: any) => p.rh_payroll_runs ?? [])
    .find((r: any) => r.employee_id === employeeId);

  const exportCsv = () => {
    downloadCsv("rh_vales_descontos.csv", [
      ["Funcionário", "Unidade", "Tipo", "Descrição", "Competência", "Valor", "Autorizado", "Status"],
      ...active.map((a: any) => [
        a.employee?.full_name ?? "",
        a.employee?.unit ?? "",
        a.advance_type,
        a.description,
        fmtCompetence(a.competence),
        money(a.amount_cents),
        a.authorized ? "Sim" : "Não",
        a.status,
      ]),
    ]);
  };

  const exportPdf = () => {
    const total = active.reduce((n, a) => n + Number(a.amount_cents || 0), 0);
    const body = [
      '<div class="section"><h2>Resumo da competência</h2><div class="grid">',
      '<div class="item"><div class="label">Competência filtrada</div><div class="value">' + escapeHtml(competence) + '</div></div>',
      '<div class="item"><div class="label">Lançamentos ativos</div><div class="value">' + active.length + '</div></div>',
      '<div class="item"><div class="label">Programado</div><div class="value">' + money(totalProgramado) + '</div></div>',
      '<div class="item"><div class="label">Já descontado</div><div class="value">' + money(totalDescontado) + '</div></div>',
      '<div class="item"><div class="label">Total ativo</div><div class="value">' + money(total) + '</div></div>',
      '</div></div>',
      '<div class="section"><h2>Vales e descontos</h2><table><thead><tr><th>Funcionário</th><th>Tipo</th><th>Competência</th><th>Descrição</th><th>Valor</th><th>Autorizado</th><th>Status</th></tr></thead><tbody>',
      ...active.map((a: any) =>
        '<tr><td>' + escapeHtml(a.employee?.full_name) + '</td><td>' +
        escapeHtml(a.advance_type) + '</td><td>' + escapeHtml(fmtCompetence(a.competence)) +
        '</td><td>' + escapeHtml(a.description) + '</td><td>' + money(a.amount_cents) +
        '</td><td>' + (a.authorized ? "Sim" : "Não") + '</td><td>' + escapeHtml(a.status) + '</td></tr>',
      ),
      '<tr class="total"><td colspan="4">TOTAL ATIVO</td><td>' + money(total) + '</td><td></td><td></td></tr>',
      '</tbody></table></div>',
    ].join("");
    openRhPrint("Vales e descontos em folha", "Relatório gerencial · RH / DP", body);
  };

  return (
    <section className="space-y-5">
      <header className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="bg-[#0F172A] px-5 py-6 text-white sm:px-7">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-[10px] font-black uppercase tracking-[.18em] text-sky-300">RH · financeiro do colaborador</p>
              <h2 className="mt-1 text-2xl font-black tracking-tight">Vales e descontos em folha</h2>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                O funcionário é selecionado diretamente do Cadastro de Funcionários. O lançamento fica ligado ao mesmo employee_id usado por ficha, folha, ponto e auditoria.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={exportCsv} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-xs font-bold text-slate-200 hover:bg-white/10">
                <Download className="h-4 w-4" /> CSV
              </button>
              <button onClick={exportPdf} className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2.5 text-xs font-black text-slate-900 hover:bg-slate-100">
                <FileText className="h-4 w-4" /> Relatório / PDF
              </button>
            </div>
          </div>
        </div>
        <div className="grid gap-3 bg-slate-50 p-4 sm:grid-cols-3 sm:p-5">
          <Kpi label="Programado" value={money(totalProgramado)} />
          <Kpi label="Já descontado" value={money(totalDescontado)} />
          <Kpi label="Lançamentos ativos" value={active.length} />
        </div>
      </header>

      {(save.error || advances.isError || employees.isError) && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold leading-5 text-red-700">
          {save.error instanceof Error
            ? save.error.message
            : "Não foi possível carregar o cadastro financeiro do RH. Verifique a conexão do ambiente com o banco configurado."}
        </div>
      )}
      {success && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-700">
          {success}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1.05fr_.95fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-5 flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-700"><WalletCards className="h-5 w-5" /></span>
            <div>
              <h3 className="font-black text-slate-900">Registrar novo vale</h3>
              <p className="text-xs text-slate-500">O registro será associado ao funcionário central.</p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Funcionário" className="sm:col-span-2">
              <select value={employeeId} onChange={(e) => { setEmployeeId(e.target.value); setSuccess(null); }} className="input">
                <option value="">Selecione o funcionário</option>
                {(employees.data ?? []).filter((e: any) => e.is_active).map((e: any) => (
                  <option key={e.id} value={e.id}>{e.full_name} · {e.unit}</option>
                ))}
              </select>
            </Field>

            {selected && (
              <div className="sm:col-span-2 rounded-2xl border border-sky-100 bg-sky-50 p-4">
                <p className="text-[10px] font-black uppercase tracking-wider text-sky-700">Ficha vinculada</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <Info label="Cargo" value={selected.registration_data?.job_title || "Não informado"} />
                  <Info label="Salário cadastrado" value={salaryCents ? money(salaryCents) : "Não informado"} />
                  <Info label="Unidade" value={selected.unit || "—"} />
                </div>
                {selectedNet && (
                  <p className="mt-3 text-xs text-slate-600">
                    Último líquido calculado: <strong className="text-emerald-700">{money(selectedNet.net_cents)}</strong>
                  </p>
                )}
              </div>
            )}

            <Field label="Tipo">
              <select value={type} onChange={(e) => setType(e.target.value as "VALE" | "ADIANTAMENTO" | "OUTRO")} className="input">
                <option value="VALE">Vale</option>
                <option value="ADIANTAMENTO">Adiantamento salarial</option>
                <option value="OUTRO">Outro desconto autorizado</option>
              </select>
            </Field>

            <Field label="Competência">
              <input type="month" value={competence} onChange={(e) => setCompetence(e.target.value)} className="input" />
            </Field>

            <Field label="Valor (R$)">
              <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0,00" className="input" />
            </Field>

            <Field label="Descrição" className="sm:col-span-2">
              <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: Vale salarial referente à quinzena" className="input" />
            </Field>

            <label className="sm:col-span-2 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-semibold leading-5 text-slate-700">
              <input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} className="mt-1" />
              <span><strong>Desconto autorizado.</strong> Sem autorização, o lançamento permanece registrado, mas não entra no cálculo da folha.</span>
            </label>
          </div>

          <button
            onClick={() => { setSuccess(null); save.mutate(); }}
            disabled={save.isPending || !employeeId || !description.trim() || toCents(amount) <= 0}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#0F172A] px-5 py-3 text-xs font-black text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> {save.isPending ? "Registrando..." : "Registrar vale"}
          </button>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h3 className="font-black text-slate-900">Resumo do funcionário</h3>
          {!employeeId ? (
            <p className="mt-3 rounded-2xl bg-slate-50 p-5 text-xs leading-5 text-slate-500">
              Selecione um colaborador para visualizar os lançamentos vinculados à ficha dele.
            </p>
          ) : (
            <>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Kpi label="Lançamentos" value={selectedAdvances.length} />
                <Kpi label="Total" value={money(selectedAdvances.reduce((n, a) => n + Number(a.amount_cents || 0), 0))} />
              </div>
              <div className="mt-4 space-y-2">
                {selectedAdvances.map((a: any) => (
                  <div key={a.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold text-slate-800">{a.description}</p>
                      <p className="mt-1 text-[10px] text-slate-400">
                        {fmtCompetence(a.competence)} · {a.status} · {a.authorized ? "Autorizado" : "Sem autorização"}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <b className="text-xs text-slate-800">{money(a.amount_cents)}</b>
                      {a.status === "programado" && (
                        <button title="Cancelar vale" onClick={() => cancel.mutate(a.id)} className="rounded-lg p-2 text-red-500 hover:bg-red-50">
                          <Ban className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {!selectedAdvances.length && <p className="rounded-2xl bg-slate-50 p-5 text-xs text-slate-500">Nenhum vale registrado para este funcionário.</p>}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={className + " text-xs font-bold text-slate-700"}>
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</p><p className="mt-1 text-sm font-bold text-slate-800">{value}</p></div>;
}

function Kpi({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</p><p className="mt-1 text-lg font-black text-slate-900">{value}</p></div>;
}
