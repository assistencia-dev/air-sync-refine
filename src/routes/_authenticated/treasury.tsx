import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Shield, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { decideDbsPurchaseApprovalFromTreasury, getTreasuryCloudState, postTreasuryLedgerEntry, saveTreasuryCostCenter } from "@/lib/treasury.functions";
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
  const [purchaseCommitments, setPurchaseCommitments] = useState<Array<Record<string, any>>>([]);
  const [pendingPurchaseApprovals, setPendingPurchaseApprovals] = useState<Array<Record<string, any>>>([]);
  const [purchaseApprovalBusyId, setPurchaseApprovalBusyId] = useState<string | null>(null);
  const [purchaseRejectionReasons, setPurchaseRejectionReasons] = useState<Record<string, string>>({});
  const [purchaseApprovalMessage, setPurchaseApprovalMessage] = useState<string | null>(null);

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
      if (error || !user || user.status !== "ativo" || !["SUPER_ADMIN", "FINANCEIRO_LEITURA"].includes(user.role_key)) {
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
          setPurchaseCommitments(Array.isArray(cloud?.purchase_commitments) ? cloud.purchase_commitments : []);
          setPendingPurchaseApprovals(Array.isArray(cloud?.pending_purchase_approvals) ? cloud.pending_purchase_approvals : []);
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
          const costCenters = Array.isArray(cloud?.cost_centers) ? cloud.cost_centers : [];
          if (costCenters.length) {
            const currentMeta = stateToHydrate._meta && typeof stateToHydrate._meta === "object" && !Array.isArray(stateToHydrate._meta)
              ? stateToHydrate._meta as Record<string, unknown>
              : {};
            stateToHydrate._meta = {
              ...currentMeta,
              centrosCusto: costCenters.map((center: any) => ({
                id: String(center.id), codigo: String(center.code), nome: String(center.name), ativo: center.status === "active",
              })),
            };
          }
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
      if (msg.type === "DBS_TREASURY_SAVE_COST_CENTER") {
        const requestId = typeof msg.requestId === "string" ? msg.requestId : "";
        if (!requestId || !msg.center || typeof msg.center !== "object") return;
        try {
          if (!cloudReadyRef.current) throw new Error("O Financeiro ainda não terminou a sincronização inicial.");
          const result = await saveTreasuryCostCenter({ data: {
            code: String(msg.center.code || ""),
            name: String(msg.center.name || ""),
          } });
          iframeRef.current?.contentWindow?.postMessage(
            { type: "DBS_TREASURY_COST_CENTER_RESULT", requestId, ok: true, result },
            window.location.origin,
          );
          const cloud = await getTreasuryCloudState();
          setPurchaseCommitments(Array.isArray(cloud?.purchase_commitments) ? cloud.purchase_commitments : []);
          setPendingPurchaseApprovals(Array.isArray(cloud?.pending_purchase_approvals) ? cloud.pending_purchase_approvals : []);
          const state = cloud?.state && typeof cloud.state === "object" ? cloud.state : null;
          if (state) iframeRef.current?.contentWindow?.postMessage(
            { type: "DBS_TREASURY_CLOUD_STATE", state, ledgerEntryCount: cloud?.ledger_entry_count ?? 0 },
            window.location.origin,
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : "Falha ao salvar centro de custo.";
          iframeRef.current?.contentWindow?.postMessage(
            { type: "DBS_TREASURY_COST_CENTER_RESULT", requestId, ok: false, error: message },
            window.location.origin,
          );
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

  async function decidePurchaseApproval(purchase: Record<string, any>, decision: "approved" | "rejected") {
    const purchaseId = String(purchase.id ?? "");
    const reason = String(purchaseRejectionReasons[purchaseId] ?? "").trim();
    if (decision === "rejected" && reason.length < 5) {
      setPurchaseApprovalMessage("Informe o motivo da rejeição com pelo menos 5 caracteres.");
      return;
    }
    setPurchaseApprovalBusyId(purchaseId);
    setPurchaseApprovalMessage(null);
    try {
      await decideDbsPurchaseApprovalFromTreasury({ data: {
        purchaseId,
        decision,
        reason: decision === "rejected" ? reason : undefined,
        expectedVersion: Number(purchase.version),
      } });
      const cloud = await getTreasuryCloudState();
      setPurchaseCommitments(Array.isArray(cloud?.purchase_commitments) ? cloud.purchase_commitments : []);
      setPendingPurchaseApprovals(Array.isArray(cloud?.pending_purchase_approvals) ? cloud.pending_purchase_approvals : []);
      setPurchaseApprovalMessage(decision === "approved"
        ? "Compra aprovada. O compromisso entrou no DBS Treasury e o recebimento físico foi liberado."
        : "Compra rejeitada. Nenhuma entrada de estoque foi autorizada.");
      setPurchaseRejectionReasons((current) => {
        const next = { ...current };
        delete next[purchaseId];
        return next;
      });
    } catch (error) {
      setPurchaseApprovalMessage(error instanceof Error ? error.message : "Não foi possível decidir a compra.");
    } finally {
      setPurchaseApprovalBusyId(null);
    }
  }

  return (
    <div className="admin-mobile-shell flex min-h-screen flex-col pb-20 lg:pb-0" style={{ background: "#f4f8fc", fontFamily: "'Inter',system-ui,sans-serif" }}>
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 shadow-sm sm:px-6">
        <div className="flex items-center gap-3"><BrandLogo frameClassName="rounded-lg px-2 py-1" imageClassName="h-9 w-auto max-w-[190px] object-contain" /><span className="hidden h-7 w-px bg-slate-200 sm:block" /><span className="text-xs font-bold uppercase tracking-widest" style={{ color: "#1769D1" }}>Módulo Financeiro · DBS TREASURY</span></div>
        <div className="flex items-center gap-3">{cloudError ? <span className="hidden max-w-[420px] truncate rounded-full bg-rose-50 px-3 py-1.5 text-[10px] font-bold text-rose-700 sm:inline-flex" title={cloudError}>Erro de sincronização</span> : <span className="hidden items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 sm:inline-flex"><Shield className="h-3.5 w-3.5" /> Financeiro protegido</span>}<button onClick={() => navigate({ to: profile?.role_key === "FINANCEIRO_LEITURA" ? "/financeiro-acompanhamento" : "/admin" })} className="inline-flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-bold font-bold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"><ArrowLeft className="h-4 w-4" /> Voltar</button></div>
      </header>
      <section aria-label="Compromissos de compras aprovadas" className="shrink-0 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-xs font-black uppercase tracking-wider text-slate-700">Compromissos de compras aprovadas</h2>
            <p className="text-[11px] text-slate-500">Leitura do contas a pagar já lançado; esta visão não cria nem duplica obrigações.</p>
          </div>
          <div className="text-right">
            <p className="text-xs font-bold text-slate-500">{purchaseCommitments.length} em aberto</p>
            <p className="text-sm font-black text-slate-900">{new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(purchaseCommitments.reduce((sum, item) => sum + Number(item.outstanding_cents ?? 0), 0) / 100)}</p>
          </div>
        </div>
        <div className="mt-2 max-h-28 overflow-y-auto">
          {purchaseCommitments.length ? purchaseCommitments.map((item) => (
            <div key={String(item.purchase_id)} className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 py-2 text-xs">
              <span className="min-w-0 truncate font-semibold text-slate-700">{String(item.supplier_name ?? "Fornecedor")} · {String(item.document_number ?? "Compra")}</span>
              <span className="text-slate-500">{item.commitment_date ? new Date(String(item.commitment_date) + "T12:00:00").toLocaleDateString("pt-BR") : "—"}</span>
              <strong className="text-slate-900">{new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(item.outstanding_cents ?? 0) / 100)}</strong>
            </div>
          )) : <p className="border-t border-slate-100 py-2 text-xs text-slate-500">Nenhum compromisso de compra aprovado em aberto.</p>}
        </div>
      </section>
      <section aria-label="Fila de aprovação financeira de compras" className="shrink-0 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-xs font-black uppercase tracking-wider text-slate-700">Compras aguardando aprovação financeira</h2>
            <p className="text-[11px] text-slate-500">A aprovação cria o compromisso no Ledger; a rejeição bloqueia recebimento e pagamento.</p>
          </div>
          <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-black text-amber-800">{pendingPurchaseApprovals.length} pendente(s)</span>
        </div>
        {purchaseApprovalMessage && <p role="status" className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">{purchaseApprovalMessage}</p>}
        <div className="mt-2 grid gap-2">
          {pendingPurchaseApprovals.length ? pendingPurchaseApprovals.map((purchase) => {
            const id = String(purchase.id);
            const busy = purchaseApprovalBusyId === id;
            return (
              <article key={id} className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-slate-800">{String(purchase.supplier_name ?? "Fornecedor")} · {String(purchase.document_number ?? "Pedido sem documento")}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {purchase.purchase_date ? new Date(String(purchase.purchase_date) + "T12:00:00").toLocaleDateString("pt-BR") : "—"}
                    {" · "} {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(purchase.total_cents ?? 0) / 100)}
                  </p>
                  {purchase.cost_center_name && <p className="mt-1 text-xs text-slate-500">Centro de custo: {String(purchase.cost_center_name)}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <input
                    aria-label={"Motivo da rejeição da compra " + id}
                    value={purchaseRejectionReasons[id] ?? ""}
                    onChange={(event) => setPurchaseRejectionReasons((current) => ({ ...current, [id]: event.target.value }))}
                    maxLength={1000}
                    placeholder="Motivo para rejeitar"
                    className="min-h-10 min-w-40 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-xs sm:w-48 sm:flex-none"
                  />
                  <button type="button" disabled={busy || purchaseApprovalBusyId !== null} onClick={() => void decidePurchaseApproval(purchase, "approved")} className="min-h-10 rounded-lg bg-emerald-700 px-3 text-xs font-black text-white disabled:opacity-40">
                    {busy ? "Salvando..." : "Aprovar"}
                  </button>
                  <button type="button" disabled={busy || purchaseApprovalBusyId !== null || String(purchaseRejectionReasons[id] ?? "").trim().length < 5} onClick={() => void decidePurchaseApproval(purchase, "rejected")} className="min-h-10 rounded-lg bg-rose-700 px-3 text-xs font-black text-white disabled:opacity-40">
                    Rejeitar
                  </button>
                </div>
              </article>
            );
          }) : <p className="rounded-lg border-t border-slate-100 py-3 text-xs text-slate-500">Nenhuma compra pendente de aprovação financeira.</p>}
        </div>
      </section>
      <main className="relative flex-1 w-full bg-[#f5f7fb]" style={{ minHeight: "calc(100vh - 176px)" }}>
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
        <iframe className="admin-mobile-iframe" key={iframeReloadKey} ref={iframeRef} title="DBS TREASURY" src={TREASURY_URL} sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads" style={{ width: "100%", height: "calc(100dvh - 176px)", border: "none", display: "block", background: "#f5f7fb" }} />
      </main>
      {profile?.role_key === "SUPER_ADMIN" && <MobileAdminNavigation active="finance" />}
    </div>
  );
}
