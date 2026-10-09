import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { createClientUser } from "@/lib/admin.functions";
import { hasMyDbsControlAccess, listRhEmployeeRegistry, listRhCollaboratorUsers, saveRhEmployeeRecord, saveRhEmployeeAccess } from "@/lib/rh.functions";
import { getMyProfile } from "@/lib/auth.functions";
import { supabase } from "@/integrations/supabase/client";
import { getDbsControlCloudState, saveDbsControlCloudState, auditDbsControlDatabase } from "@/lib/dbs-control.functions";
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

function DbsControlPage() {
  const navigate = useNavigate();
  const profile = useQuery({ queryKey: ["me"], queryFn: () => getMyProfile() });
  const access = useQuery({ queryKey: ["my-dbs-control-access"], queryFn: () => hasMyDbsControlAccess(), retry: false });
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingStateRef = useRef<Record<string, unknown> | null>(null);
  const cloudReadyRef = useRef(false);
  const [cloudError, setCloudError] = useState<string | null>(null);

  useEffect(() => {
    const handler = async (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const msg = event.data || {};

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

          // Um snapshot vazio não pode substituir os dados locais já existentes.
          // Isso é importante na primeira abertura em outro dispositivo: se ele
          // entrou antes da migração do notebook, o snapshot vazio é apenas um
          // estado inicial e o primeiro estado real deve ser promovido para a nuvem.
          if (cloudState && (dbsControlStateHasData(cloudState) || !dbsControlStateHasData(localState))) {
            cloudReadyRef.current = true;
            iframeRef.current?.contentWindow?.postMessage(
              { type: "DBS_CONTROL_CLOUD_STATE", state: cloudState },
              "*",
            );
          } else if (localState) {
            const saved = await saveDbsControlCloudState({ data: { state: localState } });
            cloudReadyRef.current = true;
            iframeRef.current?.contentWindow?.postMessage(
              { type: "DBS_CONTROL_CLOUD_STATE", state: saved.state },
              "*",
            );
          } else {
            throw new Error("O DBS CONTROL não conseguiu estabelecer uma fonte de dados compartilhada.");
          }

          setCloudError(null);
        } catch (err) {
          console.error("DBS Control cloud load:", err);
          setCloudError(err instanceof Error ? err.message : "Falha ao sincronizar o DBS CONTROL.");
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

      if (msg.type === "DBS_CONTROL_SAVE") {
        pendingStateRef.current = msg.state;
        if (!cloudReadyRef.current) return;
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(async () => {
          const state = pendingStateRef.current;
          if (!state) return;
          try {
            await saveDbsControlCloudState({ data: { state } });
            setCloudError(null);
          } catch (err) {
            console.error("DBS Control cloud save:", err);
            setCloudError(err instanceof Error ? err.message : "Falha ao salvar o DBS CONTROL.");
          }
        }, 450);
      }
    };

    window.addEventListener("message", handler);
    return () => {
      window.removeEventListener("message", handler);
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
    ? `/dbs-control.html?mode=employee&employee_id=${encodeURIComponent(access.data.employee?.id ?? "")}&employee_name=${encodeURIComponent(employeeName)}&employee_email=${encodeURIComponent(access.data.employee?.email ?? "")}&v=20261009-3`
    : "/dbs-control.html?v=20261009-3";

  return (
    <main className="min-h-screen bg-[#f4f8fc]">
      <div className="flex h-10 items-center justify-between border-b border-slate-200/80 bg-white/95 px-4 shadow-[0_2px_14px_rgba(16,42,67,0.035)] backdrop-blur-xl">
        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">
          <span>DBS CONTROL</span>
          {cloudError && <span className="rounded-full bg-rose-50 px-2 py-1 text-[9px] font-bold text-rose-600">Erro de sincronização</span>}
        </div>
        <button
          type="button"
          onClick={() => navigate({ to: employeeMode ? "/folha-ponto" : "/admin", replace: true })}
          className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-black text-slate-600 shadow-sm transition hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700"
        >
          ← Voltar ao menu principal
        </button>
      </div>
      <iframe ref={iframeRef} title="DBS CONTROL" src={src} className="h-[calc(100vh-2.5rem)] w-full border-0" allow="camera; geolocation" />
    </main>
  );
}
