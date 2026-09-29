import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Shield, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import logoAsset from "@/assets/logo-dbs-air.jpg.asset.json";

const getTreasuryCloudState = async () => {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Sessão expirada.");
  const { data: user, error: userError } = await (supabase as any)
    .from("users").select("id, company_id, role_key, status").eq("auth_id", auth.user.id).maybeSingle();
  if (userError) throw new Error(userError.message);
  if (!user || user.status !== "ativo" || user.role_key !== "SUPER_ADMIN") throw new Error("Acesso ao Financeiro restrito ao SUPER_ADMIN.");
  const scopeKey = user.company_id ? "company:" + user.company_id : "user:" + user.id;
  const { data, error } = await (supabase as any).from("treasury_snapshots")
    .select("state, state_version, updated_at").eq("scope_key", scopeKey).maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
};

const saveTreasuryCloudState = async ({ state }: { state: Record<string, unknown> }) => {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Sessão expirada.");
  const { data: user, error: userError } = await (supabase as any)
    .from("users").select("id, company_id, role_key, status").eq("auth_id", auth.user.id).maybeSingle();
  if (userError) throw new Error(userError.message);
  if (!user || user.status !== "ativo" || user.role_key !== "SUPER_ADMIN") throw new Error("Acesso ao Financeiro restrito ao SUPER_ADMIN.");
  if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error("Estado financeiro inválido.");
  const scopeKey = user.company_id ? "company:" + user.company_id : "user:" + user.id;
  const payload = { scope_key: scopeKey, company_id: user.company_id ?? null, owner_user_id: user.id, state, state_version: Number((state as any)?._meta?.version) || 5, updated_by: user.id, updated_at: new Date().toISOString() };
  const { data: saved, error } = await (supabase as any).from("treasury_snapshots")
    .upsert(payload, { onConflict: "scope_key" }).select("state, state_version, updated_at").single();
  if (error) throw new Error(error.message);
  return saved;
};

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
          if (cloud?.state && treasuryStateHasData(cloud.state as Record<string, unknown>)) {
            iframeRef.current?.contentWindow?.postMessage({ type: "DBS_TREASURY_CLOUD_STATE", state: cloud.state }, "*");
            cloudReadyRef.current = true;
          } else if (msg.state && typeof msg.state === "object" && !Array.isArray(msg.state)) {
            const sanitized = JSON.parse(JSON.stringify(msg.state));
            const removeBy = (arr: any[], fn: (x:any)=>boolean) => arr.filter(x => !fn(x));
            sanitized.recebimentos = removeBy(sanitized.recebimentos || [], x => x.id === "rec_in_1" && x.cliente === "Cliente Contratual S/A" && Number(x.valor) === 25000 && x.status === "Pendente");
            sanitized.contasPagar = removeBy(sanitized.contasPagar || [], x => x.id === "pag_1" && x.fornecedor === "Insumos Técnicos Ltda" && Number(x.valor) === 3400 && x.status === "Pendente");
            sanitized.movimentacoes = removeBy(sanitized.movimentacoes || [], x => x.id === "mov_1" && x.descricao === "Aporte Inicial de Caixa" && Number(x.valor) === 12500);
            sanitized.recorrencias = removeBy(sanitized.recorrencias || [], x => x.id === "rec_1" && x.servico === "Sistemas & Licenças Operacionais" && Number(x.valor) === 1200);
            sanitized.bancos = removeBy(sanitized.bancos || [], x => (x.id === "banco_1" && x.nome === "Santander Principal" && Number(x.saldo) === 12500) || (x.id === "banco_2" && x.nome === "Caixa Física Empresarial" && Number(x.saldo) === 1500));
            sanitized._meta = { ...(sanitized._meta || {}), demoSanitizedAt: new Date().toISOString(), version: 5 };
            // Bootstrap seguro: se a nuvem estiver vazia, a cópia local existente é a fonte de migração.\n            // Nunca substitua um estado financeiro existente por um estado vazio.\n            const saved = await saveTreasuryCloudState({ state: sanitized });
            iframeRef.current?.contentWindow?.postMessage({ type: "DBS_TREASURY_CLOUD_STATE", state: saved.state }, "*");
            cloudReadyRef.current = true;
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
        <div className="flex items-center gap-3">{cloudError ? <span className="hidden max-w-[420px] truncate rounded-full bg-rose-500/10 px-3 py-1.5 text-[10px] font-bold text-rose-300 sm:inline-flex" title={cloudError}>Erro de sincronização</span> : <span className="hidden items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300 sm:inline-flex"><Shield className="h-3.5 w-3.5" /> Financeiro protegido</span>}<button onClick={() => navigate({ to: "/admin" })} className="inline-flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-bold text-slate-300 transition hover:bg-slate-800 hover:text-white"><ArrowLeft className="h-4 w-4" /> Voltar ao painel</button></div>
      </header>
      <main className="relative flex-1 w-full bg-[#f5f7fb]" style={{ minHeight: "calc(100vh - 72px)" }}>
        {loading && <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-50"><div className="flex flex-col items-center gap-4"><Loader2 className="h-10 w-10 animate-spin text-blue-600" /><p className="text-sm font-semibold text-slate-600">Carregando DBS TREASURY Enterprise Executive Suite…</p></div></div>}
        <iframe ref={iframeRef} title="DBS TREASURY" src={TREASURY_URL} onLoad={() => setLoading(false)} sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads" style={{ width: "100%", height: "calc(100vh - 72px)", border: "none", display: "block", background: "#f5f7fb" }} />
      </main>
    </div>
  );
}