import { hasMyPontoAccess } from "@/lib/ponto.functions";
import { hasMyDbsControlAccess } from "@/lib/rh.functions";

export type CollaboratorLanding = "/folha-ponto" | "/dbs-control" | "/portal";

/**
 * Resolve the first useful collaborator workspace without making one optional
 * module take down the login. Ponto and DBS CONTROL are independent grants:
 * a field collaborator may have OS access without using the time sheet, and a
 * transient RH query failure must not send that person to the customer portal.
 */
export async function resolveCollaboratorLanding(): Promise<CollaboratorLanding> {
  const [pontoResult, controlResult] = await Promise.allSettled([
    hasMyPontoAccess(),
    hasMyDbsControlAccess(),
  ]);

  const pontoEnabled = pontoResult.status === "fulfilled" && pontoResult.value.enabled === true;
  const controlEnabled = controlResult.status === "fulfilled"
    && controlResult.value.enabled === true
    && controlResult.value.administrative !== true;

  // Folha de Ponto is the shared collaborator shell when both modules exist;
  // it exposes the "Minhas OS" switch without adding another login.
  if (pontoEnabled) return "/folha-ponto";
  if (controlEnabled) return "/dbs-control";
  return "/portal";
}
