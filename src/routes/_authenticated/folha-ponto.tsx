import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";\nimport { ShieldAlert } from "lucide-react";
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
  if (access.isError && !isRh) {
    return (
      <main className="min-h-screen grid place-items-center bg-slate-50 p-6">
        <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 text-center shadow-sm">
          <ShieldAlert className="mx-auto h-10 w-10 text-amber-500" />
          <h1 className="mt-3 text-xl font-black text-slate-900">Não foi possível carregar seu acesso</h1>
          <p className="mt-2 text-sm text-slate-500">{access.error instanceof Error ? access.error.message : "O RH precisa liberar a Folha de Ponto para este usuário."}</p>
          <button onClick={() => navigate({ to: "/portal", replace: true })} className="mt-5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-black text-white">Voltar ao Portal</button>
        </section>
      </main>
    );
  }
  if (!isRh && !access.data?.enabled) {
    return (
      <main className="min-h-screen grid place-items-center bg-slate-50 p-6">
        <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 text-center shadow-sm">
          <h1 className="text-xl font-black text-slate-900">Folha de Ponto não liberada</h1>
          <p className="mt-2 text-sm text-slate-500">O RH ainda não liberou este acesso para o seu funcionário.</p>
          <button onClick={() => navigate({ to: "/portal", replace: true })} className="mt-5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-black text-white">Voltar ao Portal</button>
        </section>
      </main>
    );
  }
  return (
    <main className="min-h-screen bg-[#f4f7f6] px-4 py-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
          <div className="px-2 text-xs font-black uppercase tracking-wider text-slate-500">Portal do colaborador</div>
          <div className="flex gap-1">
            <button className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-black text-white">Folha de Ponto</button>
            {controlAccess.data?.enabled && (
              <button onClick={() => navigate({ to: "/dbs-control" })} className="rounded-lg px-3 py-2 text-xs font-black text-emerald-700 hover:bg-emerald-50">
                DBS CONTROL
              </button>
            )}
          </div>
        </div>
        <RhPontoEmployeePortal />
      </div>
    </main>
  );
}
