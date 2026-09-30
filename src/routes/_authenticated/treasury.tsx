import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Shield, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getTreasuryCloudState, saveTreasuryCloudState } from "@/lib/treasury.functions";
import logoAsset from "@/assets/logo-dbs-air.jpg.asset.json";


export const Route = createFileRoute("/_authenticated/treasury")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "DBS TREASURY | Financeiro" },
      { name: "description", content: "Módulo Financeiro DBS TREASURY Enterprise Executive Suite" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: TreasuryPage,
});

const NATIVE_ADMIN_USERNAMES = new Set(["DBS123", "DBSASSISTENCIA123"]);

// HTML completo do DBS TREASURY V10 fornecido pelo usuário
// Os links de CDN foram removidos das crases acidentais no original
const TREASURY_URL = "/treasury.html?v=20260929-2";

function treasuryStateHasData(state: Record<string, unknown> | null | undefined) {
  if (!state) return false;
  const keys = ["passivos", "recorrencias", "recebimentos", "contasPagar", "bancos", "movimentacoes", "auditoria"];
  return keys.some((key) => Array.isArray(state[key]) && (state[key] as unknown[]).length > 0);
}


function TreasuryPage() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<{ role_key?: string } | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingStateRef = useRef<Record<string, unknown> | null>(null);
  const cloudReadyRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [cloudError, setCloudError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadProfile = async () => {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) {
        if (!cancelled) navigate({ to: "/login", replace: true });
        return;
      }
      const { data: user, error } = await (supabase as any)
        .from("users")
        .select("role_key, status")
        .eq("auth_id", auth.user.id)
        .maybeSingle();
      if (error || !user || user.status !== "ativo" || user.role_key !== "SUPER_ADMIN") {
        if (!cancelled) navigate({ to: "/portal", replace: true });
        return;
      }
      if (!cancelled) setProfile(user);
    };
    void loadProfile();
    return () => { cancelled = true; };
  }, [navigate]);

  useEffect(() => {
    const handler = async (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const msg = event.data || {};
      if (msg.type === "DBS_TREASURY_READY") {
        try {
          const cloud = await getTreasuryCloudState();
          const cloudState = cloud?.state && typeof cloud.state === "object" && !Array.isArray(cloud.state)
            ? cloud.state as Record<string, unknown>
            : null;
          const localState = msg.state && typeof msg.state === "object" && !Array.isArray(msg.state)
            ? JSON.parse(JSON.stringify(msg.state)) as Record<string, unknown>
            : null;

          // A nuvem é a fonte compartilhada quando já existe um snapshot.
          // Se ainda não houver snapshot, preservamos o estado deste dispositivo
          // e fazemos a primeira migração para a nuvem sem apagar lançamentos.
          if (cloudState) {
            if (treasuryStateHasData(cloudState) || !treasuryStateHasData(localState)) {
              cloudReadyRef.current = true;
              iframeRef.current?.contentWindow?.postMessage(
                { type: "DBS_TREASURY_CLOUD_STATE", state: cloudState },
                "*",
              );
            } else {
              localState._meta = {
                ...(localState._meta || {}),
                version: 5,
                cloudMigratedAt: new Date().toISOString(),
              };
              const saved = await saveTreasuryCloudState({ state: localState });
              cloudReadyRef.current = true;
              iframeRef.current?.contentWindow?.postMessage(
                { type: "DBS_TREASURY_CLOUD_STATE", state: saved.state },
                "*",
              );
            }
          } else if (localState) {
            localState._meta = {
              ...(localState._meta || {}),
              version: 5,
              cloudMigratedAt: new Date().toISOString(),
            };
            const saved = await saveTreasuryCloudState({ state: localState });
            cloudReadyRef.current = true;
            iframeRef.current?.contentWindow?.postMessage(
              { type: "DBS_TREASURY_CLOUD_STATE", state: saved.state },
              "*",
            );
          }

          if (!cloudReadyRef.current) {
            throw new Error("O Financeiro não conseguiu estabelecer a sincronização compartilhada com o banco de dados.");
          }
          setCloudError(null);
        } catch (err) {
          console.error("DBS Treasury cloud load:", err);
          setCloudError(err instanceof Error ? err.message : "Falha ao carregar o Financeiro.");
        }
        return;
      }
      if (msg.type === "DBS_TREASURY_SAVE") {
        pendingStateRef.current = msg.state;
        if (!cloudReadyRef.current) return;
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(async () => {
          const state = pendingStateRef.current;
          if (!state) return;
          try { await saveTreasuryCloudState({ state }); setCloudError(null); }
          catch (err) { console.error("DBS Treasury cloud save:", err); setCloudError(err instanceof Error ? err.message : "Falha ao salvar o Financeiro."); }
        }, 450);
      }
    };
    window.addEventListener("message", handler);
    return () => { window.removeEventListener("message", handler); if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, []);

  return (
    <div className="flex flex-col min-h-screen" style={{ background: "#090D16", fontFamily: "'Inter',system-ui,sans-serif" }}>
      <header className="flex h-[72px] shrink-0 items-center justify-between border-b border-slate-800 bg-[#0F172A]/90 px-4 shadow-sm backdrop-blur sm:px-6">
        <div className="flex items-center gap-3"><img src={logoAsset.url} alt="DBS Air" className="h-10 w-auto max-w-[190px] object-contain" /><span className="hidden h-7 w-px bg-slate-700 sm:block" /><span className="text-xs font-bold uppercase tracking-widest" style={{ color: "#F59E0B" }}>Módulo Financeiro · DBS TREASURY</span></div>
        <div className="flex items-center gap-3">{cloudError ? <span className="hidden max-w-[420px] truncate rounded-full bg-rose-500/10 px-3 py-1.5 text-[10px] font-bold text-rose-300 sm:inline-flex" title={cloudError}>Erro de sincronização</span> : <span className="hidden items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300 sm:inline-flex"><Shield className="h-3.5 w-3.5" /> Financeiro protegido</span>}<button onClick={() => navigate({ to: "/admin" })} className="inline-flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-bold font-bold text-slate-300 transition hover:bg-slate-800 hover:text-white"><ArrowLeft className="h-4 w-4" /> Voltar ao painel</button></div>
      </header>
      <main className="relative flex-1 w-full bg-[#f5f7fb]" style={{ minHeight: "calc(100vh - 72px)" }}>
        {loading && <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-50"><div className="flex flex-col items-center gap-4"><Loader2 className="h-10 w-10 animate-spin text-blue-600" /><p className="text-sm font-semibold text-slate-600">Carregando DBS TREASURY Enterprise Executive Suite…</p></div></div>}
        <iframe ref={iframeRef} title="DBS TREASURY" src={TREASURY_URL} onLoad={() => setLoading(false)} sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads" style={{ width: "100%", height: "calc(100vh - 72px)", border: "none", display: "block", background: "#f5f7fb" }} />
      </main>
    </div>
  );
}
