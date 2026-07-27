import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut, RefreshCw, Shield, Ticket, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getMyProfile } from "@/lib/auth.functions";
import { listAllTickets, updateTicketStatus } from "@/lib/tickets.functions";
import { listAllUsers, setUserStatus, listCompaniesUnits, createClientUser } from "@/lib/admin.functions";
import logoAsset from "@/assets/logo-dbs-air.jpg.asset.json";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "Admin DBS Air" }, { name: "robots", content: "noindex" }] }),
  component: AdminPage,
});

const STATUSES = ["aberto", "atribuido", "em_rota", "aguardando_peca", "concluido"];

function AdminPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"tickets" | "users">("tickets");
  const profile = useQuery({ queryKey: ["me"], queryFn: () => getMyProfile() });

  useEffect(() => {
    if (profile.data && profile.data.role_key !== "SUPER_ADMIN" && profile.data.role_key !== "ADMIN_OPERACIONAL") {
      navigate({ to: "/portal", replace: true });
    }
  }, [profile.data, navigate]);

  const isSuperAdmin = profile.data?.role_key === "SUPER_ADMIN";

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/login", replace: true });
  }

  return (
    <div className="min-h-screen bg-slate-50" style={{ fontFamily: "'Inter',system-ui,sans-serif" }}>
      <header className="bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={logoAsset.url} alt="DBS Air" className="h-8 w-auto object-contain" />
            <span className="text-xs font-bold uppercase tracking-widest inline-flex items-center gap-1.5" style={{ color: "#0284C7" }}>
              <Shield className="w-3.5 h-3.5" /> Painel Administrativo
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm font-semibold text-slate-700 hidden sm:inline">
              {profile.data?.full_name ?? profile.data?.username}
            </span>
            <button onClick={signOut} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900">
              <LogOut className="w-4 h-4" /> Sair
            </button>
          </div>
        </div>
      </header>

      {profile.data?.username === "DBSASSISTENCIA123" && (
        <div className="max-w-7xl mx-auto px-4 pt-4">
          <div className="rounded-md p-3 text-xs" style={{ background: "#FEF3C7", color: "#78350F", border: "1px solid #FCD34D" }}>
            <strong>Aviso de segurança:</strong> Recomenda-se trocar a senha padrão deste usuário administrador após o primeiro acesso.
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 pt-6 flex gap-2 border-b border-slate-200">
        <TabBtn active={tab === "tickets"} onClick={() => setTab("tickets")} icon={<Ticket className="w-3.5 h-3.5" />} label="Chamados" />
        <TabBtn active={tab === "users"} onClick={() => setTab("users")} icon={<Users className="w-3.5 h-3.5" />} label="Usuários Vinculados" />
      </div>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {tab === "tickets" ? <TicketsPanel /> : <UsersPanel isSuperAdmin={isSuperAdmin} />}
      </main>
    </div>
  );
}

function TabBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-t-md border-b-2 -mb-px transition ${active ? "border-blue-600 text-blue-700 bg-white" : "border-transparent text-slate-500 hover:text-slate-800"}`}
    >
      {icon} {label}
    </button>
  );
}

function TicketsPanel() {
  const qc = useQueryClient();
  const tickets = useQuery({ queryKey: ["all-tickets"], queryFn: () => listAllTickets() });
  const mut = useMutation({
    mutationFn: (v: { id: string; status: string }) => updateTicketStatus({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["all-tickets"] }),
  });

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
      <div className="p-6 border-b border-slate-200 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Central de Chamados (Visão Global)</h2>
          <p className="text-xs text-slate-500 mt-0.5">Todos os chamados de todas as unidades. Altere status inline.</p>
        </div>
        <button onClick={() => tickets.refetch()} className="text-xs font-semibold text-slate-600 hover:text-slate-900 inline-flex items-center gap-1">
          <RefreshCw className="w-3.5 h-3.5" /> Atualizar
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-600">
            <tr>
              <th className="text-left px-4 py-3">Protocolo</th>
              <th className="text-left px-4 py-3">Tipo</th>
              <th className="text-left px-4 py-3">Unidade</th>
              <th className="text-left px-4 py-3">Aberto por</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Aberto em</th>
            </tr>
          </thead>
          <tbody>
            {tickets.isLoading && <tr><td colSpan={6} className="p-6 text-center text-slate-500">Carregando...</td></tr>}
            {tickets.data?.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-slate-500">Nenhum chamado.</td></tr>}
            {tickets.data?.map((t: any) => (
              <tr key={t.id} className="border-t border-slate-100 align-top">
                <td className="px-4 py-3 font-mono text-xs">{t.protocol_number}</td>
                <td className="px-4 py-3">{t.occurrence_type}</td>
                <td className="px-4 py-3 text-xs">{t.unit?.name ?? "—"}</td>
                <td className="px-4 py-3 text-xs">{t.users?.full_name ?? t.users?.username ?? "—"}</td>
                <td className="px-4 py-3">
                  <select
                    value={t.status}
                    onChange={(e) => mut.mutate({ id: t.id, status: e.target.value })}
                    className="text-xs px-2 py-1 rounded border border-slate-300"
                  >
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                <td className="px-4 py-3 text-slate-500 text-xs">{new Date(t.created_at).toLocaleString("pt-BR")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UsersPanel({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ["all-users"], queryFn: () => listAllUsers() });
  const [confirm, setConfirm] = useState<{ id: string; name: string; nextStatus: "ativo" | "bloqueado" } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const mut = useMutation({
    mutationFn: (v: { user_id: string; status: "ativo" | "bloqueado" }) => setUserStatus({ data: v }),
    onSuccess: () => {
      setConfirm(null);
      setErr(null);
      qc.invalidateQueries({ queryKey: ["all-users"] });
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "Falha na operação."),
  });

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
      <div className="p-6 border-b border-slate-200 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Usuários Vinculados</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {isSuperAdmin ? "Somente SUPER_ADMIN pode criar, ativar ou desativar acessos." : "Visualização apenas — gestão restrita ao SUPER_ADMIN."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isSuperAdmin && (
            <button
              onClick={() => setShowCreate(true)}
              className="text-xs font-semibold px-3 py-1.5 rounded-md text-white bg-blue-600 hover:bg-blue-700"
            >
              + Novo Acesso
            </button>
          )}
          <button onClick={() => users.refetch()} className="text-xs font-semibold text-slate-600 hover:text-slate-900 inline-flex items-center gap-1">
            <RefreshCw className="w-3.5 h-3.5" /> Atualizar
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-600">
            <tr>
              <th className="text-left px-4 py-3">Nome</th>
              <th className="text-left px-4 py-3">Usuário / E-mail</th>
              <th className="text-left px-4 py-3">Papel</th>
              <th className="text-left px-4 py-3">Empresa / Unidade</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-right px-4 py-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            {users.isLoading && <tr><td colSpan={6} className="p-6 text-center text-slate-500">Carregando...</td></tr>}
            {users.data?.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-slate-500">Nenhum usuário.</td></tr>}
            {users.data?.map((u: any) => {
              const blocked = u.status !== "ativo";
              return (
                <tr key={u.id} className="border-t border-slate-100 align-top">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    <div className="flex items-center gap-2">
                      <span>{u.full_name ?? "—"}</span>
                      {blocked && <span className="inline-block px-2 py-0.5 text-[10px] font-bold rounded bg-slate-200 text-slate-700">Bloqueado</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    <div>{u.username ?? "—"}</div>
                    <div className="text-slate-400">{u.email ?? "—"}</div>
                  </td>
                  <td className="px-4 py-3 text-xs">{u.role_key}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    <div>{u.company?.trade_name ?? u.company?.legal_name ?? "—"}</div>
                    <div className="text-slate-400">{u.unit?.name ?? "—"}</div>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <span className={`inline-block px-2 py-0.5 font-bold rounded ${blocked ? "bg-slate-200 text-slate-700" : "bg-green-100 text-green-800"}`}>
                      {blocked ? "Bloqueado" : "Ativo"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {isSuperAdmin ? (
                      blocked ? (
                        <button
                          onClick={() => setConfirm({ id: u.id, name: u.full_name ?? u.username ?? "usuário", nextStatus: "ativo" })}
                          className="text-xs font-semibold px-3 py-1.5 rounded-md border border-green-600 text-green-700 hover:bg-green-50"
                        >
                          Reativar
                        </button>
                      ) : (
                        <button
                          onClick={() => setConfirm({ id: u.id, name: u.full_name ?? u.username ?? "usuário", nextStatus: "bloqueado" })}
                          className="text-xs font-semibold px-3 py-1.5 rounded-md border border-red-600 text-red-700 hover:bg-red-50"
                        >
                          Desativar
                        </button>
                      )
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {confirm && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !mut.isPending && setConfirm(null)}>
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-900">
              {confirm.nextStatus === "bloqueado" ? "Desativar acesso" : "Reativar acesso"}
            </h3>
            <p className="mt-3 text-sm text-slate-600">
              {confirm.nextStatus === "bloqueado"
                ? <>Tem certeza que deseja suspender o acesso de <strong>{confirm.name}</strong>? Ele não poderá mais fazer login nem abrir novos chamados.</>
                : <>Deseja reativar o acesso de <strong>{confirm.name}</strong>? Ele voltará a acessar o portal normalmente.</>}
            </p>
            {err && <div className="mt-3 text-xs p-2.5 rounded-md" style={{ background: "#FEF2F2", color: "#B91C1C" }}>{err}</div>}
            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                onClick={() => setConfirm(null)}
                disabled={mut.isPending}
                className="text-xs font-semibold px-4 py-2 rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                onClick={() => mut.mutate({ user_id: confirm.id, status: confirm.nextStatus })}
                disabled={mut.isPending}
                className={`text-xs font-semibold px-4 py-2 rounded-md text-white disabled:opacity-60 ${confirm.nextStatus === "bloqueado" ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700"}`}
              >
                {mut.isPending ? "Processando..." : confirm.nextStatus === "bloqueado" ? "Confirmar desativação" : "Confirmar reativação"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
