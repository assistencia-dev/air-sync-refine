import { createFileRoute } from '@tanstack/react-router'
import { ArrowLeft, ExternalLink, Shield, Utensils, WalletCards } from "lucide-react";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMyProfile } from "@/lib/auth.functions";

const VALE_PASSAGEM_URL = "https://valepassagem-d8edi3fl.manus.space";

type Benefit = "passagem" | "alimentacao";

export const Route = createFileRoute("/_authenticated/passage")({
  head: () => ({ meta: [{ title: "RH | DBS Air" }, { name: "robots", content: "noindex" }] }),
  component: HrRoute,
});

export function HrRoute() {
  const navigate = useNavigate();
  const [benefit, setBenefit] = useState<Benefit>("passagem");
  const profile = useQuery({ queryKey: ["me"], queryFn: () => getMyProfile() });

  useEffect(() => {
    if (profile.data && profile.data.username !== "DBSASSISTENCIA123") {
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
            <nav className="flex gap-2" aria-label="Benefícios de RH">
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
          {benefit === "passagem" ? (
            <div>
              <div className="mb-2 flex items-center justify-between rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-2 text-xs text-emerald-800 sm:px-5">
                <span>
                  <strong>Vale Passagem</strong> · dados preservados no sistema original
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
          ) : (
            <FoodBenefitPanel />
          )}
        </div>
      </main>
    </div>
  );
}

function FoodBenefitPanel() {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="bg-gradient-to-br from-[#102b3b] via-[#1b4b55] to-[#f7c945] px-6 py-10 text-white sm:px-10">
        <div className="flex max-w-3xl items-start justify-between gap-6">
          <div>
            <span className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[.2em] text-amber-200">
              <Utensils className="h-4 w-4" /> Novo benefício de RH
            </span>
            <h2 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">
              Vale Alimentação
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-white/75">
              A mesma experiência de gestão do Vale Passagem, preparada para organizar benefícios de
              alimentação.
            </p>
          </div>
          <div className="hidden rounded-2xl border border-white/15 bg-white/10 p-4 sm:block">
            <Utensils className="h-9 w-9 text-amber-200" />
          </div>
        </div>
      </div>
      <div className="grid gap-4 p-6 sm:grid-cols-3 sm:p-10">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
          <p className="text-[10px] font-black uppercase tracking-[.16em] text-slate-400">
            Colaboradores
          </p>
          <p className="mt-3 text-2xl font-black text-[#102b3b]">—</p>
          <p className="mt-1 text-xs text-slate-500">Aguardando conexão do cadastro RH.</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
          <p className="text-[10px] font-black uppercase tracking-[.16em] text-slate-400">
            Recargas
          </p>
          <p className="mt-3 text-2xl font-black text-[#102b3b]">—</p>
          <p className="mt-1 text-xs text-slate-500">Fluxo preparado para a próxima etapa.</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
          <p className="text-[10px] font-black uppercase tracking-[.16em] text-slate-400">
            Histórico
          </p>
          <p className="mt-3 text-2xl font-black text-[#102b3b]">—</p>
          <p className="mt-1 text-xs text-slate-500">
            Sem leitura de dados enquanto o banco está em standby.
          </p>
        </div>
      </div>
      <div className="mx-6 mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900 sm:mx-10 sm:mb-10">
        <strong>Área preparada.</strong> Esta aba já faz parte do RH e está na mesma navegação do
        Vale Passagem. A operação real de colaboradores, saldos e recargas será ligada somente
        quando a origem de dados autorizada estiver disponível, sem criar registros fictícios.
      </div>
    </section>
  );
}
