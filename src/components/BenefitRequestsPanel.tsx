import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronRight,
  Download,
  FileSpreadsheet,
  FileText,
  History,
  Loader2,
  Paperclip,
  Plane,
  Plus,
  Printer,
  Trash2,
  Upload,
  Utensils,
  X,
} from "lucide-react";
import {
  changeRequestStatus,
  listBenefitRequests,
  listRequestAttachments,
  listRequestAudit,
  saveBenefitRequest,
  softDeleteRequest,
  uploadRequestAttachment,
  type BenefitKind,
  type BenefitRequest,
} from "@/lib/rh-requests.functions";
import { listRhEmployeeRegistry } from "@/lib/rh.functions";

const FLOW: Record<BenefitKind, string[]> = {
  passagem: ["PENDENTE", "EM_ANALISE", "APROVADO", "EMITIDO", "CONCLUIDO"],
  alimentacao: ["SOLICITADO", "EM_APROVACAO", "CREDITADO", "FINALIZADO"],
};
const QUEUE: Record<BenefitKind, string[]> = {
  passagem: ["PENDENTE", "EM_ANALISE", "APROVADO"],
  alimentacao: ["SOLICITADO", "EM_APROVACAO"],
};
const ACTIVE: Record<BenefitKind, string[]> = {
  passagem: ["EMITIDO"],
  alimentacao: ["CREDITADO"],
};

const STATUS_STYLE: Record<string, string> = {
  PENDENTE: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  SOLICITADO: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  EM_ANALISE: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  EM_APROVACAO: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  APROVADO: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  EMITIDO: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  CREDITADO: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  CONCLUIDO: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  FINALIZADO: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  RECUSADO: "bg-red-500/15 text-red-300 border-red-500/30",
  CANCELADO: "bg-red-500/15 text-red-300 border-red-500/30",
};

const money = (cents: number | null | undefined) =>
  `R$ ${((cents ?? 0) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
const toCents = (value: string) => Math.round(Number(value.replace(",", ".") || 0) * 100);
const dateText = (v: string | null) =>
  v ? new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

function readAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

function StatusChip({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${STATUS_STYLE[status] ?? "border-slate-600 bg-slate-700/40 text-slate-300"}`}
    >
      {status.replace("_", " ")}
    </span>
  );
}

/* ------------------------------- Formulário ------------------------------- */

