import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { createClientUser } from "@/lib/admin.functions";
import { hasMyDbsControlAccess, listRhEmployeeRegistry, listRhCollaboratorUsers, saveRhEmployeeRecord, saveRhEmployeeAccess } from "@/lib/rh.functions";
import { getMyProfile } from "@/lib/auth.functions";
import { supabase } from "@/integrations/supabase/client";
import { getDbsControlCloudState, saveDbsControlCloudState, auditDbsControlDatabase, uploadDbsControlOsAttachment } from "@/lib/dbs-control.functions";
import {
  getFieldControlIntegrationStatus,
  saveFieldControlApiKey,
  testFieldControlConnection,
  syncFieldControl,
  getFieldControlImportedState,
  getFieldControlWorkOrderDetails,
} from "@/lib/fieldcontrol.functions";

// DBS CONTROL production hardening: collaborator mode remains backed by the canonical RH employee link.

export const Route = createFileRoute("/_authenticated/dbs-control")({
  head: () => ({ meta: [{ title: "DBS CONTROL · DBS Air" }, { name: "robots", content: "noindex" }] }),
  component: DbsControlPage,
});

function dbsControlStateHasData(state: Record<string, unknown> | null | undefined) {
  if (!state) return false;
  const keys = ["tecnicos", "clientes", "equipamentos", "pecas", "servicos", "compras", "ordens"];
  return keys.some((key) => Array.isArray(state[key]) && (state[key] as unknown[]).length > 0);
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
  const pendingStateRef = useRef<Record<string, unknown> | null>(null);
  const pendingSaveRequestIdsRef = useRef<string[]>([]);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttemptRef = useRef(0);
  const retryPendingSaveRef = useRef<((manual?: boolean) => void) | null>(null);
  const cloudReadyRef = useRef(false);
  const cloudUpdatedAtRef = useRef<string | null>(null);
  const [cloudError, setCloudError] = useState<string | null>(null);

  useEffect(() => {
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
          const currentCloud = await getDbsControlCloudState();
          const currentState = currentCloud?.state && typeof currentCloud.state === "object" && !Array.isArray(currentCloud.state)
            ? currentCloud.state as Record<string, unknown>
            : {};
          const mergeById = (current: unknown, incoming: unknown) => {
            const currentItems = Array.isArray(current) ? current as any[] : [];
            const incomingItems = Array.isArray(incoming) ? incoming as any[] : [];
            const incomingIds = new Set(incomingItems.map((item) => String(item?.id ?? "")));
            const preserved = currentItems.filter((item) => !incomingIds.has(String(item?.id ?? "")));
            return [...preserved, ...incomingItems];
          };
          const mergedState = {
            ...currentState,
            tecnicos: Array.from(new Map(mergeById(currentState.tecnicos, importedState.tecnicos).map((t:any) => [String(t.employeeId || t.fieldControlId || t.id || t.nome || ''), t])).values()),
            clientes: mergeById(currentState.clientes, importedState.clientes),
            equipamentos: mergeById(currentState.equipamentos, importedState.equipamentos),
            servicos: mergeById(currentState.servicos, importedState.servicos),
            ordens: mergeById(currentState.ordens, importedState.ordens),
            pecas: Array.isArray(currentState.pecas) ? currentState.pecas : [],
            compras: Array.isArray(currentState.compras) ? currentState.compras : [],
            orcamentos: Array.isArray(currentState.orcamentos) ? currentState.orcamentos : [],
            osHistorico: Array.isArray(currentState.osHistorico) ? currentState.osHistorico : [],
          };
          const saved = await saveDbsControlCloudState({ data: { state: mergedState } });
          iframeRef.current?.contentWindow?.postMessage({ type: "DBS_CONTROL_CLOUD_STATE", state: saved.state }, "*");
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
        try {
          const cloud = await getDbsControlCloudState();
          const cloudState = cloud?.state && typeof cloud.state === "object" && !Array.isArray(cloud.state)
            ? cloud.state as Record<string, unknown>
            : null;
          const localState = msg.state && typeof msg.state === "object" && !Array.isArray(msg.state)
            ? JSON.parse(JSON.stringify(msg.state)) as Record<string, unknown>
            : null;

          if (cloudState) {
            // Nunca grave automaticamente um snapshot local no estado compartilhado durante
            // a inicialização: um navegador antigo pode ressuscitar OS excluídas/antigas ou
            // reverter a execução. A cópia local permanece no dispositivo para recuperação
            // explícita; a base compartilhada é a autoridade de leitura quando já existe.
            cloudReadyRef.current = true;
            cloudUpdatedAtRef.current = cloud?.updated_at ?? null;
            iframeRef.current?.contentWindow?.postMessage(
              { type: "DBS_CONTROL_CLOUD_STATE", state: cloudState },
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
            // Nunca promova cache de navegador para a base compartilhada automaticamente.
            // Sem snapshot na nuvem, falha em modo seguro e preserva a cópia local apenas para recuperação.
            throw new Error(
              localState
                ? "A base compartilhada não retornou um snapshot. O cache local foi preservado e não será enviado automaticamente para evitar sobrescrever dados mais recentes."
                : "O DBS CONTROL não conseguiu estabelecer uma fonte de dados compartilhada.",
            );
          }

          setCloudError(null);
        } catch (err) {
          console.error("DBS Control cloud load:", err);
          const message = err instanceof Error ? err.message : "Falha ao sincronizar o DBS CONTROL.";
          setCloudError(message);
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
              const currentCloud = await getDbsControlCloudState();
              const currentState = currentCloud?.state && typeof currentCloud.state === "object" && !Array.isArray(currentCloud.state)
                ? currentCloud.state as Record<string, unknown>
                : null;
              // A FieldControl import becomes visible in the DBS CONTROL immediately,
              // but existing manually created records are preserved. Imported records
              // are identified by their database UUIDs and therefore update idempotently.
              const mergeById = (current: unknown, incoming: unknown) => {
                const currentItems = Array.isArray(current) ? current as any[] : [];
                const incomingItems = Array.isArray(incoming) ? incoming as any[] : [];
                const incomingIds = new Set(incomingItems.map((item) => String(item?.id ?? "")));
                const preserved = currentItems.filter((item) => !incomingIds.has(String(item?.id ?? "")));
                return [...preserved, ...incomingItems];
              };
              const base = currentState ?? {};
              const mergedState = {
                ...base,
                tecnicos: mergeById(base.tecnicos, importedState.tecnicos),
                clientes: mergeById(base.clientes, importedState.clientes),
                equipamentos: mergeById(base.equipamentos, importedState.equipamentos),
                pecas: Array.isArray(base.pecas) ? base.pecas : [],
                servicos: mergeById(base.servicos, importedState.servicos),
                compras: Array.isArray(base.compras) ? base.compras : [],
                ordens: mergeById(base.ordens, importedState.ordens),
                osHistorico: Array.isArray(base.osHistorico) ? base.osHistorico : [],
              };
              const saved = await saveDbsControlCloudState({ data: { state: mergedState } });
              iframeRef.current?.contentWindow?.postMessage({ type: "DBS_CONTROL_CLOUD_STATE", state: saved.state }, "*");
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

      if (msg.type === "DBS_CONTROL_RETRY_SAVE") {
        retryPendingSaveRef.current?.(true);
        return;
      }

      if (msg.type === "DBS_CONTROL_SAVE") {
        const requestId = typeof msg.requestId === "string" ? msg.requestId : null;
        pendingStateRef.current = msg.state;
        if (requestId) pendingSaveRequestIdsRef.current.push(requestId);
        if (!cloudReadyRef.current) {
          if (requestId) {
            iframeRef.current?.contentWindow?.postMessage({
              type: "DBS_CONTROL_SAVE_ACK", requestId, ok: false,
              error: "A base compartilhada ainda não está pronta. A conclusão não foi confirmada na nuvem.",
            }, "*");
            pendingSaveRequestIdsRef.current = pendingSaveRequestIdsRef.current.filter((id) => id !== requestId);
          }
          return;
        }
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
          saveTimerRef.current = null;
          const persist = async () => {
            const state = pendingStateRef.current;
            if (!state) return;
            const requestIds = [...pendingSaveRequestIdsRef.current];
            try {
              const saved = await saveDbsControlCloudState({ data: { state } });
              cloudUpdatedAtRef.current = saved.updated_at ?? cloudUpdatedAtRef.current;
              if (pendingStateRef.current === state) {
                pendingStateRef.current = null;
                pendingSaveRequestIdsRef.current = pendingSaveRequestIdsRef.current.filter((id) => !requestIds.includes(id));
              }
              retryAttemptRef.current = 0;
              if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
              retryTimerRef.current = null;
              setCloudError(null);
              iframeRef.current?.contentWindow?.postMessage({
                type: "DBS_CONTROL_SYNC_STATUS", status: pendingStateRef.current ? "pending" : "synced",
                pendingCount: pendingStateRef.current ? 1 : 0, updated_at: saved.updated_at ?? null,
              }, "*");
              requestIds.forEach((id) => iframeRef.current?.contentWindow?.postMessage({
                type: "DBS_CONTROL_SAVE_ACK", requestId: id, ok: true, updated_at: saved.updated_at ?? null,
              }, "*"));
            } catch (err) {
              console.error("DBS Control cloud save:", err);
              const message = err instanceof Error ? err.message : "Falha ao salvar o DBS CONTROL.";
              setCloudError(message);
              iframeRef.current?.contentWindow?.postMessage({
                type: "DBS_CONTROL_SYNC_STATUS", status: "error", pendingCount: pendingStateRef.current ? 1 : 0, error: message,
              }, "*");
              requestIds.forEach((id) => iframeRef.current?.contentWindow?.postMessage({
                type: "DBS_CONTROL_SAVE_ACK", requestId: id, ok: false, error: message,
              }, "*"));
              if (retryAttemptRef.current < 3 && pendingStateRef.current) {
                const delays = [5000, 15000, 45000];
                const delay = delays[retryAttemptRef.current++];
                if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
                retryTimerRef.current = setTimeout(() => {
                  retryTimerRef.current = null;
                  retryPendingSaveRef.current?.();
                }, delay);
              }
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

    // Supabase Realtime: eventos no snapshot, reconexão automática e fallback de 30 s.
    let refreshInFlight = false;
    let refreshGeneration = 0;
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;
    const refreshLatestCloudState = async (force = false) => {
      if (disposed || !cloudReadyRef.current || saveTimerRef.current || refreshInFlight) return;
      refreshInFlight = true;
      const generation = ++refreshGeneration;
      try {
        const latest = await getDbsControlCloudState();
        if (disposed || generation !== refreshGeneration || !latest?.state || !latest.updated_at) return;
        if (pendingStateRef.current || saveTimerRef.current) {
          iframeRef.current?.contentWindow?.postMessage({ type: "DBS_CONTROL_SYNC_STATUS", status: "pending", pendingCount: 1 }, "*");
          return;
        }
        if (force || latest.updated_at !== cloudUpdatedAtRef.current) {
          cloudUpdatedAtRef.current = latest.updated_at;
          iframeRef.current?.contentWindow?.postMessage({ type: "DBS_CONTROL_CLOUD_STATE", state: latest.state }, "*");
        }
        setCloudError(null);
      } catch (err) {
        console.error("DBS Control Realtime recovery:", err);
        setCloudError(err instanceof Error ? err.message : "Falha ao atualizar as OS atribuídas.");
      } finally {
        refreshInFlight = false;
      }
    };
    const subscribeToSnapshot = () => {
      if (disposed) return;
      realtimeChannel = supabase.channel("dbs-control-snapshot-realtime")
        .on("postgres_changes", { event: "*", schema: "public", table: "dbs_control_snapshots" }, () => {
          void refreshLatestCloudState();
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "dbs_control_work_orders" }, () => {
          void refreshLatestCloudState(true);
        })
        .subscribe((status) => {
          if (disposed) return;
          if (status === "SUBSCRIBED") {
            void refreshLatestCloudState();
            setCloudError(null);
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            setCloudError("Realtime desconectado. Recuperação automática em andamento.");
            if (reconnectTimer) clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(() => {
              if (disposed) return;
              const previous = realtimeChannel;
              realtimeChannel = null;
              if (previous) void supabase.removeChannel(previous);
              subscribeToSnapshot();
            }, 3000);
          }
        });
    };
    subscribeToSnapshot();
    // Não depender do evento SUBSCRIBED para a primeira reconciliação:
    // após 3 s, faz leitura autoritativa direta se o handshake Realtime ainda
    // não tiver estabilizado. A leitura não grava nem sobrescreve dados locais.
    const realtimeInitialFallbackTimer = setTimeout(() => {
      if (!disposed && cloudReadyRef.current) void refreshLatestCloudState(true);
    }, 3000);
    // Fallback periódico para eventos perdidos ou períodos sem conectividade.
    const refreshTimer = setInterval(() => { void refreshLatestCloudState(true); }, 30000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void refreshLatestCloudState();
    };
    const handleOnline = () => {
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
    ? `/dbs-control.html?mode=employee&employee_id=${encodeURIComponent(access.data.employee?.id ?? "")}&employee_name=${encodeURIComponent(employeeName)}&employee_email=${encodeURIComponent(access.data.employee?.email ?? "")}&v=20261018-treasury-os-lifecycle-2`
    : "/dbs-control.html?v=20261018-treasury-os-lifecycle-2";

  return (
    <main className="min-h-screen bg-[#f4f8fc]">
      <div className="flex h-10 items-center justify-between border-b border-slate-200/80 bg-white/95 px-4 shadow-[0_2px_14px_rgba(16,42,67,0.035)] backdrop-blur-xl">
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
        <section role="alert" aria-live="polite" className="mx-4 mt-3 rounded-xl border border-rose-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-bold text-rose-700">A sincronização automática do DBS CONTROL encontrou uma falha</p>
          <p className="mt-1 break-words text-xs leading-5 text-slate-700">{cloudError}</p>
          <p className="mt-2 text-[11px] text-slate-500">A sincronização deve se recuperar automaticamente. Não exclua nem recadastre OS.</p>
        </section>
      )}
      <iframe ref={iframeRef} title="DBS CONTROL" src={src} className="h-[calc(100vh-2.5rem)] w-full border-0" style={{ height: "calc(100dvh - 2.5rem)" }} allow="camera; geolocation" />
    </main>
  );
}
