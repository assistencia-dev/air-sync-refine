/**
 * Employee Form Component
 * Complete form for creating and editing employee records with daily benefit rates.
 * Single source of truth: all data flows through rhEmployeeService.
 */

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertCircle, Plus, Loader2 } from 'lucide-react';
import { DailyCostsDisplay } from './DailyCostsDisplay';
import { calculateDailyCosts } from '@/utils/benefitCalculations';
import { createEmployee, updateEmployee, type EmployeeWithCosts } from '@/services/rhEmployeeService';
import { supabase } from '@/integrations/supabase/client';

// ============================================================================
// VALIDATION SCHEMA
// ============================================================================

const employeeFormSchema = z.object({
  full_name: z.string().min(3, 'Nome deve ter ao menos 3 caracteres').max(100),
  benefit_type: z.enum(['VT', 'VA', 'VT_VA'], {
    errorMap: () => ({ message: 'Selecione um tipo de benefício' }),
  }),
  unit: z.string().min(1, 'Unidade é obrigatória'),
  work_schedule: z.enum(['5x2', '6x1', '12x36'], {
    errorMap: () => ({ message: 'Selecione uma jornada de trabalho' }),
  }),
  vt_tariff_unit: z.number().positive('Tarifa deve ser maior que 0').optional().default(4.3),
  vt_trips_per_day: z.number().int().positive('Viagens deve ser maior que 0').optional().default(2),
  va_daily_rate: z.number().positive('Diária deve ser maior que 0').optional().default(35.0),
});

type EmployeeFormData = z.infer<typeof employeeFormSchema>;

export interface EmployeeFormProps {
  initialData?: EmployeeWithCosts;
  onSuccess?: (employee: EmployeeWithCosts) => void;
  onCancel?: () => void;
}

/**
 * Main Employee Form Component
 */
