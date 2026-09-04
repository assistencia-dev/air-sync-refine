import { useState } from "react";
import { IdCard, Lock, Shield, Utensils, WalletCards } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getMyProfile } from "@/lib/auth.functions";
import { unlockRhModule } from "@/lib/rh.functions";
import { RhBenefitPanel } from "@/components/RhBenefitPanel";
import { RhEmployeeRegistry } from "@/components/RhEmployeeRegistry";

export const VALE_PASSAGEM_URL = "https://valepassagem-d8edi3fl.manus.space";

type HrSection = "passagem" | "alimentacao" | "cadastro";

/**
 * Tela de acesso do módulo RH. Enquanto o login não for concluído,
 * nenhuma ferramenta ou menu interno do RH é renderizado.
 */
function RhLogin({
  loading = false,
  denied = false,
  defaultUsername = "",
  onUnlocked,
}: {
  loading?: boolean;
  denied?: boolean;
  defaultUsername?: string;
  onUnlocked?: () => void;
}) {
  const [username, setUsername] = useState(defaultUsername);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const unlock = useMutation({
    mutationFn: () => unlockRhModule({ data: { username, password } }),
    onSuccess: () => {
      window.sessionStorage.setItem("dbs-rh-authenticated", "1");
      onUnlocked?.();
    },
    onError: (e: unknown) =>
      setError(e instanceof Error ? e.message : "Usuário ou senha do RH inválidos."),
  });

  return (
    <section className="flex min-h-[520px] items-center justify-center rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-slate-50 p-8">
        <div className="text-center">
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
                : "Informe usuário e senha para liberar as ferramentas do RH."}
          </p>
        </div>

        {!loading && !denied && (
          <form
            className="mt-6 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              unlock.mutate();
            }}
          >
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Usuário do RH"
              autoComplete="username"
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm"
            />
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Senha"
              type="password"
              autoComplete="current-password"
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm"
            />
            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={unlock.isPending || !username.trim() || !password}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#102b3b] px-4 py-3 text-sm font-bold text-white transition hover:bg-[#173e54] disabled:opacity-50"
            >
              <Lock className="h-4 w-4" />
              {unlock.isPending ? "Validando..." : "Entrar no módulo RH"}
            </button>
          </form>
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
  const [section, setSection] = useState<HrSection>("cadastro");
  const isNativeOperator = ["DBS123", "DBSASSISTENCIA123"].includes(profile.data?.username ?? "");

  if (profile.isLoading) return <RhLogin loading />;
  if (!profile.data || !isNativeOperator) return <RhLogin denied />;
  if (!rhAuthenticated) {
    return (
      <RhLogin
        defaultUsername={profile.data.username ?? ""}
        onUnlocked={() => setRhAuthenticated(true)}
      />
    );
  }

  const tabs: { key: HrSection; label: string; icon: React.ReactNode; active: string }[] = [
    {
      key: "cadastro",
      label: "Cadastro de Funcionários",
      icon: <IdCard className="h-4 w-4" />,
      active: "bg-[#1E8F66] text-white shadow-md",
    },
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
            Cadastro central de colaboradores compartilhado pelas duas ferramentas de benefício.
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
      {section === "passagem" && <RhBenefitPanel benefitType="passagem" />}
    </div>
  );
}
