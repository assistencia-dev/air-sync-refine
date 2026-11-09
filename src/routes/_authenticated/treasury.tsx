import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Shield, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getTreasuryCloudState, postTreasuryLedgerEntry, getTreasuryVtBenefitsReport } from "@/lib/treasury.functions";
import { BrandLogo } from "@/components/BrandLogo";
import { MobileAdminNavigation } from "@/components/MobileAdminNavigation";


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

// HTML completo do DBS TREASURY V10 fornecido pelo usuário
// Os links de CDN foram removidos das crases acidentais no original
const TREASURY_URL = "/treasury.html?v=20261027-ledger-1";


function TreasuryPage() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<{ role_key?: string } | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const cloudReadyRef = useRef(false);
  const [iframeReloadKey, setIframeReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [vtCompetence, setVtCompetence] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  });
  const vtStart = `${vtCompetence}-01`;
  const [vtYear, vtMonth] = vtCompetence.split("-").map(Number);
  const vtEndDate = new Date(vtYear, vtMonth, 1);
  const vtEnd = `${vtEndDate.getFullYear()}-${String(vtEndDate.getMonth()+1).padStart(2,"0")}-01`;
  const vtReport = useQuery({
    queryKey: ["treasury-vt-benefits", vtCompetence],
    queryFn: () => getTreasuryVtBenefitsReport({ data: { competence_start: vtStart, competence_end: vtEnd } }),
    enabled: profile?.role_key === "SUPER_ADMIN",
  });
  const vtRows = vtReport.data ?? [];
  const vtTotals = vtRows.reduce((acc: any, row: any) => ({
    rh: acc.rh + Number(row.rh_total_cents ?? 0),
    treasury: acc.treasury + Number(row.treasury_total_cents ?? 0),
    difference: acc.difference + Number(row.difference_cents ?? 0),
  }), { rh: 0, treasury: 0, difference: 0 });

  useEffect(() => {
    let cancelled = false;
    const loadProfile = async () => {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) {
        if (!cancelled) navigate({ to: "/login", replace: true });
        return;
      }
      const { data: user, error } = await supabase
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
      if (event.origin !== window.location.origin) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      const msg = event.data || {};
      if (msg.type === "DBS_TREASURY_VERIFY_ADMIN_PASSWORD") {
        const requestId = typeof msg.requestId === "string" ? msg.requestId : "";
        const password = typeof msg.password === "string" ? msg.password : "";
        let ok = false;
        try {
          if (!requestId || !password || password.length > 128) {
            throw new Error("Invalid administrative password verification request.");
          }
          const { data: auth, error: authError } = await supabase.auth.getUser();
          if (authError || !auth.user?.email) {
            throw new Error("Administrator session is missing.");
          }
          const { data: user, error: userError } = await supabase
            .from("users")
            .select("role_key, status")
            .eq("auth_id", auth.user.id)
            .maybeSingle();
          if (userError || !user || user.status !== "ativo" || user.role_key !== "SUPER_ADMIN") {
            throw new Error("Current session is not an active SUPER_ADMIN.");
          }
          // Supabase Auth validates the live account password; no reusable secret is stored in HTML.
          const { data: verified, error: verifyError } = await supabase.auth.signInWithPassword({
            email: auth.user.email,
            password,
          });
          if (verifyError || verified.user?.id !== auth.user.id) {
            throw new Error("Administrative re-authentication failed.");
          }
          ok = true;
        } catch {
          ok = false;
        }
        iframeRef.current?.contentWindow?.postMessage(
          { type: "DBS_TREASURY_ADMIN_PASSWORD_RESULT", requestId, ok },
          window.location.origin,
        );
        return;
      }
      if (msg.type === "DBS_TREASURY_READY") {
        try {
          const cloud = await getTreasuryCloudState();
          const cloudState = cloud?.state && typeof cloud.state === "object" && !Array.isArray(cloud.state)
            ? cloud.state as Record<string, unknown>
            : null;
          const localState = msg.state && typeof msg.state === "object" && !Array.isArray(msg.state)
            ? JSON.parse(JSON.stringify(msg.state)) as Record<string, unknown>
            : null;
          // Snapshot legado é somente leitura. Sem snapshot, o cache local serve
          // apenas como recuperação visual; os novos lançamentos seguem pelo Ledger.
          const stateToHydrate = cloudState || localState || {
            passivos: [], recorrencias: [], recebimentos: [], contasPagar: [],
            bancos: [], movimentacoes: [], auditoria: [], _meta: { version: 5 },
          };
          cloudReadyRef.current = true;
          iframeRef.current?.contentWindow?.postMessage(
            { type: "DBS_TREASURY_CLOUD_STATE", state: stateToHydrate, ledgerEntryCount: cloud?.ledger_entry_count ?? 0 },
            window.location.origin,
          );
          setCloudError(null);
          setLoading(false);
        } catch (err) {
          console.error("DBS Treasury cloud load:", err);
          setCloudError(err instanceof Error ? err.message : "Falha ao carregar o Financeiro.");
          // Keep the iframe covered until shared state is hydrated; local-only edits
          // could otherwise appear saved even while the cloud is unavailable.
          setLoading(true);
        }
        return;
      }
      if (msg.type === "DBS_TREASURY_LEDGER_COMMAND") {
        const requestId = typeof msg.requestId === "string" ? msg.requestId : "";
        if (!requestId || !msg.command || typeof msg.command !== "object") return;
        try {
          if (!cloudReadyRef.current) throw new Error("O Financeiro ainda não terminou a sincronização inicial.");
          const result = await postTreasuryLedgerEntry({ data: msg.command });
          iframeRef.current?.contentWindow?.postMessage(
            { type: "DBS_TREASURY_LEDGER_RESULT", requestId, ok: true, result },
            window.location.origin,
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : "Falha ao gravar o lançamento relacional.";
          console.error("DBS Treasury ledger command:", err);
          iframeRef.current?.contentWindow?.postMessage(
            { type: "DBS_TREASURY_LEDGER_RESULT", requestId, ok: false, error: message },
            window.location.origin,
          );
        }
      }
    };
    window.addEventListener("message", handler);
    return () => { window.removeEventListener("message", handler); };
  }, []);

  return (
    <div className="admin-mobile-shell flex min-h-screen flex-col pb-20 lg:pb-0" style={{ background: "#f4f8fc", fontFamily: "'Inter',system-ui,sans-serif" }}>
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 shadow-sm sm:px-6">
        <div className="flex items-center gap-3"><BrandLogo frameClassName="rounded-lg px-2 py-1" imageClassName="h-9 w-auto max-w-[190px] object-contain" /><span className="hidden h-7 w-px bg-slate-200 sm:block" /><span className="text-xs font-bold uppercase tracking-widest" style={{ color: "#1769D1" }}>Módulo Financeiro · DBS TREASURY</span></div>
        <div className="flex items-center gap-3">{cloudError ? <span className="hidden max-w-[420px] truncate rounded-full bg-rose-50 px-3 py-1.5 text-[10px] font-bold text-rose-700 sm:inline-flex" title={cloudError}>Erro de sincronização</span> : <span className="hidden items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 sm:inline-flex"><Shield className="h-3.5 w-3.5" /> Financeiro protegido</span>}<button onClick={() => navigate({ to: "/admin" })} className="inline-flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-bold font-bold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"><ArrowLeft className="h-4 w-4" /> Voltar ao painel</button></div>
      </header>
      <main className="relative flex-1 w-full bg-[#f5f7fb]" style={{ minHeight: "calc(100vh - 64px)" }}>
        <section className="mx-auto max-w-[1600px] border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-sm font-extrabold text-slate-900">Custo de Vale-Transporte por funcionário</h2><p className="mt-1 text-xs text-slate-500">Conciliação RH × Treasury · regime de competência · sem ajustes automáticos</p></div>
            <label className="text-xs font-semibold text-slate-600">Competência <input className="ml-2 rounded-lg border border-slate-300 px-3 py-2" type="month" value={vtCompetence} onChange={e=>{if(e.target.value)setVtCompetence(e.target.value)}} /></label>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">RH</p><p className="mt-1 text-lg font-black text-slate-900">{new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(vtTotals.rh/100)}</p></div>
            <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Despesa no Treasury</p><p className="mt-1 text-lg font-black text-slate-900">{new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(vtTotals.treasury/100)}</p></div>
            <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Diferença</p><p className={`mt-1 text-lg font-black ${vtTotals.difference ? "text-rose-700" : "text-emerald-700"}`}>{new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(vtTotals.difference/100)}</p></div>
          </div>
          {vtReport.isError && <p className="mt-2 text-xs text-rose-700">{(vtReport.error as Error).message}</p>}
          <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-slate-500"><tr><th className="p-2">Funcionário</th><th className="p-2">Competência</th><th className="p-2">Custo RH</th><th className="p-2">Custo Treasury</th><th className="p-2">Diferença</th><th className="p-2">Conciliação</th></tr></thead><tbody>{vtRows.map((row: any)=><tr key={`${row.employee_id}-${row.company_id}-${row.competence_month}`} className="border-t border-slate-100"><td className="p-2 font-semibold text-slate-800">{row.employee_name ?? "Funcionário"}</td><td className="p-2 text-slate-600">{row.competence_month}</td><td className="p-2">{new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(row.rh_total_cents ?? 0)/100)}</td><td className="p-2">{new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(row.treasury_total_cents ?? 0)/100)}</td><td className={`p-2 font-bold ${row.divergence ? "text-rose-700" : "text-emerald-700"}`}>{new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(row.difference_cents ?? 0)/100)}</td><td className="p-2">{row.divergence ? <span className="font-bold text-rose-700">Divergente</span> : <span className="font-bold text-emerald-700">Conciliado</span>}</td></tr>)}</tbody></table></div>
          {!vtRows.length && !vtReport.isLoading && <p className="mt-2 text-xs text-slate-500">Sem recargas ou lançamentos de VT nesta competência.</p>}
        </section>
        {loading && <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-50 p-5">
          {cloudError ? (
            <div role="alert" className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-lg">
              <Shield className="mx-auto h-9 w-9 text-slate-600" />
              <h2 className="mt-3 text-base font-bold text-slate-900">Sincronização financeira não confirmada</h2>
              <p className="mt-2 break-words text-sm leading-6 text-slate-600">{cloudError}</p>
              <p className="mt-2 text-xs text-slate-500">O módulo permanecerá bloqueado para evitar alterações locais que não sejam gravadas na nuvem.</p>
              <button onClick={() => {
                cloudReadyRef.current = false;
                setCloudError(null);
                setLoading(true);
                setIframeReloadKey((key) => key + 1);
              }} className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700">
                Tentar sincronizar novamente
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4"><Loader2 className="h-10 w-10 animate-spin text-blue-600" /><p className="text-sm font-semibold text-slate-600">Sincronizando DBS TREASURY com a nuvem…</p></div>
          )}
        </div>}
        <iframe className="admin-mobile-iframe" key={iframeReloadKey} ref={iframeRef} title="DBS TREASURY" src={TREASURY_URL} sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads" style={{ width: "100%", height: "calc(100dvh - 64px)", border: "none", display: "block", background: "#f5f7fb" }} />
      </main>
      <MobileAdminNavigation active="finance" />
    </div>
  );
}
