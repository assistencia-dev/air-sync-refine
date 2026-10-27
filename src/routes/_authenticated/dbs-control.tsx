import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { createClientUser } from "@/lib/admin.functions";
import { hasMyDbsControlAccess, listRhEmployeeRegistry, listRhCollaboratorUsers, saveRhEmployeeRecord, saveRhEmployeeAccess } from "@/lib/rh.functions";
import { getMyProfile } from "@/lib/admin-profile.functions";
import { supabase } from "@/integrations/supabase/client";
import { applyDbsControlDelta, getDbsControlCloudState, getDbsControlDashboardSummary, auditDbsControlDatabase, uploadDbsControlOsAttachment } from "@/lib/dbs-control.functions";
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
  const access = useQuery({ queryKey: ["my-dbs-control-access"], queryFn: () => hasMyDbsControlAccess(), retry: false });
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Serialize writes from this browser so an earlier slow request cannot finish
  // after a newer request and overwrite the latest snapshot.
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingChangesRef = useRef<Record<string, any[]> | null>(null);
  const pendingBatchIdRef = useRef<string | null>(null);
  const saveInFlightRef = useRef(false);
  const pendingSaveRequestIdsRef = useRef<string[]>([]);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttemptRef = useRef(0);
  const retryPendingSaveRef = useRef<((manual?: boolean) => void) | null>(null);
  const cloudReadyRef = useRef(false);
  const cloudUpdatedAtRef = useRef<string | null>(null);
  const localRecoveryStateRef = useRef<Record<string, unknown> | null>(null);
  const employeeModeRef = useRef(false);
  const [cloudError, setCloudError] = useState<string | null>(null);

  // O HTML legado pode chegar do CDN sem o último asset de navegação. O shell
  // autenticado reaplica apenas a apresentação do colaborador no carregamento
  // do iframe, sem tocar nos dados nem nos handlers de negócio.
  const handleEmployeeFrameLoad = () => {
    if (!employeeModeRef.current) return;
    const frame = iframeRef.current;
    const frameDocument = frame?.contentDocument;
    if (!frameDocument) return;

    const employeeTitles: Record<string, [string, string]> = {
      "tab-dashboard": ["Meu painel", "Progresso e operação do colaborador"],
      "tab-pwa": ["Minhas OS", "Execução das Ordens de Serviço do colaborador"],
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

    if (frame.dataset.employeeUiBound !== "true") {
      frame.dataset.employeeUiBound = "true";
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
        });
    };

    const handler = async (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const msg = event.data || {};
      if (msg.type === "DBS_CONTROL_UPLOAD_ATTACHMENT") {
        try {
          const attachment = await uploadDbsControlOsAttachment({ data: {
            orderId: String(msg.orderId || ""),
            attachmentType: msg.attachmentType,
            fileName: String(msg.fileName || "evidencia"),
            contentType: String(msg.contentType || ""),
            dataBase64: String(msg.dataBase64 || ""),
            requestId: String(msg.requestId || ""),
          } });
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
          const cloud = await getDbsControlCloudState();
          if (cloud?.state) iframeRef.current?.contentWindow?.postMessage({ type: "DBS_CONTROL_CLOUD_STATE", state: cloud.state }, "*");
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
        sendDashboardSummary();
        try {
          const cloud = await getDbsControlCloudState();
          const cloudState = cloud?.state && typeof cloud.state === "object" && !Array.isArray(cloud.state)
            ? cloud.state as Record<string, unknown>
            : null;
          const localState = msg.state && typeof msg.state === "object" && !Array.isArray(msg.state)
            ? JSON.parse(JSON.stringify(msg.state)) as Record<string, unknown>
            : null;

          const localHasData = dbsControlStateHasData(localState);
          localRecoveryStateRef.current = localState;
          // O servidor retorna null somente quando não existe snapshot nem registro canônico
          // no escopo atual. Nesse caso, iniciar a base compartilhada vazia é mais seguro do que
          // bloquear todos os comandos por causa de um cache antigo deste navegador.
          // O iframe faz backup da cópia local antes da hidratação; nenhum cache é apagado.
          if (!cloudState && !employeeModeRef.current) {
            const initialState: Record<string, unknown> = {
              tecnicos: [], clientes: [], equipamentos: [], pecas: [],
              servicos: [], compras: [], ordens: [], osHistorico: [],
            };
            cloudReadyRef.current = true;
            cloudUpdatedAtRef.current = null;
            localRecoveryStateRef.current = initialState;
            iframeRef.current?.contentWindow?.postMessage(
              { type: "DBS_CONTROL_CLOUD_STATE", state: initialState, allowEmptyBaseBootstrap: true },
              "*",
            );
            iframeRef.current?.contentWindow?.postMessage({
              type: "DBS_CONTROL_SYNC_STATUS",
              status: "synced",
              pendingCount: 0,
              updated_at: null,
            }, "*");
            setCloudError(null);
            return;
          }
          // A sessão de colaborador recebe deliberadamente um subconjunto da base (somente OS e cadastros vinculados).
          // Comparar esse subconjunto com o cache local completo gera falso alarme de perda e bloqueia a sincronização.
          if (cloudState) {
            // A administração pode ter registros locais que ainda não chegaram ao snapshot
            // compartilhado. Reconciliamos por ID/protocolo antes de hidratar o iframe:
            // a nuvem prevalece nos campos preenchidos e os registros locais exclusivos
            // permanecem disponíveis para a próxima gravação. O colaborador recebe apenas
            // o recorte filtrado pelo servidor e nunca entra neste merge.
            const reconciledInitialState = employeeModeRef.current
              ? cloudState
              : mergeDbsControlStates(cloudState, localState);
            if (!employeeModeRef.current && localHasData && dbsControlStateIsSmallerThan(localState, cloudState)) {
              console.warn("DBS Control: snapshot remoto menor; estado administrativo reconciliado sem descarte.");
            }
            if (!employeeModeRef.current) localRecoveryStateRef.current = reconciledInitialState;
            cloudReadyRef.current = true;
            cloudUpdatedAtRef.current = cloud?.updated_at ?? null;
            iframeRef.current?.contentWindow?.postMessage(
              { type: "DBS_CONTROL_CLOUD_STATE", state: reconciledInitialState },
              "*",
            );
            // Remove o estado inicial "aguardando" assim que a leitura autoritativa da nuvem termina.
            iframeRef.current?.contentWindow?.postMessage({
              type: "DBS_CONTROL_SYNC_STATUS",
              status: "synced",
              pendingCount: 0,
              updated_at: cloud?.updated_at ?? null,
            }, "*");
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
          const rawMessage = err instanceof Error ? err.message : "Falha ao sincronizar o DBS CONTROL.";
          const connectionFailure = /missing supabase environment|failed to fetch|network|fetch failed|timeout|timed out|connection|invalid api key|jwt|unauthorized|not found/i.test(rawMessage);
          const message = connectionFailure
            ? `AMBIENTE DESCONECTADO / VERIFIQUE AS VARIÁVEIS DE AMBIENTE (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY e SUPABASE_URL/segredo do servidor). Detalhe: ${rawMessage}`
            : rawMessage;
          setCloudError(message);
          iframeRef.current?.contentWindow?.postMessage({ type: "DBS_CONTROL_LOCAL_RECOVERY" }, "*");
          iframeRef.current?.contentWindow?.postMessage({
            type: "DBS_CONTROL_SYNC_STATUS",
            status: "error",
            pendingCount: 0,
            error: message,
          }, "*");
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
              const cloud = await getDbsControlCloudState();
              if (cloud?.state) iframeRef.current?.contentWindow?.postMessage({ type: "DBS_CONTROL_CLOUD_STATE", state: cloud.state }, "*");
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

      if (msg.type === "DBS_CONTROL_RECONCILE_CONFLICT") {
        const draftChanges = pendingChangesRef.current;
        try {
          const latest = await withDbsControlTransientRetry(() => getDbsControlCloudState());
          if (!latest?.state || typeof latest.state !== "object") {
            throw new Error("A versão mais recente da OS não está disponível para reconciliação.");
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
        } catch (err) {
          const message = err instanceof Error ? err.message : "Não foi possível carregar a versão atual da OS.";
          setCloudError(message);
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

      if (msg.type === "DBS_CONTROL_SAVE") {
        const requestId = typeof msg.requestId === "string" ? msg.requestId : null;
        if (!msg.changes || typeof msg.changes !== "object" || Array.isArray(msg.changes)) {
          if (requestId) iframeRef.current?.contentWindow?.postMessage({
            type: "DBS_CONTROL_SAVE_ACK", requestId, ok: false,
            error: "O cliente enviou um snapshot antigo. Atualize a tela para usar o salvamento relacional por deltas.",
          }, "*");
          return;
        }
        if (saveInFlightRef.current) pendingBatchIdRef.current = crypto.randomUUID();
        if (!pendingBatchIdRef.current) pendingBatchIdRef.current = requestId ?? crypto.randomUUID();
        pendingChangesRef.current = mergeDbsControlChanges(pendingChangesRef.current, msg.changes as Record<string, any[]>);
        if (requestId && !pendingSaveRequestIdsRef.current.includes(requestId)) pendingSaveRequestIdsRef.current.push(requestId);
        if (!cloudReadyRef.current) {
          iframeRef.current?.contentWindow?.postMessage({ type: "DBS_CONTROL_SYNC_STATUS", status: "pending", pendingCount: 1 }, "*");
        }
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
          saveTimerRef.current = null;
          const persist = async () => {
            const changes = pendingChangesRef.current;
            if (!changes) return;
            const batchId = pendingBatchIdRef.current ?? crypto.randomUUID();
            const requestIds = [...pendingSaveRequestIdsRef.current];
            saveInFlightRef.current = true;
            try {
              if (!cloudReadyRef.current) {
                if (retryAttemptRef.current < 3) {
                  const delays = [5000, 15000, 45000];
                  const delay = delays[retryAttemptRef.current++];
                  logSyncEvent("save_retry_waiting_for_cloud", { attempt: retryAttemptRef.current, delayMs: delay });
                  if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
                  retryTimerRef.current = setTimeout(() => {
                    retryTimerRef.current = null;
                    retryPendingSaveRef.current?.();
                  }, delay);
                }
                return;
              }
              // A RPC relacional é a confirmação da gravação. Não bloqueie o ACK
              // esperando uma hidratação completa do estado (que pode consultar
              // milhares de OS e storage). O técnico precisa saber imediatamente
              // que a intenção foi aceita; a atualização visual vem em segundo
              // plano e nunca transforma uma gravação confirmada em erro.
              const result = await withDbsControlTransientRetry(() =>
                applyDbsControlDelta({ data: { requestId: batchId, changes } }),
              );
              const hasConflict = Array.isArray(result.conflicts) && result.conflicts.length > 0;
              if (!hasConflict && pendingChangesRef.current === changes) {
                pendingChangesRef.current = null;
                pendingBatchIdRef.current = null;
                pendingSaveRequestIdsRef.current = pendingSaveRequestIdsRef.current.filter((id) => !requestIds.includes(id));
              }
              // Em conflito, preserve the exact local delta in the parent queue until
              // the operator explicitly reconciles it. This prevents the old version
              // from being silently discarded after a rejected save.
              retryAttemptRef.current = 0;
              if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
              retryTimerRef.current = null;
              logSyncEvent(hasConflict ? "save_conflict" : "save_applied", {
                requestCount: requestIds.length,
                applied: Number(result.applied ?? 0),
                conflicts: hasConflict ? result.conflicts.length : 0,
              });
              const resultMessage = hasConflict
                ? `Conflito de versão em ${result.conflicts.length} OS. Recarregue a tela para reconciliar sem sobrescrever dados.`
                : null;
              setCloudError(resultMessage);
              const ackUpdatedAt = cloudUpdatedAtRef.current;
              iframeRef.current?.contentWindow?.postMessage({
                type: "DBS_CONTROL_SYNC_STATUS", status: hasConflict ? "conflict" : (pendingChangesRef.current ? "pending" : "synced"),
                pendingCount: pendingChangesRef.current ? 1 : 0, updated_at: ackUpdatedAt,
                error: resultMessage,
              }, "*");
              requestIds.forEach((id) => iframeRef.current?.contentWindow?.postMessage({
                type: "DBS_CONTROL_SAVE_ACK", requestId: id, ok: !hasConflict,
                updated_at: ackUpdatedAt, conflicts: result.conflicts ?? [],
                appliedOrders: result.appliedOrders ?? [],
                error: resultMessage ?? undefined,
              }, "*"));
              if (hasConflict) {
                iframeRef.current?.contentWindow?.postMessage({
                  type: "DBS_CONTROL_SYNC_CONFLICT",
                  conflicts: result.conflicts ?? [],
                  changes,
                  requestIds,
                }, "*");
              }

              // Reconcilia o estado retornado pelo banco depois do ACK. Se essa
              // leitura falhar ou demorar, a OS continua confirmada e o retry
              // não é rearmado: a gravação já foi aplicada na transação.
              if (!hasConflict) {
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
                        type: "DBS_CONTROL_CLOUD_STATE", state: latest.state,
                      }, "*");
                    }
                  } catch (refreshError) {
                    logSyncEvent("post_save_refresh_error", {
                      message: refreshError instanceof Error ? refreshError.message : "Falha ao atualizar a leitura após a gravação.",
                    });
                  }
                })();
              }
            } catch (err) {
              const message = err instanceof Error ? err.message : "Falha ao salvar o DBS CONTROL.";
              logSyncEvent("save_error", { message, attempt: retryAttemptRef.current + 1 });
              setCloudError(message);
              iframeRef.current?.contentWindow?.postMessage({
                type: "DBS_CONTROL_SYNC_STATUS", status: "error", pendingCount: pendingChangesRef.current ? 1 : 0, error: message,
              }, "*");
              requestIds.forEach((id) => iframeRef.current?.contentWindow?.postMessage({
                type: "DBS_CONTROL_SAVE_ACK", requestId: id, ok: false, error: message,
              }, "*"));
              if (pendingChangesRef.current && (isDbsControlTransientError(err) || retryAttemptRef.current < 3)) {
                const delays = [5000, 15000, 45000];
                if (retryAttemptRef.current >= delays.length) return;
                const delay = delays[retryAttemptRef.current++];
                logSyncEvent("save_retry_scheduled", {
                  attempt: retryAttemptRef.current,
                  delayMs: delay,
                  transient: isDbsControlTransientError(err),
                  httpStatus: dbsControlHttpStatus(err) || null,
                });
                if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
                retryTimerRef.current = setTimeout(() => {
                  retryTimerRef.current = null;
                  retryPendingSaveRef.current?.();
                }, delay);
              }
            } finally {
              saveInFlightRef.current = false;
            }
          };
          retryPendingSaveRef.current = (manual = false) => {
            if (manual && retryTimerRef.current) clearTimeout(retryTimerRef.current);
            if (manual) retryAttemptRef.current = 0;
            retryTimerRef.current = null;
            saveQueueRef.current = saveQueueRef.current.then(persist, persist);
          };
          retryPendingSaveRef.current();
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
    const refreshLatestCloudState = async (force = false) => {
      if (disposed || saveTimerRef.current || refreshInFlight) return;
      refreshInFlight = true;
      const generation = ++refreshGeneration;
      try {
        const latest = await getDbsControlCloudState();
        if (disposed || generation !== refreshGeneration || !latest?.state || !latest.updated_at) return;
        // O payload do colaborador é filtrado no servidor; o cache local pode conter arrays maiores por design.
        // Para a administração, uma redução de contagem é reconciliada por identidade em vez de
        // bloquear a operação. Isso preserva OS locais e evita que um snapshot atrasado congele o despacho.
        const latestCloudState = latest.state as Record<string, unknown>;
        const reconciledLatestState = employeeModeRef.current
          ? latestCloudState
          : mergeDbsControlStates(latestCloudState, localRecoveryStateRef.current);
        if (!employeeModeRef.current && dbsControlStateIsSmallerThan(localRecoveryStateRef.current, latestCloudState)) {
          console.warn("DBS Control: snapshot remoto menor durante o realtime; estado administrativo reconciliado sem descarte.");
        }
        if (!employeeModeRef.current) localRecoveryStateRef.current = reconciledLatestState;
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
          iframeRef.current?.contentWindow?.postMessage({ type: "DBS_CONTROL_CLOUD_STATE", state: reconciledLatestState }, "*");
        }
        setCloudError(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Falha ao atualizar as OS atribuídas.";
        logSyncEvent("realtime_recovery_error", { message });
        setCloudError(message);
      } finally {
        refreshInFlight = false;
      }
    };
    const subscribeToCanonicalTables = () => {
      if (disposed) return;
      const channelName = "dbs-control-work-orders-realtime";
      for (const existing of supabase.getChannels()) {
        if (existing.topic === `realtime:${channelName}`) void supabase.removeChannel(existing);
      }
      realtimeChannel = supabase.channel(channelName)
        .on("postgres_changes", { event: "*", schema: "public", table: "dbs_control_work_orders" }, () => {
          void refreshLatestCloudState(true);
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "dbs_control_work_order_events" }, () => {
          void refreshLatestCloudState(true);
        })
        .subscribe((status) => {
          if (disposed) return;
          logSyncEvent("realtime_status", { status });
          if (status === "SUBSCRIBED") {
            void refreshLatestCloudState();
            setCloudError(null);
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            logSyncEvent("realtime_retry", { status, delayMs: 3000 });
            setCloudError("Realtime desconectado. Recuperação automática em andamento.");
            if (reconnectTimer) clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(() => {
              if (disposed) return;
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
    // Fallback periódico para eventos perdidos ou períodos sem conectividade.
    const refreshTimer = setInterval(() => { void refreshLatestCloudState(true); }, 30000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void refreshLatestCloudState();
    };
    const handleOnline = () => {
      logSyncEvent("network_online");
      retryPendingSaveRef.current?.(true);
      void refreshLatestCloudState();
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("focus", handleVisibilityChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      disposed = true;
      window.removeEventListener("message", handler);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("focus", handleVisibilityChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearInterval(refreshTimer);
      clearTimeout(realtimeInitialFallbackTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (realtimeChannel) void supabase.removeChannel(realtimeChannel);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  if (profile.isLoading || access.isLoading) {
    return <div className="min-h-screen grid place-items-center bg-slate-50 text-sm text-slate-500">Carregando DBS CONTROL...</div>;
  }

  if (access.isError) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 p-6">
        <section role="alert" className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-7 text-center shadow-sm">
          <h1 className="text-xl font-black text-slate-900">Não foi possível verificar o acesso ao DBS CONTROL</h1>
          <p className="mt-3 break-words text-sm text-slate-600">{access.error instanceof Error ? access.error.message : "Falha de conexão com o serviço de acesso."}</p>
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
  const src = employeeMode
    ? `/dbs-control.html?mode=employee&employee_id=${encodeURIComponent(access.data.employee?.id ?? "")}&employee_name=${encodeURIComponent(employeeName)}&employee_email=${encodeURIComponent(access.data.employee?.email ?? "")}&can_issue_os=${access.data.employee?.can_issue_work_orders ? "1" : "0"}&base_active=${access.data.employee?.base_active ? "1" : "0"}&base_name=${encodeURIComponent(access.data.employee?.base_name ?? "")}&v=20261027-collaborator-ui-2`
    : "/dbs-control.html?v=20261027-collaborator-ui-2"

  if (employeeMode) {
    return (
      <main className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-[#f4f8fc]">
        {cloudError && (
          <section role="alert" aria-live="polite" className="pointer-events-none absolute inset-x-3 top-3 z-20 rounded-xl border border-rose-200 bg-white/95 p-4 shadow-lg backdrop-blur">
            <p className="text-sm font-bold text-rose-700">A sincronização automática do DBS CONTROL encontrou uma falha</p>
            <p className="mt-1 break-words text-xs leading-5 text-slate-700">{cloudError}</p>
            <p className="mt-2 text-[11px] text-slate-500">A sincronização deve se recuperar automaticamente. Não exclua nem recadastre OS.</p>
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
          {cloudError && <span role="alert" title={cloudError} className="rounded-full bg-rose-50 px-2 py-1 text-[9px] font-bold text-rose-700">Erro de sincronização</span>}
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
        <section role="alert" aria-live="polite" className="mx-4 mt-3 shrink-0 rounded-xl border border-rose-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-bold text-rose-700">A sincronização automática do DBS CONTROL encontrou uma falha</p>
          <p className="mt-1 break-words text-xs leading-5 text-slate-700">{cloudError}</p>
          <p className="mt-2 text-[11px] text-slate-500">A sincronização deve se recuperar automaticamente. Não exclua nem recadastre OS.</p>
        </section>
      )}
      <iframe ref={iframeRef} title="DBS CONTROL" src={src} className="min-h-0 w-full flex-1 border-0" allow="camera; geolocation" />
    </main>
  );
}