export function EmployeeForm({ initialData, onSuccess, onCancel }: EmployeeFormProps) {
  const isEditMode = !!initialData;
  const [units, setUnits] = useState<Array<{ id: string; name: string }>>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [dailyCosts, setDailyCosts] = useState(calculateDailyCosts({
    employeeId: '',
    fullName: '',
    vt_tariff_unit: 4.3,
    vt_trips_per_day: 2,
    va_daily_rate: 35.0,
    work_schedule: '5x2',
  }));

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
    reset,
  } = useForm<EmployeeFormData>({
    resolver: zodResolver(employeeFormSchema),
    defaultValues: initialData ? {
      full_name: initialData.full_name,
      benefit_type: initialData.benefit_type === 'passagem' ? 'VT' : 'VA',
      unit: initialData.unit,
      work_schedule: '5x2',
      vt_tariff_unit: initialData.benefit_type === 'passagem' ? initialData.fare_cents / 100 : 4.3,
      vt_trips_per_day: initialData.benefit_type === 'passagem' ? initialData.trips_per_day : 1,
      va_daily_rate: initialData.benefit_type === 'alimentacao' ? initialData.fare_cents / 100 : 35.0,
    } : {
      benefit_type: 'VT_VA',
      work_schedule: '5x2',
      vt_tariff_unit: 4.3,
      vt_trips_per_day: 2,
      va_daily_rate: 35.0,
    },
  });

  // Watch form fields to update daily costs preview
  const vt_tariff = watch('vt_tariff_unit');
  const vt_trips = watch('vt_trips_per_day');
  const va_rate = watch('va_daily_rate');

  useEffect(() => {
    const costs = calculateDailyCosts({
      employeeId: '',
      fullName: '',
      vt_tariff_unit: vt_tariff ?? 4.3,
      vt_trips_per_day: vt_trips ?? 2,
      va_daily_rate: va_rate ?? 35.0,
      work_schedule: '5x2',
    });
    setDailyCosts(costs);
  }, [vt_tariff, vt_trips, va_rate]);

  // Load units on mount
  useEffect(() => {
    async function loadUnits() {
      const { data, error } = await supabase
        .from('units')
        .select('id, name')
        .order('name');

      if (!error && data) {
        setUnits(data);
      }
    }
    loadUnits();
  }, []);

  async function onSubmit(data: EmployeeFormData) {
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      let employee: EmployeeWithCosts;

      if (isEditMode && initialData) {
        employee = await updateEmployee(initialData.id, data);
      } else {
        employee = await createEmployee(data);
      }

      reset();
      onSuccess?.(employee);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao salvar colaborador';
      setSubmitError(msg);
      console.error('[EmployeeForm] Submit error:', err);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Error Alert */}
      {submitError && (
        <div className="p-4 rounded-lg border border-red-800/50 bg-red-900/20 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <p style={{ color: '#FCA5A5' }}>{submitError}</p>
        </div>
      )}

      {/* Personal Information */}
      <fieldset className="space-y-4 pb-4 border-b border-slate-700">
        <legend className="text-sm font-bold uppercase tracking-wider" style={{ color: '#F8FAFC' }}>
          Informações Pessoais
        </legend>

        <div>
          <label className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: '#94A3B8' }}>
            Nome Completo *
          </label>
          <input
            type="text"
            {...register('full_name')}
            placeholder="Ex: João Silva"
            className="w-full px-4 py-2.5 rounded-lg border border-slate-600 bg-slate-900 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {errors.full_name && (
            <p className="text-xs mt-1" style={{ color: '#FCA5A5' }}>{errors.full_name.message}</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: '#94A3B8' }}>
              Tipo de Benefício *
            </label>
            <select
              {...register('benefit_type')}
              className="w-full px-4 py-2.5 rounded-lg border border-slate-600 bg-slate-900 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="VT">Vale Passagem</option>
              <option value="VA">Vale Alimentação</option>
              <option value="VT_VA">Ambos (VT + VA)</option>
            </select>
            {errors.benefit_type && (
              <p className="text-xs mt-1" style={{ color: '#FCA5A5' }}>{errors.benefit_type.message}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: '#94A3B8' }}>
              Unidade *
            </label>
            <select
              {...register('unit')}
              className="w-full px-4 py-2.5 rounded-lg border border-slate-600 bg-slate-900 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Selecione...</option>
              {units.map((u) => (
                <option key={u.id} value={u.name}>
                  {u.name}
                </option>
              ))}
            </select>
            {errors.unit && (
              <p className="text-xs mt-1" style={{ color: '#FCA5A5' }}>{errors.unit.message}</p>
            )}
          </div>
        </div>
      </fieldset>

      {/* Work Schedule & Daily Rates */}
      <fieldset className="space-y-4 pb-4 border-b border-slate-700">
        <legend className="text-sm font-bold uppercase tracking-wider" style={{ color: '#F8FAFC' }}>
          Jornada & Tarifa Diária
        </legend>

        <div>
          <label className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: '#94A3B8' }}>
            Jornada de Trabalho *
          </label>
          <select
            {...register('work_schedule')}
            className="w-full px-4 py-2.5 rounded-lg border border-slate-600 bg-slate-900 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="5x2">5x2 (Seg-Sex)</option>
            <option value="6x1">6x1 (Seg-Sab)</option>
            <option value="12x36">12x36 (Escala 12/36)</option>
          </select>
          {errors.work_schedule && (
            <p className="text-xs mt-1" style={{ color: '#FCA5A5' }}>{errors.work_schedule.message}</p>
          )}
        </div>

        <div className="grid grid-cols-3 gap-4">
          {/* VT Tariff Unit */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: '#94A3B8' }}>
              Valor diário VT (R$)
            </label>
            <input
              type="number"
              step="0.01"
              {...register('vt_tariff_unit', { valueAsNumber: true })}
              placeholder="4.30"
              className="w-full px-4 py-2.5 rounded-lg border border-slate-600 bg-slate-900 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs mt-1" style={{ color: '#64748B' }}>Valor usado em: dias trabalhados × diária VT</p>
            {errors.vt_tariff_unit && (
              <p className="text-xs mt-1" style={{ color: '#FCA5A5' }}>{errors.vt_tariff_unit.message}</p>
            )}
          </div>

          {/* VT Trips Per Day */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: '#94A3B8' }}>
              Viagens/Dia
            </label>
            <input
              type="number"
              {...register('vt_trips_per_day', { valueAsNumber: true })}
              placeholder="2"
              className="w-full px-4 py-2.5 rounded-lg border border-slate-600 bg-slate-900 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs mt-1" style={{ color: '#64748B' }}>Ex: 2 (ida/volta)</p>
            {errors.vt_trips_per_day && (
              <p className="text-xs mt-1" style={{ color: '#FCA5A5' }}>{errors.vt_trips_per_day.message}</p>
            )}
          </div>

          {/* VA Daily Rate */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider mb-2" style={{ color: '#94A3B8' }}>
              Diária VA (R$)
            </label>
            <input
              type="number"
              step="0.01"
              {...register('va_daily_rate', { valueAsNumber: true })}
              placeholder="35.00"
              className="w-full px-4 py-2.5 rounded-lg border border-slate-600 bg-slate-900 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs mt-1" style={{ color: '#64748B' }}>Diária alimentação</p>
            {errors.va_daily_rate && (
              <p className="text-xs mt-1" style={{ color: '#FCA5A5' }}>{errors.va_daily_rate.message}</p>
            )}
          </div>
        </div>
      </fieldset>

      {/* Daily Costs Preview */}
      <div>
        <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: '#94A3B8' }}>
          Resumo de Gastos Diários
        </p>
        <DailyCostsDisplay dailyCosts={dailyCosts} variant="card" />
      </div>

      {/* Form Actions */}
      <div className="flex gap-3 pt-4">
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex-1 inline-flex items-center justify-center gap-2 text-white px-6 py-3 rounded-lg font-semibold transition disabled:opacity-60"
          style={{ background: '#16A34A' }}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Salvando...
            </>
          ) : (
            <>
              <Plus className="w-4 h-4" />
              {isEditMode ? 'Atualizar' : 'Adicionar Colaborador'}
            </>
          )}
        </button>

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 px-6 py-3 rounded-lg font-semibold border transition"
            style={{ borderColor: '#64748B', color: '#CBD5E1' }}
          >
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}
