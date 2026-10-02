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
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
          <div className="px-2 text-xs font-black uppercase tracking-wider text-slate-500">Portal do colaborador</div>
          <div className="flex gap-1">
            <button className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-black text-white">Folha de Ponto</button>
            {controlAccess.data?.enabled && (
              <button
                type="button"
                onClick={() => navigate({ to: "/dbs-control", replace: true })}
                className="rounded-lg px-3 py-2 text-xs font-black text-emerald-700 hover:bg-emerald-50"
              >
                Minhas OS
              </button>
            )}
          </div>
        </div>
        <RhPontoEmployeePortal />
      </div>
    </main>
  );
}
