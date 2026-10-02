import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMyProfile } from "@/lib/auth.functions";
import { hasMyPontoAccess } from "@/lib/ponto.functions";
import { hasMyDbsControlAccess } from "@/lib/rh.functions";
import { RhPontoEmployeePortal } from "@/components/RhPontoWorkspace";

export const Route = createFileRoute("/_authenticated/folha-ponto")({
  head: () => ({ meta: [{ title: "Folha de Ponto · DBS Air" }, { name: "robots", content: "noindex" }] }),
  component: FolhaPontoPage,
});

function FolhaPontoPage() {
  const navigate = useNavigate();
  const profile = useQuery({ queryKey: ["me"], queryFn: () => getMyProfile() });
  const access = useQuery({ queryKey: ["my-ponto-access"], queryFn: () => hasMyPontoAccess(), retry: false });
  const controlAccess = useQuery({ queryKey: ["my-dbs-control-access"], queryFn: () => hasMyDbsControlAccess(), retry: false });
  const isRh = profile.data?.role_key === "SUPER_ADMIN" || profile.data?.role_key === "ADMIN_OPERACIONAL" || ["DBS123", "DBSASSISTENCIA123"].includes(profile.data?.username ?? "");
  useEffect(() => {
    if (!profile.isLoading && !isRh && access.data && !access.data.enabled) navigate({ to: "/portal", replace: true });
  }, [profile.isLoading, isRh, access.data, navigate]);
  if (profile.isLoading || access.isLoading || controlAccess.isLoading) return <div className="min-h-screen grid place-items-center bg-slate-50 text-sm text-slate-500">Carregando Folha de Ponto...</div>;
  if (!isRh && !access.data?.enabled) return null;
  return (
    <main className="min-h-screen bg-[#f4f7f6] px-4 py-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-4 border-b border-slate-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[.2em] text-sky-600">DBS AIR · Portal do colaborador</p>
              <p className="mt-1 text-sm font-black text-slate-900">{profile.data?.full_name ?? profile.data?.username ?? "Colaborador"}</p>
            </div>
            <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
              <button type="button" className="rounded-lg bg-white px-4 py-2 text-xs font-black text-slate-900 shadow-sm">Folha de Ponto</button>
              {controlAccess.data?.enabled && (
                <button type="button" onClick={() => navigate({ to: "/dbs-control", replace: true })} className="rounded-lg px-4 py-2 text-xs font-black text-slate-600 transition hover:bg-white hover:text-slate-900">Minhas OS</button>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-[11px] font-bold text-slate-400 sm:px-6">
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">Sessão autenticada</span>
            <span>Use o menu acima para alternar entre sua jornada e suas ordens de serviço.</span>
          </div>
        </div>
        <RhPontoEmployeePortal />
      </div>
    </main>
  );
}

// Portal do colaborador: shell compartilhado com Folha de Ponto e DBS CONTROL.
