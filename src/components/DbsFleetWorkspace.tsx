import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2, ExternalLink, LocateFixed, MapPin,
  Navigation, Radio, RefreshCw, ShieldCheck, Siren, Square, UserRound,
} from "lucide-react";
import {
  getMyFleetStatus,
  listRhFleetOverview,
  listRhFleetSessionRoute,
  recordMyFleetPosition,
  sendMyFleetSos,
  startMyFleetTracking,
  stopMyFleetTracking,
  updateRhFleetSos,
} from "@/lib/ponto.functions";
import { distanceMeters } from "@/lib/ponto-geo";

declare global {
  interface Window { L?: any; }
}

type FleetSession = {
  id: string;
  employee_id: string;
  work_date: string;
  started_at: string;
  ended_at: string | null;
  end_reason: string | null;
  last_latitude: number | string | null;
  last_longitude: number | string | null;
  last_accuracy_m: number | string | null;
  last_position_at: string | null;
  employee?: { id: string; full_name: string; unit: string | null } | null;
};

type FleetPoint = {
  id: string;
  recorded_at: string;
  latitude: number | string;
  longitude: number | string;
  accuracy_m: number | string;
};

const fleetLocalDate = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}-${parts.find((part) => part.type === "day")?.value}`;
};

const dateTime = (value?: string | null) => value
  ? new Date(value).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
  : "—";

const FLEET_LOCATION_FRESHNESS_MS = 180_000;
const isRecentFleetPosition = (session: FleetSession) => Boolean(
  !session.ended_at
  && session.last_position_at
  && Date.now() - Date.parse(session.last_position_at) <= FLEET_LOCATION_FRESHNESS_MS
);

const timeSince = (value?: string | null) => {
  if (!value) return "Aguardando primeira leitura";
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60_000));
  if (minutes < 1) return "Atualizado agora";
  if (minutes === 1) return "Atualizado há 1 minuto";
  return `Atualizado há ${minutes} minutos`;
};

const mapsUrl = (lat: number | string, lng: number | string) =>
  `https://www.google.com/maps/search/?api=1&query=${Number(lat)},${Number(lng)}`;

function loadFleetLeaflet(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("Mapa indisponível neste ambiente."));
  if (window.L) return Promise.resolve(window.L);
  return new Promise((resolve, reject) => {
    let css = document.getElementById("dbs-fleet-leaflet-css") as HTMLLinkElement | null;
    if (!css) {
      css = document.createElement("link");
      css.id = "dbs-fleet-leaflet-css";
      css.rel = "stylesheet";
      css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(css);
    }
    let script = document.getElementById("dbs-fleet-leaflet-js") as HTMLScriptElement | null;
    if (script) {
      if (window.L) return resolve(window.L);
      script.addEventListener("load", () => window.L ? resolve(window.L) : reject(new Error("Biblioteca do mapa não carregou.")), { once: true });
      script.addEventListener("error", () => reject(new Error("Não foi possível carregar o mapa.")), { once: true });
      return;
    }
    script = document.createElement("script");
    script.id = "dbs-fleet-leaflet-js";
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.onload = () => window.L ? resolve(window.L) : reject(new Error("Biblioteca do mapa não carregou."));
    script.onerror = () => reject(new Error("Não foi possível carregar o mapa."));
    document.head.appendChild(script);
  });
}

