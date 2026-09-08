/**
 * Tab 1: Gestão de Colaboradores
 * Central CRUD management for all employees
 * Shows daily costs for each employee (VT + VA combined for display only)
 */

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { EmployeeForm } from '@/components/EmployeeForm';
import { EmployeeTable } from '@/components/EmployeeTable';
import type { EmployeeWithCosts } from '@/services/rhEmployeeService';

/**
 * Tab Gestão de Colaboradores Component
 */
export function TabGestaoColaboradores() {
  const [showForm, setShowForm] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<EmployeeWithCosts | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  function handleFormSuccess() {
    setShowForm(false);
    setEditingEmployee(null);
    setRefreshTrigger((prev) => prev + 1); // Trigger table refresh
  }

  return (
    <div className="space-y-6">
      {/* Header with Add Button */}
      {!showForm && !editingEmployee && (
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold" style={{ color: '#F8FAFC' }}>
              Gestão de Colaboradores
            </h2>
            <p className="text-sm mt-1" style={{ color: '#94A3B8' }}>
              Gerencie informações de colaboradores e configure as tarifas de benefício diárias
            </p>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg font-semibold text-white transition"
            style={{ background: '#16A34A' }}
          >
            <Plus className="w-5 h-5" />
            Adicionar Colaborador
          </button>
        </div>
      )}

      {/* Form Section */}
      {(showForm || editingEmployee) && (
        <div className="border border-slate-700 rounded-lg p-6" style={{ background: 'rgba(15, 23, 42, 0.6)' }}>
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold" style={{ color: '#F8FAFC' }}>
              {editingEmployee ? 'Editar Colaborador' : 'Novo Colaborador'}
            </h3>
            <button
              onClick={() => {
                setShowForm(false);
                setEditingEmployee(null);
              }}
              className="p-2 rounded-lg transition"
              style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#F87171' }}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <EmployeeForm
            initialData={editingEmployee ?? undefined}
            onSuccess={handleFormSuccess}
            onCancel={() => {
              setShowForm(false);
              setEditingEmployee(null);
            }}
          />
        </div>
      )}

      {/* Table Section */}
      {!showForm && !editingEmployee && (
        <div className="border border-slate-700 rounded-lg p-6" style={{ background: 'rgba(15, 23, 42, 0.6)' }}>
          <EmployeeTable
            key={refreshTrigger}
            onEdit={(emp) => setEditingEmployee(emp)}
            onDelete={() => setRefreshTrigger((prev) => prev + 1)}
          />
        </div>
      )}
    </div>
  );
}
