import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, type FormEvent } from "react";
import { ShieldCheck, LogIn, Phone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { resolveLogin } from "@/lib/auth.functions";
import { getMyProfile } from "@/lib/admin-profile.functions";
import { hasMyPontoAccess } from "@/lib/ponto.functions";
import { BrandLogo } from "@/components/BrandLogo";

export const Route = createFileRoute("/login")({
  ssr: false,
  head: () => ({ meta: [{ title: "Portal DBS Air | Acesso Restrito" }, { name: "description", content: "Portal de gestão de chamados e climatização DBS Air. Acesso restrito a clientes e parceiros cadastrados." }, { name: "robots", content: "noindex,nofollow" }] }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const profileAccessError =
    "A autenticação ocorreu, mas não foi possível carregar seu perfil e as permissões. Nenhum módulo foi aberto. Tente entrar novamente; se persistir, é necessário verificar a conexão das funções do servidor com o Supabase.";

  async function resolveAuthenticatedRoleProfile(authUserId: string): Promise<{ role_key: string | null } | null> {
    // Prefer the normal user-scoped lookup. If RLS or a transient session timing
    // issue blocks it, retry briefly and use the server-side profile resolver.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const { data, error: lookupError } = await supabase
        .from("users")
        .select("role_key")
        .eq("auth_id", authUserId)
        .maybeSingle();

      if (data?.role_key) return { role_key: data.role_key };
      if (lookupError) {
        console.error("DBS Air: falha ao consultar o perfil do usuário autenticado.", lookupError);
      }
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 250));
    }

    try {
      const profile = await getMyProfile();
      if (profile?.role_key) return { role_key: profile.role_key };
    } catch (profileError) {
      // Do not silently route an administrator into the customer portal when
      // the server-side authorization/profile service is unavailable.
      console.error("DBS Air: o resolvedor de perfil do servidor falhou.", profileError);
    }

    return null;
  }

  useEffect(() => {
    let cancelled = false;

    async function redirectExistingSession() {
      try {
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!data.session || cancelled) return;

        const profile = await resolveAuthenticatedRoleProfile(data.session.user.id);
        if (cancelled) return;
        if (!profile?.role_key) {
          setError(profileAccessError);
          return;
        }

        if (profile.role_key === "FINANCEIRO_LEITURA") {
          navigate({ to: "/financeiro-acompanhamento", replace: true });
          return;
        }
        if (profile.role_key === "SUPER_ADMIN" || profile.role_key === "ADMIN_OPERACIONAL") {
          navigate({ to: "/admin", replace: true });
          return;
        }
        if (profile.role_key === "COLABORADOR") {
          try {
            const point = await hasMyPontoAccess();
            if (cancelled) return;
            navigate({ to: point.enabled ? "/folha-ponto" : "/portal", replace: true });
          } catch {
            if (!cancelled) navigate({ to: "/portal", replace: true });
          }
          return;
        }
        navigate({ to: "/portal", replace: true });
      } catch (sessionError) {
        console.error("DBS Air: falha ao recuperar a sessão e o perfil.", sessionError);
        if (!cancelled) setError(profileAccessError);
      }
    }

    void redirectExistingSession();
    return () => { cancelled = true; };
  }, [navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault(); setError(null); setLoading(true);
    try {
      // E-mail autentica diretamente. Para o SUPER ADMIN nativo, usamos o
      // e-mail técnico conhecido sem depender do resolver administrativo.
      // Isso evita que uma falha isolada de server function impeça o acesso.
      const normalizedIdentifier = identifier.trim();
      const email = normalizedIdentifier.includes("@")
        ? normalizedIdentifier
        : normalizedIdentifier.toUpperCase() === "DBSASSISTENCIA123"
          ? "dbsassistencia123@dbsair.internal"
          : (await resolveLogin({ data: { identifier: normalizedIdentifier } })).email;

      const { error: signErr } = await supabase.auth.signInWithPassword({ email, password });
      if (signErr) throw signErr;

      // Em alguns navegadores o evento de sessão chega alguns milissegundos
      // depois do signIn. Aguarde a sessão antes de consultar o perfil/rotear.
      let sessionUserId: string | null = null;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const { data: session } = await supabase.auth.getSession();
        sessionUserId = session.session?.user.id ?? null;
        if (sessionUserId) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (!sessionUserId) throw new Error("Sessão não estabelecida. Tente novamente.");

      const profile = await resolveAuthenticatedRoleProfile(sessionUserId);
      if (!profile?.role_key) throw new Error(profileAccessError);
      const role = profile.role_key;
      const isAdmin = role === "SUPER_ADMIN" || role === "ADMIN_OPERACIONAL";
      const isCollaborator = role === "COLABORADOR";
      if (role === "FINANCEIRO_LEITURA") {
        navigate({ to: "/financeiro-acompanhamento", replace: true });
      } else if (isAdmin) {
        navigate({ to: "/admin", replace: true });
      } else if (isCollaborator) {
        // Somente colaboradores consultam o RH/Folha de Ponto.
        // Clientes nunca devem depender de rh_employees para entrar no portal.
        try {
          const point = await hasMyPontoAccess();
          navigate({ to: point.enabled ? "/folha-ponto" : "/portal", replace: true });
        } catch {
          // Se o schema de RH estiver em migração, o colaborador continua
          // autenticado e pode acessar o portal; o erro do RH não derruba o login.
          navigate({ to: "/portal", replace: true });
        }
      } else {
        navigate({ to: "/portal", replace: true });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao autenticar.";
      setError(msg.includes("Invalid login") ? "Usuário ou senha inválidos." : msg);
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2" style={{ fontFamily: "'Inter',system-ui,sans-serif" }}>
      <div className="hidden lg:flex flex-col justify-between p-12 text-white relative overflow-hidden" style={{ background: "linear-gradient(135deg,#0F172A 0%,#1E3A8A 100%)" }}>
        <div className="absolute inset-0 opacity-[0.07] pointer-events-none" style={{ backgroundImage: "linear-gradient(#93C5FD 1px, transparent 1px), linear-gradient(90deg,#93C5FD 1px, transparent 1px)", backgroundSize: "48px 48px" }} />
        <div className="relative"><BrandLogo frameClassName="rounded-2xl px-5 py-4 shadow-xl" imageClassName="h-20 xl:h-24 w-auto max-w-[280px] object-contain" /><p className="mt-8 text-xs font-bold uppercase tracking-[0.25em]" style={{ color: "#93C5FD" }}>Portal de Gestão de Climatização</p><h1 className="mt-3 text-4xl font-bold leading-[1.15]">Engenharia · Manutenção · PMOC · B2B</h1><p className="mt-5 max-w-md text-base" style={{ color: "#CBD5E1" }}>Central operacional de chamados, ordens de serviço e conformidade técnica para redes de varejo, escritórios e instalações corporativas.</p></div>
        <div className="relative space-y-4"><div className="flex items-center gap-3 text-sm" style={{ color: "#CBD5E1" }}><ShieldCheck className="w-4 h-4" style={{ color: "#16A34A" }} /><span>Lei 13.589/2018 · ANVISA · CREA/CFT</span></div><p className="text-xs" style={{ color: "#94A3B8" }}>© 2026 DBS Air Refrigeração LTDA · CNPJ 13.352.707/0001-09</p></div>
      </div>
      <div className="flex flex-col justify-center p-6 md:p-12 bg-white"><div className="mx-auto w-full max-w-md"><div className="mb-7 flex justify-center lg:hidden"><BrandLogo frameClassName="rounded-xl px-5 py-3" imageClassName="h-14 w-auto max-w-[240px] object-contain" /></div><a href="/site" className="text-xs font-semibold tracking-widest uppercase" style={{ color: "#0284C7" }}>← Voltar ao site</a><h2 className="mt-6 text-3xl font-bold" style={{ color: "#0F172A" }}>Acesso ao Portal</h2><p className="mt-2 text-sm" style={{ color: "#666" }}>Autentique-se com seu usuário, e-mail ou CPF cadastrado.</p>
        <form onSubmit={handleSubmit} className="mt-8 space-y-5"><div><label htmlFor="portal-identifier" className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: "#0F172A" }}>Usuário</label><input id="portal-identifier" type="text" inputMode="email" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" value={identifier} onChange={e => setIdentifier(e.target.value)} placeholder="Usuário técnico, e-mail ou CPF" required className="w-full px-4 py-3 rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm" /></div><div><label htmlFor="portal-password" className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: "#0F172A" }}>Senha</label><input id="portal-password" type="password" autoComplete="current-password" enterKeyHint="done" value={password} onChange={e => setPassword(e.target.value)} required className="w-full px-4 py-3 rounded-md border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm" /></div>{error && <div role="alert" aria-live="polite" className="text-sm p-3 rounded-md" style={{ background: "#FEF2F2", color: "#B91C1C", border: "1px solid #FECACA" }}>{error}</div>}<button type="submit" disabled={loading} className="w-full inline-flex items-center justify-center gap-2 text-white px-5 py-3 rounded-md font-semibold text-sm shadow-md hover:shadow-lg transition disabled:opacity-60" style={{ background: "linear-gradient(135deg,#1E3A8A,#0284C7)" }}><LogIn className="w-4 h-4" /> {loading ? "Autenticando..." : "Entrar"}</button><div className="flex items-center justify-between text-xs pt-2" style={{ color: "#666" }}><a href="https://wa.me/5521998256991?text=Olá.%20Não%20consigo%20acessar%20o%20Portal%20DBS%20Air." target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold hover:underline" style={{ color: "#0284C7" }}><Phone className="w-3 h-3" /> Não possui acesso? Fale com o suporte</a></div></form>
        <div className="mt-10 pt-6 border-t border-gray-200"><p className="text-xs leading-relaxed" style={{ color: "#666" }}><strong style={{ color: "#0F172A" }}>Acesso Restrito.</strong> Ambiente destinado a clientes e parceiros cadastrados da DBS Air. Todos os acessos são monitorados e registrados para fins de auditoria.</p></div>
      </div></div>
    </div>
  );
}
