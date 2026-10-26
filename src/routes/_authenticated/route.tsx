import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { getMyProfile } from "@/lib/admin-profile.functions";
import { resolveCollaboratorLanding } from "@/lib/collaborator-navigation";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/login" });

    // O guard global continua permitindo clientes mesmo quando uma consulta
    // opcional do RH falha. Para colaboradores, porém, o destino deve respeitar
    // as permissões independentes de Ponto e DBS CONTROL; caso contrário o
    // celular entra num ciclo /portal -> /folha-ponto.
    if (location.pathname !== "/folha-ponto" && location.pathname !== "/dbs-control") {
      try {
        const profile = await getMyProfile();
        const isCollaborator = profile?.role_key === "COLABORADOR";
        if (isCollaborator) {
          const destination = await resolveCollaboratorLanding();
          if (destination !== location.pathname) throw redirect({ to: destination, replace: true });
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
