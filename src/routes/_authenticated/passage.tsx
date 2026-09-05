import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Shield } from "lucide-react";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMyProfile } from "@/lib/auth.functions";
import { HrWorkspace } from "@/components/HrWorkspace";
import logoAsset from "@/assets/logo-dbs-air.jpg.asset.json";

const NATIVE_ADMIN_USERNAMES = new Set(["DBS123", "DBSASSISTENCIA123"]);

export const Route = createFileRoute("/_authenticated/passage")({
  head: () => ({ meta: [{ title: "RH | DBS Air" }, { name: "robots", content: "noindex" }] }),
  component: HrRoute,
});

export function HrRoute() {
  const navigate = useNavigate();
  const profile = useQuery({ queryKey: ["me"], queryFn: () => getMyProfile() });

  useEffect(() => {
    if (profile.data && !NATIVE_ADMIN_USERNAMES.has(profile.data.username ?? "")) {
      navigate({ to: "/portal", replace: true });
    }
  }, [profile.data, navigate]);

  return (
    <div
      className="flex min-h-screen flex-col bg-[#090D16]"
      style={{ fontFamily: "'Inter',system-ui,sans-serif" }}
    >
      <header className="flex h-[72px] shrink-0 items-center justify-between border-b border-slate-800 bg-[#0F172A]/90 px-4 shadow-sm backdrop-blur sm:px-6">
        <div className="flex items-center gap-3">
          <img
            src={logoAsset.url}
            alt="DBS Air"
            className="h-10 w-auto max-w-[190px] object-contain"
          />
          <span className="hidden h-7 w-px bg-slate-700 sm:block" />
          <span className="text-xs font-bold uppercase tracking-widest text-[#F59E0B]">
            Módulo RH
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300 sm:inline-flex">
            <Shield className="h-3.5 w-3.5" /> Acesso administrativo
          </span>
          <button
            onClick={() => navigate({ to: "/admin" })}
            className="inline-flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-bold text-slate-300 transition hover:bg-slate-800 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" /> Voltar ao painel
          </button>
        </div>
      </header>
      <main className="flex-1 p-4 sm:p-6">
        <div className="mx-auto max-w-[1480px]">
          <HrWorkspace />
        </div>
      </main>
    </div>
  );
}