function RequestForm({
  kind,
  employees,
  editing,
  onClose,
}: {
  kind: BenefitKind;
  employees: { id: string; full_name: string; unit: string }[];
  editing: BenefitRequest | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    employee_id: editing?.employee_id ?? "",
    employee_name: editing?.employee_name ?? "",
    cpf: editing?.cpf ?? "",
    rg: editing?.rg ?? "",
    birth_date: editing?.birth_date ?? "",
    filial: editing?.filial ?? "",
    travel_mode: editing?.travel_mode ?? "aereo",
    origin: editing?.origin ?? "",
    destination: editing?.destination ?? "",
    depart_at: editing?.depart_at ? editing.depart_at.slice(0, 16) : "",
    return_at: editing?.return_at ? editing.return_at.slice(0, 16) : "",
    reason: editing?.reason ?? "",
    carrier: editing?.carrier ?? "",
    pnr: editing?.pnr ?? "",
    estimated: editing ? String((editing.estimated_cents ?? 0) / 100) : "",
    paid: editing ? String((editing.paid_cents ?? 0) / 100) : "",
    over_budget_reason: editing?.over_budget_reason ?? "",
    ref_month: editing?.ref_month ?? new Date().toISOString().slice(0, 7),
    days: editing?.days ? String(editing.days) : "22",
    daily: editing?.daily_cents ? String(editing.daily_cents / 100) : "",
    meal_type: editing?.meal_type ?? "Alimentação",
  });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const save = useMutation({
    mutationFn: () =>
      saveBenefitRequest({
        data: {
          id: editing?.id,
          kind,
          employee_id: form.employee_id || null,
          employee_name: form.employee_name,
          cpf: form.cpf,
          rg: form.rg,
          birth_date: form.birth_date || null,
          filial: form.filial,
          travel_mode: kind === "passagem" ? form.travel_mode : null,
          origin: form.origin,
          destination: form.destination,
          depart_at: form.depart_at ? new Date(form.depart_at).toISOString() : null,
          return_at: form.return_at ? new Date(form.return_at).toISOString() : null,
          reason: form.reason,
          carrier: form.carrier,
          pnr: form.pnr,
          estimated_cents: toCents(form.estimated),
          paid_cents: toCents(form.paid),
          over_budget_reason: form.over_budget_reason,
          ref_month: kind === "alimentacao" ? form.ref_month : null,
          days: kind === "alimentacao" ? Number(form.days || 0) : null,
          daily_cents: kind === "alimentacao" ? toCents(form.daily) : null,
          meal_type: kind === "alimentacao" ? form.meal_type : null,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["benefit-requests", kind] });
      onClose();
    },
    onError: (e: unknown) =>
      setError(e instanceof Error ? e.message : "Não foi possível salvar a solicitação."),
  });

  const field =
    "w-full rounded-xl border border-slate-700 bg-[#0F172A] px-3 py-2.5 text-sm font-semibold text-slate-100 outline-none focus:border-[#F59E0B]";
  const label = "mb-1.5 block text-[10px] font-black uppercase tracking-wider text-slate-400";

  return (
    <div className="fixed inset-0 z-50 grid place-items-start overflow-y-auto bg-black/70 p-4 sm:p-8">
      <div className="mx-auto w-full max-w-3xl rounded-2xl border border-slate-800 bg-[#1E293B] p-6 shadow-2xl">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[.2em] text-[#F59E0B]">
              {kind === "passagem" ? "Vale Passagem" : "Vale Alimentação / Refeição"}
            </p>
            <h3 className="mt-1 text-lg font-black text-slate-50">
              {editing ? "Editar solicitação" : "Nova solicitação"}
            </h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            save.mutate();
          }}
        >
          <label className="sm:col-span-2">
            <span className={label}>Colaborador (base do RH)</span>
            <select
              className={field}
              value={form.employee_id}
              onChange={(e) => {
                const emp = employees.find((x) => x.id === e.target.value);
                set({
                  employee_id: e.target.value,
                  employee_name: emp?.full_name ?? form.employee_name,
                  filial: emp?.unit ?? form.filial,
                });
              }}
            >
              <option value="">Selecionar do cadastro central...</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.full_name} — {emp.unit}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className={label}>Nome do colaborador *</span>
            <input
              className={field}
              value={form.employee_name}
              onChange={(e) => set({ employee_name: e.target.value })}
            />
          </label>
          <label>
            <span className={label}>Filial / Centro de custo *</span>
            <input
              className={field}
              placeholder="Filial 622"
              value={form.filial}
              onChange={(e) => set({ filial: e.target.value })}
            />
          </label>
          <label>
            <span className={label}>CPF</span>
            <input className={field} value={form.cpf} onChange={(e) => set({ cpf: e.target.value })} />
          </label>
          {kind === "passagem" ? (
            <label>
              <span className={label}>RG</span>
              <input className={field} value={form.rg} onChange={(e) => set({ rg: e.target.value })} />
            </label>
          ) : (
            <label>
              <span className={label}>Tipo</span>
              <select
                className={field}
                value={form.meal_type}
                onChange={(e) => set({ meal_type: e.target.value })}
              >
                <option>Alimentação</option>
                <option>Refeição</option>
                <option>Diária</option>
              </select>
            </label>
          )}

          {kind === "passagem" ? (
            <>
              <label>
                <span className={label}>Data de nascimento</span>
                <input
                  type="date"
                  className={field}
                  value={form.birth_date}
                  onChange={(e) => set({ birth_date: e.target.value })}
                />
              </label>
              <label>
                <span className={label}>Modalidade</span>
                <select
                  className={field}
                  value={form.travel_mode}
                  onChange={(e) => set({ travel_mode: e.target.value })}
                >
                  <option value="aereo">Aéreo</option>
                  <option value="rodoviario">Rodoviário</option>
                </select>
              </label>
              <label>
                <span className={label}>Origem *</span>
                <input
                  className={field}
                  value={form.origin}
                  onChange={(e) => set({ origin: e.target.value })}
                />
              </label>
              <label>
                <span className={label}>Destino *</span>
                <input
                  className={field}
                  value={form.destination}
                  onChange={(e) => set({ destination: e.target.value })}
                />
              </label>
              <label>
                <span className={label}>Saída *</span>
                <input
                  type="datetime-local"
                  className={field}
                  value={form.depart_at}
                  onChange={(e) => set({ depart_at: e.target.value })}
                />
              </label>
              <label>
                <span className={label}>Retorno</span>
                <input
                  type="datetime-local"
                  className={field}
                  value={form.return_at}
                  onChange={(e) => set({ return_at: e.target.value })}
                />
              </label>
              <label>
                <span className={label}>Companhia / Empresa</span>
                <input
                  className={field}
                  value={form.carrier}
                  onChange={(e) => set({ carrier: e.target.value })}
                />
              </label>
              <label>
                <span className={label}>Localizador (PNR)</span>
                <input
                  className={field}
                  value={form.pnr}
                  onChange={(e) => set({ pnr: e.target.value.toUpperCase() })}
                />
              </label>
              <label>
                <span className={label}>Valor estimado (R$)</span>
                <input
                  className={field}
                  value={form.estimated}
                  onChange={(e) => set({ estimated: e.target.value })}
                />
              </label>
              <label>
                <span className={label}>Valor real pago (R$)</span>
                <input
                  className={field}
                  value={form.paid}
                  onChange={(e) => set({ paid: e.target.value })}
                />
              </label>
              <label className="sm:col-span-2">
                <span className={label}>Motivo da viagem</span>
                <textarea
                  rows={2}
                  className={field}
                  value={form.reason}
                  onChange={(e) => set({ reason: e.target.value })}
                />
              </label>
            </>
          ) : (
            <>
              <label>
                <span className={label}>Mês de referência *</span>
                <input
                  type="month"
                  className={field}
                  value={form.ref_month}
                  onChange={(e) => set({ ref_month: e.target.value })}
                />
              </label>
              <label>
                <span className={label}>Quantidade de dias *</span>
                <input
                  className={field}
                  value={form.days}
                  onChange={(e) => set({ days: e.target.value })}
                />
              </label>
              <label>
                <span className={label}>Valor diário (R$) *</span>
                <input
                  className={field}
                  value={form.daily}
                  onChange={(e) => set({ daily: e.target.value })}
                />
              </label>
              <div className="rounded-xl border border-slate-700 bg-[#0F172A] px-3 py-2.5">
                <span className={label}>Valor total calculado</span>
                <p className="text-sm font-black text-[#F59E0B]">
                  {money(Number(form.days || 0) * toCents(form.daily))}
                </p>
              </div>
              <label className="sm:col-span-2">
                <span className={label}>Observação</span>
                <textarea
                  rows={2}
                  className={field}
                  value={form.reason}
                  onChange={(e) => set({ reason: e.target.value })}
                />
              </label>
            </>
          )}

          <label className="sm:col-span-2">
            <span className={label}>Justificativa de valor acima do estimado (se houver)</span>
            <input
              className={field}
              value={form.over_budget_reason}
              onChange={(e) => set({ over_budget_reason: e.target.value })}
            />
          </label>

          {error && (
            <p className="sm:col-span-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-xs font-semibold text-red-300">
              {error}
            </p>
          )}

          <div className="sm:col-span-2 flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-700 px-4 py-2.5 text-xs font-bold text-slate-300 hover:bg-slate-800"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={save.isPending}
              className="inline-flex items-center gap-2 rounded-xl bg-[#F59E0B] px-5 py-2.5 text-xs font-black text-[#102b3b] transition hover:brightness-110 disabled:opacity-60"
            >
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {editing ? "Salvar alterações" : "Registrar solicitação"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* --------------------------- Painel de detalhes --------------------------- */

function RequestDetail({
  kind,
  request,
  onClose,
  onEdit,
}: {
  kind: BenefitKind;
  request: BenefitRequest;
  onClose: () => void;
  onEdit: () => void;
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const attachments = useQuery({
    queryKey: ["benefit-request-attachments", request.id],
    queryFn: () => listRequestAttachments({ data: { request_id: request.id } }),
  });
  const audit = useQuery({
    queryKey: ["benefit-request-audit", request.id],
    queryFn: () => listRequestAudit({ data: { request_id: request.id } }),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["benefit-requests", kind] });
    qc.invalidateQueries({ queryKey: ["benefit-request-attachments", request.id] });
    qc.invalidateQueries({ queryKey: ["benefit-request-audit", request.id] });
  };

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const data_base64 = await readAsBase64(file);
      return uploadRequestAttachment({
        data: {
          request_id: request.id,
          file_name: file.name || `foto-${Date.now()}.jpg`,
          file_type: file.type || null,
          data_base64,
        },
      });
    },
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Falha ao enviar o anexo."),
  });

  const advance = useMutation({
    mutationFn: (status: string) =>
      changeRequestStatus({ data: { id: request.id, status, note: note || null } }),
    onSuccess: () => {
      setError(null);
      setNote("");
      refresh();
    },
    onError: (e: unknown) =>
      setError(e instanceof Error ? e.message : "Não foi possível alterar a situação."),
  });

  const remove = useMutation({
    mutationFn: () => softDeleteRequest({ data: { id: request.id, reason: note || null } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["benefit-requests", kind] });
      onClose();
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Falha ao arquivar."),
  });

  const flow = FLOW[kind];
  const index = flow.indexOf(request.status);
  const next = index >= 0 ? flow[index + 1] : undefined;
  const closed = ["RECUSADO", "CANCELADO"].includes(request.status);

  const rows: [string, string][] =
    kind === "passagem"
      ? [
          ["Filial / centro de custo", request.filial ?? "—"],
          ["Documentos", [request.cpf, request.rg].filter(Boolean).join(" · ") || "—"],
          ["Modalidade", request.travel_mode === "rodoviario" ? "Rodoviário" : "Aéreo"],
          ["Trecho", `${request.origin ?? "—"} → ${request.destination ?? "—"}`],
          ["Saída", dateText(request.depart_at)],
          ["Retorno", dateText(request.return_at)],
          ["Companhia", request.carrier ?? "—"],
          ["Localizador (PNR)", request.pnr ?? "—"],
          ["Valor estimado", money(request.estimated_cents)],
          ["Valor real pago", money(request.paid_cents)],
          ["Motivo", request.reason ?? "—"],
        ]
      : [
          ["Filial / centro de custo", request.filial ?? "—"],
          ["CPF", request.cpf ?? "—"],
          ["Tipo", request.meal_type ?? "—"],
          ["Mês de referência", request.ref_month ?? "—"],
          ["Dias", String(request.days ?? "—")],
          ["Valor diário", money(request.daily_cents)],
          ["Valor total", money(request.total_cents)],
          ["Observação", request.reason ?? "—"],
        ];

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-4 sm:p-8">
      <div className="mx-auto w-full max-w-3xl rounded-2xl border border-slate-800 bg-[#1E293B] p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <StatusChip status={request.status} />
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Aberta em {dateText(request.created_at)}
              </span>
            </div>
            <h3 className="mt-2 text-lg font-black text-slate-50">{request.employee_name}</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <dl className="grid gap-x-6 gap-y-2 rounded-xl border border-slate-800 bg-[#0F172A] p-4 sm:grid-cols-2">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3 text-xs">
              <dt className="font-bold uppercase tracking-wider text-slate-500">{k}</dt>
              <dd className="text-right font-semibold text-slate-200">{v}</dd>
            </div>
          ))}
        </dl>

        {request.over_budget_reason && (
          <p className="mt-3 inline-flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5" /> Justificativa de valor:{" "}
            {request.over_budget_reason}
          </p>
        )}

        {/* Anexos */}
        <div className="mt-5">
          <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[.16em] text-slate-400">
            <Paperclip className="h-3.5 w-3.5" /> Anexos ({attachments.data?.length ?? 0})
          </p>
          <ul className="mt-2 space-y-1.5">
            {(attachments.data ?? []).map((a) => (
              <li key={a.id}>
                <a
                  href={a.url ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 rounded-lg border border-slate-700 bg-[#0F172A] px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 hover:border-[#F59E0B]"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span className="max-w-[260px] truncate">{a.file_name}</span>
                </a>
              </li>
            ))}
            {attachments.data?.length === 0 && (
              <li className="text-[11px] text-slate-500">
                Nenhum comprovante anexado — obrigatório para{" "}
                {kind === "passagem" ? "emitir" : "creditar"}.
              </li>
            )}
          </ul>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept="application/pdf,image/*,.xlsx,.xls,.csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) upload.mutate(f);
            }}
          />
          <input
            ref={cameraRef}
            type="file"
            className="hidden"
            accept="image/*"
            capture="environment"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) upload.mutate(f);
            }}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              disabled={upload.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-[11px] font-bold text-slate-200 hover:border-[#F59E0B] disabled:opacity-60"
            >
              {upload.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              PDF, planilha ou imagem
            </button>
            <button
              onClick={() => cameraRef.current?.click()}
              disabled={upload.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-[11px] font-bold text-slate-200 hover:border-[#F59E0B] disabled:opacity-60"
            >
              <Camera className="h-3.5 w-3.5" /> Tirar foto
            </button>
          </div>
        </div>

        {/* Ações de fluxo */}
        {!closed && (
          <div className="mt-5 rounded-xl border border-slate-800 bg-[#0F172A] p-4">
            <p className="text-[10px] font-black uppercase tracking-[.16em] text-slate-400">
              Fluxo da solicitação
            </p>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Observação / motivo (obrigatório ao recusar ou cancelar)"
              className="mt-2 w-full rounded-xl border border-slate-700 bg-[#1E293B] px-3 py-2.5 text-xs font-semibold text-slate-100 outline-none focus:border-[#F59E0B]"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              {next && (
                <button
                  onClick={() => advance.mutate(next)}
                  disabled={advance.isPending}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#F59E0B] px-4 py-2 text-[11px] font-black text-[#102b3b] hover:brightness-110 disabled:opacity-60"
                >
                  <ChevronRight className="h-3.5 w-3.5" /> Avançar para {next.replace("_", " ")}
                </button>
              )}
              <button
                onClick={() => advance.mutate("RECUSADO")}
                className="rounded-xl border border-red-500/40 px-4 py-2 text-[11px] font-black text-red-300 hover:bg-red-500/10"
              >
                Recusar
              </button>
              <button
                onClick={() => advance.mutate("CANCELADO")}
                className="rounded-xl border border-slate-600 px-4 py-2 text-[11px] font-black text-slate-300 hover:bg-slate-800"
              >
                Cancelar solicitação
              </button>
              <button
                onClick={onEdit}
                className="rounded-xl border border-slate-600 px-4 py-2 text-[11px] font-black text-slate-300 hover:bg-slate-800"
              >
                Editar dados
              </button>
              <button
                onClick={() => remove.mutate()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 px-4 py-2 text-[11px] font-black text-slate-400 hover:bg-slate-800"
              >
                <Trash2 className="h-3.5 w-3.5" /> Arquivar (sem apagar)
              </button>
            </div>
            {error && (
              <p className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300">
                {error}
              </p>
            )}
          </div>
        )}

        {/* Auditoria */}
        <div className="mt-5">
          <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[.16em] text-slate-400">
            <History className="h-3.5 w-3.5" /> Histórico de alterações
          </p>
          <ul className="mt-2 space-y-1.5">
            {(audit.data ?? []).map((entry) => (
              <li
                key={entry.id}
                className="rounded-lg border border-slate-800 bg-[#0F172A] px-3 py-2 text-[11px] text-slate-300"
              >
                <span className="font-black text-slate-100">{entry.action.replace("_", " ")}</span>{" "}
                {entry.status_from && entry.status_to && entry.status_from !== entry.status_to
                  ? `${entry.status_from} → ${entry.status_to}`
                  : ""}{" "}
                <span className="text-slate-500">
                  · {entry.user_name ?? "Operador"} · {dateText(entry.created_at)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- Painel --------------------------------- */

export function BenefitRequestsPanel({ kind }: { kind: BenefitKind }) {
  const [tab, setTab] = useState<"fila" | "ativos" | "historico">("fila");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<BenefitRequest | null>(null);
  const [selected, setSelected] = useState<BenefitRequest | null>(null);
  const [search, setSearch] = useState("");

  const requests = useQuery({
    queryKey: ["benefit-requests", kind],
    queryFn: () => listBenefitRequests({ data: { kind } }),
  });
  const employees = useQuery({
    queryKey: ["rh-employee-registry"],
    queryFn: () => listRhEmployeeRegistry(),
  });

  const all = requests.data ?? [];
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return all.filter((r) => {
      const inTab =
        tab === "fila"
          ? QUEUE[kind].includes(r.status)
          : tab === "ativos"
            ? ACTIVE[kind].includes(r.status)
            : !QUEUE[kind].includes(r.status) && !ACTIVE[kind].includes(r.status);
      if (!inTab) return false;
      if (!term) return true;
      return `${r.employee_name} ${r.filial ?? ""} ${r.pnr ?? ""} ${r.origin ?? ""} ${r.destination ?? ""}`
        .toLowerCase()
        .includes(term);
    });
  }, [all, tab, search, kind]);

  const metrics = useMemo(() => {
    const month = new Date().toISOString().slice(0, 7);
    const inMonth = all.filter((r) => r.created_at.slice(0, 7) === month);
    const value = (r: BenefitRequest) =>
      kind === "passagem" ? r.paid_cents || r.estimated_cents : (r.total_cents ?? 0);
    const total = inMonth.reduce((sum, r) => sum + value(r), 0);
    const released = all.filter((r) => ACTIVE[kind].concat(FLOW[kind].slice(-1)).includes(r.status));
    const people = new Set(inMonth.map((r) => r.employee_name)).size || 1;
    return {
      total,
      released: released.length,
      average: Math.round(total / people),
      queue: all.filter((r) => QUEUE[kind].includes(r.status)).length,
    };
  }, [all, kind]);

  const exportCsv = () => {
    const header =
      kind === "passagem"
        ? ["Colaborador", "Filial", "Trecho", "Saída", "PNR", "Estimado", "Pago", "Situação"]
        : ["Colaborador", "Filial", "Tipo", "Mês", "Dias", "Valor diário", "Total", "Situação"];
    const lines = filtered.map((r) =>
      kind === "passagem"
        ? [
            r.employee_name,
            r.filial ?? "",
            `${r.origin ?? ""} > ${r.destination ?? ""}`,
            dateText(r.depart_at),
            r.pnr ?? "",
            money(r.estimated_cents),
            money(r.paid_cents),
            r.status,
          ]
        : [
            r.employee_name,
            r.filial ?? "",
            r.meal_type ?? "",
            r.ref_month ?? "",
            String(r.days ?? ""),
            money(r.daily_cents),
            money(r.total_cents),
            r.status,
          ],
    );
    const csv = [header, ...lines]
      .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";"))
      .join("\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${kind === "passagem" ? "vale-passagem" : "vale-alimentacao"}-${tab}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const Icon = kind === "passagem" ? Plane : Utensils;

  return (
    <section className="space-y-4">
      {/* Métricas */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Total gasto no mês", value: money(metrics.total), tone: "text-[#F59E0B]" },
          { label: "Benefícios liberados", value: String(metrics.released), tone: "text-emerald-300" },
          { label: "Média por colaborador", value: money(metrics.average), tone: "text-sky-300" },
          { label: "Na fila de trabalho", value: String(metrics.queue), tone: "text-amber-300" },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-2xl border border-slate-800 bg-[#1E293B] p-4 shadow-sm"
          >
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                {card.label}
              </p>
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-slate-800 text-[#F59E0B]">
                <Icon className="h-4 w-4" />
              </span>
            </div>
            <p className={`mt-2 text-xl font-black ${card.tone}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Barra de ações */}
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-[#1E293B] p-4 lg:flex-row lg:items-center lg:justify-between">
        <nav className="flex flex-wrap gap-2">
          {(
            [
              ["fila", "Fila de trabalho"],
              ["ativos", kind === "passagem" ? "Emissões & viagens ativas" : "Créditos do mês"],
              ["historico", "Histórico & finalizados"],
            ] as const
          ).map(([key, labelText]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`rounded-xl px-4 py-2 text-xs font-bold transition ${tab === key ? "bg-[#F59E0B] text-[#102b3b]" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
            >
              {labelText}
            </button>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar colaborador, filial ou PNR"
            className="w-56 rounded-xl border border-slate-700 bg-[#0F172A] px-3 py-2 text-xs font-semibold text-slate-100 outline-none focus:border-[#F59E0B]"
          />
          <button
            onClick={exportCsv}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 px-3 py-2 text-[11px] font-bold text-slate-200 hover:border-[#F59E0B]"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
          </button>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 px-3 py-2 text-[11px] font-bold text-slate-200 hover:border-[#F59E0B]"
          >
            <Printer className="h-3.5 w-3.5" /> PDF
          </button>
          <button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#F59E0B] px-4 py-2 text-[11px] font-black text-[#102b3b] hover:brightness-110"
          >
            <Plus className="h-3.5 w-3.5" /> Nova solicitação
          </button>
        </div>
      </div>

      {/* Lista */}
      <div
        className={`overflow-hidden rounded-2xl border border-slate-800 bg-[#1E293B] ${tab === "historico" ? "opacity-80" : ""}`}
      >
        {requests.isLoading ? (
          <p className="flex items-center gap-2 p-6 text-xs text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando solicitações...
          </p>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-xs text-slate-400">Nenhuma solicitação nesta aba.</p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="bg-[#0F172A] text-[10px] font-black uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-4 py-3">Colaborador</th>
                <th className="px-4 py-3">Filial</th>
                <th className="px-4 py-3">{kind === "passagem" ? "Trecho / saída" : "Referência"}</th>
                <th className="px-4 py-3">Valor</th>
                <th className="px-4 py-3">Anexos</th>
                <th className="px-4 py-3">Situação</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-t border-slate-800">
                  <td className="px-4 py-3 font-bold text-slate-100">{r.employee_name}</td>
                  <td className="px-4 py-3 text-slate-300">{r.filial ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-300">
                    {kind === "passagem"
                      ? `${r.origin ?? "—"} → ${r.destination ?? "—"} · ${dateText(r.depart_at)}`
                      : `${r.meal_type ?? "—"} · ${r.ref_month ?? "—"} · ${r.days ?? 0} dias`}
                  </td>
                  <td className="px-4 py-3 font-black text-[#F59E0B]">
                    {kind === "passagem"
                      ? money(r.paid_cents || r.estimated_cents)
                      : money(r.total_cents)}
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {r.attachments_count > 0 ? (
                      <span className="inline-flex items-center gap-1 text-emerald-300">
                        <CheckCircle2 className="h-3.5 w-3.5" /> {r.attachments_count}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-slate-500">
                        <FileText className="h-3.5 w-3.5" /> 0
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusChip status={r.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setSelected(r)}
                      className="rounded-lg border border-slate-700 px-3 py-1.5 text-[11px] font-bold text-slate-200 hover:border-[#F59E0B]"
                    >
                      Abrir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {formOpen && (
        <RequestForm
          kind={kind}
          employees={(employees.data ?? []).map((e) => ({
            id: e.id,
            full_name: e.full_name,
            unit: e.unit,
          }))}
          editing={editing}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
        />
      )}
      {selected && !formOpen && (
        <RequestDetail
          kind={kind}
          request={
            (requests.data ?? []).find((r) => r.id === selected.id) ?? selected
          }
          onClose={() => setSelected(null)}
          onEdit={() => {
            setEditing(selected);
            setFormOpen(true);
          }}
        />
      )}
    </section>
  );
}
