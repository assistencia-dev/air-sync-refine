import { createFileRoute, Outlet, isRedirect, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { getMyEmployeePortalAccess } from "@/lib/rh.functions";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/login" });

    // Funcionário com acesso RH não entra no portal de clientes nem nos módulos administrativos.
    // A única porta funcional liberada para esse perfil é a Folha de Ponto individual.
    if (location.pathname !== "/folha-ponto") {
      try {
        const employeeAccess = await getMyEmployeePortalAccess();
        if (employeeAccess.enabled) {
          throw redirect({ to: "/folha-ponto", replace: true });
        }
      } catch (error) {
        if (isRedirect(error)) throw error;
        // Falhas de consulta não bloqueiam usuários legados/clientes durante a migração.
      }
    }

    return { user: data.user };
  },
  component: () => <Outlet />,
});
