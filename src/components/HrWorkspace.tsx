import { useState } from "react";
import {
  Eye,
  EyeOff,
  IdCard,
  KeyRound,
  Lock,
  Shield,
  ShieldCheck,
  UserRound,
  Utensils,
  WalletCards,
} from "lucide-react";
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
  const [showPassword, setShowPassword] = useState(false);
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
    <section className="grid min-h-[560px] overflow-hidden rounded-2xl border border-slate-800 bg-[#1E293B] shadow-xl lg:grid-cols-2">
      {/* Painel institucional */}
      <div className="relative hidden flex-col justify-between bg-[#090D16] p-10 text-white lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.18]"
          style={{
            backgroundImage:
              "linear-gradient(#ffffff22 1px,transparent 1px),linear-gradient(90deg,#ffffff22 1px,transparent 1px)",
            backgroundSize: "38px 38px",
          }}
        />
        <div className="relative">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[.2em] text-[#F59E0B]">
            <ShieldCheck className="h-3.5 w-3.5" /> Ambiente restrito
          </span>
          <h1 className="mt-6 text-3xl font-black leading-tight tracking-tight">
            Recursos Humanos
            <br />
            DBS Air
          </h1>
          <p className="mt-3 max-w-sm text-sm leading-6 text-white/65">
            Cadastro central de colaboradores, Vale Passagem e Vale Alimentação em um único
            ambiente auditado.
          </p>
        </div>
        <ul className="relative mt-10 space-y-3 text-sm">
          {(
            [
              [IdCard, "Cadastro único de colaboradores"],
              [WalletCards, "Controle de recargas e cobertura"],
              [KeyRound, "Acesso liberado somente após login"],
            ] as const
          ).map(([Icon, text], index) => (
            <li key={index} className="flex items-center gap-3 text-white/80">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/10 text-[#1fd08c]">
                <Icon className="h-4 w-4" />
              </span>
              {text}
            </li>
          ))}
        </ul>
      </div>

      {/* Formulário */}
      <div className="flex items-center justify-center bg-[#0F172A] p-6 sm:p-10">
        <div className="w-full max-w-sm">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#0F172A] text-[#F59E0B] shadow-lg">
            <Lock className="h-5 w-5" />
          </div>
          <p className="mt-6 text-[10px] font-black uppercase tracking-[.22em] text-slate-400">
            Módulo protegido
          </p>
          <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-50">Acesso ao RH</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            {loading
              ? "Validando a sessão administrativa..."
              : denied
                ? "Este usuário não possui acesso ao módulo RH."
                : "Use as mesmas credenciais administrativas do portal para liberar as ferramentas."}
          </p>

          {loading && (
            <div className="mt-6 space-y-3">
              <div className="h-12 animate-pulse rounded-xl bg-slate-800" />
              <div className="h-12 animate-pulse rounded-xl bg-slate-800" />
            </div>
          )}

          {!loading && !denied && (
            <form
              className="mt-7 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                setError(null);
                unlock.mutate();
              }}
            >
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Usuário
                </span>
                <div className="flex items-center gap-2 rounded-xl border border-slate-700 bg-[#0F172A] px-3 transition focus-within:border-[#1E8F66] focus-within:ring-2 focus-within:ring-[#1E8F66]/20">
                  <UserRound className="h-4 w-4 shrink-0 text-slate-400" />
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="DBSASSISTENCIA123"
                    autoComplete="username"
                    className="w-full bg-transparent py-3 text-sm font-semibold text-slate-50 outline-none"
                  />
                </div>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Senha
                </span>
                <div className="flex items-center gap-2 rounded-xl border border-slate-700 bg-[#0F172A] px-3 transition focus-within:border-[#1E8F66] focus-within:ring-2 focus-within:ring-[#1E8F66]/20">
                  <KeyRound className="h-4 w-4 shrink-0 text-slate-400" />
                  <input
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    className="w-full bg-transparent py-3 text-sm font-semibold text-slate-50 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                    className="text-slate-400 transition hover:text-slate-200"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </label>
              {error && (
                <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-xs font-semibold text-red-300">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={unlock.isPending || !username.trim() || !password}
                className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#0F172A] px-4 py-3.5 text-sm font-black text-white shadow-lg transition hover:bg-[#1E293B] disabled:opacity-50"
              >
                <ShieldCheck className="h-4 w-4" />
                {unlock.isPending ? "Validando acesso..." : "Entrar no módulo RH"}
              </button>
              <p className="pt-1 text-center text-[11px] text-slate-400">
                Sessão do RH válida apenas nesta aba do navegador.
              </p>
            </form>
          )}
        </div>
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
      active: "bg-[#F59E0B] text-white shadow-md",
    },
    {
      key: "passagem",
      label: "Vale Passagem",
      icon: <WalletCards className="h-4 w-4" />,
      active: "bg-[#0F172A] text-white shadow-md",
    },
    {
      key: "alimentacao",
      label: "Vale Alimentação",
      icon: <Utensils className="h-4 w-4" />,
      active: "bg-[#F59E0B] text-[#102b3b] shadow-md",
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-800 bg-[#1E293B] p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[.2em] text-slate-400">
            Área de trabalho
          </p>
          <h1 className="mt-1 text-xl font-black tracking-tight text-slate-50">
            RH — Benefícios e cadastro
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            Cadastro central de colaboradores compartilhado pelas duas ferramentas de benefício.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <nav className="flex flex-wrap gap-2" aria-label="Módulos de RH">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setSection(t.key)}
                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition ${section === t.key ? t.active : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </nav>
          {embedded && (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-300">
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
