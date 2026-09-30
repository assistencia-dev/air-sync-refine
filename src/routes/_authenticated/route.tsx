import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { getMyProfile } from "@/lib/auth.functions";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/login" });

    // O guard global de autenticação NÃO consulta tabelas do RH.
    // Clientes existentes devem conseguir entrar mesmo que o schema do RH
    // esteja incompleto ou em migração. O direcionamento do colaborador
    // usa somente o perfil já existente em public.users.
    if (location.pathname !== "/folha-ponto" && location.pathname !== "/dbs-control") {
      try {
        const profile = await getMyProfile();
        const isCollaborator = profile?.role_key === "COLABORADOR";
        if (isCollaborator) {
          throw redirect({ to: "/folha-ponto", replace: true });
        }
      } catch (error) {
        if (error && typeof error === "object" && "to" in error) throw error;
        // Falhas de perfil não bloqueiam a sessão autenticada aqui.
        // A página de destino fará sua própria validação.
      }
    }

    return { user: data.user };
  },
  component: () => <Outlet />,
});
