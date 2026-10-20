import { createFileRoute, redirect } from "@tanstack/react-router";

// Stable direct URL for Usuários Vinculados; the existing admin workspace owns the
// current implementation and its role-based access checks.
export const Route = createFileRoute("/_authenticated/users")({
  ssr: false,
  beforeLoad: () => {
    throw redirect({ to: "/admin", replace: true });
  },
});