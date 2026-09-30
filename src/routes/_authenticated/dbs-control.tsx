import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { hasMyDbsControlAccess } from "@/lib/rh.functions";
import { getMyProfile } from "@/lib/auth.functions";

export const Route = createFileRoute("/_authenticated/dbs-control")({
  head: () => ({ meta: [{ title: "DBS CONTROL · DBS Air" }, { name: "robots", content: "noindex" }] }),
  component: DbsControlPage,
});

function DbsControlPage() {
  const navigate = useNavigate();
  const profile = useQuery({ queryKey: ["me"], queryFn: () => getMyProfile() });
  const access = useQuery({ queryKey: ["my-dbs-control-access"], queryFn: () => hasMyDbsControlAccess(), retry: false });

  if (profile.isLoading || access.isLoading) {
    return <div className="min-h-screen grid place-items-center bg-slate-50 text-sm text-slate-500">Carregando DBS CONTROL...</div>;
  }

  if (access.isError || !access.data?.enabled) {
    return (
      <main className="min-h-screen grid place-items-center bg-slate-50 p-6">
        <section className="max-w-md rounded-2xl border border-slate-200 bg-white p-7 text-center shadow-sm">
          <h1 className="text-xl font-black text-slate-900">DBS CONTROL não liberado</h1>
          <p className="mt-2 text-sm text-slate-500">O RH ainda não liberou o módulo DBS CONTROL para este funcionário.</p>
          <button onClick={() => navigate({ to: "/folha-ponto", replace: true })} className="mt-5 rounded-lg bg-sky-600 px-4 py-2 text-xs font-black text-white">Voltar para Folha de Ponto</button>
        </section>
      </main>
    );
  }

  const employeeName = access.data.employee?.full_name ?? profile.data?.full_name ?? "";
  const employeeMode = !access.data.administrative;
  const src = employeeMode
    ? `/dbs-control.html?mode=employee&employee_name=${encodeURIComponent(employeeName)}`
    : "/dbs-control.html";

  return (
    <main className="min-h-screen bg-slate-100">
      <iframe title="DBS CONTROL" src={src} className="h-screen w-full border-0" allow="camera; geolocation" />
    </main>
  );
}
