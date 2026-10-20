import { createFileRoute, redirect } from "@tanstack/react-router";

// Stable direct URL for Central de Chamados; the existing admin workspace owns the
// current implementation and its role-based access checks.
export const Route = createFileRoute("/_authenticated/chamados")({
  ssr: false,
  beforeLoad: () => {
    throw redirect({ to: "/admin", replace: true });
  },
});