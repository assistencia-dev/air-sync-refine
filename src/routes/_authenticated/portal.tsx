import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleDot, LogOut, PlusCircle, RefreshCw, Ticket } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getMyProfile } from "@/lib/auth.functions";
import { createTicket, listMyTickets } from "@/lib/tickets.functions";
import logoAsset from "@/assets/logo-dbs-air.jpg.asset.json";

export const Route = createFileRoute("/_authenticated/portal")({
  head: () => ({ meta: [{ title: "Portal DBS Air" }, { name: "robots", content: "noindex" }] }),
  component: PortalPage,
});

const OCCURRENCE_TYPES = [
  "Emergência Térmica / Ar sem gelar",
  "Ruído / Vazamento",
  "Preventiva PMOC",
  "Solicitação de Laudo Técnico / ART",
];

function PortalPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const profile = useQuery({ queryKey: ["me"], queryFn: () => getMyProfile() });
  const tickets = useQuery({
    queryKey: ["my-tickets"],
    queryFn: () => listMyTickets(),
    enabled: !!profile.data,
  });

  useEffect(() => {
    // If super/admin lands here by mistake, forward.
    if (
      profile.data &&
      (profile.data.role_key === "SUPER_ADMIN" || profile.data.role_key === "ADMIN_OPERACIONAL")
    ) {
      navigate({ to: "/admin", replace: true });
    }
  }, [profile.data, navigate]);

  // If the account was suspended mid-session, sign out.
  useEffect(() => {
    const msg = profile.error instanceof Error ? profile.error.message : "";
    if (msg.includes("Acesso suspenso")) {
      (async () => {
        await qc.cancelQueries();
        qc.clear();
        await supabase.auth.signOut();
        navigate({ to: "/login", replace: true });
      })();
    }
  }, [profile.error, qc, navigate]);

  const [occurrence, setOccurrence] = useState(OCCURRENCE_TYPES[0]);
  const [desc, setDesc] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [ticketView, setTicketView] = useState<"active" | "closed">("active");

  const mut = useMutation({
    mutationFn: (input: { occurrence_type: string; description: string }) =>
      createTicket({ data: input }),
    onSuccess: (t) => {
      setMsg(`Chamado criado. Protocolo ${t.protocol_number}`);
      setDesc("");
      qc.invalidateQueries({ queryKey: ["my-tickets"] });
    },
    onError: (e) => setMsg(e instanceof Error ? e.message : "Falha ao criar chamado."),
  });

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/login", replace: true });
  }

  const unit = (profile.data as any)?.unit;
  const company = (profile.data as any)?.company;

  return (
    <div
      className="min-h-screen bg-slate-50"
      style={{ fontFamily: "'Inter',system-ui,sans-serif" }}
    >
      <header className="bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={logoAsset.url} alt="DBS Air" className="h-8 w-auto object-contain" />
            <span className="text-xs font-bold uppercase tracking-widest text-slate-500 hidden md:inline">
              Portal do Cliente
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm font-semibold text-slate-700 hidden sm:inline">
              {profile.data?.full_name ?? profile.data?.username ?? "Usuário"}
            </span>
            <button
              onClick={signOut}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900"
            >
              <LogOut className="w-4 h-4" /> Sair
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 pt-6">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-wrap items-center gap-x-8 gap-y-2">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
              Empresa
            </div>
            <div className="text-sm font-semibold text-slate-900">
              {company?.trade_name ?? company?.legal_name ?? "—"}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
              Unidade
            </div>
            <div className="text-sm font-semibold text-slate-900">{unit?.name ?? "—"}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
              CNPJ
            </div>
            <div className="text-sm font-mono text-slate-700">{unit?.cnpj ?? "—"}</div>
          </div>
          <div className="ml-auto text-[11px] text-slate-500">
            Contexto herdado da sessão autenticada. Não editável.
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-5 gap-8">
        <section className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-6 shadow-sm h-fit">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2 mb-1">
            <PlusCircle className="w-5 h-5" style={{ color: "#16A34A" }} /> Abrir novo chamado
          </h2>
          <p className="text-xs text-slate-500 mb-6">
            Endereço e dados da unidade herdados automaticamente do seu cadastro.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              mut.mutate({ occurrence_type: occurrence, description: desc });
            }}
            className="space-y-4"
          >
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-1.5 text-slate-800">
                Tipo de ocorrência
              </label>
              <select
                value={occurrence}
                onChange={(e) => setOccurrence(e.target.value)}
                className="w-full px-3 py-2.5 rounded-md border border-slate-300 text-sm"
              >
                {OCCURRENCE_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-1.5 text-slate-800">
                Descrição (mín. 20 caracteres)
              </label>
              <textarea
                required
                minLength={20}
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                rows={5}
                className="w-full px-3 py-2.5 rounded-md border border-slate-300 text-sm"
                placeholder="Descreva sintomas, criticidade e horário observado..."
              />
            </div>
            {msg && <div className="text-xs p-2.5 rounded-md bg-blue-50 text-blue-800">{msg}</div>}
            <button
              type="submit"
              disabled={mut.isPending}
              className="w-full inline-flex items-center justify-center gap-2 text-white px-4 py-2.5 rounded-md font-semibold text-sm disabled:opacity-60"
              style={{ background: "#16A34A" }}
            >
              {mut.isPending ? "Enviando..." : "Gerar Ordem de Serviço"}
            </button>
          </form>
        </section>

        <section className="lg:col-span-3 bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="p-6 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Ticket className="w-5 h-5" style={{ color: "#0284C7" }} /> Meus chamados
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Acompanhe o atendimento e o histórico das suas solicitações.
              </p>
            </div>
            <button
              onClick={() => tickets.refetch()}
              className="text-xs font-semibold text-slate-600 hover:text-slate-900 inline-flex items-center gap-1"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Atualizar
            </button>
          </div>
          <div className="flex gap-2 px-6 pb-4">
            <button
              onClick={() => setTicketView("active")}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition ${ticketView === "active" ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
            >
              <CircleDot className="h-3.5 w-3.5" /> Em andamento
            </button>
            <button
              onClick={() => setTicketView("closed")}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition ${ticketView === "closed" ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> Concluídos
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-600">
                <tr>
                  <th className="text-left px-4 py-3">Protocolo</th>
                  <th className="text-left px-4 py-3">Tipo</th>
                  <th className="text-left px-4 py-3 min-w-[260px]">Descrição do problema</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Aberto em</th>
                </tr>
              </thead>
              <tbody>
                {tickets.isLoading && (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-slate-500">
                      Carregando...
                    </td>
                  </tr>
                )}
                {tickets.data?.filter((t: any) =>
                  ticketView === "closed"
                    ? t.status === "concluido" || t.status === "cancelado"
                    : t.status !== "concluido" && t.status !== "cancelado",
                ).length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-slate-500">
                      Nenhum chamado nesta aba.
                    </td>
                  </tr>
                )}
                {tickets.data
                  ?.filter((t: any) =>
                    ticketView === "closed"
                      ? t.status === "concluido" || t.status === "cancelado"
                      : t.status !== "concluido" && t.status !== "cancelado",
                  )
                  .map((t: any) => {
                    const closed = t.status === "concluido" || t.status === "cancelado";
                    return (
                      <tr key={t.id} className="border-t border-slate-100 align-top">
                        <td className="px-4 py-3 font-mono text-xs">{t.protocol_number}</td>
                        <td className="px-4 py-3">{t.occurrence_type}</td>
                        <td className="px-4 py-3">
                          <p
                            className="max-w-[320px] whitespace-pre-wrap text-xs leading-5 text-slate-700"
                            title={t.description}
                          >
                            {t.description}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={t.status} />
                          {closed && (
                            <p className="text-[11px] text-slate-500 mt-1 max-w-[240px]">
                              Este chamado está encerrado. Caso o problema persista ou retorne, abra
                              um novo chamado.
                            </p>
                          )}
                          {t.status === "cancelado" && t.cancel_reason && (
                            <p className="text-[11px] text-red-700 mt-1 max-w-[240px]">
                              Motivo: {t.cancel_reason}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-500 text-xs">
                          {new Date(t.created_at).toLocaleString("pt-BR")}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    aberto: { bg: "#DBEAFE", fg: "#1D4ED8", label: "Aberto" },
    atribuido: { bg: "#FEF3C7", fg: "#B45309", label: "Atribuído" },
    em_atendimento: { bg: "#FEF3C7", fg: "#B45309", label: "Em atendimento" },
    em_rota: { bg: "#E0E7FF", fg: "#4338CA", label: "Em rota" },
    aguardando_peca: { bg: "#FEE2E2", fg: "#B91C1C", label: "Aguardando peça" },
    concluido: { bg: "#DCFCE7", fg: "#166534", label: "Concluído" },
    cancelado: { bg: "#F1F5F9", fg: "#475569", label: "Cancelado" },
  };
  const it = map[status] ?? { bg: "#F1F5F9", fg: "#334155", label: status };
  return (
    <span
      className="inline-block px-2 py-0.5 text-[11px] font-bold rounded"
      style={{ background: it.bg, color: it.fg }}
    >
      {it.label}
    </span>
  );
}
