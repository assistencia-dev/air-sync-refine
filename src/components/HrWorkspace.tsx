import { useState } from "react";
import { IdCard, Shield, Utensils, WalletCards } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getMyProfile } from "@/lib/auth.functions";
import { createValePassageSsoUrl } from "@/lib/vale-passage.functions";
import { RhBenefitPanel } from "@/components/RhBenefitPanel";
import { RhEmployeeRegistry } from "@/components/RhEmployeeRegistry";

export const VALE_PASSAGEM_URL = "https://valepassagem-d8edi3fl.manus.space";

type HrSection = "passagem" | "alimentacao" | "cadastro";

/**
 * Área de trabalho de RH compartilhada: usada embutida na aba do painel
 * administrativo e também na rota dedicada /passage (aba nova).
 */
function RhGate({
  loading = false,
  denied = false,
  onEnter,
}: {
  loading?: boolean;
  denied?: boolean;
  onEnter?: () => void;
}) {
  return (
    <section className="flex min-h-[420px] items-center justify-center rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-slate-50 p-8 text-center">
        <Shield className="mx-auto h-8 w-8 text-[#1E8F66]" />
        <p className="mt-4 text-[10px] font-black uppercase tracking-[.2em] text-slate-400">
          Módulo protegido
        </p>
        <h1 className="mt-2 text-xl font-black text-[#102b3b]">Acesso ao RH</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {loading
            ? "Validando a sessão administrativa..."
            : denied
              ? "Este usuário não possui acesso ao módulo RH."
              : "Faça o acesso com a sessão administrativa já registrada para liberar as ferramentas."}
        </p>
        {onEnter && (
          <button
            type="button"
            onClick={onEnter}
            className="mt-6 w-full rounded-xl bg-[#102b3b] px-4 py-3 text-sm font-bold text-white transition hover:bg-[#173e54]"
          >
            Entrar no módulo RH
          </button>
        )}
      </div>
    </section>
  );
}

export function HrWorkspace({ embedded = false }: { embedded?: boolean }) {
  const profile = useQuery({ queryKey: ["rh-module-profile"], queryFn: () => getMyProfile() });
  const [rhAuthenticated, setRhAuthenticated] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.sessionStorage.getItem("dbs-rh-authenticated") === "1";
  });
  const [section, setSection] = useState<HrSection>("passagem");
  const isNativeOperator = ["DBS123", "DBSASSISTENCIA123"].includes(profile.data?.username ?? "");
  const sso = useQuery({
    queryKey: ["rh-vale-passagem-sso"],
    queryFn: () => createValePassageSsoUrl(),
    enabled: rhAuthenticated && isNativeOperator,
    retry: false,
  });

  if (profile.isLoading) return <RhGate loading />;
  if (!profile.data || !isNativeOperator) return <RhGate denied />;
  if (!rhAuthenticated) {
    return (
      <RhGate
        onEnter={() => {
          window.sessionStorage.setItem("dbs-rh-authenticated", "1");
          setRhAuthenticated(true);
        }}
      />
    );
  }

  const tabs: { key: HrSection; label: string; icon: React.ReactNode; active: string }[] = [
    {
      key: "passagem",
      label: "Vale Passagem",
      icon: <WalletCards className="h-4 w-4" />,
      active: "bg-[#102b3b] text-white shadow-md",
    },
    {
      key: "alimentacao",
      label: "Vale Alimentação",
      icon: <Utensils className="h-4 w-4" />,
      active: "bg-[#f7c945] text-[#102b3b] shadow-md",
    },
    {
      key: "cadastro",
      label: "Cadastro de Funcionários",
      icon: <IdCard className="h-4 w-4" />,
      active: "bg-[#1E8F66] text-white shadow-md",
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[.2em] text-slate-400">
            Área de trabalho
          </p>
          <h1 className="mt-1 text-xl font-black tracking-tight text-[#102b3b]">
            RH — Benefícios e cadastro
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Colaboradores, recargas e fichas cadastrais dentro do portal DBS Air.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <nav className="flex flex-wrap gap-2" aria-label="Módulos de RH">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setSection(t.key)}
                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition ${section === t.key ? t.active : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </nav>
          {embedded && (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-700">
              <Shield className="h-3.5 w-3.5" /> Sessão única do RH
            </span>
          )}
        </div>
      </div>

      {section === "cadastro" && <RhEmployeeRegistry />}
      {section === "alimentacao" && <RhBenefitPanel benefitType="alimentacao" />}
      {section === "passagem" && (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-emerald-100 bg-emerald-50 px-5 py-4 text-emerald-900 sm:flex-row sm:items-center sm:justify-between sm:px-7">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[.18em] text-emerald-700">
                Sistema preservado
              </p>
              <p className="mt-1 text-sm font-bold">Vale Passagem</p>
            </div>
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-800">
              <Shield className="h-3.5 w-3.5" /> Acesso pelo RH
            </span>
          </div>
          {sso.isLoading ? (
            <div className="flex min-h-[560px] items-center justify-center text-sm font-semibold text-slate-500">
              Validando acesso único...
            </div>
          ) : (
            <iframe
              title="Sistema de Vale Passagem"
              src={sso.data?.url ?? VALE_PASSAGEM_URL}
              className="h-[min(760px,calc(100vh-15rem))] min-h-[560px] w-full bg-white"
              allow="storage-access; notifications"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          )}
        </section>
      )}
    </div>
  );
}
