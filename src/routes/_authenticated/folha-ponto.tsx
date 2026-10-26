import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getMyProfile } from "@/lib/admin-profile.functions";
import { hasMyPontoAccess } from "@/lib/ponto.functions";
import { hasMyDbsControlAccess } from "@/lib/rh.functions";
import { RhPontoEmployeePortal } from "@/components/RhPontoWorkspace";
import { EmployeeRhRequestsPanel } from "@/components/EmployeeRhRequestsPanel";
import { BrandLogo } from "@/components/BrandLogo";

export const Route = createFileRoute("/_authenticated/folha-ponto")({
  head: () => ({ meta: [{ title: "Folha de Ponto · DBS Air" }, { name: "robots", content: "noindex" }] }),
  component: FolhaPontoPage,
});

function FolhaPontoPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/login", replace: true });
  }
  const profile = useQuery({ queryKey: ["me"], queryFn: () => getMyProfile() });
  const access = useQuery({ queryKey: ["my-ponto-access"], queryFn: () => hasMyPontoAccess(), retry: 2, retryDelay: 700 });
  const controlAccess = useQuery({ queryKey: ["my-dbs-control-access"], queryFn: () => hasMyDbsControlAccess(), retry: 2, retryDelay: 700 });
  const isRh = profile.data?.role_key === "SUPER_ADMIN" || profile.data?.role_key === "ADMIN_OPERACIONAL" || ["DBS123", "DBSASSISTENCIA123"].includes(profile.data?.username ?? "");
  useEffect(() => {
    if (!profile.isLoading && !isRh && access.data && !access.data.enabled) {
      if (controlAccess.data?.enabled) navigate({ to: "/dbs-control", replace: true });
      else if (!controlAccess.isLoading && !controlAccess.error) navigate({ to: "/portal", replace: true });
    }
  }, [profile.isLoading, isRh, access.data, controlAccess.data, controlAccess.isLoading, controlAccess.error, navigate]);
  if (profile.isLoading || access.isLoading || controlAccess.isLoading) return <div className="collaborator-loading min-h-[100dvh] grid place-items-center bg-slate-50 px-5 text-center text-sm text-slate-500"><div><div className="mx-auto mb-3 h-8 w-8 animate-pulse rounded-full bg-sky-100" /><p className="font-bold text-slate-700">Preparando seu portal</p><p className="mt-1 text-xs text-slate-400">Validando seus acessos de colaborador…</p></div></div>;
  if (!isRh && (access.isError || (!access.data?.enabled && controlAccess.isError))) return <main className="collaborator-shell grid min-h-[100dvh] place-items-center bg-[#f4f7f6] px-3 py-3 sm:px-4 sm:py-5"><div className="w-full max-w-md rounded-3xl border border-amber-200 bg-white p-6 text-center shadow-sm sm:p-8"><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-amber-50 text-amber-600">!</div><h1 className="mt-4 text-xl font-black text-slate-900">Não foi possível preparar seu portal</h1><p className="mt-2 text-sm leading-6 text-slate-500">A validação de acesso demorou ou falhou momentaneamente. Nenhum dado foi alterado.</p><div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center"><button type="button" onClick={() => { void profile.refetch(); void access.refetch(); void controlAccess.refetch(); }} className="min-h-11 rounded-xl bg-sky-600 px-4 py-3 text-sm font-black text-white hover:bg-sky-700">Tentar novamente</button><button type="button" onClick={signOut} className="min-h-11 rounded-xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-700 hover:border-sky-200">Sair</button></div></div></main>;
  if (!isRh && !access.data?.enabled) return null;
  return (
    <main className="collaborator-shell min-h-[100dvh] bg-[#f4f7f6] px-3 py-3 sm:px-4 sm:py-5 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="collaborator-topbar mb-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm sm:mb-5">
          <div className="flex flex-col gap-3 border-b border-slate-100 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-4">
            <div className="flex min-w-0 items-center gap-3">
              <BrandLogo frameClassName="rounded-lg px-2 py-1" imageClassName="h-8 w-auto max-w-[160px] object-contain" />
              <div className="min-w-0">
                <p className="text-[9px] font-black uppercase tracking-[.16em] text-sky-700">Portal do colaborador</p>
                <p className="mt-1 truncate text-sm font-black text-slate-900">{profile.data?.full_name ?? profile.data?.username ?? "Colaborador"}</p>
              </div>
            </div>
            <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end"><div className="flex min-w-0 flex-1 items-center gap-1 rounded-xl bg-slate-100 p-1 sm:flex-none">
              <button type="button" aria-current="page" className="min-h-10 flex-1 rounded-lg bg-white px-3 py-2 text-[11px] font-black text-slate-900 shadow-sm sm:flex-none sm:px-4">Folha de Ponto</button>
              {controlAccess.data?.enabled && (
                <button type="button" onClick={() => navigate({ to: "/dbs-control", replace: true })} className="min-h-10 flex-1 rounded-lg px-3 py-2 text-[11px] font-black text-slate-600 transition hover:bg-white hover:text-slate-900 sm:flex-none sm:px-4">Minhas OS</button>
              )}
              </div>
              <button type="button" onClick={signOut} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-bold text-slate-700 shadow-sm transition hover:border-blue-200 hover:text-blue-800"><LogOut className="h-4 w-4" /> <span className="hidden sm:inline">Sair</span></button>
            </div>
          </div>
          <div className="collaborator-session-note flex flex-wrap items-center gap-2 px-3 py-2.5 text-[11px] font-bold text-slate-400 sm:px-6">
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">Sessão autenticada</span>
            <span>Alterne entre jornada e ordens de serviço no menu acima.</span>
          </div>
        </div>
        <RhPontoEmployeePortal />
        {!isRh && <EmployeeRhRequestsPanel />}
      </div>
    </main>
  );
}

// Portal do colaborador: shell compartilhado com Folha de Ponto e DBS CONTROL.
