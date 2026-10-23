import { createFileRoute } from "@tanstack/react-router";
import { Index } from "./index";

// Keep the original corporate landing page available without making it
// the default destination when an operator opens the app.
export const Route = createFileRoute("/site")({
  head: () => ({
    meta: [
      { title: "DBS Air | Soluções de climatização" },
      { name: "description", content: "Soluções de climatização, manutenção e conformidade técnica da DBS Air." },
    ],
  }),
  component: Index,
});
