import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/chamados")({
  ssr: false,
  beforeLoad: () => { throw redirect({ to: "/admin", search: { tab: "tickets" }, replace: true }); },
});
