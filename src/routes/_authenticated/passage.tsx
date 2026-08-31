import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ExternalLink, Shield, WalletCards } from "lucide-react";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMyProfile } from "@/lib/auth.functions";

const VALE_PASSAGEM_URL = "https://valepassagem-d8edi3fl.manus.space";

export const Route = createFileRoute("/_authenticated/passage")({
  head: () => ({
    meta: [{ title: "Controle de Passagem | DBS Air" }, { name: "robots", content: "noindex" }],
  }),
  component: ValePassageRoute,
});

export function ValePassageRoute() {
  const navigate = useNavigate();
  const profile = useQuery({ queryKey: ["me"], queryFn: () => getMyProfile() });

  useEffect(() => {
    if (profile.data && profile.data.username !== "DBSASSISTENCIA123") {
      navigate({ to: "/portal", replace: true });
    }
  }, [profile.data, navigate]);

  return (
    <div className="flex min-h-screen flex-col bg-[#f6f4ed]">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 shadow-sm sm:px-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate({ to: "/admin" })}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4" /> Voltar ao painel
          </button>
          <span className="hidden h-6 w-px bg-slate-200 sm:block" />
          <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[#1E8F66]">
            <WalletCards className="h-4 w-4" /> Controle de Passagem
          </span>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
          <Shield className="h-3.5 w-3.5" /> Acesso administrativo
        </span>
      </header>
      <main className="relative flex-1 p-2 sm:p-4">
        <div className="mb-2 flex items-center justify-between rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-2 text-xs text-emerald-800 sm:px-5">
          <span>
            <strong>Controle de Passagem</strong> · dados preservados no sistema original
          </span>
          <a
            href={VALE_PASSAGEM_URL}
            target="_blank"
            rel="noreferrer"
            className="hidden items-center gap-1 font-bold hover:underline sm:inline-flex"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Abrir em nova aba
          </a>
        </div>
        <iframe
          title="Sistema de Vale Passagem"
          src={VALE_PASSAGEM_URL}
          className="h-[calc(100vh-8.5rem)] min-h-[640px] w-full rounded-xl border border-slate-200 bg-white shadow-sm"
          allow="storage-access; notifications"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </main>
    </div>
  );
}