function FleetMap({
  sessions,
  routePoints = [],
  selectedSessionId,
}: {
  sessions: FleetSession[];
  routePoints?: FleetPoint[];
  selectedSessionId?: string | null;
}) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const leafletRef = useRef<any>(null);
  const [mapError, setMapError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void loadFleetLeaflet().then((L) => {
      if (cancelled || !elementRef.current || mapRef.current) return;
      leafletRef.current = L;
      const map = L.map(elementRef.current, { scrollWheelZoom: false, preferCanvas: true }).setView([-22.9, -43.2], 10);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(map);
      mapRef.current = map;
      layerRef.current = L.layerGroup().addTo(map);
      setMapError("");
      window.setTimeout(() => map.invalidateSize(), 100);
    }).catch((error) => {
      if (!cancelled) setMapError(error instanceof Error ? error.message : "Mapa indisponível.");
    });
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        layerRef.current = null;
        leafletRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    const layer = layerRef.current;
    if (!map || !L || !layer) return;
    layer.clearLayers();
    const bounds: [number, number][] = [];

    if (routePoints.length > 0) {
      const ordered = routePoints.map((point) => [Number(point.latitude), Number(point.longitude)] as [number, number]);
      ordered.forEach((coords, index) => {
        bounds.push(coords);
        L.circleMarker(coords, {
          radius: index === 0 || index === ordered.length - 1 ? 8 : 5,
          color: "#075985", weight: 2, fillColor: "#38bdf8", fillOpacity: 0.95,
        }).bindPopup(`Ponto ${index + 1}<br>${dateTime(routePoints[index].recorded_at)}<br>Precisão ±${Math.round(Number(routePoints[index].accuracy_m))} m`).addTo(layer);
      });
      if (ordered.length > 1) L.polyline(ordered, { color: "#0369a1", weight: 4, opacity: 0.85 }).addTo(layer);
    } else {
      sessions.forEach((session) => {
        if (session.last_latitude == null || session.last_longitude == null) return;
        const coords: [number, number] = [Number(session.last_latitude), Number(session.last_longitude)];
        if (!Number.isFinite(coords[0]) || !Number.isFinite(coords[1])) return;
        bounds.push(coords);
        const name = session.employee?.full_name ?? "Colaborador";
        const recent = isRecentFleetPosition(session);
        const marker = L.circleMarker(coords, {
          radius: recent ? 10 : 8,
          color: recent ? "#047857" : "#b45309",
          fillColor: recent ? "#34d399" : "#fbbf24",
          fillOpacity: 0.95,
          weight: 3,
        }).addTo(layer);
        marker.bindPopup(
          `<strong>${String(name).replace(/[&<>"]/g, "")}</strong><br>${String(session.employee?.unit ?? "Sem unidade").replace(/[&<>"]/g, "")}<br>${recent ? "GPS atualizado nos últimos 3 minutos" : session.ended_at ? "Sessão encerrada · última posição" : "Sem atualização nos últimos 3 minutos"}<br>${dateTime(session.last_position_at)}<br>Precisão ±${Math.round(Number(session.last_accuracy_m ?? 0))} m`,
        );
      });
    }

    if (bounds.length > 1) map.fitBounds(L.latLngBounds(bounds).pad(0.18));
    else if (bounds.length === 1) map.setView(bounds[0], 15);
    else map.setView([-22.9, -43.2], 10);
    window.setTimeout(() => map.invalidateSize(), 80);
  }, [sessions, routePoints, selectedSessionId]);

  return (
    <div className="relative">
      <div ref={elementRef} className="h-[340px] w-full overflow-hidden rounded-2xl bg-slate-100 sm:h-[420px]" aria-label="Mapa de localização da equipe" />
      {mapError && <div className="absolute inset-0 grid place-items-center rounded-2xl bg-slate-50/95 p-5 text-center text-xs font-bold text-slate-600">{mapError}</div>}
      {routePoints.length > 0 && <span className="absolute bottom-3 left-3 rounded-lg bg-white/95 px-3 py-1.5 text-[10px] font-black text-sky-800 shadow">Trajeto selecionado · {routePoints.length} posições</span>}
    </div>
  );
}

