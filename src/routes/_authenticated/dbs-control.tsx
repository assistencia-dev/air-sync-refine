import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { createClientUser } from "@/lib/admin.functions";
import { hasMyDbsControlAccess, listRhEmployeeRegistry, listRhCollaboratorUsers, saveRhEmployeeRecord, saveRhEmployeeAccess } from "@/lib/rh.functions";
import { getMyProfile } from "@/lib/admin-profile.functions";
import { supabase } from "@/integrations/supabase/client";
import { applyDbsControlDelta, deleteDbsControlWorkOrder, getDbsControlCloudState, getDbsControlSyncCursor, getDbsControlDashboardSummary, auditDbsControlDatabase, uploadDbsControlOsAttachment } from "@/lib/dbs-control.functions";
import {
  deleteDbsControlLocalSyncCommand,
  getDbsControlLocalSyncSummary,
  putDbsControlLocalSyncCommand,
  recoverExpiredDbsControlLocalSyncCommands,
  updateDbsControlLocalSyncCommand,
  withDbsControlLocalSyncLock,
  type DbsControlLocalSyncCommand,
} from "@/lib/dbs-control.local-sync";
import {
  getFieldControlIntegrationStatus,
  saveFieldControlApiKey,
  testFieldControlConnection,
  syncFieldControl,
  getFieldControlImportedState,
  getFieldControlWorkOrderDetails,
} from "@/lib/fieldcontrol.functions";

// DBS CONTROL production hardening: collaborator mode remains backed by the canonical RH employee link.

function dbsControlHttpStatus(error: unknown) {
  const candidate = error as { status?: unknown; statusCode?: unknown; cause?: { status?: unknown } } | null;
  return Number(candidate?.status ?? candidate?.statusCode ?? candidate?.cause?.status ?? 0);
}

function isDbsControlTransientError(error: unknown) {
  const status = dbsControlHttpStatus(error);
  const message = error instanceof Error ? error.message : String(error ?? "");
  return [408, 425, 429, 502, 503, 504].includes(status)
    || /(timeout|timed out|timeout manager|gateway|failed to fetch|fetch failed|network|connection reset|temporarily unavailable|warp server error)/i.test(message);
}

function isLegacyAutomaticReconcileCommand(command: Pick<DbsControlLocalSyncCommand, "id" | "requestIds">) {
  return String(command.id).startsWith("reconcile:")
    || command.requestIds.some((requestId) => String(requestId).startsWith("reconcile:"));
}

const DBS_CONTROL_PERMANENT_CONFLICT_CODES = new Set([
  "DBS_OS_CONFLICT",
  "DBS_OS_COMPLETED_LOCKED",
  "DBS_OS_FIELD_FORBIDDEN",
  "DBS_OS_NOT_ASSIGNED",
  "DBS_OS_EMPLOYEE_NOT_FOUND",
  "DBS_OS_STOCK_INSUFFICIENT",
  "DBS_OS_PART_NOT_FOUND",
  "DBS_OS_ISSUE_FORBIDDEN",
  "DBS_OS_ISSUE_CLIENT_OUT_OF_SCOPE",
  "DBS_OS_ISSUE_CLIENT_INACTIVE",
  "DBS_OS_ISSUE_BASE_INACTIVE",
  "DBS_OS_ISSUE_SITE_INVALID",
  "DBS_OS_ISSUE_COMPANY_MISMATCH",
]);

function dbsControlConflictCode(conflict: unknown) {
  const item = conflict as { code?: unknown; error_code?: unknown; message?: unknown } | null;
  const explicit = String(item?.code ?? item?.error_code ?? "").trim();
  if (explicit) return explicit;
  const message = String(item?.message ?? "");
  return message.match(/DBS_OS_[A-Z_]+/)?.[0] ?? "DBS_OS_CONFLICT";
}

function dbsControlConflictIsPermanent(conflict: unknown) {
  return DBS_CONTROL_PERMANENT_CONFLICT_CODES.has(dbsControlConflictCode(conflict));
}

function dbsControlConflictIsAutoResolvable(conflict: unknown) {
  const code = dbsControlConflictCode(conflict);
  const message = String((conflict as { message?: unknown } | null)?.message ?? "")
    .trim()
    .toLocaleLowerCase("pt-BR");
  return code === "DBS_OS_COMPLETED_LOCKED"
    || /já foi conclu[ií]da|dados assinados.*protegidos|os conclu[ií]da.*protegida/.test(message);
}

function dbsControlUserFacingSyncMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  if (/invalid api key|missing supabase environment|jwt|unauthorized/i.test(raw)) {
    return "A conexão do ambiente precisa ser revisada. Os dados locais continuam preservados.";
  }
  if (isDbsControlTransientError(error)) {
    return "Conexão instável. A alteração foi preservada e será reenviada automaticamente.";
  }
  if (/DBS_OS_CONFLICT|conflito|alterada em outro/i.test(raw)) {
    return "Esta OS foi atualizada em outro dispositivo. A alteração ficou disponível para reconciliação.";
  }
  if (/DBS_OS_EMPLOYEE_NOT_FOUND|técnico.*(não existe|não possui|indisponível)|funcionário.*(não existe|não possui|indisponível)/i.test(raw)) {
    return "O técnico selecionado não está disponível no cadastro. Atualize a lista de colaboradores e tente novamente.";
  }
  return "Não foi possível sincronizar agora. A alteração foi preservada; tente novamente em instantes.";
}

function dbsControlRowIdentity(row: any) {
  return String(row?.id ?? row?.protocolo ?? row?.protocol ?? row?.numero ?? row?.codigo ?? row?.sku ?? row?.email ?? "").trim().toLocaleLowerCase("pt-BR");
}

function dbsControlOrderIdentity(row: any) {
  return [row?.protocolo, row?.protocol, row?.numero, row?.id]
    .map((value) => String(value ?? "").trim().toLocaleLowerCase("pt-BR"))
    .find(Boolean) ?? "";
}

function dbsControlSelectConflictingChanges(changes: Record<string, any[]> | null, conflicts: any[]) {
  if (!changes) return null;
  const keys = new Set((conflicts ?? []).map((conflict) => String(conflict?.protocol ?? "").trim().toLocaleLowerCase("pt-BR")).filter(Boolean));
  const selected: Record<string, any[]> = {};
  for (const [key, rows] of Object.entries(changes)) {
    if (!Array.isArray(rows)) continue;
    if (key !== "ordens") {
      // Master-data deltas are committed before an OS conflict is reported and
      // must not be replayed with the same idempotency batch.
      continue;
    }
    const matching = rows.filter((row) => {
      const identity = dbsControlOrderIdentity(row);
      return identity && keys.has(identity);
    });
    if (matching.length) selected[key] = matching;
  }
  return Object.keys(selected).length ? selected : null;
}

function dbsControlSubtractChanges(changes: Record<string, any[]> | null, excluded: Record<string, any[]> | null) {
  if (!changes) return null;
  if (!excluded) return changes;
  const result: Record<string, any[]> = {};
  for (const [key, rows] of Object.entries(changes)) {
    if (!Array.isArray(rows)) continue;
    const excludedRows = new Set((excluded[key] ?? []).map((row) => key === "ordens" ? dbsControlOrderIdentity(row) : dbsControlRowIdentity(row)).filter(Boolean));
    const remaining = rows.filter((row) => {
      const identity = key === "ordens" ? dbsControlOrderIdentity(row) : dbsControlRowIdentity(row);
      return !identity || !excludedRows.has(identity);
    });
    if (remaining.length) result[key] = remaining;
  }
  return Object.keys(result).length ? result : null;
}

async function withDbsControlTransientRetry<T>(operation: () => Promise<T>) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isDbsControlTransientError(error) || attempt === 2) throw error;
      const delayMs = Math.min(2000, 500 * (2 ** attempt));
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Falha transitória do DBS CONTROL.");
}

export const Route = createFileRoute("/_authenticated/dbs-control")({
  head: () => ({ meta: [{ title: "DBS CONTROL · DBS Air" }, { name: "robots", content: "noindex" }] }),
  component: DbsControlPage,
});

function dbsControlStateHasData(state: Record<string, unknown> | null | undefined) {
  if (!state) return false;
  const keys = ["tecnicos", "clientes", "equipamentos", "pecas", "servicos", "compras", "ordens"];
  return keys.some((key) => Array.isArray(state[key]) && (state[key] as unknown[]).length > 0);
}

function dbsControlClone<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

const DBS_CONTROL_PROTECTED_ARRAYS = ["tecnicos", "clientes", "equipamentos", "pecas", "servicos", "compras", "ordens"];

