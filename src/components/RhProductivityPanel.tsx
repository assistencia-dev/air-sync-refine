import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, CalendarDays, CheckCircle2, Clock3, RefreshCw, ShieldCheck } from "lucide-react";
import { getDbsControlProductivity } from "@/lib/dbs-control.functions";

function currentMonthRange() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const lastDay = String(new Date(year, now.getMonth() + 1, 0).getDate()).padStart(2, "0");
  return { start: `${year}-${month}-01`, end: `${year}-${month}-${lastDay}` };
}

const duration = (minutes: number | null | undefined) => {
  if (minutes == null || !Number.isFinite(Number(minutes))) return "—";
  const value = Math.max(0, Math.round(Number(minutes)));
  const hours = Math.floor(value / 60);
  const mins = value % 60;
  return hours ? `${hours}h ${String(mins).padStart(2, "0")}m` : `${mins} min`;
};

const dateTime = (value: string | null | undefined) => value
  ? new Date(value).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
  : "Sem registro";

export function RhProductivityPanel() {
  const initial = currentMonthRange();
  const [startDate, setStartDate] = useState(initial.start);
  const [endDate, setEndDate] = useState(initial.end);
  const query = useQuery({
    queryKey: ["dbs-control-productivity", startDate, endDate],
    queryFn: () => getDbsControlProductivity({ data: { startDate, endDate } }),
    enabled: Boolean(startDate && endDate && startDate <= endDate),
    staleTime: 15_000,
  });
  const data = query.data;

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[.18em] text-sky-600">DBS CONTROL · RH</p>
            <h2 className="mt-1 text-xl font-black text-slate-900">Produtividade técnica</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
              Indicadores baseados nas transições reais de status das OS. Aguardando peça e aguardando cliente pausam o tempo ativo; dados sem histórico confiável ficam fora das médias.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-[10px] font-bold text-slate-500">
              Data inicial
              <input type="date" value={startDate} max={endDate || undefined} onChange={(event) => setStartDate(event.target.value)} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-800 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100" />
            </label>
            <label className="grid gap-1 text-[10px] font-bold text-slate-500">
              Data final
              <input type="date" value={endDate} min={startDate || undefined} onChange={(event) => setEndDate(event.target.value)} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-800 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100" />
            </label>
            <button type="button" onClick={() => query.refetch()} disabled={query.isFetching || !startDate || !endDate || startDate > endDate} className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#0F3D75] px-3 text-xs font-black text-white transition hover:bg-[#124d91] disabled:opacity-50">
              <RefreshCw className={`h-3.5 w-3.5 ${query.isFetching ? "animate-spin" : ""}`} /> Atualizar
            </button>
          </div>
        </div>
      </section>

      {query.isError && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">Não foi possível carregar a produtividade. Verifique se seu perfil tem permissão administrativa.</div>}
      {query.isLoading && <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Calculando indicadores a partir do histórico de OS…</div>}

      {data && !query.isError && (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi icon={<CheckCircle2 />} label="Atendimentos medidos" value={data.totalTracked} note="Com início e conclusão confiáveis" />
            <Kpi icon={<Clock3 />} label="Tempo ativo médio" value={duration(data.totalTracked ? Math.round(data.metrics.reduce((sum, item) => sum + item.activeMinutesTotal, 0) / data.totalTracked) : null)} note="Exclui esperas registradas" />
            <Kpi icon={<AlertTriangle />} label="Conclusões para revisar" value={data.totalExcluded} note="Não entram nas médias" />
            <Kpi icon={<CalendarDays />} label="OS antigas sem medição" value={data.legacyUnmeasuredCount} note="Histórico anterior não comprovado" />
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-sky-600" />
              <div>
                <h3 className="text-base font-black text-slate-900">Resumo por técnico</h3>
                <p className="mt-1 text-xs text-slate-500">O volume sozinho não define desempenho. Compare tipos de serviço e valide os casos atípicos.</p>
              </div>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-xs">
                <thead><tr className="border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-400"><th className="py-3 pr-3">Técnico</th><th className="py-3 pr-3">Tipo de serviço</th><th className="py-3 pr-3">OS medidas</th><th className="py-3 pr-3">Média ativa</th><th className="py-3 pr-3">Média corrida</th><th className="py-3">Leitura</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {data.metrics.map((item) => <tr key={item.metricKey}>
                    <td className="py-3 pr-3 font-bold text-slate-800">{item.technicianName}</td>
                    <td className="py-3 pr-3">{item.type}</td>
                    <td className="py-3 pr-3 tabular-nums">{item.completedCount}</td>
                    <td className="py-3 pr-3 tabular-nums">{duration(item.averageActiveMinutes)}</td>
                    <td className="py-3 pr-3 tabular-nums">{duration(item.averageElapsedMinutes)}</td>
                    <td className="py-3 text-slate-500">Indicador descritivo; não é nota automática</td>
                  </tr>)}
                  {!data.metrics.length && <tr><td colSpan={6} className="py-8 text-center text-slate-500">Ainda não há atendimentos com histórico confiável neste período. As próximas transições registradas alimentarão o painel.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
            <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-emerald-600" /><h3 className="text-base font-black text-slate-900">Atendimentos considerados</h3></div>
            <p className="mt-1 text-xs text-slate-500">Cada linha permite conferir a origem das médias. Não há valores financeiros neste painel.</p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-xs">
                <thead><tr className="border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-400"><th className="py-3 pr-3">OS</th><th className="py-3 pr-3">Técnico</th><th className="py-3 pr-3">Tipo</th><th className="py-3 pr-3">Início</th><th className="py-3 pr-3">Conclusão</th><th className="py-3">Tempo ativo</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {data.completed.map((item) => <tr key={`${item.orderId}-${item.completedAt}`}>
                    <td className="py-3 pr-3 font-bold text-slate-800">{item.protocol}</td><td className="py-3 pr-3">{item.technicianName}</td><td className="py-3 pr-3">{item.type}</td><td className="py-3 pr-3">{dateTime(item.startedAt)}</td><td className="py-3 pr-3">{dateTime(item.completedAt)}</td><td className="py-3 font-bold tabular-nums">{duration(item.activeMinutes)}</td>
                  </tr>)}
                  {!data.completed.length && <tr><td colSpan={6} className="py-8 text-center text-slate-500">Nenhuma OS medida neste período.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          {(data.totalExcluded > 0 || data.legacyUnmeasuredCount > 0) && <section className="rounded-3xl border border-amber-200 bg-amber-50/70 p-5 sm:p-7">
            <div className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-700" /><h3 className="text-base font-black text-slate-900">Dados que não devem virar conclusão automática</h3></div>
            <p className="mt-2 text-xs leading-5 text-slate-600">OS legadas não recebem horários inventados. Conclusões sem início, sem técnico ou com transições inconsistentes são exibidas para revisão e não entram na média.</p>
            {data.excluded.length > 0 && <div className="mt-4 space-y-2">
              {data.excluded.map((item) => <div key={`${item.orderId}-${item.completedAt}`} className="rounded-xl border border-amber-200 bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-xs text-slate-800">{item.protocol} · {item.technicianName}</strong><span className="text-[10px] text-slate-500">{dateTime(item.completedAt)}</span></div>
                <p className="mt-1 text-xs text-amber-800">{item.reason}</p>
              </div>)}
            </div>}
            {data.legacyUnmeasuredCount > 0 && <div className="mt-4 rounded-xl border border-amber-200 bg-white p-3">
              <strong className="text-xs text-slate-800">{data.legacyUnmeasuredCount} OS concluídas sem transição de conclusão confiável</strong>
              <p className="mt-1 text-xs text-slate-500">Exemplos: {data.legacySamples.map((item) => item.protocol).join(", ") || "nenhum disponível"}. Essas OS não são datadas retroativamente.</p>
            </div>}
          </section>}
        </>
      )}
    </div>
  );
}

function Kpi({ icon, label, value, note }: { icon: React.ReactNode; label: string; value: React.ReactNode; note: string }) {
  return <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex items-center gap-2 text-slate-400"><span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-50 text-sky-700">{icon}</span><span className="text-[10px] font-black uppercase tracking-wider">{label}</span></div>
    <strong className="mt-3 block text-2xl font-black text-slate-900">{value}</strong>
    <p className="mt-1 text-[10px] text-slate-500">{note}</p>
  </article>;
}
