import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMyProfile } from "@/lib/auth.functions";
import { hasMyPontoAccess } from "@/lib/ponto.functions";
import { HrWorkspace } from "@/components/HrWorkspace";
import { RhPontoWorkspace } from "@/components/RhPontoWorkspace";

export const Route = createFileRoute("/_authenticated/folha-ponto")({
  head: () => ({ meta: [{ title: "Folha de Ponto · DBS Air" }, { name: "robots", content: "noindex" }] }),
  component: FolhaPontoPage,
});

function FolhaPontoPage() {
  const navigate = useNavigate();
  const profile = useQuery({ queryKey: ["me"], queryFn: () => getMyProfile() });
  const isRh = profile.data?.role_key === "SUPER_ADMIN" || profile.data?.role_key === "ADMIN_OPERACIONAL";
  const access = useQuery({
    queryKey: ["my-ponto-access"],
    queryFn: () => hasMyPontoAccess(),
    enabled: !profile.isLoading && !isRh,
    retry: false,
  });

  useEffect(() => {
    if (!profile.isLoading && !profile.error && !isRh && access.data && !access.data.enabled) {
      navigate({ to: "/portal", replace: true });
    }
  }, [profile.isLoading, profile.error, isRh, access.data, navigate]);

  if (profile.isLoading || (!isRh && access.isLoading)) {
    return <div className="min-h-screen grid place-items-center bg-slate-50 text-sm text-slate-500">Carregando Folha de Ponto...</div>;
  }

  if (profile.error) {
    return <div className="min-h-screen grid place-items-center bg-slate-50 px-4 text-center text-sm text-slate-600">Não foi possível validar sua sessão. Entre novamente no sistema.</div>;
  }

  if (!isRh && !access.data?.enabled) return null;

  return isRh ? <HrWorkspace embedded /> : <RhPontoWorkspace />;
}
