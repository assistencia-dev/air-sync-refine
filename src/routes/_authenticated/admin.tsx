import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut, RefreshCw, Shield } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getMyProfile } from "@/lib/auth.functions";
import { listAllTickets, updateTicketStatus } from "@/lib/tickets.functions";
import logoAsset from "@/assets/logo-dbs-air.jpg.asset.json";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "Admin DBS Air" }, { name: "robots", content: "noindex" }] }),
  component: AdminPage,
});

const STATUSES = ["aberto", "atribuido", "em_rota", "aguardando_peca", "concluido"];

function AdminPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const profile = useQuery({ queryKey: ["me"], queryFn: () => getMyProfile() });

  useEffect(() => {
    if (profile.data && profile.data.role_key !== "SUPER_ADMIN" && profile.data.role_key !== "ADMIN_OPERACIONAL") {
      navigate({ to: "/portal", replace: true });
    }
  }, [profile.data, navigate]);

  const tickets = useQuery({ queryKey: ["all-tickets"], queryFn: () => listAllTickets() });
  const mut = useMutation({
    mutationFn: (v: { id: string; status: string }) => updateTicketStatus({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["all-tickets"] }),
  });

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

      <main className="max-w-7xl mx-auto px-4 py-8">
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
      </main>
    </div>
  );
}
