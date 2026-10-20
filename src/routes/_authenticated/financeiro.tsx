import { createFileRoute, redirect } from "@tanstack/react-router";

// Keep /financeiro as the stable user-facing route while reusing the existing
// DBS TREASURY implementation and its authorization checks.
export const Route = createFileRoute("/_authenticated/financeiro")({
  ssr: false,
  beforeLoad: () => {
    throw redirect({ to: "/treasury", replace: true });
  },
});