export function DbsFleetEmployeePanel() {
  const queryClient = useQueryClient();
  const [consent, setConsent] = useState(false);
  const [message, setMessage] = useState("Preciso de ajuda. Estou em uma situação de emergência.");
  const [feedback, setFeedback] = useState<{ kind: "ok" | "error" | "info"; text: string } | null>(null);
  const [gpsState, setGpsState] = useState("A localização só é consultada quando o acompanhamento estiver ativo.");
  const lastSentRef = useRef<{ at: number; lat: number; lng: number } | null>(null);
  const status = useQuery({
    queryKey: ["my-dbs-fleet-status"],
    queryFn: () => getMyFleetStatus(),
    refetchInterval: 20_000,
    retry: 1,
  });
  const sessionId = status.data?.activeSession?.id ?? null;

  const start = useMutation({
    mutationFn: () => {
      if (!window.isSecureContext || !navigator.geolocation) {
        throw new Error("O GPS exige conexão HTTPS e permissão de localização neste navegador.");
      }
      return startMyFleetTracking({ data: { consent: true } });
    },
    onSuccess: async () => {
      setConsent(false);
      setFeedback({ kind: "ok", text: "Acompanhamento iniciado. Seu status e a última atualização aparecem nesta tela." });
      await queryClient.invalidateQueries({ queryKey: ["my-dbs-fleet-status"] });
    },
    onError: (error) => setFeedback({ kind: "error", text: error instanceof Error ? error.message : "Não foi possível iniciar o acompanhamento." }),
  });

  const stop = useMutation({
    mutationFn: () => stopMyFleetTracking({ data: { session_id: sessionId! } }),
    onSuccess: async () => {
      setFeedback({ kind: "info", text: "Acompanhamento encerrado. Nenhuma nova posição será coletada." });
      setGpsState("Acompanhamento encerrado.");
      await queryClient.invalidateQueries({ queryKey: ["my-dbs-fleet-status"] });
    },
    onError: (error) => setFeedback({ kind: "error", text: error instanceof Error ? error.message : "Não foi possível encerrar o acompanhamento." }),
  });

  const sendSos = useMutation({
    mutationFn: async () => {
      const location = await new Promise<{ latitude: number; longitude: number; accuracy_m: number } | null>((resolve) => {
        if (!window.isSecureContext || !navigator.geolocation) return resolve(null);
        navigator.geolocation.getCurrentPosition(
          (position) => resolve(position.coords.accuracy <= 500 ? {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy_m: position.coords.accuracy,
          } : null),
          () => resolve(null),
          { enableHighAccuracy: true, maximumAge: 10_000, timeout: 8_000 },
        );
      });
      return sendMyFleetSos({ data: { ...(location ?? {}), message } });
    },
    onSuccess: async () => {
      setFeedback({ kind: "ok", text: "SOS enviado à administração. Mantenha o celular disponível para retorno." });
      await queryClient.invalidateQueries({ queryKey: ["my-dbs-fleet-status"] });
    },
    onError: (error) => setFeedback({ kind: "error", text: error instanceof Error ? error.message : "Não foi possível enviar o SOS." }),
  });

  useEffect(() => {
    if (!sessionId) {
      lastSentRef.current = null;
      return;
    }
    if (!window.isSecureContext || !navigator.geolocation) {
      setGpsState("Este navegador não disponibiliza GPS em conexão segura. A sessão permanece aberta, mas sem novas posições.");
      return;
    }

    let watchId: number | null = null;
    let disposed = false;
    const stopWatch = () => {
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }
    };
    const startWatch = () => {
      if (disposed || document.visibilityState !== "visible" || watchId !== null) return;
      setGpsState("Solicitando localização precisa…");
      watchId = navigator.geolocation.watchPosition(
        (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          const accuracy = position.coords.accuracy;
          if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(accuracy) || accuracy > 250) {
            setGpsState("Precisão acima de 250 m. Aguardando uma leitura melhor, sem gravar esta posição.");
            return;
          }
          const now = Date.now();
          const last = lastSentRef.current;
          const moved = last ? distanceMeters(last.lat, last.lng, lat, lng) : Number.POSITIVE_INFINITY;
          if (last && now - last.at < 45_000 && moved < 50) {
            setGpsState("Acompanhamento ativo · aguardando próxima atualização.");
            return;
          }
          lastSentRef.current = { at: now, lat, lng };
          setGpsState(`GPS ativo · precisão ±${Math.round(accuracy)} m · enviando posição segura.`);
          void recordMyFleetPosition({
            data: { session_id: sessionId, latitude: lat, longitude: lng, accuracy_m: accuracy },
          }).then((result) => {
            if (disposed) return;
            if (result.stored) setGpsState(`Localização atualizada às ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} · precisão ±${Math.round(accuracy)} m.`);
          }).catch((error) => {
            if (!disposed) setGpsState(error instanceof Error ? error.message : "Não foi possível enviar a última posição.");
          });
        },
        (error) => {
          if (disposed) return;
          if (error.code === 1) {
            setGpsState("Permissão de localização negada. O acompanhamento será encerrado até você autorizar o GPS no navegador.");
            void stopMyFleetTracking({ data: { session_id: sessionId } }).then(() => {
              if (!disposed) return queryClient.invalidateQueries({ queryKey: ["my-dbs-fleet-status"] });
            }).catch(() => {
              if (!disposed) setGpsState("Permissão de localização negada. Encerre manualmente o acompanhamento.");
            });
          } else if (error.code === 2) setGpsState("Sinal GPS indisponível temporariamente. O acompanhamento tentará novamente.");
          else setGpsState("O GPS ainda está procurando uma posição. Mantenha o portal aberto.");
        },
        { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
      );
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") startWatch();
      else {
        stopWatch();
        setGpsState("Portal em segundo plano. A leitura de GPS foi pausada até você voltar a esta tela.");
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    startWatch();
    return () => {
      disposed = true;
      stopWatch();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [sessionId]);

  const activeSos = status.data?.openSos ?? [];
  if (status.isLoading) return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-black text-slate-800">DBS FLEET · Segurança e localização</p>
      <p className="mt-2 text-xs text-slate-500">Verificando a situação da sua jornada…</p>
    </section>
  );

  return (
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 bg-slate-950 px-5 py-5 text-white sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[.2em] text-sky-300">DBS FLEET · segurança de campo</p>
          <h2 className="mt-1 text-xl font-black">Acompanhamento da jornada</h2>
          <p className="mt-1 text-xs text-slate-300">O GPS só é compartilhado depois da sua autorização e durante a jornada registrada.</p>
        </div>
        <span className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-2 text-[10px] font-black ${sessionId ? "border-emerald-300/30 bg-emerald-400/10 text-emerald-200" : "border-white/15 bg-white/5 text-slate-300"}`}>
          <Radio className="h-3.5 w-3.5" /> {sessionId ? "Acompanhamento ativo" : status.data?.onBreak ? "Pausa de almoço" : status.data?.eligible ? "Aguardando autorização" : "Fora da janela de jornada"}
        </span>
      </div>
      <div className="grid gap-4 p-5 sm:p-7 lg:grid-cols-[1.2fr_.8fr]">
        <div className="space-y-3">
          {sessionId ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black text-emerald-900">Localização compartilhada nesta jornada</p>
                  <p className="mt-1 text-xs leading-5 text-emerald-800">{gpsState}</p>
                  <p className="mt-1 text-[10px] font-bold text-emerald-700">Iniciado às {dateTime(status.data?.activeSession?.started_at)} · encerramento automático na batida de saída.</p>
                </div>
              </div>
              <button type="button" onClick={() => stop.mutate()} disabled={stop.isPending} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-emerald-300 bg-white px-4 py-2.5 text-xs font-black text-emerald-900 disabled:opacity-50">
                <Square className="h-3.5 w-3.5" /> {stop.isPending ? "Encerrando…" : "Encerrar acompanhamento"}
              </button>
            </div>
          ) : status.data?.eligible ? (
            <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-sky-700" />
                <div>
                  <p className="text-sm font-black text-slate-900">Ative o DBS FLEET durante o expediente</p>
                  <p className="mt-1 text-xs leading-5 text-slate-600">Com sua autorização, o RH poderá ver sua posição e o deslocamento desta jornada para coordenar a equipe e responder a emergências. A coleta pausa quando o portal fica em segundo plano e termina na batida de saída ou quando você encerrar manualmente.</p>
                </div>
              </div>
              <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-xl border border-sky-200 bg-white p-3 text-xs font-bold leading-5 text-slate-700">
                <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-1 h-4 w-4 accent-sky-700" />
                Autorizo compartilhar minha localização com a administração durante esta jornada, conforme a política de privacidade do DBS Air.
              </label>
              <button type="button" onClick={() => start.mutate()} disabled={!consent || start.isPending} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-sky-700 px-4 py-3 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto">
                <LocateFixed className="h-4 w-4" /> {start.isPending ? "Iniciando…" : "Autorizar e iniciar GPS"}
              </button>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-black text-slate-800">Acompanhamento indisponível neste momento</p>
              <p className="mt-1 text-xs leading-5 text-slate-600">{status.data?.onBreak ? "O GPS foi pausado no intervalo. Depois de registrar o retorno do almoço, você poderá autorizar novamente." : "A opção aparece depois da batida de entrada e fica disponível até a batida de saída. Fora desse período, o sistema não coleta novas posições."}</p>
            </div>
          )}
          {feedback && <div role="status" className={`rounded-xl border p-3 text-xs font-bold ${feedback.kind === "error" ? "border-rose-200 bg-rose-50 text-rose-800" : feedback.kind === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-sky-200 bg-sky-50 text-sky-800"}`}>{feedback.text}</div>}
          {status.error && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-800">{status.error instanceof Error ? status.error.message : "Não foi possível consultar o status do DBS FLEET."}</p>}
          {activeSos.map((alert: any) => (
            <div key={alert.id} className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">
              <p className="font-black">SOS em acompanhamento · {dateTime(alert.created_at)}</p>
              <p className="mt-1">{alert.message}</p>
              <p className="mt-1 font-bold">{alert.status === "ACKNOWLEDGED" ? "A administração confirmou o recebimento." : "A administração ainda não confirmou o recebimento."}</p>
            </div>
          ))}
        </div>
        <div className="rounded-2xl border border-rose-200 bg-rose-50/70 p-4">
          <div className="flex items-center gap-2 text-rose-800"><Siren className="h-5 w-5" /><p className="text-sm font-black">Precisa de ajuda?</p></div>
          <p className="mt-2 text-xs leading-5 text-rose-800">Envie um alerta à administração. O sistema tenta obter uma localização atual; se o GPS não responder, usa a última posição conhecida, quando disponível. O SOS não depende de manter o acompanhamento contínuo ativo.</p>
          <textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={500} rows={2} className="mt-3 w-full rounded-xl border border-rose-200 bg-white p-3 text-xs text-slate-700" aria-label="Mensagem opcional do SOS" />
          <button type="button" onClick={() => { if (window.confirm("Enviar um alerta SOS à administração da DBS Air agora?")) sendSos.mutate(); }} disabled={!status.data?.sosAvailable || sendSos.isPending} className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-rose-700 px-4 py-3 text-xs font-black text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-45">
            <Siren className="h-4 w-4" /> {sendSos.isPending ? "Enviando SOS…" : "ENVIAR SOS"}
          </button>
          {!status.data?.sosAvailable && <p className="mt-2 text-[10px] font-bold text-rose-800">O SOS pelo portal fica disponível durante a jornada registrada.</p>}
        </div>
      </div>
      <div className="border-t border-slate-100 bg-slate-50 px-5 py-3 text-[10px] leading-5 text-slate-500 sm:px-7">
        O navegador pode suspender a leitura quando a tela for bloqueada ou o portal sair de primeiro plano. Esta versão não rastreia em segundo plano nem fora do expediente.
      </div>
    </section>
  );
}

export function DbsFleetAdminPanel() {
  const queryClient = useQueryClient();
  const [workDate, setWorkDate] = useState(fleetLocalDate());
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["rh-dbs-fleet-overview", workDate],
    queryFn: () => listRhFleetOverview({ data: { work_date: workDate } }),
    refetchInterval: 15_000,
    retry: 1,
  });
  const routeQuery = useQuery({
    queryKey: ["rh-dbs-fleet-route", selectedSessionId],
    queryFn: () => listRhFleetSessionRoute({ data: { session_id: selectedSessionId! } }),
    enabled: Boolean(selectedSessionId),
    staleTime: 10_000,
  });
  const updateSos = useMutation({
    mutationFn: (input: { alert_id: string; status: "ACKNOWLEDGED" | "RESOLVED" }) => updateRhFleetSos({ data: input }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["rh-dbs-fleet-overview"] });
    },
  });

  const sessions: FleetSession[] = query.data?.sessions ?? [];
  const alerts: any[] = query.data?.sosAlerts ?? [];
  const liveCount = sessions.filter(isRecentFleetPosition).length;
  const routePoints: FleetPoint[] = routeQuery.data?.points ?? [];

  return (
    <div className="space-y-5">
      <header className="rounded-3xl bg-slate-950 p-6 text-white shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[.2em] text-sky-300">DBS AIR · gestão de campo</p>
            <h3 className="mt-2 text-3xl font-black">DBS FLEET</h3>
            <p className="mt-1 max-w-2xl text-sm text-slate-300">Visão operacional das localizações autorizadas, deslocamentos do dia e alertas de segurança.</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-300">Data<input type="date" value={workDate} onChange={(event) => { setWorkDate(event.target.value); setSelectedSessionId(null); }} className="mt-1 block min-h-10 rounded-xl border border-white/15 bg-white/10 px-3 text-xs font-bold text-white" /></label>
            <button type="button" onClick={() => void query.refetch()} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs font-black text-white"><RefreshCw className="h-3.5 w-3.5" /> Atualizar</button>
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3"><p className="text-[10px] font-black uppercase text-slate-400">Sessões no dia</p><p className="mt-1 text-2xl font-black">{sessions.length}</p></div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3"><p className="text-[10px] font-black uppercase text-slate-400">Posições nos últimos 3 min</p><p className="mt-1 text-2xl font-black">{liveCount}</p></div>
          <div className="rounded-2xl border border-rose-300/20 bg-rose-500/10 p-3"><p className="text-[10px] font-black uppercase text-rose-200">SOS em aberto</p><p className="mt-1 text-2xl font-black text-rose-100">{alerts.length}</p></div>
        </div>
      </header>

      {alerts.length > 0 && <section className="space-y-3">
        <div className="flex items-center gap-2 text-rose-800"><Siren className="h-5 w-5" /><h4 className="text-sm font-black">Alertas SOS que precisam de atenção</h4></div>
        {alerts.map((alert) => (
          <article key={alert.id} className="rounded-2xl border border-rose-200 bg-rose-50 p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-black text-rose-950">{alert.employee?.full_name ?? "Colaborador"} · {alert.employee?.unit ?? "Sem unidade"}</p>
                <p className="mt-1 text-xs font-bold text-rose-800">{dateTime(alert.created_at)} · {alert.status === "OPEN" ? "Aguardando atendimento" : "Recebido pela administração"}</p>
                <p className="mt-2 text-sm text-rose-900">{alert.message}</p>
                {alert.location_source === "last_known_session" && <p className="mt-2 text-[10px] font-black text-rose-800">Última posição conhecida · {dateTime(alert.location_recorded_at)}</p>}
                {alert.location_source === "current_sos" && <p className="mt-2 text-[10px] font-black text-rose-800">Localização capturada no acionamento do SOS</p>}
                {alert.latitude != null && alert.longitude != null && <a href={mapsUrl(alert.latitude, alert.longitude)} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-black text-rose-900 underline"><MapPin className="h-3.5 w-3.5" /> Abrir posição do SOS no Maps <ExternalLink className="h-3 w-3" /></a>}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {alert.status === "OPEN" && <button type="button" onClick={() => updateSos.mutate({ alert_id: alert.id, status: "ACKNOWLEDGED" })} disabled={updateSos.isPending} className="min-h-10 rounded-xl bg-rose-800 px-3 py-2 text-[11px] font-black text-white">Confirmar recebimento</button>}
                <button type="button" onClick={() => updateSos.mutate({ alert_id: alert.id, status: "RESOLVED" })} disabled={updateSos.isPending} className="min-h-10 rounded-xl border border-rose-300 bg-white px-3 py-2 text-[11px] font-black text-rose-900">Encerrar SOS</button>
              </div>
            </div>
          </article>
        ))}
      </section>}

      <section className="grid gap-4 xl:grid-cols-[1.2fr_.8fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-start justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-wider text-sky-700">Mapa da equipe</p><h4 className="mt-1 text-base font-black text-slate-900">{selectedSessionId ? "Trajeto da sessão selecionada" : "Última posição compartilhada"}</h4></div>{selectedSessionId && <button type="button" onClick={() => setSelectedSessionId(null)} className="text-xs font-black text-sky-700 underline">Voltar ao mapa da equipe</button>}</div>
          <FleetMap sessions={sessions} routePoints={routePoints} selectedSessionId={selectedSessionId} />
          <p className="mt-3 text-[10px] leading-5 text-slate-500">O mapa é atualizado a cada 15 segundos e considera recente uma posição recebida nos últimos 3 minutos. O pino verde indica sinal recente; o âmbar indica última posição antiga, sessão encerrada ou ausência de atualização. O portal precisa permanecer aberto e visível no aparelho do técnico.</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-wider text-sky-700">Equipe do dia</p><h4 className="mt-1 text-base font-black text-slate-900">Sessões e deslocamentos</h4></div><Navigation className="h-5 w-5 text-slate-400" /></div>
          <div className="mt-3 max-h-[430px] space-y-2 overflow-y-auto">
            {sessions.map((session) => {
              const recent = isRecentFleetPosition(session);
              const hasLocation = session.last_latitude != null && session.last_longitude != null;
              return <article key={session.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-xs font-black text-slate-900">{session.employee?.full_name ?? "Colaborador"}</p><p className="mt-0.5 text-[10px] text-slate-500">{session.employee?.unit ?? "Sem unidade"} · início {dateTime(session.started_at)}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-black ${session.ended_at ? "bg-slate-100 text-slate-600" : recent ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{session.ended_at ? "Encerrado" : recent ? "Com sinal · até 3 min" : "Sem sinal recente"}</span></div>
                <p className="mt-2 text-[10px] font-bold text-slate-500">{timeSince(session.last_position_at)} · {hasLocation ? `±${Math.round(Number(session.last_accuracy_m ?? 0))} m` : "Sem coordenadas"}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" onClick={() => setSelectedSessionId(session.id)} className="min-h-9 rounded-lg bg-slate-900 px-3 py-2 text-[10px] font-black text-white">Ver deslocamento</button>
                  {hasLocation && <a href={mapsUrl(session.last_latitude!, session.last_longitude!)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-[10px] font-black text-slate-700"><MapPin className="h-3 w-3" /> Maps</a>}
                </div>
              </article>;
            })}
            {!sessions.length && <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center"><UserRound className="mx-auto h-6 w-6 text-slate-300" /><p className="mt-2 text-xs font-black text-slate-600">Nenhuma sessão registrada nesta data.</p><p className="mt-1 text-[10px] text-slate-400">As posições aparecem quando o colaborador autoriza o acompanhamento no portal.</p></div>}
          </div>
        </div>
      </section>
      {query.error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-800">{query.error instanceof Error ? query.error.message : "Não foi possível consultar o DBS FLEET."}</p>}
      {routeQuery.error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-800">{routeQuery.error instanceof Error ? routeQuery.error.message : "Não foi possível carregar o trajeto."}</p>}
      <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4 text-xs leading-5 text-sky-900">
        <strong>Transparência e retenção:</strong> o colaborador vê e controla o acompanhamento. O mapa e o histórico são restritos ao RH autorizado; pontos de deslocamento são retidos por até 30 dias e alertas SOS resolvidos por até 90 dias. A versão web registra posições somente com o portal em primeiro plano.
      </div>
    </div>
  );
}


/**
 * O dock permanece montado no layout autenticado durante a navegação entre
 * módulos. O painel fica apenas oculto por CSS quando recolhido, para que a
 * sessão de GPS não seja desmontada ao abrir uma OS ou trocar de rota.
 */
export function DbsFleetEmployeeDock() {
  const [open, setOpen] = useState(false);
  const status = useQuery({
    queryKey: ["my-dbs-fleet-status"],
    queryFn: () => getMyFleetStatus(),
    refetchInterval: 20_000,
    retry: false,
    staleTime: 10_000,
  });

  if (status.isLoading || status.error || !status.data?.employee
    || (!status.data.eligible && !status.data.sosAvailable && !status.data.activeSession)) {
    return null;
  }

  const active = Boolean(status.data.activeSession);
  const label = active
    ? "GPS compartilhado"
    : status.data.onBreak
      ? "GPS pausado · almoço"
      : status.data.eligible
        ? "Autorizar GPS"
        : "Segurança da jornada";

  return (
    <>
      <div
        className={`fixed bottom-24 right-3 z-[90] w-[min(94vw,520px)] transition-opacity md:bottom-16 ${open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}
        aria-hidden={!open}
      >
        <div className="max-h-[78vh] overflow-y-auto rounded-3xl bg-white shadow-2xl ring-1 ring-slate-900/10">
          <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-950 px-4 py-3 text-white">
            <div className="min-w-0">
              <p className="text-[9px] font-black uppercase tracking-[.18em] text-sky-300">Controles em qualquer módulo</p>
              <p className="mt-0.5 truncate text-sm font-black">DBS FLEET · {label}</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="min-h-10 min-w-10 rounded-xl border border-white/20 bg-white/10 text-lg font-black text-white" aria-label="Recolher controles do DBS FLEET">×</button>
          </div>
          <div className="p-2 sm:p-3">
            <DbsFleetEmployeePanel />
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={open ? "Recolher controles do DBS FLEET" : "Abrir controles de localização e SOS do DBS FLEET"}
        className="fixed bottom-4 right-3 z-[91] inline-flex min-h-12 max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-left text-xs font-black text-white shadow-xl ring-1 ring-white/10 md:bottom-4"
      >
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${active ? "animate-pulse bg-emerald-400" : status.data.onBreak ? "bg-amber-400" : "bg-sky-400"}`} />
        <span className="truncate">DBS FLEET · {label}</span>
        <span className="rounded-lg bg-white/10 px-2 py-1 text-[10px] text-sky-200">{status.data.sosAvailable ? "SOS" : "Abrir"}</span>
      </button>
    </>
  );
}
