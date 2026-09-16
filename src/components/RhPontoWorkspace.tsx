import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CheckCircle2, Clock3, MapPin, ShieldCheck, UserCheck, UserX } from "lucide-react";
import { getMyProfile } from "@/lib/auth.functions";
import { createRhPontoAccess, getMyPonto, listRhPontoEmployees, registerMyPonto, setRhPontoAccess } from "@/lib/ponto.functions";

const labels: Record<string, string> = { entrada: "Entrada", almoco_saida: "Saída almoço", almoco_retorno: "Retorno almoço", saida: "Saída" };
const todayLocal = () => {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 10);
};
const nextType = (records: any[]) => {
  const today = todayLocal();
  const done = records.filter(r => r.work_date === today).map(r => r.punch_type);
  return (["entrada", "almoco_saida", "almoco_retorno", "saida"] as const).find(t => !done.includes(t)) ?? null;
};

export function RhPontoWorkspace() {
  const profile = useQuery({ queryKey: ["me"], queryFn: () => getMyProfile() });
  const isRh = profile.data?.role_key === "SUPER_ADMIN" || profile.data?.role_key === "ADMIN_OPERACIONAL" || ["DBS123", "DBSASSISTENCIA123"].includes(profile.data?.username ?? "");
  return isRh ? <PontoRh /> : <PontoColaborador />;
}

