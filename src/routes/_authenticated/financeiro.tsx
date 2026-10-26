import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/financeiro")({
  ssr: false,
  beforeLoad: () => { throw redirect({ to: "/treasury", replace: true }); },
});
