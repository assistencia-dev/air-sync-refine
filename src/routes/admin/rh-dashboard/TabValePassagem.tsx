/**
 * Tab 2: Vale Passagem (VT)
 * INDEPENDENT benefit management - NO data sharing with Vale Alimentação
 * Focus: Recharge batches, durability estimation, VT-only employees
 */

import { useState, useEffect } from 'react';
import { CreditCard, Loader2, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { calculateDailyCosts, formatCurrencyBRL } from '@/utils/benefitCalculations';
import { DailyCostsDisplay } from '@/components/DailyCostsDisplay';
import type { EmployeeWithCosts } from '@/services/rhEmployeeService';

/**
 * Tab Vale Passagem Component
 */
export function TabValePassagem() {
  const [employees, setEmployees] = useState<EmployeeWithCosts[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalMonthlyVT, setTotalMonthlyVT] = useState(0);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());

  // Load only VT-enabled employees
  useEffect(() => {
    async function loadVTEmployees() {
      setIsLoading(true);
      setError(null);
      try {
        const { data, error: err } = await supabase
          .from('rh_employees')
          .select('*')
          .eq('is_active', true)
          .in('benefit_type', ['VT', 'VT_VA']) // Only VT-enabled
          .order('full_name');

        if (err) throw err;

        const employees = (data || []) as EmployeeWithCosts[];
        setEmployees(employees);

        // Calculate total monthly requirement
        const total = employees.reduce((sum, emp) => {
          const daily = (emp.vt_tariff_unit ?? 4.3) * (emp.vt_trips_per_day ?? 2);
          // Approximate 21 business days per month
          return sum + daily * 21;
        }, 0);
        setTotalMonthlyVT(total);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Erro ao carregar dados VT';
        setError(msg);
        console.error('[TabValePassagem] Load error:', err);
      } finally {
        setIsLoading(false);
      }
    }
    loadVTEmployees();
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#3B82F6' }} />
        <span className="ml-3" style={{ color: '#94A3B8' }}>Carregando dados de Vale Passagem...</span>
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
          <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'rgba(59, 130, 246, 0.2)' }}>
            <CreditCard className="w-6 h-6" style={{ color: '#3B82F6' }} />
          </div>
          <div>
            <h2 className="text-2xl font-bold" style={{ color: '#F8FAFC' }}>
              Vale Passagem (VT)
            </h2>
            <p className="text-sm mt-1" style={{ color: '#94A3B8' }}>
              Gestão independente de benefício de transporte
            </p>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Total Employees with VT */}
        <div className="rounded-lg border border-slate-700 p-4" style={{ background: 'rgba(59, 130, 246, 0.05)' }}>
          <p className="text-xs font-bold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
            Colaboradores VT
          </p>
          <p className="text-3xl font-bold mt-2" style={{ color: '#3B82F6' }}>
            {employees.length}
          </p>
        </div>

        {/* Monthly Total VT Requirement */}
        <div className="rounded-lg border border-slate-700 p-4" style={{ background: 'rgba(59, 130, 246, 0.05)' }}>
          <p className="text-xs font-bold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
            Gasto Mensal (21 dias)
          </p>
          <p className="text-3xl font-bold mt-2" style={{ color: '#3B82F6' }}>
            {formatCurrencyBRL(totalMonthlyVT)}
          </p>
        </div>

        {/* Average Daily VT */}
        <div className="rounded-lg border border-slate-700 p-4" style={{ background: 'rgba(59, 130, 246, 0.05)' }}>
          <p className="text-xs font-bold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
            Média Diária
          </p>
          <p className="text-3xl font-bold mt-2" style={{ color: '#3B82F6' }}>
            {formatCurrencyBRL(totalMonthlyVT / 21)}
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
                Tarifa
              </th>
              <th className="px-6 py-3 text-left font-bold uppercase tracking-wider" style={{ color: '#F8FAFC' }}>
                Viagens/Dia
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
              const vtDaily = (emp.vt_tariff_unit ?? 4.3) * (emp.vt_trips_per_day ?? 2);
              const vtMonthly = vtDaily * 21;
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
                      {formatCurrencyBRL(emp.vt_tariff_unit ?? 4.3)}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span style={{ color: '#CBD5E1' }}>
                      {emp.vt_trips_per_day ?? 2}x
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="font-semibold" style={{ color: '#3B82F6' }}>
                      {formatCurrencyBRL(vtDaily)}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="font-bold" style={{ color: '#F59E0B' }}>
                      {formatCurrencyBRL(vtMonthly)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer Note */}
      <div className="p-4 rounded-lg" style={{ background: 'rgba(59, 130, 246, 0.05)', borderLeft: '3px solid #3B82F6' }}>
        <p className="text-xs" style={{ color: '#94A3B8' }}>
          <strong>Nota:</strong> Vale Passagem é um benefício INDEPENDENTE. Os dados aqui não incluem Vale Alimentação. Consulte a aba "Vale Alimentação" para gestão de VA.
        </p>
      </div>
    </div>
  );
}