function mergeDbsControlChanges(current: Record<string, any[]> | null, incoming: Record<string, any[]>) {
  const merged: Record<string, any[]> = { ...(current ?? {}) };
  for (const [key, values] of Object.entries(incoming)) {
    if (!Array.isArray(values)) continue;
    const existing = Array.isArray(merged[key]) ? merged[key] : [];
    const identity = (row: any) => String(row?.id ?? row?.protocolo ?? row?.protocol ?? row?.numero ?? row?.codigo ?? row?.sku ?? "");
    const byId = new Map(existing.map((row) => [identity(row), row]));
    for (const row of values) {
      const id = identity(row);
      if (!id) {
        byId.set(`${key}:${byId.size}`, row);
      } else {
        byId.set(id, { ...(byId.get(id) ?? {}), ...row });
      }
    }
    merged[key] = [...byId.values()];
  }
  return merged;
}

function dbsControlStateIsSmallerThan(localState: Record<string, unknown> | null | undefined, cloudState: Record<string, unknown> | null | undefined) {
  if (!localState || !cloudState) return Boolean(localState && dbsControlStateHasData(localState));
  return DBS_CONTROL_PROTECTED_ARRAYS.some((key) => {
    const localCount = Array.isArray(localState[key]) ? (localState[key] as unknown[]).length : 0;
    const cloudCount = Array.isArray(cloudState[key]) ? (cloudState[key] as unknown[]).length : 0;
    return localCount > cloudCount;
  });
}

function mergeDbsControlStates(
  cloudState: Record<string, unknown>,
  localState: Record<string, unknown> | null,
) {
  if (!localState) return cloudState;

  // The shared cloud snapshot is authoritative for fields already populated.
  // Local-only records are retained, and local non-empty fields may fill cloud blanks,
  // but an old phone/browser snapshot must never overwrite newer cloud values.
  const merged: Record<string, unknown> = { ...localState, ...cloudState };
  const arrayKeys = new Set([
    ...Object.keys(cloudState).filter((key) => Array.isArray(cloudState[key])),
    ...Object.keys(localState).filter((key) => Array.isArray(localState[key])),
  ]);

  const identity = (item: unknown): string => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const row = item as Record<string, unknown>;
      for (const key of ["id", "employeeId", "protocolo", "protocol", "sku", "email", "fieldControlId"]) {
        const value = row[key];
        if (value !== null && value !== undefined && String(value).trim()) {
          return key + ":" + String(value).trim().toLocaleLowerCase("pt-BR");
        }
      }
    }
    return "value:" + JSON.stringify(item);
  };

  const hasValue = (value: unknown) =>
    value !== null && value !== undefined && !(typeof value === "string" && value.trim() === "");

  for (const key of arrayKeys) {
    const cloudRows = Array.isArray(cloudState[key]) ? cloudState[key] as unknown[] : [];
    const localRows = Array.isArray(localState[key]) ? localState[key] as unknown[] : [];
    const rows = new Map<string, unknown>();

    for (const row of cloudRows) rows.set(identity(row), row);
    for (const row of localRows) {
      const id = identity(row);
      const existing = rows.get(id);
      if (existing !== undefined && row && typeof existing === "object" && typeof row === "object" && !Array.isArray(existing) && !Array.isArray(row)) {
        const localRecord = row as Record<string, unknown>;
        const cloudRecord = existing as Record<string, unknown>;
        const combined: Record<string, unknown> = { ...localRecord };
        for (const [field, value] of Object.entries(cloudRecord)) {
          if (hasValue(value) || !hasValue(combined[field])) combined[field] = value;
        }

        // Uma resposta de nuvem atrasada não pode reabrir uma OS que o próprio
        // dispositivo já marcou como concluída. A nuvem continua prevalecendo
        // quando ela também confirma a conclusão ou possui dados mais recentes.
        if (key === "ordens") {
          const isCompleted = (value: unknown) =>
            ["concluída", "concluida", "concluído", "concluido"].includes(
              String(value ?? "").trim().toLocaleLowerCase("pt-BR"),
            );
          if (isCompleted(localRecord.status) && !isCompleted(cloudRecord.status)) {
            combined.status = localRecord.status;
            for (const field of [
              "diagnostico",
              "trabalhoExecutado",
              "observacao",
              "observacaoTecnico",
              "observacaoComplementarTecnico",
              "assinatura",
              "assinaturaEm",
              "concluidoEm",
              "concluidoPorEmployeeId",
              "fotoAntes",
              "fotoDepois",
            ]) {
              if (hasValue(localRecord[field])) combined[field] = localRecord[field];
            }
          }
        }
        rows.set(id, combined);
      } else if (existing === undefined) {
        rows.set(id, row);
      }
    }
    merged[key] = [...rows.values()];
  }

  return merged;
}

