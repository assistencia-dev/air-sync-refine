import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { ShieldCheck, LogIn, Phone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { resolveLogin } from "@/lib/auth.functions";
import logoAsset from "@/assets/logo-dbs-air.jpg.asset.json";

export const Route = createFileRoute("/login")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Portal DBS Air | Acesso Restrito" },
      { name: "description", content: "Portal de gestão de chamados e climatização DBS Air. Acesso restrito a clientes e parceiros cadastrados." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/portal", replace: true });
    });
  }, [navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { email } = await resolveLogin({ data: { identifier } });
      const { error: signErr } = await supabase.auth.signInWithPassword({ email, password });
      if (signErr) throw signErr;
      // Route: check role and redirect
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) throw new Error("Sessão não estabelecida.");
      const { data: profile } = await supabase
        .from("users")
        .select("role_key")
        .eq("auth_id", session.session.user.id)
        .maybeSingle();
      const isAdmin = profile?.role_key === "SUPER_ADMIN" || profile?.role_key === "ADMIN_OPERACIONAL";
      navigate({ to: isAdmin ? "/admin" : "/portal", replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao autenticar.";
      setError(msg.includes("Invalid login") ? "Usuário ou senha inválidos." : msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2" style={{ fontFamily: "'Inter',system-ui,sans-serif" }}>
      {/* LEFT — brand */}
      <div className="hidden lg:flex flex-col justify-between p-12 text-white relative overflow-hidden" style={{ background: "linear-gradient(135deg,#0F172A 0%,#1E3A8A 100%)" }}>
        <div className="absolute inset-0 opacity-[0.07] pointer-events-none" style={{ backgroundImage: "linear-gradient(#93C5FD 1px, transparent 1px), linear-gradient(90deg,#93C5FD 1px, transparent 1px)", backgroundSize: "48px 48px" }} />
        <div className="relative">
          <div className="bg-white rounded-xl p-4 inline-block">
            <img src={logoAsset.url} alt="DBS Air" className="h-16 w-auto object-contain" />
          </div>
          <p className="mt-8 text-xs font-bold uppercase tracking-[0.25em]" style={{ color: "#93C5FD" }}>
            Portal de Gestão de Climatização
          </p>
          <h1 className="mt-3 text-4xl font-bold leading-[1.15]">Engenharia · Manutenção · PMOC · B2B</h1>
          <p className="mt-5 max-w-md text-base" style={{ color: "#CBD5E1" }}>
            Central operacional de chamados, ordens de serviço e conformidade técnica para redes de varejo, escritórios e instalações corporativas.
          </p>
        </div>
        <div className="relative space-y-4">
          <div className="flex items-center gap-3 text-sm" style={{ color: "#CBD5E1" }}>
            <ShieldCheck className="w-4 h-4" style={{ color: "#16A34A" }} />
            <span>Lei 13.589/2018 · ANVISA · CREA/CFT</span>
          </div>
          <p className="text-xs" style={{ color: "#94A3B8" }}>
            © 2026 DBS Air Refrigeração LTDA · CNPJ 13.352.707/0001-09
          </p>
        </div>
      </div>

      {/* RIGHT — form */}
      <div className="flex flex-col justify-center p-6 md:p-12 bg-white">
        <div className="mx-auto w-full max-w-md">
          <Link to="/" className="text-xs font-semibold tracking-widest uppercase" style={{ color: "#0284C7" }}>← Voltar ao site</Link>
          <h2 className="mt-6 text-3xl font-bold" style={{ color: "#0F172A" }}>Acesso ao Portal</h2>
          <p className="mt-2 text-sm" style={{ color: "#666" }}>Autentique-se com seu usuário, e-mail ou CPF cadastrado.</p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: "#0F172A" }}>Usuário</label>
              <input
                type="text"
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="Usuário técnico, e-mail ou CPF"
                required
                className="w-full px-4 py-3 rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: "#0F172A" }}>Senha</label>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-4 py-3 rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm"
              />
            </div>

            {error && (
              <div className="text-sm p-3 rounded-md" style={{ background: "#FEF2F2", color: "#B91C1C", border: "1px solid #FECACA" }}>{error}</div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 text-white px-5 py-3 rounded-md font-semibold text-sm shadow-md hover:shadow-lg transition disabled:opacity-60"
              style={{ background: "linear-gradient(135deg,#1E3A8A,#0284C7)" }}
            >
              <LogIn className="w-4 h-4" /> {loading ? "Autenticando..." : "Entrar"}
            </button>

            <div className="flex items-center justify-between text-xs pt-2" style={{ color: "#666" }}>
              <a
                href="https://wa.me/5521998256991?text=Olá.%20Não%20consigo%20acessar%20o%20Portal%20DBS%20Air."
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-semibold hover:underline"
                style={{ color: "#0284C7" }}
              >
                <Phone className="w-3 h-3" /> Não possui acesso? Fale com o suporte
              </a>
            </div>
          </form>

          <div className="mt-10 pt-6 border-t border-gray-200">
            <p className="text-xs leading-relaxed" style={{ color: "#666" }}>
              <strong style={{ color: "#0F172A" }}>Acesso Restrito.</strong> Ambiente destinado a clientes e parceiros cadastrados da DBS Air. Todos os acessos são monitorados e registrados para fins de auditoria.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
