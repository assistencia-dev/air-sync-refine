import { useEffect, useMemo, useState } from "react";
import { Bell, BellRing, Check, X } from "lucide-react";
import { getMyProfile } from "@/lib/auth.functions";
import { supabase } from "@/integrations/supabase/client";

type Profile = {
  id: string;
  username?: string | null;
  full_name?: string | null;
  role_key: string;
};

type Toast = {
  id: string;
  title: string;
  message: string;
  tone: "blue" | "green";
};

const statusLabels: Record<string, string> = {
  aberto: "Aberto",
  atribuido: "Atribuído",
  em_rota: "Em rota",
  em_atendimento: "Em atendimento",
  aguardando_peca: "Aguardando peça",
  concluido: "Concluído",
  cancelado: "Cancelado",
};

function notifyNative(title: string, body: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission === "granted")
    new Notification(title, { body, icon: "/favicon.ico" });
}

export function TicketNotificationListener() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [permission, setPermission] = useState<NotificationPermission>("default");

  const isAdmin = useMemo(
    () => profile?.role_key === "SUPER_ADMIN" || profile?.role_key === "ADMIN_OPERACIONAL",
    [profile],
  );

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window)
      setPermission(Notification.permission);
    let mounted = true;
    getMyProfile()
      .then((value) => {
        if (mounted) setProfile(value as Profile);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!profile) return;
    const channel = supabase
      .channel(`ticket-notifications-${profile.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "tickets" },
        (payload) => {
          if (!isAdmin) return;
          const ticket = payload.new as {
            id: string;
            protocol_number?: string;
            occurrence_type?: string;
            description?: string;
          };
          const title = "Novo chamado recebido";
          const message = `${ticket.protocol_number ?? "Novo protocolo"} · ${ticket.occurrence_type ?? "Ocorrência"}`;
          notifyNative(title, message);
          setToasts((current) =>
            [{ id: `${ticket.id}-new`, title, message, tone: "blue" }, ...current].slice(0, 3),
          );
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "tickets" },
        (payload) => {
          if (isAdmin) return;
          const oldTicket = payload.old as { created_by_user_id?: string; status?: string };
          const ticket = payload.new as {
            id: string;
            created_by_user_id?: string;
            status?: string;
            protocol_number?: string;
          };
          if (ticket.created_by_user_id !== profile.id || ticket.status === oldTicket.status)
            return;
          const status = statusLabels[ticket.status ?? ""] ?? ticket.status ?? "Atualizado";
          const title = "Atualização do seu chamado";
          const message = `${ticket.protocol_number ?? "Seu chamado"} agora está: ${status}.`;
          notifyNative(title, message);
          setToasts((current) =>
            [
              { id: `${ticket.id}-${ticket.status}`, title, message, tone: "green" },
              ...current,
            ].slice(0, 3),
          );
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [profile, isAdmin]);

  async function enableNotifications() {
    if (!("Notification" in window)) return;
    const next = await Notification.requestPermission();
    setPermission(next);
    if (next === "granted") {
      notifyNative("Notificações ativadas", "Você receberá atualizações importantes dos chamados.");
      setToasts((current) => current.filter((item) => item.id !== "permission"));
    }
  }

  useEffect(() => {
    if (permission !== "default" || !profile) return;
    setToasts((current) =>
      current.some((item) => item.id === "permission")
        ? current
        : [
            {
              id: "permission",
              title: "Ative as notificações",
              message: "Receba avisos de novos chamados e mudanças de status.",
              tone: "blue",
            },
            ...current,
          ],
    );
  }, [permission, profile]);

  if (!profile || toasts.length === 0) return null;
  return (
    <div
      className="fixed bottom-5 right-5 z-[100] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-3"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <div key={toast.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xl">
          <div className="flex items-start gap-3">
            <div
              className={`mt-0.5 rounded-lg p-2 ${toast.tone === "green" ? "bg-emerald-50 text-emerald-600" : "bg-sky-50 text-sky-600"}`}
            >
              {toast.id === "permission" ? (
                <Bell className="h-4 w-4" />
              ) : (
                <BellRing className="h-4 w-4" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-slate-900">{toast.title}</p>
              <p className="mt-1 text-xs leading-5 text-slate-600">{toast.message}</p>
              {toast.id === "permission" && (
                <button
                  onClick={enableNotifications}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-sky-700"
                >
                  <Check className="h-3.5 w-3.5" /> Ativar agora
                </button>
              )}
            </div>
            <button
              aria-label="Fechar aviso"
              onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}
              className="text-slate-400 hover:text-slate-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