function DbsControlPage() {
  const navigate = useNavigate();
  const profile = useQuery({ queryKey: ["me"], queryFn: () => getMyProfile() });
  const access = useQuery({ queryKey: ["my-dbs-control-access"], queryFn: () => hasMyDbsControlAccess(), retry: false, staleTime: 0, refetchOnMount: "always" });
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Serialize writes from this browser so an earlier slow request cannot finish
  // after a newer request and overwrite the latest snapshot.
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingChangesRef = useRef<Record<string, any[]> | null>(null);
  const pendingBatchIdRef = useRef<string | null>(null);
  const saveInFlightRef = useRef(false);
  const pendingSaveRequestIdsRef = useRef<string[]>([]);
  // A second edit arriving while the first RPC is in flight is kept as a
  // separate durable command. Merging it into the in-flight payload would
  // replay the first intent with a new idempotency key after a reload.
  const queuedChangesRef = useRef<Record<string, any[]> | null>(null);
  const queuedBatchIdRef = useRef<string | null>(null);
  const queuedRequestIdsRef = useRef<string[]>([]);
  const localSyncCommandsRef = useRef<Map<string, DbsControlLocalSyncCommand>>(new Map());
  const localSyncHydrationRef = useRef<Promise<void> | null>(null);
  const localSyncRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttemptRef = useRef(0);
  const retryPendingSaveRef = useRef<((manual?: boolean) => void) | null>(null);
  const cloudReadyRef = useRef(false);
  const cloudUpdatedAtRef = useRef<string | null>(null);
  const syncCursorRef = useRef<string | null>(null);
  const localRecoveryStateRef = useRef<Record<string, unknown> | null>(null);
  const employeeModeRef = useRef(false);
  const employeeFrameDocumentRef = useRef<Document | null>(null);
  const readyHydrationInFlightRef = useRef(false);
  const [cloudError, setCloudError] = useState<string | null>(null);

  // O HTML legado pode chegar do CDN sem o último asset de navegação. O shell
  // autenticado reaplica apenas a apresentação do colaborador no carregamento
  // do iframe, sem tocar nos dados nem nos handlers de negócio.
  const handleEmployeeFrameLoad = () => {
    const frame = iframeRef.current;
    // The static shell can finish loading before React's message listener on
    // a suspended/mobile tab.  The shell treats this as an explicit handshake
    // and sends DBS_CONTROL_READY again, so the first cloud hydration is never
    // lost just because of load ordering.
    frame?.contentWindow?.postMessage({ type: "DBS_CONTROL_PARENT_READY" }, window.location.origin);
    if (!employeeModeRef.current) return;
    const frameDocument = frame?.contentDocument;
    if (!frameDocument) return;

    const employeeTitles: Record<string, [string, string]> = {
      "tab-dashboard": ["Meu painel", "Progresso e operação do colaborador"],
      "tab-pwa": ["Atendimentos", "Execução das ordens atribuídas ao colaborador"],
      "tab-nova-os": ["Emitir OS", "Nova ordem dentro da base vinculada"],
    };
    const syncEmployeeFrameUi = () => {
      const activeId = frameDocument.querySelector<HTMLElement>(".tab-view.active")?.id ?? "tab-dashboard";
      const meta = employeeTitles[activeId] ?? employeeTitles["tab-dashboard"];
      const title = frameDocument.getElementById("view-title");
      const subtitle = frameDocument.getElementById("view-subtitle");
      if (title) title.textContent = meta[0];
      if (subtitle) subtitle.textContent = meta[1];
      frameDocument.querySelectorAll<HTMLElement>("main > header .dbs-employee-issue-cta, main > header .btn-primary, main > header .dbs-secondary-menu").forEach((element) => {
        element.style.setProperty("display", "none", "important");
      });
    };

    // The iframe element survives route changes, while its document is
    // replaced on every reload.  Bind against the document identity instead
    // of a dataset flag on the iframe, otherwise a reload leaves the visible
    // buttons with listeners attached to a dead document.
    if (employeeFrameDocumentRef.current !== frameDocument) {
      employeeFrameDocumentRef.current = frameDocument;
      // Bind the session controls from the authenticated shell itself.  The
      // legacy HTML keeps an inline fallback for standalone use, but relying
      // only on postMessage made these controls appear clickable while doing
      // nothing after a suspended tab/hot reload.  Removing the inline handler
      // here avoids duplicate sign-out requests and makes the action direct,
      // observable and keyboard accessible.
      const backButton = frameDocument.querySelector<HTMLButtonElement>("[data-dbs-session-action=back]");
      const logoutButton = frameDocument.querySelector<HTMLButtonElement>("[data-dbs-session-action=logout]");
      if (backButton) {
        backButton.removeAttribute("onclick");
        backButton.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          backButton.setAttribute("aria-busy", "true");
          navigate({ to: "/folha-ponto", replace: true });
        });
      }
      if (logoutButton) {
        logoutButton.removeAttribute("onclick");
        logoutButton.addEventListener("click", async (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (logoutButton.getAttribute("aria-busy") === "true") return;
          logoutButton.setAttribute("aria-busy", "true");
          logoutButton.setAttribute("disabled", "true");
          logoutButton.textContent = "Saindo…";
          try {
            await supabase.auth.signOut();
          } finally {
            navigate({ to: "/login", replace: true });
          }
        });
      }
      frameDocument.addEventListener("click", () => window.setTimeout(syncEmployeeFrameUi, 0), true);
    }
    syncEmployeeFrameUi();
  };

  useEffect(() => {
    const logSyncEvent = (event: string, details: Record<string, unknown> = {}) => {
      const entry = JSON.stringify({ scope: "dbs-control-sync", event, at: new Date().toISOString(), ...details });
      if (event.includes("error") || event.includes("conflict") || event.includes("retry")) console.warn(entry);
      else console.info(entry);
    };
    const sendDashboardSummary = () => {
      void getDbsControlDashboardSummary()
        .then((summary) => {
          iframeRef.current?.contentWindow?.postMessage({
            type: "DBS_CONTROL_DASHBOARD_SUMMARY",
            summary,
          }, "*");
        })
        .catch((error) => {
          // KPI failure must never block OS reads/writes; the relational path remains authoritative.
          logSyncEvent("dashboard_summary_error", {
            message: error instanceof Error ? error.message : "Falha ao carregar os indicadores agregados.",
          });
          iframeRef.current?.contentWindow?.postMessage({
            type: "DBS_CONTROL_DASHBOARD_SUMMARY_ERROR",
            error: error instanceof Error ? error.message : "Não foi possível carregar os indicadores.",
          }, "*");
        });
    };

    const postLocalSyncStatus = async (fallbackStatus?: "synced" | "pending" | "conflict" | "error") => {
      const summary = await getDbsControlLocalSyncSummary();
      const pendingCount = summary.pending + summary.sending;
      const status = summary.conflict > 0
        ? "conflict"
        : summary.error > 0
          ? "error"
          : pendingCount > 0
            ? "pending"
            : (fallbackStatus ?? "synced");
      iframeRef.current?.contentWindow?.postMessage({
        type: "DBS_CONTROL_SYNC_STATUS",
        status,
        pendingCount,
        localQueue: summary,
        error: status === "error"
          ? "Há uma intenção local que precisa de nova tentativa. Nenhum dado foi descartado."
          : undefined,
      }, "*");
    };

    const persistLocalSyncCommand = async ({
      id,
      changes,
      requestIds,
      status = "pending",
      nextAttemptAt = Date.now(),
      lastError = null,
      conflicts,
      attempts,
      leaseUntil = null,
    }: {
      id: string;
      changes: Record<string, any[]>;
      requestIds: string[];
      status?: DbsControlLocalSyncCommand["status"];
      nextAttemptAt?: number;
      lastError?: string | null;
      conflicts?: unknown[];
      attempts?: number;
      leaseUntil?: number | null;
    }) => {
      const existing = localSyncCommandsRef.current.get(id);
      const command: DbsControlLocalSyncCommand = {
        id,
        requestIds: [...new Set([...(existing?.requestIds ?? []), ...requestIds].filter(Boolean))],
        changes: dbsControlClone(changes) as Record<string, any[]>,
        status,
        attempts: Number(attempts ?? existing?.attempts ?? 0),
        createdAt: Number(existing?.createdAt ?? Date.now()),
        updatedAt: Date.now(),
        nextAttemptAt,
        leaseUntil,
        lastError,
        conflicts: conflicts ?? existing?.conflicts,
      };
      localSyncCommandsRef.current.set(id, command);
      try {
        await putDbsControlLocalSyncCommand(command);
      } catch (error) {
        console.warn("DBS CONTROL: não foi possível persistir a intenção local.", error);
      }
      return command;
    };

    const findNextRetryableLocalCommand = () => {
      const now = Date.now();
      return [...localSyncCommandsRef.current.values()]
        .filter((command) => (command.status === "pending" || command.status === "sending") && Number(command.nextAttemptAt ?? 0) <= now)
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))[0] ?? null;
    };

    const promoteNextLocalSyncCommand = () => {
      if (pendingChangesRef.current || saveInFlightRef.current) return false;
      const next = findNextRetryableLocalCommand();
      if (!next) return false;
      pendingChangesRef.current = dbsControlClone(next.changes);
      pendingBatchIdRef.current = next.id;
      pendingSaveRequestIdsRef.current = [...next.requestIds];
      return true;
    };

    const hydrateLocalSyncQueue = async () => {
      if (localSyncHydrationRef.current) return localSyncHydrationRef.current;
      localSyncHydrationRef.current = (async () => {
        let commands = await recoverExpiredDbsControlLocalSyncCommands();
        const legacyCommands = commands.filter(isLegacyAutomaticReconcileCommand);
        if (legacyCommands.length > 0) {
          // These commands were generated by the retired cache-reconciliation
          // path. Keep them as evidence, but never replay stale local state
          // into the relational database after an upgrade or hot reload.
          await Promise.all(legacyCommands.map((command) => putDbsControlLocalSyncCommand({
            ...command,
            status: "quarantined",
            nextAttemptAt: Number.MAX_SAFE_INTEGER,
            leaseUntil: null,
            lastError: "Comando legado de reconciliação automática isolado; nenhuma regravação foi executada.",
            updatedAt: Date.now(),
          })));
          commands = await recoverExpiredDbsControlLocalSyncCommands();
        }
        localSyncCommandsRef.current = new Map(commands.map((command) => [command.id, command]));
        if (!pendingChangesRef.current) promoteNextLocalSyncCommand();
      })().catch((error) => {
        console.warn("DBS CONTROL: fila local não pôde ser carregada; a sessão seguirá com retry em memória.", error);
      });
      return localSyncHydrationRef.current;
    };

    const scheduleLocalSyncRetry = (delayMs = 0) => {
      if (localSyncRetryTimerRef.current) clearTimeout(localSyncRetryTimerRef.current);
      localSyncRetryTimerRef.current = setTimeout(() => {
        localSyncRetryTimerRef.current = null;
        retryPendingSaveRef.current?.();
      }, Math.max(0, delayMs));
    };

    const promoteQueuedCommandAfterCommit = () => {
      if (queuedChangesRef.current && queuedBatchIdRef.current) {
        pendingChangesRef.current = queuedChangesRef.current;
        pendingBatchIdRef.current = queuedBatchIdRef.current;
        pendingSaveRequestIdsRef.current = [...queuedRequestIdsRef.current];
        queuedChangesRef.current = null;
        queuedBatchIdRef.current = null;
        queuedRequestIdsRef.current = [];
        return true;
      }
      return promoteNextLocalSyncCommand();
    };

    // Only network and gateway failures enter the backoff queue; permanent
    // business conflicts remain visible for explicit reconciliation.
    const persist = async () => {
      const changes = pendingChangesRef.current;
      if (!changes || saveInFlightRef.current) return;
      const batchId = pendingBatchIdRef.current ?? crypto.randomUUID();
      const requestIds = [...pendingSaveRequestIdsRef.current];
      const previousCommand = localSyncCommandsRef.current.get(batchId);
      const attempt = Number(previousCommand?.attempts ?? 0) + 1;
      saveInFlightRef.current = true;
      await persistLocalSyncCommand({
        id: batchId,
        changes,
        requestIds,
        status: "sending",
        attempts: attempt,
        nextAttemptAt: Date.now(),
        leaseUntil: Date.now() + 60_000,
      });

      try {
        if (!cloudReadyRef.current) {
          const delays = [5000, 15000, 45000, 120000, 300000, 900000];
          const delay = delays[Math.min(retryAttemptRef.current, delays.length - 1)];
          retryAttemptRef.current += 1;
          await persistLocalSyncCommand({
            id: batchId,
            changes,
            requestIds,
            status: "pending",
            attempts: attempt,
            nextAttemptAt: Date.now() + delay,
            lastError: "A conexão com a nuvem ainda não está pronta.",
          });
          await postLocalSyncStatus("pending");
          if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
          retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null;
            retryPendingSaveRef.current?.();
          }, delay);
          return;
        }

        const result = await withDbsControlLocalSyncLock(() => withDbsControlTransientRetry(() =>
          applyDbsControlDelta({ data: { requestId: batchId, changes } }),
        ));
        const conflicts = Array.isArray(result.conflicts) ? result.conflicts : [];
        const hasConflict = conflicts.length > 0;
        const conflictingChanges = hasConflict
          ? dbsControlSelectConflictingChanges(changes, conflicts)
          : null;
        const committedChanges = hasConflict
          ? dbsControlSubtractChanges(changes, conflictingChanges)
          : changes;
        const autoResolvableConflict = hasConflict && conflicts.every(dbsControlConflictIsAutoResolvable);
        const permanentConflict = conflicts.some(dbsControlConflictIsPermanent);
        const employeeReferenceConflict = conflicts.some((conflict) => dbsControlConflictCode(conflict) === "DBS_OS_EMPLOYEE_NOT_FOUND");
        const resultMessage = hasConflict
          ? autoResolvableConflict
            ? null
            : employeeReferenceConflict
              ? "O técnico selecionado não está disponível no cadastro. Atualize a lista de colaboradores e tente novamente."
            : permanentConflict
              ? "A alteração ficou pendente de revisão. Nenhum dado foi descartado e não haverá novas tentativas automáticas."
              : `Conflito de versão em ${result.conflicts.length} OS. Recarregue a tela para reconciliar sem sobrescrever dados.`
          : null;

        if (hasConflict && !autoResolvableConflict) {
          await persistLocalSyncCommand({
            id: batchId,
            changes: conflictingChanges ?? changes,
            requestIds,
            status: "conflict",
            attempts: attempt,
            nextAttemptAt: Number.MAX_SAFE_INTEGER,
            lastError: resultMessage,
            conflicts,
          });
        } else {
          await deleteDbsControlLocalSyncCommand(batchId);
          localSyncCommandsRef.current.delete(batchId);
        }

        // A second edit is deliberately kept in a different local command and
        // is promoted only after the first transaction has an ACK.
        pendingChangesRef.current = hasConflict && !autoResolvableConflict ? (conflictingChanges ?? changes) : null;
        pendingBatchIdRef.current = hasConflict && !autoResolvableConflict ? batchId : null;
        pendingSaveRequestIdsRef.current = hasConflict && !autoResolvableConflict ? requestIds : [];
        if (!hasConflict || autoResolvableConflict) {
          promoteQueuedCommandAfterCommit();
        }
        retryAttemptRef.current = 0;
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
        logSyncEvent(hasConflict ? "save_conflict" : "save_applied", {
          requestCount: requestIds.length,
          applied: Number(result.applied ?? 0),
          conflicts: hasConflict ? result.conflicts.length : 0,
          localQueue: true,
        });
        setCloudError(resultMessage);
        const ackUpdatedAt = cloudUpdatedAtRef.current;
        requestIds.forEach((id) => iframeRef.current?.contentWindow?.postMessage({
          type: "DBS_CONTROL_SAVE_ACK",
          requestId: id,
          ok: !hasConflict,
          updated_at: ackUpdatedAt,
          conflicts: result.conflicts ?? [],
          appliedOrders: result.appliedOrders ?? [],
          committedChanges,
          pendingCount: pendingChangesRef.current ? 1 : 0,
          error: resultMessage ?? undefined,
        }, "*"));
        if (hasConflict) {
          iframeRef.current?.contentWindow?.postMessage({
            type: "DBS_CONTROL_SYNC_CONFLICT",
            conflicts: result.conflicts ?? [],
            changes,
            requestIds,
            permanent: permanentConflict,
            autoResolvable: autoResolvableConflict,
          }, "*");
        }
        await postLocalSyncStatus(hasConflict && !autoResolvableConflict ? "conflict" : "synced");

        if (!hasConflict || autoResolvableConflict) {
          if (pendingChangesRef.current) scheduleLocalSyncRetry(0);
          void (async () => {
            try {
              const latest = await Promise.race([
                getDbsControlCloudState(),
                new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
              ]);
              if (!latest?.state) {
                logSyncEvent("post_save_refresh_timeout");
                return;
              }
              cloudUpdatedAtRef.current = latest.updated_at ?? cloudUpdatedAtRef.current;
              if (!pendingChangesRef.current) {
                iframeRef.current?.contentWindow?.postMessage({
                  type: "DBS_CONTROL_CLOUD_STATE", state: latest.state, baseState: latest.state,
                }, "*");
              }
              sendDashboardSummary();
            } catch (refreshError) {
              logSyncEvent("post_save_refresh_error", {
                message: refreshError instanceof Error ? refreshError.message : "Falha ao atualizar a leitura após a gravação.",
              });
            }
          })();
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Falha ao salvar o DBS CONTROL.";
        const transient = isDbsControlTransientError(err) || /Outra aba está sincronizando/i.test(message);
        const delays = [5000, 15000, 45000, 120000, 300000, 900000];
        const retryDelay = delays[Math.min(retryAttemptRef.current, delays.length - 1)];
        if (transient && retryAttemptRef.current < delays.length) retryAttemptRef.current += 1;
        await persistLocalSyncCommand({
          id: batchId,
          changes,
          requestIds,
          status: transient && retryAttemptRef.current <= delays.length ? "pending" : "error",
          attempts: attempt,
          nextAttemptAt: transient && retryAttemptRef.current <= delays.length ? Date.now() + retryDelay : Number.MAX_SAFE_INTEGER,
          lastError: message,
        });
        logSyncEvent("save_error", { message, attempt, transient, localQueue: true });
        setCloudError(dbsControlUserFacingSyncMessage(err));
        await postLocalSyncStatus(transient ? "pending" : "error");
        requestIds.forEach((id) => iframeRef.current?.contentWindow?.postMessage({
          type: "DBS_CONTROL_SAVE_ACK",
          requestId: id,
          ok: false,
          error: message,
          queuedLocally: transient,
          retryAt: transient ? Date.now() + retryDelay : undefined,
        }, "*"));
        if (transient && retryAttemptRef.current <= delays.length) {
          if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
          retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null;
            retryPendingSaveRef.current?.();
          }, retryDelay);
        }
      } finally {
        saveInFlightRef.current = false;
      }
    };

    retryPendingSaveRef.current = (manual = false) => {
      const activeBatchId = pendingBatchIdRef.current;
      const activeCommand = activeBatchId ? localSyncCommandsRef.current.get(activeBatchId) : null;
      // A permanent conflict must wait for the operator's explicit choice. A
      // focus/online event must never resurrect it as an automatic retry.
      if (activeCommand?.status === "conflict") {
        retryTimerRef.current = null;
        void postLocalSyncStatus("conflict");
        return;
      }
      if (manual) {
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        retryAttemptRef.current = 0;
        const batchId = pendingBatchIdRef.current;
        if (batchId) {
          void updateDbsControlLocalSyncCommand(batchId, {
            status: "pending",
            nextAttemptAt: Date.now(),
            leaseUntil: null,
            lastError: null,
          });
          const existing = localSyncCommandsRef.current.get(batchId);
          if (existing) localSyncCommandsRef.current.set(batchId, { ...existing, status: "pending", nextAttemptAt: Date.now(), leaseUntil: null, lastError: null });
        }
      }
      retryTimerRef.current = null;
      saveQueueRef.current = saveQueueRef.current.then(persist, persist);
    };

    const handler = async (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const msg = event.data || {};
      if (msg.type === "DBS_CONTROL_BACK_TO_MAIN") {
        navigate({ to: "/folha-ponto", replace: true });
        return;
      }
      if (msg.type === "DBS_CONTROL_LOGOUT") {
        try {
          await supabase.auth.signOut();
        } finally {
          navigate({ to: "/login", replace: true });
        }
        return;
      }
      if (msg.type === "DBS_CONTROL_REFRESH_DASHBOARD_SUMMARY") {
        sendDashboardSummary();
        return;
      }
      if (msg.type === "DBS_CONTROL_UPLOAD_ATTACHMENT") {
        try {
          const attachment = await withDbsControlTransientRetry(() => uploadDbsControlOsAttachment({ data: {
              orderId: String(msg.orderId || ""),
              attachmentType: msg.attachmentType,
              fileName: String(msg.fileName || "evidencia"),
              contentType: String(msg.contentType || ""),
              dataBase64: String(msg.dataBase64 || ""),
              requestId: String(msg.requestId || ""),
            } }));
          iframeRef.current?.contentWindow?.postMessage({
            type: "DBS_CONTROL_UPLOAD_ATTACHMENT_RESULT", requestId: msg.requestId, ok: true, attachment,
          }, window.location.origin);
        } catch (error) {
          iframeRef.current?.contentWindow?.postMessage({
            type: "DBS_CONTROL_UPLOAD_ATTACHMENT_RESULT", requestId: msg.requestId, ok: false,
            error: error instanceof Error ? error.message : "Falha no upload do anexo.",
          }, window.location.origin);
        }
        return;
      }

      if (msg.type === "DBS_CONTROL_DB_AUDIT") {
        try {
          const result = await auditDbsControlDatabase();
          iframeRef.current?.contentWindow?.postMessage({
            type: "DBS_CONTROL_DB_AUDIT_RESULT",
            ok: true,
            result,
          }, "*");
        } catch (err) {
          iframeRef.current?.contentWindow?.postMessage({
            type: "DBS_CONTROL_DB_AUDIT_RESULT",
            ok: false,
            error: err instanceof Error ? err.message : "Não foi possível auditar a base de produção.",
          }, "*");
        }
        return;
      }

      if (msg.type === "DBS_CONTROL_FIELD_ORDER_DETAILS") {
        try {
          const result = await getFieldControlWorkOrderDetails({ data: { workOrderId: String(msg.workOrderId || "") } });
          iframeRef.current?.contentWindow?.postMessage({
            type: "DBS_CONTROL_FIELD_ORDER_DETAILS_RESULT",
            ok: true,
            workOrderId: String(msg.workOrderId || ""),
            result,
          }, "*");
        } catch (err) {
          iframeRef.current?.contentWindow?.postMessage({
            type: "DBS_CONTROL_FIELD_ORDER_DETAILS_RESULT",
            ok: false,
            workOrderId: String(msg.workOrderId || ""),
            error: err instanceof Error ? err.message : "Não foi possível carregar o histórico FieldControl.",
          }, "*");
        }
        return;
      }

      if (msg.type === "DBS_CONTROL_REFRESH_MASTER_DATA") {
        try {
          const importedState = await getFieldControlImportedState();
          const result = await applyDbsControlDelta({ data: {
            requestId: `fieldcontrol:${Date.now()}`,
            changes: {
              clientes: Array.isArray(importedState.clientes) ? importedState.clientes : [],
              equipamentos: Array.isArray(importedState.equipamentos) ? importedState.equipamentos : [],
              servicos: Array.isArray(importedState.servicos) ? importedState.servicos : [],
              ordens: Array.isArray(importedState.ordens) ? importedState.ordens : [],
            },
          } });
          const cloud = await withDbsControlTransientRetry(() => getDbsControlCloudState());
          if (cloud?.state) iframeRef.current?.contentWindow?.postMessage({ type: "DBS_CONTROL_CLOUD_STATE", state: cloud.state, baseState: cloud.state }, "*");
          sendDashboardSummary();
          iframeRef.current?.contentWindow?.postMessage({ type: "DBS_CONTROL_MASTER_REFRESH_RESULT", ok: true, result }, "*");
        } catch (err) {
          console.error("DBS Control master refresh:", err);
          iframeRef.current?.contentWindow?.postMessage({
            type: "DBS_CONTROL_MASTER_REFRESH_RESULT",
            ok: false,
            error: err instanceof Error ? err.message : "Falha ao atualizar a base principal.",
          }, "*");
        }
        return;
      }

      if (msg.type === "DBS_CONTROL_READY") {
        iframeRef.current?.contentWindow?.postMessage({ type: "DBS_CONTROL_PARENT_READY" }, window.location.origin);
        if (cloudReadyRef.current || readyHydrationInFlightRef.current) return;
        readyHydrationInFlightRef.current = true;
        sendDashboardSummary();
        try {
          await hydrateLocalSyncQueue();
          const cloud = await withDbsControlTransientRetry(() => getDbsControlCloudState());
          const cloudState = cloud?.state && typeof cloud.state === "object" && !Array.isArray(cloud.state)
            ? cloud.state as Record<string, unknown>
            : null;
          const localState = msg.state && typeof msg.state === "object" && !Array.isArray(msg.state)
            ? JSON.parse(JSON.stringify(msg.state)) as Record<string, unknown>
            : null;

          const localHasData = dbsControlStateHasData(localState);
          localRecoveryStateRef.current = localState;
          // Um cache local com dados nunca pode ser promovido a estado compartilhado
          // quando a leitura canônica retorna nula. Isso evita que uma falha de
          // gateway pareça uma base vazia e gere regravações indevidas.
          if (!cloudState && !employeeModeRef.current) {
            if (localHasData && localState) {
              iframeRef.current?.contentWindow?.postMessage({ type: "DBS_CONTROL_LOCAL_RECOVERY" }, "*");
              throw new Error(
                "A base compartilhada não retornou dados. A cópia local foi preservada em somente leitura; nenhuma gravação será enviada.",
              );
            }
            const initialState: Record<string, unknown> = {
              tecnicos: [], clientes: [], equipamentos: [], pecas: [],
              servicos: [], compras: [], ordens: [], osHistorico: [],
            };
            cloudReadyRef.current = true;
            cloudUpdatedAtRef.current = null;
            iframeRef.current?.contentWindow?.postMessage(
              { type: "DBS_CONTROL_CLOUD_STATE", state: initialState, baseState: initialState, allowEmptyBaseBootstrap: true },
              "*",
            );
            iframeRef.current?.contentWindow?.postMessage({
              type: "DBS_CONTROL_SYNC_STATUS",
              status: "synced",
              pendingCount: 0,
              updated_at: null,
            }, "*");
            await postLocalSyncStatus("synced");
            setCloudError(null);
            return;
          }
          // A sessão de colaborador recebe deliberadamente um subconjunto da base (somente OS e cadastros vinculados).
          // A leitura remota continua sendo a única fonte de verdade para a hidratação.
          if (cloudState) {
            // Uma cópia local maior ou mais recente nunca vira uma intenção de
            // escrita implícita. Ela permanece preservada para auditoria.
            const reconciledInitialState = cloudState;
            if (!employeeModeRef.current && localHasData && dbsControlStateIsSmallerThan(localState, cloudState)) {
              console.warn("DBS Control: snapshot remoto menor; cópia local preservada somente para auditoria.");
            }
            cloudReadyRef.current = true;
            cloudUpdatedAtRef.current = cloud?.updated_at ?? null;
            iframeRef.current?.contentWindow?.postMessage(
              { type: "DBS_CONTROL_CLOUD_STATE", state: reconciledInitialState, baseState: cloudState },
              "*",
            );
            // Remove o estado inicial "aguardando" assim que a leitura autoritativa da nuvem termina.
            await postLocalSyncStatus("synced");
            const restoredCommand = (pendingBatchIdRef.current
              ? localSyncCommandsRef.current.get(pendingBatchIdRef.current)
              : null)
              ?? [...localSyncCommandsRef.current.values()].find((command) => command.status === "conflict" && command.conflicts?.length)
              ?? null;
            if (restoredCommand?.status === "conflict" && restoredCommand.conflicts?.length) {
              iframeRef.current?.contentWindow?.postMessage({
                type: "DBS_CONTROL_SYNC_CONFLICT",
                conflicts: restoredCommand.conflicts,
                changes: restoredCommand.changes,
                requestIds: restoredCommand.requestIds,
                permanent: true,
              }, "*");
            } else if (restoredCommand?.status === "pending" || restoredCommand?.status === "sending") {
              scheduleLocalSyncRetry(0);
            }
          } else {
            // A recuperação local é explicitamente somente leitura e nunca é enviada à nuvem.
            iframeRef.current?.contentWindow?.postMessage({ type: "DBS_CONTROL_LOCAL_RECOVERY" }, "*");
            throw new Error(
              localState
                ? "AMBIENTE DESCONECTADO / VERIFIQUE AS VARIÁVEIS DE AMBIENTE: a base compartilhada não retornou um snapshot. A cópia local foi preservada em somente leitura; nenhuma gravação será enviada."
                : "AMBIENTE DESCONECTADO / VERIFIQUE AS VARIÁVEIS DE AMBIENTE: o DBS CONTROL não conseguiu estabelecer conexão com a base compartilhada.",
            );
          }

          setCloudError(null);
        } catch (err) {
          console.error("DBS Control cloud load:", err);
          const message = dbsControlUserFacingSyncMessage(err);
          setCloudError(message);
          iframeRef.current?.contentWindow?.postMessage({ type: "DBS_CONTROL_LOCAL_RECOVERY" }, "*");
          iframeRef.current?.contentWindow?.postMessage({
            type: "DBS_CONTROL_SYNC_STATUS",
            status: "error",
            pendingCount: 0,
            error: message,
          }, "*");
          await postLocalSyncStatus("error");
        } finally {
          readyHydrationInFlightRef.current = false;
        }
        return;
      }

      if (msg.type === "DBS_CONTROL_REGISTER_TECHNICIAN") {
        try {
          const name = String(msg.name || "").trim();
          const email = String(msg.email || "").trim().toLowerCase();
          const password = String(msg.password || "");
          const position = String(msg.position || "").trim();
          const phone = String(msg.phone || "").trim();
          if (!name || !email || !password) throw new Error("Nome, e-mail e senha são obrigatórios.");

          const registry = await listRhEmployeeRegistry();
          const existing = (registry as any[]).find((employee) =>
            String(employee.access?.user?.email || "").toLowerCase() === email ||
            String(employee.registration_data?.email || "").toLowerCase() === email
          );

          let employeeId = existing?.id;
          if (!employeeId) {
            const created = await saveRhEmployeeRecord({
              data: {
                full_name: name,
                unit: "Não informado",
                registration_data: { email, phone, position, source: "DBS_CONTROL" },
              },
            } as any);
            employeeId = created.id;
          }

          let linked = (registry as any[]).find((employee) =>
            String(employee.access?.user?.email || "").toLowerCase() === email
          )?.access?.user;

          if (!linked) {
            const collaborators = await listRhCollaboratorUsers();
            linked = (collaborators as any[]).find((user) =>
              String(user.email || "").toLowerCase() === email
            );
          }

          if (!linked) {
            await createClientUser({
              data: {
                full_name: name,
                email,
                role_key: "COLABORADOR",
                password,
              },
            } as any);
          }

          await saveRhEmployeeAccess({
            data: {
              employee_id: employeeId,
              enabled: true,
              login_identifier: email,
              dbs_control_enabled: true,
            },
          } as any);

          iframeRef.current?.contentWindow?.postMessage(
            { type: "DBS_CONTROL_TECHNICIAN_SYNCED", ok: true, email, employee_id: employeeId, name, position, phone },
            "*",
          );
        } catch (err) {
          iframeRef.current?.contentWindow?.postMessage(
            { type: "DBS_CONTROL_TECHNICIAN_SYNCED", ok: false, error: err instanceof Error ? err.message : "Falha ao criar acesso." },
            "*",
          );
        }
        return;
      }

      if (msg.type === "DBS_CONTROL_FIELDCONTROL") {
        try {
          const action = String(msg.action || "");
          if (action === "status") {
            const result = await getFieldControlIntegrationStatus();
            iframeRef.current?.contentWindow?.postMessage({ type: "DBS_CONTROL_FIELDCONTROL_RESULT", action, ok: true, result }, "*");
          } else if (action === "save_key") {
            const apiKey = String(msg.apiKey || "").trim();
            await saveFieldControlApiKey({ data: { apiKey } });
            const result = await testFieldControlConnection();
            iframeRef.current?.contentWindow?.postMessage({ type: "DBS_CONTROL_FIELDCONTROL_RESULT", action, ok: true, result: { saved: true, test: result } }, "*");
          } else if (action === "test") {
            const result = await testFieldControlConnection();
            iframeRef.current?.contentWindow?.postMessage({ type: "DBS_CONTROL_FIELDCONTROL_RESULT", action, ok: true, result }, "*");
          } else if (action === "sync_preview" || action === "sync_apply") {
            const result = await syncFieldControl({ data: { mode: action === "sync_apply" ? "apply" : "preview" } });
            if (action === "sync_apply" && result?.ok && (result as any)?.status !== "error") {
              const importedState = await getFieldControlImportedState();
              await applyDbsControlDelta({ data: {
                requestId: `fieldcontrol:${Date.now()}`,
                changes: {
                  clientes: Array.isArray(importedState.clientes) ? importedState.clientes : [],
                  equipamentos: Array.isArray(importedState.equipamentos) ? importedState.equipamentos : [],
                  servicos: Array.isArray(importedState.servicos) ? importedState.servicos : [],
                  ordens: Array.isArray(importedState.ordens) ? importedState.ordens : [],
                },
              } });
              const cloud = await withDbsControlTransientRetry(() => getDbsControlCloudState());
              if (cloud?.state) iframeRef.current?.contentWindow?.postMessage({ type: "DBS_CONTROL_CLOUD_STATE", state: cloud.state, baseState: cloud.state }, "*");
              result.summary = { ...result.summary, visible_in_dbs_control: true };
            }
            iframeRef.current?.contentWindow?.postMessage({ type: "DBS_CONTROL_FIELDCONTROL_RESULT", action, ok: true, result }, "*");
          } else {
            throw new Error("Ação FieldControl desconhecida.");
          }
        } catch (err) {
          iframeRef.current?.contentWindow?.postMessage({
            type: "DBS_CONTROL_FIELDCONTROL_RESULT",
            action: String(msg.action || ""),
            ok: false,
            error: err instanceof Error ? err.message : "Falha na integração FieldControl.",
          }, "*");
        }
        return;
      }

      if (msg.type === "DBS_CONTROL_OPEN_RH_EMPLOYEE") {
        const employeeId = String(msg.employee_id || "").trim();
        if (employeeId) {
          sessionStorage.setItem("DBS_RH_OPEN_EMPLOYEE", employeeId);
          await navigate({ to: "/admin/rh-dashboard", replace: true });
        }
        return;
      }

      if (msg.type === "DBS_CONTROL_DELETE_WORK_ORDER") {
        const requestId = typeof msg.requestId === "string" ? msg.requestId : crypto.randomUUID();
        try {
          const result = await withDbsControlTransientRetry(() => deleteDbsControlWorkOrder({
            data: {
              requestId,
              workOrderId: String(msg.workOrderId || ""),
              protocol: String(msg.protocol || ""),
            },
          }));
          iframeRef.current?.contentWindow?.postMessage({
            type: "DBS_CONTROL_DELETE_WORK_ORDER_ACK",
            requestId,
            ok: true,
            result,
          }, "*");

          // O soft delete já foi confirmado pelo RPC transacional. A atualização
          // visual da nuvem é uma etapa posterior e não deve transformar uma
          // exclusão concluída em erro para o usuário.
          try {
            const cloud = await withDbsControlTransientRetry(() => getDbsControlCloudState());
            if (cloud?.state) {
              iframeRef.current?.contentWindow?.postMessage({ type: "DBS_CONTROL_CLOUD_STATE", state: cloud.state, baseState: cloud.state }, "*");
            }
            sendDashboardSummary();
          } catch (refreshError) {
            logSyncEvent("delete_cloud_refresh_error", {
              requestId,
              message: refreshError instanceof Error ? refreshError.message : "Falha ao atualizar a visão após a exclusão.",
            });
          }
        } catch (err) {
          // Exclusão é uma intenção isolada. Não abrir o banner de conflito do
          // autosave e não pedir reconciliação: o iframe fará rollback local.
          logSyncEvent("delete_error", {
            requestId,
            message: err instanceof Error ? err.message : "Falha ao excluir a OS.",
          });
          iframeRef.current?.contentWindow?.postMessage({
            type: "DBS_CONTROL_DELETE_WORK_ORDER_ACK",
            requestId,
            ok: false,
            error: "Não foi possível excluir a OS agora. Nenhum dado foi perdido; tente novamente.",
          }, "*");
        }
        return;
      }

      if (msg.type === "DBS_CONTROL_RECONCILE_CONFLICT") {
        const conflictCommand = [...localSyncCommandsRef.current.values()]
          .find((command) => command.status === "conflict" && command.conflicts?.length);
        const draftBatchId = pendingBatchIdRef.current ?? conflictCommand?.id ?? null;
        const draftChanges = pendingChangesRef.current ?? conflictCommand?.changes ?? null;
        try {
          const latest = await withDbsControlTransientRetry(() => getDbsControlCloudState());
          if (!latest?.state || typeof latest.state !== "object") {
            throw new Error("A versão mais recente da OS não está disponível para reconciliação.");
          }
          if (draftBatchId) {
            await deleteDbsControlLocalSyncCommand(draftBatchId);
            localSyncCommandsRef.current.delete(draftBatchId);
          }
          pendingChangesRef.current = null;
          pendingBatchIdRef.current = null;
          pendingSaveRequestIdsRef.current = [];
          cloudReadyRef.current = true;
          cloudUpdatedAtRef.current = latest.updated_at ?? cloudUpdatedAtRef.current;
          setCloudError(null);
          iframeRef.current?.contentWindow?.postMessage({
            type: "DBS_CONTROL_CONFLICT_RECONCILED",
            state: latest.state,
            changes: draftChanges ?? {},
            conflicts: Array.isArray(msg.conflicts) ? msg.conflicts : [],
            updated_at: latest.updated_at ?? null,
          }, "*");
          if (promoteQueuedCommandAfterCommit()) scheduleLocalSyncRetry(0);
          await postLocalSyncStatus(pendingChangesRef.current ? "pending" : "synced");
        } catch (err) {
          const message = err instanceof Error ? err.message : "Não foi possível carregar a versão atual da OS.";
          setCloudError(dbsControlUserFacingSyncMessage(err));
          iframeRef.current?.contentWindow?.postMessage({
            type: "DBS_CONTROL_SYNC_STATUS",
            status: "error",
            pendingCount: pendingChangesRef.current ? 1 : 0,
            error: message,
          }, "*");
        }
        return;
      }

      if (msg.type === "DBS_CONTROL_RETRY_SAVE") {
        retryPendingSaveRef.current?.(true);
        return;
      }

      if (msg.type === "DBS_CONTROL_DISMISS_CONFLICT") {
        const conflicts = Array.isArray(msg.conflicts) ? msg.conflicts : [];
        const dismissedBatchId = pendingBatchIdRef.current
          ?? [...localSyncCommandsRef.current.values()].find((command) => command.status === "conflict" && command.conflicts?.length)?.id
          ?? null;
        const conflictingChanges = dbsControlSelectConflictingChanges(pendingChangesRef.current, conflicts);
        if (pendingChangesRef.current === conflictingChanges || conflictingChanges === null) {
          pendingChangesRef.current = conflictingChanges ? null : pendingChangesRef.current;
        } else {
          pendingChangesRef.current = dbsControlSubtractChanges(pendingChangesRef.current, conflictingChanges);
        }
        if (!pendingChangesRef.current) {
          if (dismissedBatchId) {
            await deleteDbsControlLocalSyncCommand(dismissedBatchId);
            localSyncCommandsRef.current.delete(dismissedBatchId);
          }
          pendingBatchIdRef.current = null;
          pendingSaveRequestIdsRef.current = [];
          if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
          if (promoteQueuedCommandAfterCommit()) scheduleLocalSyncRetry(0);
        }
        try {
          const latest = await withDbsControlTransientRetry(() => getDbsControlCloudState());
          cloudReadyRef.current = true;
          cloudUpdatedAtRef.current = latest?.updated_at ?? cloudUpdatedAtRef.current;
          setCloudError(null);
          if (latest?.state) {
            iframeRef.current?.contentWindow?.postMessage({
              type: "DBS_CONTROL_CLOUD_STATE",
              state: latest.state,
              baseState: latest.state,
            }, "*");
          }
          await postLocalSyncStatus(pendingChangesRef.current ? "pending" : "synced");
        } catch (error) {
          logSyncEvent("conflict_dismiss_refresh_error", {
            message: error instanceof Error ? error.message : "Falha ao atualizar a OS protegida.",
          });
        }
        return;
      }

      if (msg.type === "DBS_CONTROL_SAVE") {
        const requestId = typeof msg.requestId === "string" && msg.requestId.trim()
          ? msg.requestId.trim().slice(0, 160)
          : `autosave:${crypto.randomUUID()}`;
        if (requestId.startsWith("reconcile:")) {
          logSyncEvent("legacy_reconcile_blocked", { requestId });
          iframeRef.current?.contentWindow?.postMessage({
            type: "DBS_CONTROL_SAVE_ACK", requestId, ok: false,
            error: "A reconciliação automática legada foi bloqueada. A cópia local foi preservada para auditoria; nenhum dado foi sobrescrito.",
          }, "*");
          return;
        }
        if (!msg.changes || typeof msg.changes !== "object" || Array.isArray(msg.changes)) {
          iframeRef.current?.contentWindow?.postMessage({
            type: "DBS_CONTROL_SAVE_ACK", requestId, ok: false,
            error: "O cliente enviou um snapshot antigo. Atualize a tela para usar o salvamento relacional por deltas.",
          }, "*");
          return;
        }
        await hydrateLocalSyncQueue();
        const incomingChanges = msg.changes as Record<string, any[]>;
        if (saveInFlightRef.current) {
          if (!queuedBatchIdRef.current) queuedBatchIdRef.current = requestId;
          queuedChangesRef.current = mergeDbsControlChanges(queuedChangesRef.current, incomingChanges);
          if (requestId && !queuedRequestIdsRef.current.includes(requestId)) queuedRequestIdsRef.current.push(requestId);
          if (queuedBatchIdRef.current && queuedChangesRef.current) {
            await persistLocalSyncCommand({
              id: queuedBatchIdRef.current,
              changes: queuedChangesRef.current,
              requestIds: queuedRequestIdsRef.current,
              status: "pending",
            });
          }
          await postLocalSyncStatus("pending");
          return;
        }
        if (!pendingBatchIdRef.current) pendingBatchIdRef.current = requestId;
        pendingChangesRef.current = mergeDbsControlChanges(pendingChangesRef.current, incomingChanges);
        if (requestId && !pendingSaveRequestIdsRef.current.includes(requestId)) pendingSaveRequestIdsRef.current.push(requestId);
        if (pendingBatchIdRef.current && pendingChangesRef.current) {
          await persistLocalSyncCommand({
            id: pendingBatchIdRef.current,
            changes: pendingChangesRef.current,
            requestIds: pendingSaveRequestIdsRef.current,
            status: "pending",
          });
        }
        if (!cloudReadyRef.current) {
          await postLocalSyncStatus("pending");
        }
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
          saveTimerRef.current = null;
          retryPendingSaveRef.current?.();
        }, 450);
      }
    };

    window.addEventListener("message", handler);

    // Supabase Realtime: somente tabelas relacionais canônicas, reconexão automática
    // e fallback de 30 s. Snapshots não são mais canal de gravação nem de sincronização.
    let refreshInFlight = false;
    let refreshGeneration = 0;
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;
    let realtimeSubscriptionGeneration = 0;
    const refreshLatestCloudState = async (force = false) => {
      if (disposed || saveTimerRef.current || refreshInFlight) return false;
      refreshInFlight = true;
      const generation = ++refreshGeneration;
      try {
        const latest = await withDbsControlTransientRetry(() => getDbsControlCloudState());
        if (disposed || generation !== refreshGeneration || !latest?.state || !latest.updated_at) return false;
        // O payload do colaborador é filtrado no servidor; o cache local pode conter arrays maiores por design.
        // A leitura remota é canônica em todos os modos: uma resposta menor é
        // diagnosticada, mas nunca completada com cache local nem regravada.
        const latestCloudState = latest.state as Record<string, unknown>;
        const reconciledLatestState = latestCloudState;
        if (!employeeModeRef.current && dbsControlStateIsSmallerThan(localRecoveryStateRef.current, latestCloudState)) {
          console.warn("DBS Control: snapshot remoto menor durante o realtime; cópia local preservada somente para auditoria.");
        }
        // A falha na leitura inicial não pode bloquear todas as tentativas seguintes.
        // A primeira leitura válida também libera a fila de gravação do iframe.
        cloudReadyRef.current = true;
        if (pendingChangesRef.current || saveTimerRef.current || saveInFlightRef.current) {
          iframeRef.current?.contentWindow?.postMessage({ type: "DBS_CONTROL_SYNC_STATUS", status: "pending", pendingCount: 1 }, "*");
          return;
        }
        if (force || latest.updated_at !== cloudUpdatedAtRef.current) {
          logSyncEvent("canonical_reconciled", { forced: force, changed: latest.updated_at !== cloudUpdatedAtRef.current });
          cloudUpdatedAtRef.current = latest.updated_at;
          iframeRef.current?.contentWindow?.postMessage({ type: "DBS_CONTROL_CLOUD_STATE", state: reconciledLatestState, baseState: latestCloudState }, "*");
          sendDashboardSummary();
        }
        setCloudError(null);
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Falha ao atualizar as OS atribuídas.";
        logSyncEvent("realtime_recovery_error", { message });
        setCloudError(dbsControlUserFacingSyncMessage(err));
        return false;
      } finally {
        refreshInFlight = false;
      }
    };
    const subscribeToCanonicalTables = () => {
      if (disposed) return;
      // Keep the topic owned by this mounted shell. Removing every channel with
      // a shared name used to make a second tab/hot-reload disconnect the first.
      const channelName = `dbs-control-work-orders-realtime:${crypto.randomUUID()}`;
      const subscriptionGeneration = ++realtimeSubscriptionGeneration;
      const previousChannel = realtimeChannel;
      realtimeChannel = null;
      if (previousChannel) void supabase.removeChannel(previousChannel);
      const channelPrefix = "realtime:dbs-control-work-orders-realtime:";
      for (const existing of supabase.getChannels()) {
        if (existing.topic.startsWith(channelPrefix)) void supabase.removeChannel(existing);
      }
      realtimeChannel = supabase.channel(channelName)
        .on("postgres_changes", { event: "*", schema: "public", table: "dbs_control_work_orders" }, () => {
          void refreshLatestCloudState(true);
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "dbs_control_work_order_events" }, () => {
          void refreshLatestCloudState(true);
        })
        .subscribe((status) => {
          if (disposed || subscriptionGeneration !== realtimeSubscriptionGeneration) return;
          logSyncEvent("realtime_status", { status });
          if (status === "SUBSCRIBED") {
            void refreshLatestCloudState();
            setCloudError(null);
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            logSyncEvent("realtime_retry", { status, delayMs: 3000 });
            setCloudError("Realtime desconectado. Recuperação automática em andamento.");
            if (reconnectTimer) clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(() => {
              if (disposed || subscriptionGeneration !== realtimeSubscriptionGeneration) return;
              const previous = realtimeChannel;
              realtimeChannel = null;
              if (previous) void supabase.removeChannel(previous);
              subscribeToCanonicalTables();
            }, 3000);
          }
        });
    };
    subscribeToCanonicalTables();
    // Não depender do evento SUBSCRIBED para a primeira reconciliação:
    // após 3 s, faz leitura autoritativa direta se o handshake Realtime ainda
    // não tiver estabilizado. A leitura não grava nem sobrescreve dados locais.
    const realtimeInitialFallbackTimer = setTimeout(() => {
      // Tentar a leitura mesmo quando a inicialização falhou; caso contrário, cloudReadyRef
      // permanece false e o fallback nunca consegue recuperar a conexão sozinho.
      if (!disposed) void refreshLatestCloudState(true);
    }, 3000);
    // Fallback periódico leve: primeiro lê um cursor indexado (1 linha). A
    // hidratação completa só acontece quando o cursor mudou, evitando milhares
    // de objetos e eliminando a dependência exclusiva do websocket.
    let syncPollInFlight = false;
    const pollSyncCursor = async () => {
      if (disposed || syncPollInFlight) return;
      syncPollInFlight = true;
      try {
        const cursorResult = await withDbsControlTransientRetry(() => getDbsControlSyncCursor());
        const nextCursor = cursorResult?.cursor ?? null;
        if (syncCursorRef.current === null) {
          syncCursorRef.current = nextCursor;
        } else if (nextCursor !== syncCursorRef.current) {
          const refreshed = await refreshLatestCloudState(true);
          if (refreshed) syncCursorRef.current = nextCursor;
        }
      } catch (err) {
        logSyncEvent("sync_cursor_error", { message: err instanceof Error ? err.message : "Falha ao consultar o cursor de sincronização." });
      } finally {
        syncPollInFlight = false;
      }
    };
    const refreshTimer = setInterval(() => { void pollSyncCursor(); }, 10000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        retryPendingSaveRef.current?.();
        void refreshLatestCloudState();
      }
    };
    const handleOnline = () => {
      logSyncEvent("network_online");
      retryPendingSaveRef.current?.(true);
      void refreshLatestCloudState();
    };
    const handleOffline = () => {
      logSyncEvent("network_offline");
      void postLocalSyncStatus("pending");
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("focus", handleVisibilityChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      disposed = true;
      window.removeEventListener("message", handler);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("focus", handleVisibilityChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearInterval(refreshTimer);
      clearTimeout(realtimeInitialFallbackTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      realtimeSubscriptionGeneration += 1;
      if (realtimeChannel) void supabase.removeChannel(realtimeChannel);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (localSyncRetryTimerRef.current) clearTimeout(localSyncRetryTimerRef.current);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      employeeFrameDocumentRef.current = null;
    };
  }, []);

  if (profile.isLoading || access.isLoading) {
    return <div className="min-h-screen grid place-items-center bg-slate-50 text-sm text-slate-500">Carregando DBS CONTROL...</div>;
  }

  if (access.isError) {
    const accessErrorMessage = access.error instanceof Error ? access.error.message : "";
    const accessErrorIsTransient = isDbsControlTransientError(access.error)
      || /invalid api key|jwt|unauthorized|network|fetch failed/i.test(accessErrorMessage);
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 p-6">
        <section role="alert" className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-7 text-center shadow-sm">
          <h1 className="text-xl font-black text-slate-900">Não foi possível verificar o acesso ao DBS CONTROL</h1>
          <p className="mt-3 break-words text-sm text-slate-600">
            {accessErrorIsTransient
              ? "A conexão está temporariamente indisponível. Tente novamente; seus dados operacionais não foram alterados."
              : "O serviço de acesso não respondeu corretamente. Tente novamente ou volte ao painel."}
          </p>
          {accessErrorMessage && (
            <details className="mt-3 text-left text-[11px] text-slate-400">
              <summary className="cursor-pointer select-none">Detalhes técnicos</summary>
              <code className="mt-2 block break-words rounded-lg bg-slate-50 p-2">{accessErrorMessage}</code>
            </details>
          )}
          <button onClick={() => void access.refetch()} className="mt-5 min-h-11 rounded-xl bg-sky-600 px-4 py-2 text-sm font-bold text-white">Tentar novamente</button>
          <button onClick={() => navigate({ to: "/admin" })} className="ml-3 mt-5 min-h-11 rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700">Voltar ao painel</button>
        </section>
      </main>
    );
  }

  if (!access.data?.enabled) {
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
  employeeModeRef.current = employeeMode;
  // Cache-bust the legacy static shell after each operational hardening pass.
  // The shell is intentionally isolated in a full-width block so a stale
  // preview/debug node can never render beside the actual DBS CONTROL UI.
  const src = employeeMode
    ? `/dbs-control-shell.html?mode=employee&employee_id=${encodeURIComponent(access.data.employee?.id ?? "")}&employee_name=${encodeURIComponent(employeeName)}&employee_email=${encodeURIComponent(access.data.employee?.email ?? "")}&can_issue_os=${access.data.employee?.can_issue_work_orders ? "1" : "0"}&base_active=${access.data.employee?.base_active ? "1" : "0"}&base_name=${encodeURIComponent(access.data.employee?.base_name ?? "")}&v=20261029-front-quality-3`
    : "/dbs-control-shell.html?v=20261029-front-quality-3"

  if (employeeMode) {
    return (
      <main className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-[#f4f8fc]">
        {cloudError && (
          <section role="status" aria-live="polite" className="pointer-events-none absolute inset-x-3 top-3 z-20 rounded-xl border border-amber-200 bg-amber-50/95 px-3 py-2 shadow-sm backdrop-blur">
            <p className="text-xs font-bold text-amber-800">Sincronização em recuperação</p>
            <p className="mt-0.5 break-words text-[11px] text-amber-900">{cloudError}</p>
          </section>
        )}
        <iframe ref={iframeRef} title="DBS CONTROL" src={src} onLoad={handleEmployeeFrameLoad} className="min-h-0 w-full flex-1 border-0" allow="camera; geolocation" />
      </main>
    );
  }

  return (
    <main className="flex min-h-[100dvh] flex-col overflow-hidden bg-[#f4f8fc]">
      <div className="flex min-h-10 shrink-0 items-center justify-between border-b border-slate-200/80 bg-white/95 px-4 pb-[env(safe-area-inset-bottom)] shadow-[0_2px_14px_rgba(16,42,67,0.035)] backdrop-blur-xl">
        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">
          <span>DBS CONTROL</span>
          {cloudError && <span role="status" title={cloudError} className="rounded-full bg-amber-50 px-2 py-1 text-[9px] font-bold text-amber-800">Sincronização em recuperação</span>}
        </div>
        <button
          type="button"
          onClick={() => navigate({ to: employeeMode ? "/folha-ponto" : "/admin", replace: true })}
          className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-black text-slate-600 shadow-sm transition hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700"
        >
          ← Voltar ao menu principal
        </button>
      </div>
      {cloudError && (
        <section role="status" aria-live="polite" className="mx-4 mt-3 shrink-0 rounded-xl border border-amber-200 bg-amber-50 p-3 shadow-sm">
          <p className="text-sm font-bold text-amber-800">Sincronização em recuperação</p>
          <p className="mt-1 break-words text-xs text-amber-900">{cloudError}</p>
        </section>
      )}
      <iframe ref={iframeRef} title="DBS CONTROL" src={src} onLoad={handleEmployeeFrameLoad} className="min-h-0 w-full flex-1 border-0" allow="camera; geolocation" />
    </main>
  );
}