function PontoRh() {
  const qc = useQueryClient();
  const employees = useQuery({ queryKey: ["rh-ponto-employees"], queryFn: () => listRhPontoEmployees() });
  const [selected, setSelected] = useState<any>(null);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [radius, setRadius] = useState("150");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [entrada, setEntrada] = useState("");
  const [saida, setSaida] = useState("");
  const [almocoIni, setAlmocoIni] = useState("");
  const [almocoFim, setAlmocoFim] = useState("");
  const [credentialMessage, setCredentialMessage] = useState("");

  const existingMutation = useMutation({
    mutationFn: (enabled: boolean) => setRhPontoAccess({ data: { employee_id: selected.id, enabled, portal_identifier: identifier, radius_m: Number(radius), base_lat: lat ? Number(lat) : null, base_lng: lng ? Number(lng) : null, entrada_prevista: entrada || null, saida_prevista: saida || null, almoco_inicio_previsto: almocoIni || null, almoco_fim_previsto: almocoFim || null } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["rh-ponto-employees"] }); setSelected(null); },
  });

  const createMutation = useMutation({
    mutationFn: () => createRhPontoAccess({ data: { employee_id: selected.id, username: identifier, password, radius_m: Number(radius), base_lat: Number(lat), base_lng: Number(lng), entrada_prevista: entrada || null, saida_prevista: saida || null, almoco_inicio_previsto: almocoIni || null, almoco_fim_previsto: almocoFim || null } }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["rh-ponto-employees"] });
      setCredentialMessage(`Acesso criado. Login: ${result.username} · Senha: a senha definida por você. Entregue essas credenciais ao colaborador.`);
      setPassword("");
      setSelected(null);
    },
  });

  const active = (employees.data ?? []).filter((e: any) => e.ponto_access_enabled).length;
  const open = (e: any) => {
    setCredentialMessage(""); setSelected(e); setIdentifier(e.portal_user?.username ?? e.portal_user?.email ?? ""); setPassword("");
    setRadius(String(e.ponto_raio_m ?? 150)); setLat(e.ponto_base_lat != null ? String(e.ponto_base_lat) : ""); setLng(e.ponto_base_lng != null ? String(e.ponto_base_lng) : "");
    setEntrada(e.ponto_entrada_prevista ?? ""); setSaida(e.ponto_saida_prevista ?? ""); setAlmocoIni(e.ponto_almoco_inicio_previsto ?? ""); setAlmocoFim(e.ponto_almoco_fim_previsto ?? "");
  };
  const busy = existingMutation.isPending || createMutation.isPending;
  const error = existingMutation.error || createMutation.error;

  return <div className="space-y-5">
    <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-[10px] font-black uppercase tracking-[.2em] text-sky-600">RH · controle de jornada</p><h2 className="mt-1 text-2xl font-black text-slate-900">Folha de Ponto</h2><p className="mt-1 text-sm text-slate-500">O gestor RH cria o login do colaborador, libera o ponto e configura a jornada.</p></div><div className="rounded-xl bg-slate-50 px-4 py-3 text-right"><b className="text-xl text-slate-900">{active}</b><span className="ml-2 text-xs font-bold text-slate-500">acessos liberados</span></div></div></header>
    {credentialMessage && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">{credentialMessage}</div>}
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-[10px] font-black uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3">Colaborador</th><th className="px-5 py-3">Unidade</th><th className="px-5 py-3">Login</th><th className="px-5 py-3">Acesso</th><th className="px-5 py-3 text-right">Configurar</th></tr></thead><tbody>{(employees.data ?? []).map((e: any) => <tr key={e.id} className="border-t border-slate-100"><td className="px-5 py-4 font-bold text-slate-800">{e.full_name}</td><td className="px-5 py-4 text-slate-500">{e.unit}</td><td className="px-5 py-4 text-slate-500">{e.portal_user?.username ?? e.portal_user?.email ?? "Ainda não criado"}</td><td className="px-5 py-4">{e.ponto_access_enabled ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5"/>Liberado</span> : <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-500"><UserX className="h-3.5 w-3.5"/>Bloqueado</span>}</td><td className="px-5 py-4 text-right"><button onClick={() => open(e)} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-black text-white">{e.ponto_access_enabled ? "Editar" : e.portal_user ? "Liberar acesso" : "Criar acesso"}</button></td></tr>)}</tbody></table></div></section>
    {selected && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4"><div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between"><div><h3 className="text-xl font-black text-slate-900">Folha de Ponto · {selected.full_name}</h3><p className="mt-1 text-xs text-slate-500">{selected.portal_user ? "Este colaborador já possui login no portal." : "Crie aqui o login e a senha que serão entregues ao colaborador."}</p></div><button onClick={() => setSelected(null)} className="text-xs font-bold text-slate-500">Fechar</button></div>
      {!selected.portal_user && <div className="mt-5 rounded-xl border border-sky-100 bg-sky-50 p-4"><p className="text-xs font-black text-sky-800">Acesso do colaborador</p><p className="mt-1 text-xs text-sky-700">Não é necessário cadastrar outro usuário antes. O RH cria o acesso nesta tela e o funcionário entra pela mesma tela de login do sistema.</p></div>}
      <div className="mt-5 grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold text-slate-600 sm:col-span-2">Login do colaborador<input value={identifier} onChange={e => setIdentifier(e.target.value)} disabled={Boolean(selected.portal_user)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 disabled:bg-slate-100" placeholder="ex.: JOAO.SILVA"/></label>{!selected.portal_user && <label className="text-xs font-bold text-slate-600 sm:col-span-2">Senha inicial<input type="password" value={password} onChange={e => setPassword(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5" placeholder="mínimo de 6 caracteres"/></label>}<label className="text-xs font-bold text-slate-600">Raio GPS (m)<input value={radius} onChange={e => setRadius(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5"/></label><label className="text-xs font-bold text-slate-600">Latitude base<input value={lat} onChange={e => setLat(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5" placeholder="-22.xxxxxxx"/></label><label className="text-xs font-bold text-slate-600">Longitude base<input value={lng} onChange={e => setLng(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5" placeholder="-43.xxxxxxx"/></label><div className="sm:col-span-2 rounded-xl bg-slate-50 p-4"><p className="mb-3 flex items-center gap-2 text-xs font-black text-slate-700"><Clock3 className="h-4 w-4"/>Jornada prevista</p><div className="grid gap-3 sm:grid-cols-4"><input aria-label="Entrada prevista" type="time" value={entrada} onChange={e => setEntrada(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-2"/><input aria-label="Início almoço" type="time" value={almocoIni} onChange={e => setAlmocoIni(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-2"/><input aria-label="Fim almoço" type="time" value={almocoFim} onChange={e => setAlmocoFim(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-2"/><input aria-label="Saída prevista" type="time" value={saida} onChange={e => setSaida(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-2"/></div></div></div>
      <div className="mt-6 flex flex-wrap justify-end gap-2">{selected.portal_user ? <><button onClick={() => existingMutation.mutate(false)} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-black text-slate-700"><UserX className="h-4 w-4"/>Revogar acesso</button><button onClick={() => existingMutation.mutate(true)} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-xs font-black text-white"><UserCheck className="h-4 w-4"/>{busy ? "Salvando..." : "Salvar configuração"}</button></> : <button onClick={() => createMutation.mutate()} disabled={busy || !identifier.trim() || password.length < 6 || !lat || !lng} className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-xs font-black text-white"><UserCheck className="h-4 w-4"/>{busy ? "Criando acesso..." : "Criar acesso e liberar ponto"}</button>}</div>{error && <p className="mt-3 text-xs font-bold text-red-600">{error instanceof Error ? error.message : "Falha ao salvar."}</p>}</div></div>}
  </div>;
}

function PontoColaborador() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["my-ponto"], queryFn: () => getMyPonto(), retry: false });
  const [status, setStatus] = useState("");
  const punch = useMutation({ mutationFn: async (type: any) => {
    const workDate = todayLocal();
    if (!navigator.geolocation) throw new Error("Este dispositivo não oferece geolocalização.");
    const pos = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }));
    return registerMyPonto({ data: { punch_type: type, work_date: workDate, latitude: pos.coords.latitude, longitude: pos.coords.longitude, gps_accuracy_m: pos.coords.accuracy } });
  }, onSuccess: () => { setStatus("Marcação registrada com evidência de localização."); qc.invalidateQueries({ queryKey: ["my-ponto"] }); }, onError: e => setStatus(e instanceof Error ? e.message : "Não foi possível registrar a marcação.") });
  const next = useMemo(() => nextType(query.data?.records ?? []), [query.data?.records]);
  if (query.isLoading) return <div className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500">Carregando sua folha de ponto...</div>;
  if (query.error) return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center"><ShieldCheck className="mx-auto h-10 w-10 text-slate-400"/><h2 className="mt-3 text-xl font-black text-slate-900">Folha de Ponto</h2><p className="mt-2 text-sm text-slate-500">{query.error instanceof Error ? query.error.message : "Acesso não liberado pelo RH."}</p></div>;
  const today = (query.data?.records ?? []).filter((r: any) => r.work_date === todayLocal());
  return <div className="mx-auto max-w-3xl space-y-5"><header className="rounded-2xl bg-slate-900 p-6 text-white"><p className="text-[10px] font-black uppercase tracking-[.2em] text-sky-300">DBS AIR · folha individual</p><h1 className="mt-1 text-2xl font-black">Olá, {query.data?.employee.full_name}</h1><p className="mt-1 text-sm text-white/60">Você visualiza somente a sua jornada.</p></header><section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-500"><CalendarDays className="h-4 w-4"/>Hoje</div><div className="mt-5 grid gap-3 sm:grid-cols-4">{(["entrada", "almoco_saida", "almoco_retorno", "saida"] as const).map(t => { const r = today.find((x: any) => x.punch_type === t); return <div key={t} className="rounded-xl border border-slate-100 bg-slate-50 p-4"><p className="text-xs font-bold text-slate-500">{labels[t]}</p><p className="mt-1 text-xl font-black text-slate-900">{r ? new Date(r.punched_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—"}</p></div>})}</div><button disabled={!next || punch.isPending} onClick={() => next && punch.mutate(next)} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 px-5 py-4 text-sm font-black text-white disabled:opacity-40"><MapPin className="h-5 w-5"/>{punch.isPending ? "Validando localização..." : next ? `Registrar ${labels[next]}` : "Jornada de hoje completa"}</button>{status && <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs font-bold text-slate-600">{status}</p>}</section><section className="rounded-2xl border border-slate-200 bg-white p-6"><h2 className="font-black text-slate-900">Histórico</h2><div className="mt-3 divide-y divide-slate-100">{(query.data?.records ?? []).slice(0, 40).map((r: any) => <div key={r.id} className="flex items-center justify-between py-3 text-sm"><span className="font-bold text-slate-700">{labels[r.punch_type] ?? r.punch_type}</span><span className="text-slate-500">{new Date(r.punched_at).toLocaleString("pt-BR")}</span><span className={r.inside_radius === false ? "text-red-600" : "text-emerald-600"}>{r.inside_radius === false ? "Fora do raio" : "GPS OK"}</span></div>)}</div></section></div>;
}
