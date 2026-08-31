import { createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, ExternalLink, Shield, Utensils, WalletCards } from "lucide-react";
import { useEffect, useState } from "react";
import { RhBenefitPanel } from "@/components/RhBenefitPanel";
import { useQuery } from "@tanstack/react-query";
import { getMyProfile } from "@/lib/auth.functions";

const VALE_PASSAGEM_URL = "https://valepassagem-d8edi3fl.manus.space";
const NATIVE_ADMIN_USERNAMES = new Set(["DBS123", "DBSASSISTENCIA123"]);

export const Route = createFileRoute("/_authenticated/passage")({
  head: () => ({ meta: [{ title: "RH | DBS Air" }, { name: "robots", content: "noindex" }] }),
  component: HrRoute,
});

export function HrRoute() {
  const navigate = useNavigate();
  const profile = useQuery({ queryKey: ["me"], queryFn: () => getMyProfile() });
  const [benefit, setBenefit] = useState<"passagem" | "alimentacao">("passagem");

  useEffect(() => {
    if (profile.data && !NATIVE_ADMIN_USERNAMES.has(profile.data.username)) {
      navigate({ to: "/portal", replace: true });
    }
  }, [profile.data, navigate]);

  return (
    <div className="flex min-h-screen flex-col bg-[#f5f7f6]">
      <header className="flex h-[72px] shrink-0 items-center justify-between border-b border-slate-200 bg-white/95 px-4 shadow-sm backdrop-blur sm:px-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate({ to: "/admin" })}
            className="inline-flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4" /> Voltar ao painel
          </button>
          <span className="hidden h-7 w-px bg-slate-200 sm:block" />
          <span className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-[.18em] text-[#1E8F66]">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#102b3b] text-[10px] text-white">
              DBS
            </span>{" "}
            RH
          </span>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
          <Shield className="h-3.5 w-3.5" /> Acesso administrativo
        </span>
      </header>
      <main className="relative flex-1 p-3 sm:p-5">
        <div className="mx-auto max-w-[1600px]">
          <div className="mb-4 flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[.2em] text-slate-400">
                Área de trabalho
              </p>
              <h1 className="mt-1 text-xl font-black tracking-tight text-[#102b3b]">
                Recargas e benefícios
              </h1>
              <p className="mt-1 text-xs text-slate-500">
                Gestão de benefícios do colaborador, dentro do portal DBS.
              </p>
            </div>
            <nav className="flex flex-wrap gap-2" aria-label="Benefícios de RH">
              <button
                onClick={() => setBenefit("passagem")}
                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition ${benefit === "passagem" ? "bg-[#102b3b] text-white shadow-md" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
              >
                <WalletCards className="h-4 w-4" /> Vale Passagem
              </button>
              <button
                onClick={() => setBenefit("alimentacao")}
                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition ${benefit === "alimentacao" ? "bg-[#f7c945] text-[#102b3b] shadow-md" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
              >
                <Utensils className="h-4 w-4" /> Vale Alimentação
              </button>
            </nav>
          </div>
          {benefit === "alimentacao" ? (
            <RhBenefitPanel benefitType="alimentacao" />
          ) : (
            <div>
              <div className="mb-2 flex items-center justify-between rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-2 text-xs text-emerald-800 sm:px-5">
                <span>
                  <strong>Vale Passagem</strong> · sistema original preservado
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
                className="h-[calc(100vh-13.5rem)] min-h-[640px] w-full rounded-xl border border-slate-200 bg-white shadow-sm"
                allow="storage-access; notifications"
                referrerPolicy="strict-origin-when-cross-origin"
              />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
