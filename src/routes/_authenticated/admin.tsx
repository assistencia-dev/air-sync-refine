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
  const [cancelTarget, setCancelTarget] = useState<{ id: string; protocol: string } | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [actionErr, setActionErr] = useState<string | null>(null);

  const reload = () => qc.invalidateQueries({ queryKey: ["all-tickets"] });
  const onErr = (e: unknown) => setActionErr(e instanceof Error ? e.message : "Falha na operação.");

  const mut = useMutation({
    mutationFn: (v: { id: string; status: string }) => updateTicketStatus({ data: v }),
    onSuccess: () => { setActionErr(null); reload(); },
    onError: onErr,
  });
  const assume = useMutation({
    mutationFn: (id: string) => assumeTicket({ data: { id } }),
    onSuccess: () => { setActionErr(null); reload(); },
    onError: onErr,
  });
  const complete = useMutation({
    mutationFn: (v: { id: string; asset_id: string | null }) => completeTicket({ data: v }),
    onSuccess: () => { setActionErr(null); reload(); },
    onError: onErr,
  });
  const cancel = useMutation({
    mutationFn: (v: { id: string; reason: string }) => cancelTicket({ data: v }),
    onSuccess: () => { setActionErr(null); setCancelTarget(null); setCancelReason(""); reload(); },
    onError: onErr,
  });

  const busy = assume.isPending || complete.isPending || cancel.isPending;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
      <div className="p-6 border-b border-slate-200 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Central de Chamados (Visão Global)</h2>
          <p className="text-xs text-slate-500 mt-0.5">Assuma, conclua ou cancele ordens de serviço. Não há reabertura de chamados encerrados.</p>
        </div>
        <button onClick={() => tickets.refetch()} className="text-xs font-semibold text-slate-600 hover:text-slate-900 inline-flex items-center gap-1">
          <RefreshCw className="w-3.5 h-3.5" /> Atualizar
        </button>
      </div>
      {actionErr && <div className="mx-6 mt-4 text-xs p-2.5 rounded-md" style={{ background: "#FEF2F2", color: "#B91C1C" }}>{actionErr}</div>}
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
              <th className="text-right px-4 py-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            {tickets.isLoading && <tr><td colSpan={7} className="p-6 text-center text-slate-500">Carregando...</td></tr>}
            {tickets.data?.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-slate-500">Nenhum chamado.</td></tr>}
            {tickets.data?.map((t: any) => {
              const closed = t.status === "concluido" || t.status === "cancelado";
              return (
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
                    {t.assumed_by && (
                      <div className="mt-1 text-[11px] text-slate-500">
                        Assumido por {t.assumed?.full_name ?? t.assumed?.username ?? "administrador"}
                        {t.assumed_at ? ` em ${new Date(t.assumed_at).toLocaleString("pt-BR")}` : ""}
                      </div>
                    )}
                    {t.status === "cancelado" && t.cancel_reason && (
                      <div className="mt-1 text-[11px] text-red-700">Motivo: {t.cancel_reason}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{new Date(t.created_at).toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col items-end gap-1.5">
                      {t.status === "aberto" && (
                        <button
                          disabled={busy}
                          onClick={() => assume.mutate(t.id)}
                          className="text-xs font-semibold px-3 py-1.5 rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap"
                        >
                          Assumir Chamado
                        </button>
                      )}
                      {(t.status === "em_atendimento" || t.status === "aguardando_peca" || t.status === "atribuido" || t.status === "em_rota") && (
                        <button
                          disabled={busy}
                          onClick={() => complete.mutate({ id: t.id, asset_id: t.asset_id ?? null })}
                          className="text-xs font-semibold px-3 py-1.5 rounded-md text-white bg-green-600 hover:bg-green-700 disabled:opacity-60 whitespace-nowrap"
                        >
                          Concluir Chamado
                        </button>
                      )}
                      {!closed && (
                        <button
                          disabled={busy}
                          onClick={() => { setCancelReason(""); setActionErr(null); setCancelTarget({ id: t.id, protocol: t.protocol_number }); }}
                          className="text-xs font-semibold px-3 py-1.5 rounded-md border border-red-600 text-red-700 hover:bg-red-50 disabled:opacity-60 whitespace-nowrap"
                        >
                          Cancelar Chamado
                        </button>
                      )}
                      {closed && <span className="text-xs text-slate-400">Encerrado</span>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {cancelTarget && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !cancel.isPending && setCancelTarget(null)}>
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-900">Cancelar chamado {cancelTarget.protocol}</h3>
            <p className="mt-2 text-sm text-slate-600">Informe a justificativa (mínimo 10 caracteres). Esta ação é definitiva.</p>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              rows={4}
              className="mt-3 w-full text-sm px-3 py-2 rounded-md border border-slate-300"
              placeholder="Ex: Cliente informou que o equipamento foi substituído."
            />
            {actionErr && <div className="mt-3 text-xs p-2.5 rounded-md" style={{ background: "#FEF2F2", color: "#B91C1C" }}>{actionErr}</div>}
            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                onClick={() => setCancelTarget(null)}
                disabled={cancel.isPending}
                className="text-xs font-semibold px-4 py-2 rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50"
              >
                Voltar
              </button>
              <button
                onClick={() => cancel.mutate({ id: cancelTarget.id, reason: cancelReason })}
                disabled={cancel.isPending}
                className="text-xs font-semibold px-4 py-2 rounded-md text-white bg-red-600 hover:bg-red-700 disabled:opacity-60"
              >
                {cancel.isPending ? "Cancelando..." : "Confirmar cancelamento"}
              </button>
            </div>
          </div>
        </div>
      )}
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

      {showCreate && isSuperAdmin && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onCreated={() => qc.invalidateQueries({ queryKey: ["all-users"] })}
        />
      )}
    </div>
  );
}

function generatePassword(len = 12) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  for (let i = 0; i < len; i++) out += chars[arr[i] % chars.length];
  return out;
}

function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const cu = useQuery({ queryKey: ["companies-units"], queryFn: () => listCompaniesUnits() });
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [cpf, setCpf] = useState("");
  const [roleKey, setRoleKey] = useState<"GESTOR_CONTA" | "GESTOR_REGIONAL" | "CLIENTE_PF">("CLIENTE_PF");
  const [companyId, setCompanyId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [password, setPassword] = useState(() => generatePassword());
  const [isUnitManager, setIsUnitManager] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ email: string; password: string } | null>(null);

  const filteredUnits = (cu.data?.units ?? []).filter((u: any) => !companyId || u.company_id === companyId);

  const mut = useMutation({
    mutationFn: () =>
      createClientUser({
        data: {
          full_name: fullName,
          email,
          cpf: cpf || undefined,
          role_key: roleKey,
          unit_id: unitId || null,
          company_id: companyId || null,
          password,
          is_unit_manager: isUnitManager,
        },
      }),
    onSuccess: (r) => {
      setSuccess({ email: r.email, password });
      setErr(null);
      onCreated();
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "Falha ao criar acesso."),
  });

  if (success) {
    return (
      <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl">
          <h3 className="text-lg font-bold text-slate-900">Acesso criado com sucesso</h3>
          <p className="mt-2 text-sm text-slate-600">
            Copie e envie ao cliente. A senha temporária não será exibida novamente.
          </p>
          <div className="mt-4 space-y-2">
            <div className="p-3 rounded-md bg-slate-50 border border-slate-200 text-sm">
              <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Login (e-mail)</div>
              <div className="font-mono">{success.email}</div>
            </div>
            <div className="p-3 rounded-md bg-slate-50 border border-slate-200 text-sm">
              <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Senha temporária</div>
              <div className="font-mono">{success.password}</div>
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <button
              onClick={() => {
                navigator.clipboard.writeText(`Login: ${success.email}\nSenha: ${success.password}`);
              }}
              className="text-xs font-semibold px-4 py-2 rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50"
            >
              Copiar credenciais
            </button>
            <button
              onClick={onClose}
              className="text-xs font-semibold px-4 py-2 rounded-md text-white bg-blue-600 hover:bg-blue-700"
            >
              Concluir
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => !mut.isPending && onClose()}>
      <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-slate-900">Novo Acesso</h3>
        <p className="mt-1 text-xs text-slate-500">Crie o login de um cliente vinculado a uma empresa/unidade.</p>

        <div className="mt-4 grid grid-cols-1 gap-3">
          <Field label="Nome completo *">
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputCls} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="E-mail *">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
            </Field>
            <Field label="CPF (opcional)">
              <input value={cpf} onChange={(e) => setCpf(e.target.value)} className={inputCls} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Papel *">
              <select value={roleKey} onChange={(e) => setRoleKey(e.target.value as any)} className={inputCls}>
                <option value="CLIENTE_PF">CLIENTE_PF</option>
                <option value="GESTOR_CONTA">GESTOR_CONTA</option>
                <option value="GESTOR_REGIONAL">GESTOR_REGIONAL</option>
              </select>
            </Field>
            <Field label="Empresa">
              <select value={companyId} onChange={(e) => { setCompanyId(e.target.value); setUnitId(""); }} className={inputCls}>
                <option value="">—</option>
                {cu.data?.companies?.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.trade_name ?? c.legal_name}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Unidade / Loja">
            <select value={unitId} onChange={(e) => setUnitId(e.target.value)} className={inputCls}>
              <option value="">—</option>
              {filteredUnits.map((u: any) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </Field>
          <label className="inline-flex items-center gap-2 text-xs text-slate-700">
            <input type="checkbox" checked={isUnitManager} onChange={(e) => setIsUnitManager(e.target.checked)} />
            Gestor da unidade (pode ver chamados dos colegas da unidade)
          </label>
          <Field label="Senha temporária">
            <div className="flex gap-2">
              <input value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls + " font-mono"} />
              <button
                type="button"
                onClick={() => setPassword(generatePassword())}
                className="text-xs font-semibold px-3 rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                Gerar
              </button>
            </div>
          </Field>
        </div>

        {err && <div className="mt-3 text-xs p-2.5 rounded-md" style={{ background: "#FEF2F2", color: "#B91C1C" }}>{err}</div>}

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={mut.isPending}
            className="text-xs font-semibold px-4 py-2 rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            onClick={() => mut.mutate()}
            disabled={mut.isPending}
            className="text-xs font-semibold px-4 py-2 rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60"
          >
            {mut.isPending ? "Criando..." : "Criar Acesso"}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputCls = "w-full text-sm px-3 py-2 rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-600 mb-1">{label}</label>
      {children}
    </div>
  );
}
