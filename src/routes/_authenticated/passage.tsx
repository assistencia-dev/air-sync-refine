import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Loader2, Shield, WalletCards } from "lucide-react";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getMyProfile } from "@/lib/auth.functions";
import { createValePassageSsoUrl } from "@/lib/vale-passage.functions";

export const Route = createFileRoute("/_authenticated/passage")({
  head: () => ({
    meta: [{ title: "Controle de Passagem | DBS Air" }, { name: "robots", content: "noindex" }],
  }),
  component: ValePassageRoute,
});

function ValePassageRoute() {
  const navigate = useNavigate();
  const profile = useQuery({ queryKey: ["me"], queryFn: () => getMyProfile() });
  const [moduleUrl, setModuleUrl] = useState<string | null>(null);
  const launch = useMutation({
    mutationFn: () => createValePassageSsoUrl(),
    onSuccess: ({ url }) => setModuleUrl(url),
  });

  useEffect(() => {
    if (!profile.data) return;
    if (profile.data.username !== "DBSASSISTENCIA123") {
      navigate({ to: "/portal", replace: true });
      return;
    }
    launch.mutate();
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
          <Shield className="h-3.5 w-3.5" /> Sessão nativa DBS
        </span>
      </header>
      <main className="relative flex-1 p-2 sm:p-4">
        {!moduleUrl && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-[#f6f4ed] p-6">
            <div className="max-w-md text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-emerald-50 text-[#1E8F66]">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
              <h1 className="mt-5 text-xl font-bold text-slate-900">
                Abrindo Controle de Passagem
              </h1>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Validando sua sessão administrativa e conectando ao módulo original, sem mover os
                dados existentes.
              </p>
              {launch.error && (
                <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-xs font-semibold leading-5 text-red-700">
                  {launch.error instanceof Error
                    ? launch.error.message
                    : "Não foi possível abrir o módulo."}
                </p>
              )}
              {launch.error && (
                <button
                  onClick={() => launch.mutate()}
                  className="mt-4 rounded-lg bg-[#1E8F66] px-4 py-2 text-xs font-bold text-white"
                >
                  Tentar novamente
                </button>
              )}
            </div>
          </div>
        )}
        {moduleUrl && (
          <iframe
            title="Sistema de Vale Passagem"
            src={moduleUrl}
            className="h-[calc(100vh-5.5rem)] w-full rounded-xl border border-slate-200 bg-white shadow-sm"
            allow="storage-access"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        )}
      </main>
    </div>
  );
}
