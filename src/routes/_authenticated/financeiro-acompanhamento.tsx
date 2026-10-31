import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CalendarClock, CheckCircle2, Clock3, LogOut, RefreshCw, ShieldCheck, Wallet, TrendingDown, ReceiptText, CalendarDays } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getTreasuryViewerData } from "@/lib/treasury-viewer.functions";
import { BrandLogo } from "@/components/BrandLogo";
import { MobileAdminNavigation } from "@/components/MobileAdminNavigation";

export const Route = createFileRoute("/_authenticated/financeiro-acompanhamento")({
  ssr: false,
  head: () => ({ meta: [{ title: "Acompanhamento Financeiro | DBS AIR" }, { name: "robots", content: "noindex,nofollow" }] }),
  component: TreasuryViewerPage,
});

type Dashboard = Awaited<ReturnType<typeof getTreasuryViewerData>>;
const money = (n: number) => (Number(n)||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const dateBR = (s: string) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "Sem vencimento"; const [y,m,d]=s.split("-"); return `${d}/${m}/${y}`; };

function TreasuryViewerPage() {
  const navigate = useNavigate();
  const [data,setData] = useState<Dashboard|null>(null);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState("");
  const [filter,setFilter] = useState("todos");
  const [search,setSearch] = useState("");
  const [lastRefresh,setLastRefresh] = useState("");
  async function load() {
    setLoading(true); setError("");
    try { const result = await getTreasuryViewerData(); setData(result); setLastRefresh(new Date().toLocaleString("pt-BR")); }
    catch(e) { setError(e instanceof Error ? e.message : "Não foi possível carregar o painel."); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    let cancelled=false;
    supabase.auth.getUser().then(async ({data:auth}) => {
      if(cancelled) return;
      if(!auth.user) { navigate({to:"/login",replace:true}); return; }
      const {data:profile} = await supabase.from("users").select("role_key,status").eq("auth_id",auth.user.id).maybeSingle();
      if(cancelled) return;
      if(profile?.status !== "ativo" || !["FINANCEIRO_LEITURA","SUPER_ADMIN"].includes(profile?.role_key || "")) { navigate({to:"/portal",replace:true}); return; }
      void load();
    });
    return () => { cancelled=true; };
  }, [navigate]);
  const visibleDues = useMemo(() => (data?.dues || []).filter(x => {
    const matchesSearch = `${x.fornecedor} ${x.descricao} ${x.status}`.toLowerCase().includes(search.toLowerCase());
    const today=data?.today || "";
    const matchesFilter = filter==="todos" || (filter==="vencidos" && x.vencimento<today) ||
      (filter==="hoje" && x.vencimento===today) || (filter==="7dias" && x.vencimento>=today && x.vencimento<=new Date(new Date(today+"T12:00:00").getTime()+7*86400000).toISOString().slice(0,10)) ||
      (filter==="30dias" && x.vencimento>=today && x.vencimento<=new Date(new Date(today+"T12:00:00").getTime()+30*86400000).toISOString().slice(0,10));
    return matchesSearch && matchesFilter;
  }),[data,filter,search]);
  async function signOut() { await supabase.auth.signOut(); navigate({to:"/login",replace:true}); }
  const kpis = [
    {label:"Saldo disponível",value:data?.summary.cash,icon:Wallet,detail:"Conforme saldos cadastrados"},
    {label:"Vencidos",value:data?.summary.overdue,icon:AlertCircle,detail:"Exigem atenção"},
    {label:"Vencem hoje",value:data?.summary.dueToday,icon:Clock3,detail:"Compromissos do dia"},
    {label:"Próximos 7 dias",value:data?.summary.next7,icon:CalendarClock,detail:"Contas e parcelas"},
    {label:"Próximos 30 dias",value:data?.summary.next30,icon:CalendarDays,detail:"Planejamento de caixa"},
    {label:"Contas a pagar",value:data?.summary.pendingPayables,icon:ReceiptText,detail:"Total pendente cadastrado"},
    {label:"Passivos futuros",value:data?.summary.passives,icon:TrendingDown,detail:"Parcelas não pagas"},
    {label:"Recebimentos previstos",value:data?.summary.expectedReceipts,icon:CheckCircle2,detail:"Entradas pendentes"},
  ];
  return <div className="admin-mobile-shell min-h-screen bg-[#f3f7fc] pb-20 text-slate-900 lg:pb-0" style={{fontFamily:"Inter,system-ui,sans-serif"}}>
    <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-4 px-5 py-4 lg:px-8">
        <div className="flex items-center gap-4"><BrandLogo frameClassName="rounded-xl px-3 py-2 shadow-sm" imageClassName="h-10 w-auto max-w-[210px] object-contain"/><span className="hidden h-8 w-px bg-slate-200 md:block"/><div><p className="text-[10px] font-bold uppercase tracking-[.22em] text-blue-700">DBS AIR · Gestão executiva</p><h1 className="text-lg font-bold tracking-tight">Acompanhamento Financeiro</h1></div></div>
        <div className="flex items-center gap-2"><span className="hidden text-xs text-slate-500 md:inline">Somente consulta</span><button onClick={()=>void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading?"animate-spin":""}`}/> Atualizar</button><button onClick={()=>void signOut()} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"><LogOut className="h-4 w-4"/> Sair</button></div>
      </div>
    </header>
    <main className="mx-auto max-w-[1500px] space-y-6 px-5 py-7 lg:px-8">
      <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-[#0b1f42] via-[#123c78] to-[#1769d1] p-6 text-white shadow-lg shadow-blue-950/10 md:p-8"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.2em] text-blue-200">Visão consolidada</p><h2 className="mt-2 text-2xl font-bold md:text-3xl">Clareza para decidir. Controle para avançar.</h2><p className="mt-2 max-w-2xl text-sm text-blue-100">Indicadores de acompanhamento calculados a partir do DBS TREASURY. Este perfil não executa operações financeiras.</p></div><div className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3"><div className="flex items-center gap-2 text-xs text-blue-100"><ShieldCheck className="h-4 w-4"/> Acesso protegido</div><div className="mt-1 text-sm font-semibold">Consulta executiva</div></div></div></section>
      {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><strong>Não foi possível carregar os dados.</strong><p className="mt-1">{error}</p><p className="mt-1 text-xs">Nenhum dado fictício será exibido.</p></div>}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{kpis.map(k=>{const Icon=k.icon;return <article key={k.label} className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"><div className="flex items-center justify-between gap-3"><span className="text-xs font-bold uppercase tracking-wider text-slate-500">{k.label}</span><span className="rounded-xl bg-blue-50 p-2 text-blue-700"><Icon className="h-5 w-5"/></span></div><p className="mt-4 text-2xl font-bold tracking-tight tabular-nums">{data?money(k.value||0):"—"}</p><p className="mt-1 text-xs text-slate-500">{k.detail}</p></article>})}</section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-bold">Agenda de pagamentos</h2><p className="mt-1 text-sm text-slate-500">Contas e parcelas em aberto, ordenadas por vencimento.</p></div><span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-800">{visibleDues.length} registros</span></div>
        <div className="mt-5 grid gap-3 md:grid-cols-[1fr_220px]"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar fornecedor ou descrição..." className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"/><select value={filter} onChange={e=>setFilter(e.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500"><option value="todos">Todos os vencimentos</option><option value="vencidos">Vencidos</option><option value="hoje">Vencem hoje</option><option value="7dias">Próximos 7 dias</option><option value="30dias">Próximos 30 dias</option></select></div>
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-100"><table className="w-full min-w-[800px] text-left text-sm"><thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500"><tr><th className="px-4 py-3 font-bold">Vencimento</th><th className="px-4 py-3 font-bold">Fornecedor / Credor</th><th className="px-4 py-3 font-bold">Descrição</th><th className="px-4 py-3 text-right font-bold">Valor</th><th className="px-4 py-3 font-bold">Situação</th></tr></thead><tbody className="divide-y divide-slate-100">{loading&&!data?<tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">Consultando financeiro...</td></tr>:visibleDues.map((x,i)=><tr key={x.id||i} className="transition hover:bg-blue-50/50"><td className="whitespace-nowrap px-4 py-3 font-medium">{dateBR(x.vencimento)}</td><td className="px-4 py-3 font-semibold">{x.fornecedor}</td><td className="px-4 py-3 text-slate-600">{x.descricao}</td><td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">{money(x.valor)}</td><td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${x.vencimento<(data?.today||"")?"bg-rose-50 text-rose-700":"bg-amber-50 text-amber-800"}`}>{x.vencimento<(data?.today||"")?"Vencido":x.vencimento===(data?.today||"")?"Vence hoje":"Pendente"}</span></td></tr>)}{!loading&&visibleDues.length===0&&<tr><td colSpan={5} className="px-4 py-10 text-center text-slate-500">Nenhuma conta corresponde a esses filtros.</td></tr>}</tbody></table></div>
        <p className="mt-3 text-xs text-slate-500">Dados sincronizados com o registro financeiro compartilhado. Última consulta: {lastRefresh||"—"}. Última gravação financeira: {data?.updatedAt?new Date(data.updatedAt).toLocaleString("pt-BR"):"não informada"}.</p>
      </section>
      <footer className="flex flex-wrap items-center justify-between gap-2 pb-5 text-xs text-slate-500"><span>DBS AIR REFRIGERAÇÃO · DBS TREASURY</span><span>Perfil somente leitura · Alterações financeiras não estão disponíveis neste acesso.</span></footer>
    </main>
    <MobileAdminNavigation active="finance" financePath="/financeiro-acompanhamento" />
  </div>;
}
