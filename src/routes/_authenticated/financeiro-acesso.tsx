import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, Eye, EyeOff, ShieldCheck, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { createTreasuryViewer } from "@/lib/treasury-viewer.functions";
import { BrandLogo } from "@/components/BrandLogo";

export const Route = createFileRoute("/_authenticated/financeiro-acesso")({
  ssr: false,
  head: () => ({ meta: [{ title: "Criar acesso financeiro | DBS AIR" }, { name: "robots", content: "noindex,nofollow" }] }),
  component: FinanceiroAccessPage,
});
function FinanceiroAccessPage() {
  const navigate=useNavigate();
  const [name,setName]=useState(""); const [email,setEmail]=useState(""); const [username,setUsername]=useState(""); const [password,setPassword]=useState(""); const [show,setShow]=useState(false); const [loading,setLoading]=useState(false); const [error,setError]=useState(""); const [success,setSuccess]=useState("");
  useEffect(() => {
    let cancelled = false;
    const validateSession = async () => {
      try {
        const { data, error: authError } = await supabase.auth.getUser();
        if (authError) throw authError;
        if (cancelled) return;
        if (!data.user) {
          navigate({ to: "/login", replace: true });
          return;
        }
        const { data: profile, error: profileError } = await supabase
          .from("users")
          .select("role_key,status")
          .eq("auth_id", data.user.id)
          .maybeSingle();
        if (profileError) throw profileError;
        if (cancelled) return;
        if (profile?.role_key !== "SUPER_ADMIN" || profile.status !== "ativo") {
          navigate({ to: "/portal", replace: true });
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Não foi possível validar a sessão administrativa.");
      }
    };
    void validateSession();
    return () => { cancelled = true; };
  }, [navigate]);
  async function submit(e:React.FormEvent){e.preventDefault();setError("");setSuccess("");setLoading(true);try{await createTreasuryViewer({data:{full_name:name,email,username,password}});setSuccess("Acesso criado. Entregue usuário e senha ao seu chefe por um canal seguro.");setName("");setEmail("");setUsername("");setPassword("");}catch(e){setError(e instanceof Error?e.message:"Não foi possível criar o acesso.");}finally{setLoading(false);}}
  return <div className="min-h-screen bg-[#f3f7fc] px-4 py-8 text-slate-900" style={{fontFamily:"Inter,system-ui,sans-serif"}}><div className="mx-auto max-w-2xl"><button onClick={()=>navigate({to:"/admin"})} className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-blue-700"><ArrowLeft className="h-4 w-4"/> Voltar ao administrativo</button><section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-blue-950/5"><div className="bg-gradient-to-br from-[#0b1f42] to-[#1769d1] p-7 text-white"><BrandLogo frameClassName="rounded-xl px-3 py-2" imageClassName="h-12 w-auto max-w-[220px] object-contain"/><div className="mt-5 flex items-center gap-3"><span className="rounded-xl bg-white/10 p-3"><ShieldCheck className="h-6 w-6"/></span><div><h1 className="text-xl font-bold">Acesso de acompanhamento financeiro</h1><p className="mt-1 text-sm text-blue-100">Conta exclusiva para consulta do DBS TREASURY.</p></div></div></div><form onSubmit={submit} className="space-y-5 p-6 md:p-8"><div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">Este perfil pode consultar indicadores e vencimentos. Não pode lançar, editar, pagar, dar baixa ou excluir informações.</div>{error&&<div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}{success&&<div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 className="mr-2 inline h-4 w-4"/>{success}</div>}<label className="block text-sm font-semibold">Nome completo<input required value={name} onChange={e=>setName(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 font-normal outline-none focus:border-blue-500" placeholder="Nome do seu chefe"/></label><label className="block text-sm font-semibold">E-mail para login<input required type="email" value={email} onChange={e=>setEmail(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 font-normal outline-none focus:border-blue-500" placeholder="nome@empresa.com"/></label><label className="block text-sm font-semibold">Nome de usuário<input required minLength={3} maxLength={40} pattern="[a-zA-Z0-9._-]+" value={username} onChange={e=>setUsername(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 font-normal outline-none focus:border-blue-500" placeholder="ex.: chefe.dbs"/><span className="mt-1 block text-xs font-normal text-slate-500">Use letras, números, ponto, hífen ou sublinhado.</span></label><label className="block text-sm font-semibold">Senha inicial (mínimo 12 caracteres)<span className="mt-2 flex rounded-xl border border-slate-200 focus-within:border-blue-500"><input required minLength={12} type={show?"text":"password"} value={password} onChange={e=>setPassword(e.target.value)} className="min-w-0 flex-1 rounded-xl px-4 py-3 font-normal outline-none" autoComplete="new-password"/><button type="button" onClick={()=>setShow(!show)} className="px-4 text-slate-500" aria-label={show?"Ocultar senha":"Mostrar senha"}>{show?<EyeOff className="h-4 w-4"/>:<Eye className="h-4 w-4"/>}</button></span></label><button disabled={loading} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-700 px-5 py-3 font-semibold text-white shadow-sm hover:bg-blue-800 disabled:opacity-50"><UserPlus className="h-4 w-4"/>{loading?"Criando acesso...":"Criar acesso somente leitura"}</button></form></section></div></div>;
}