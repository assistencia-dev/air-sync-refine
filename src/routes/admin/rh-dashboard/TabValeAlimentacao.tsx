/**
 * Tab 3: Vale Alimentação (VA)
 * INDEPENDENT benefit management - NO data sharing with Vale Passagem
 * Focus: Monthly allowance calculations, per-employee VA rates, budget planning
 */

import { useState, useEffect } from 'react';
import { Utensils, Loader2, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { calculateDailyCosts, formatCurrencyBRL } from '@/utils/benefitCalculations';
import type { EmployeeWithCosts } from '@/services/rhEmployeeService';

/**
 * Tab Vale Alimentação Component
 */
export function TabValeAlimentacao() {
  const [employees, setEmployees] = useState<EmployeeWithCosts[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalMonthlyVA, setTotalMonthlyVA] = useState(0);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());

  // Load only VA-enabled employees
  useEffect(() => {
    async function loadVAEmployees() {
      setIsLoading(true);
      setError(null);
      try {
        const { data, error: err } = await supabase
          .from('rh_employees')
          .select('*')
          .eq('is_active', true)
          .in('benefit_type', ['VA', 'VT_VA']) // Only VA-enabled
          .order('full_name');

        if (err) throw err;

        const employees = (data || []) as EmployeeWithCosts[];
        setEmployees(employees);

        // Calculate total monthly requirement
        const total = employees.reduce((sum, emp) => {
          const daily = emp.va_daily_rate ?? 35.0;
          // Approximate 21 business days per month
          return sum + daily * 21;
        }, 0);
        setTotalMonthlyVA(total);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Erro ao carregar dados VA';
        setError(msg);
        console.error('[TabValeAlimentacao] Load error:', err);
      } finally {
        setIsLoading(false);
      }
    }
    loadVAEmployees();
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#10B981' }} />
        <span className="ml-3" style={{ color: '#94A3B8' }}>Carregando dados de Vale Alimentação...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 rounded-lg border border-red-800/50 bg-red-900/20 flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
        <p style={{ color: '#FCA5A5' }}>{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'rgba(16, 185, 129, 0.2)' }}>
            <Utensils className="w-6 h-6" style={{ color: '#10B981' }} />
          </div>
          <div>
            <h2 className="text-2xl font-bold" style={{ color: '#F8FAFC' }}>
              Vale Alimentação (VA)
            </h2>
            <p className="text-sm mt-1" style={{ color: '#94A3B8' }}>
              Gestão independente de benefício alimentação
            </p>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Total Employees with VA */}
        <div className="rounded-lg border border-slate-700 p-4" style={{ background: 'rgba(16, 185, 129, 0.05)' }}>
          <p className="text-xs font-bold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
            Colaboradores VA
          </p>
          <p className="text-3xl font-bold mt-2" style={{ color: '#10B981' }}>
            {employees.length}
          </p>
        </div>

        {/* Monthly Total VA Requirement */}
        <div className="rounded-lg border border-slate-700 p-4" style={{ background: 'rgba(16, 185, 129, 0.05)' }}>
          <p className="text-xs font-bold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
            Gasto Mensal (21 dias)
          </p>
          <p className="text-3xl font-bold mt-2" style={{ color: '#10B981' }}>
            {formatCurrencyBRL(totalMonthlyVA)}
          </p>
        </div>

        {/* Average Daily VA */}
        <div className="rounded-lg border border-slate-700 p-4" style={{ background: 'rgba(16, 185, 129, 0.05)' }}>
          <p className="text-xs font-bold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
            Média Diária
          </p>
          <p className="text-3xl font-bold mt-2" style={{ color: '#10B981' }}>
            {formatCurrencyBRL(totalMonthlyVA / 21)}
          </p>
        </div>
      </div>

      {/* Employees Table */}
      <div className="rounded-lg border border-slate-700 overflow-x-auto" style={{ background: 'rgba(15, 23, 42, 0.6)' }}>
        <table className="w-full text-sm">
          <thead style={{ background: 'rgba(30, 41, 59, 0.8)', borderBottom: '1px solid #475569' }}>
            <tr>
              <th className="px-6 py-3 text-left font-bold uppercase tracking-wider" style={{ color: '#F8FAFC' }}>
                Colaborador
              </th>
              <th className="px-6 py-3 text-left font-bold uppercase tracking-wider" style={{ color: '#F8FAFC' }}>
                Diária (R$)
              </th>
              <th className="px-6 py-3 text-left font-bold uppercase tracking-wider" style={{ color: '#F8FAFC' }}>
                Gasto Diário
              </th>
              <th className="px-6 py-3 text-left font-bold uppercase tracking-wider" style={{ color: '#F8FAFC' }}>
                Mensal (21 dias)
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700">
            {employees.map((emp) => {
              const vaDaily = emp.va_daily_rate ?? 35.0;
              const vaMonthly = vaDaily * 21;
              return (
                <tr key={emp.id} style={{ background: 'rgba(15, 23, 42, 0.4)' }}>
                  <td className="px-6 py-4">
                    <p className="font-semibold" style={{ color: '#F8FAFC' }}>
                      {emp.full_name}
                    </p>
                    <p className="text-xs mt-1" style={{ color: '#64748B' }}>
                      {emp.unit}
                    </p>
                  </td>
                  <td className="px-6 py-4">
                    <span style={{ color: '#CBD5E1' }}>
                      {formatCurrencyBRL(emp.va_daily_rate ?? 35.0)}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="font-semibold" style={{ color: '#10B981' }}>
                      {formatCurrencyBRL(vaDaily)}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="font-bold" style={{ color: '#F59E0B' }}>
                      {formatCurrencyBRL(vaMonthly)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer Note */}
      <div className="p-4 rounded-lg" style={{ background: 'rgba(16, 185, 129, 0.05)', borderLeft: '3px solid #10B981' }}>
        <p className="text-xs" style={{ color: '#94A3B8' }}>
          <strong>Nota:</strong> Vale Alimentação é um benefício INDEPENDENTE. Os dados aqui não incluem Vale Passagem. Consulte a aba "Vale Passagem" para gestão de VT.
        </p>
      </div>
    </div>
  );
}
