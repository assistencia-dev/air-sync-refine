import { useEffect, useMemo, useState } from 'react';
import { Utensils, Loader2, AlertCircle } from 'lucide-react';
import { listRhEmployees } from '@/lib/rh.functions';
import { countRJBusinessDays } from '@/utils/rjHolidays';
import { formatCurrencyBRL } from '@/utils/benefitCalculations';

type Employee = { id: string; full_name: string; unit: string; fare_cents: number; trips_per_day: number; is_active: boolean };

export function TabValeAlimentacao() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  useEffect(() => {
    listRhEmployees({ data: { benefit_type: 'alimentacao' } }).then((data) => setEmployees(data as Employee[])).catch((err) => setError(err instanceof Error ? err.message : 'Erro ao carregar dados VA')).finally(() => setIsLoading(false));
  }, []);
  const daysWorked = useMemo(() => countRJBusinessDays(selectedYear, selectedMonth, '5x2'), [selectedMonth, selectedYear]);
  const totalMonthly = useMemo(() => employees.reduce((sum, emp) => sum + (emp.fare_cents / 100) * daysWorked, 0), [employees, daysWorked]);
  if (isLoading) return <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" style={{ color: '#10B981' }} /><span className="ml-3" style={{ color: '#94A3B8' }}>Carregando dados de Vale Alimentação...</span></div>;
  if (error) return <div className="p-4 rounded-lg border border-red-800/50 bg-red-900/20 flex items-start gap-3"><AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" /><p style={{ color: '#FCA5A5' }}>{error}</p></div>;
  return <div className="space-y-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><Utensils className="w-8 h-8" style={{ color: '#10B981' }} /><div><h2 className="text-2xl font-bold text-white">Vale Alimentação (VA)</h2><p className="text-sm mt-1 text-slate-400">Dias trabalhados no mês × valor diário salvo no Supabase.</p></div></div><input type="month" value={selectedYear + '-' + String(selectedMonth).padStart(2, '0')} onChange={(event) => { const parts = event.target.value.split('-').map(Number); setSelectedYear(parts[0]); setSelectedMonth(parts[1]); }} className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white" /></div>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4"><Summary label="Colaboradores VA" value={String(employees.length)} color="#10B981" /><Summary label={'Dias trabalhados (' + selectedMonth + '/' + selectedYear + ')'} value={String(daysWorked)} color="#10B981" /><Summary label="Total VA no mês" value={formatCurrencyBRL(totalMonthly)} color="#F59E0B" /></div>
    <div className="rounded-lg border border-slate-700 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="bg-slate-800 text-left text-xs uppercase text-slate-300"><th className="px-6 py-3">Colaborador</th><th className="px-6 py-3">Valor diário</th><th className="px-6 py-3">Dias trabalhados</th><th className="px-6 py-3">Total VA</th></tr></thead><tbody className="divide-y divide-slate-700">{employees.map((emp) => { const daily = emp.fare_cents / 100; return <tr key={emp.id}><td className="px-6 py-4"><p className="font-semibold text-white">{emp.full_name}</p><p className="text-xs mt-1 text-slate-500">{emp.unit}</p></td><td className="px-6 py-4 text-slate-300">{formatCurrencyBRL(daily)}</td><td className="px-6 py-4 text-slate-300">{daysWorked}</td><td className="px-6 py-4 font-bold text-amber-400">{formatCurrencyBRL(daily * daysWorked)}</td></tr>; })}</tbody></table>{!employees.length && <p className="p-8 text-center text-xs text-slate-400">Nenhum colaborador de Vale Alimentação cadastrado.</p>}</div>
  </div>;
}
function Summary({ label, value, color }: { label: string; value: string; color: string }) { return <div className="rounded-lg border border-slate-700 p-4"><p className="text-xs font-bold uppercase tracking-wider text-slate-400">{label}</p><p className="text-3xl font-bold mt-2" style={{ color }}>{value}</p></div>; }
