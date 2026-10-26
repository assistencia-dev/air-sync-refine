import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/rh")({
  ssr: false,
  beforeLoad: () => { throw redirect({ to: "/admin", search: { tab: "passage" }, replace: true }); },
});
