import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/users")({
  ssr: false,
  beforeLoad: () => { throw redirect({ to: "/admin", search: { tab: "users" }, replace: true }); },
});
