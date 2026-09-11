/**
 * Employee Table Component
 * Displays active employees with daily costs, filtering, search, and actions.
 * Single source of truth: queries rh_employees via rhEmployeeService.
 */

import { useState, useEffect } from 'react';
import { Search, Edit2, Trash2, Check, X, Loader2, AlertCircle } from 'lucide-react';
import { DailyCostsDisplay } from './DailyCostsDisplay';
import { fetchActiveEmployees, deactivateEmployee, type EmployeeWithCosts } from '@/services/rhEmployeeService';

export interface EmployeeTableProps {
  onEdit?: (employee: EmployeeWithCosts) => void;
  onDelete?: (employee: EmployeeWithCosts) => void;
  unitFilter?: string;
}

/**
 * Employee Table Component
 */
export function EmployeeTable({ onEdit, onDelete, unitFilter }: EmployeeTableProps) {
  const [employees, setEmployees] = useState<EmployeeWithCosts[]>([]);
  const [filteredEmployees, setFilteredEmployees] = useState<EmployeeWithCosts[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Load employees on mount
  useEffect(() => {
    async function loadEmployees() {
      setIsLoading(true);
      setError(null);
      try {
        const data = await fetchActiveEmployees(unitFilter);
        setEmployees(data);
        setFilteredEmployees(data);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Erro ao carregar colaboradores';
        setError(msg);
        console.error('[EmployeeTable] Load error:', err);
      } finally {
        setIsLoading(false);
      }
    }
    loadEmployees();
  }, [unitFilter]);

  // Filter employees by search term
  useEffect(() => {
    if (!searchTerm.trim()) {
      setFilteredEmployees(employees);
    } else {
      const term = searchTerm.toLowerCase();
      const filtered = employees.filter((emp) =>
        emp.full_name.toLowerCase().includes(term) ||
        emp.unit.toLowerCase().includes(term)
      );
      setFilteredEmployees(filtered);
    }
  }, [searchTerm, employees]);

  async function handleDelete(employee: EmployeeWithCosts) {
    if (!window.confirm(`Desativar ${employee.full_name}?`)) return;

    setDeletingId(employee.id);
    try {
      await deactivateEmployee(employee.id);
      setEmployees((prev) => prev.filter((e) => e.id !== employee.id));
      onDelete?.(employee);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao desativar';
      setError(msg);
      console.error('[EmployeeTable] Delete error:', err);
    } finally {
      setDeletingId(null);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#F59E0B' }} />
        <span className="ml-3" style={{ color: '#94A3B8' }}>Carregando colaboradores...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 rounded-lg border border-red-800/50 bg-red-900/20 flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold" style={{ color: '#FCA5A5' }}>Erro ao carregar</p>
          <p style={{ color: '#FCA5A5' }}>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: '#64748B' }} />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Buscar por nome ou unidade..."
          className="w-full pl-12 pr-4 py-3 rounded-lg border border-slate-600 bg-slate-900 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Results Summary */}
      <div className="text-sm" style={{ color: '#94A3B8' }}>
        {filteredEmployees.length} de {employees.length} colaboradores
      </div>

      {/* Table */}
      {filteredEmployees.length === 0 ? (
        <div className="text-center py-12" style={{ color: '#64748B' }}>
          <p>Nenhum colaborador encontrado</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-700">
          <table className="w-full text-sm">
            <thead style={{ background: 'rgba(30, 41, 59, 0.8)', borderBottom: '1px solid #475569' }}>
              <tr>
                <th className="px-6 py-3 text-left font-bold uppercase tracking-wider" style={{ color: '#F8FAFC' }}>
                  Colaborador
                </th>
                <th className="px-6 py-3 text-left font-bold uppercase tracking-wider" style={{ color: '#F8FAFC' }}>
                  Unidade
                </th>
                <th className="px-6 py-3 text-left font-bold uppercase tracking-wider" style={{ color: '#F8FAFC' }}>
                  Benefício
                </th>
                <th className="px-6 py-3 text-left font-bold uppercase tracking-wider" style={{ color: '#F8FAFC' }}>
                  Gastos Diários
                </th>
                <th className="px-6 py-3 text-center font-bold uppercase tracking-wider" style={{ color: '#F8FAFC' }}>
                  Ações
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {filteredEmployees.map((emp) => {
                const costs = {
                  vt_daily_cost: emp.daily_vt_cost,
                  va_daily_cost: emp.daily_va_cost,
                  vt_daily_cost_cents: Math.round(emp.daily_vt_cost * 100),
                  va_daily_cost_cents: Math.round(emp.daily_va_cost * 100),
                };
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
