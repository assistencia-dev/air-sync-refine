/**
 * Employee Daily Costs Display Component
 * Shows visual breakdown of daily Vale Passagem (VT) and Vale Alimentação (VA) spending.
 * Used in employee cards, detail views, and dashboard summaries.
 */

import { DailyCosts, formatCurrencyBRL } from '@/utils/benefitCalculations';
import { CreditCard, Utensils, TrendingDown } from 'lucide-react';

export interface DailyCostsDisplayProps {
  dailyCosts: DailyCosts;
  variant?: 'card' | 'inline' | 'compact';
  showCents?: boolean;
}

/**
 * Display daily costs in card format (most common)
 */
export function DailyCostsCard({ dailyCosts, showCents = false }: DailyCostsDisplayProps) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2 pb-2 border-b border-slate-700">
        <TrendingDown className="w-5 h-5" style={{ color: '#F59E0B' }} />
        <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: '#F8FAFC' }}>
          Gastos Diários
        </h3>
      </div>

      {/* Vale Passagem */}
      <div className="flex items-center justify-between p-3 rounded-md" style={{ background: 'rgba(59, 130, 246, 0.1)', borderLeft: '3px solid #3B82F6' }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'rgba(59, 130, 246, 0.2)' }}>
            <CreditCard className="w-5 h-5" style={{ color: '#3B82F6' }} />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
              Vale Passagem
            </p>
            <p className="text-sm font-bold" style={{ color: '#F8FAFC' }}>
              {formatCurrencyBRL(dailyCosts.vt_daily_cost)}
            </p>
          </div>
        </div>
        {showCents && (
          <span className="text-xs" style={{ color: '#64748B' }}>
            {dailyCosts.vt_daily_cost_cents} ¢
          </span>
        )}
      </div>

      {/* Vale Alimentação */}
      <div className="flex items-center justify-between p-3 rounded-md" style={{ background: 'rgba(16, 185, 129, 0.1)', borderLeft: '3px solid #10B981' }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'rgba(16, 185, 129, 0.2)' }}>
            <Utensils className="w-5 h-5" style={{ color: '#10B981' }} />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
              Vale Alimentação
            </p>
            <p className="text-sm font-bold" style={{ color: '#F8FAFC' }}>
              {formatCurrencyBRL(dailyCosts.va_daily_cost)}
            </p>
          </div>
        </div>
        {showCents && (
          <span className="text-xs" style={{ color: '#64748B' }}>
            {dailyCosts.va_daily_cost_cents} ¢
          </span>
        )}
      </div>

      {/* Total */}
      <div className="flex items-center justify-between p-3 rounded-md" style={{ background: 'rgba(245, 158, 11, 0.1)', borderLeft: '3px solid #F59E0B' }}>
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
          Total Diário
        </p>
        <p className="text-lg font-bold" style={{ color: '#F59E0B' }}>
          {formatCurrencyBRL(dailyCosts.vt_daily_cost + dailyCosts.va_daily_cost)}
        </p>
      </div>

      {/* Monthly Projection */}
      <div className="pt-2 border-t border-slate-700 text-xs" style={{ color: '#CBD5E1' }}>
        <p className="text-center">
          <span className="font-semibold">21 dias úteis</span> = {formatCurrencyBRL((dailyCosts.vt_daily_cost + dailyCosts.va_daily_cost) * 21)}
        </p>
      </div>
    </div>
  );
}

/**
 * Display daily costs in inline format (for tables/rows)
 */
export function DailyCostsInline({ dailyCosts }: DailyCostsDisplayProps) {
  return (
    <div className="flex items-center gap-4">
      {/* VT */}
      <div className="flex items-center gap-2">
        <CreditCard className="w-4 h-4" style={{ color: '#3B82F6' }} />
        <span className="text-sm font-semibold" style={{ color: '#F8FAFC' }}>
          {formatCurrencyBRL(dailyCosts.vt_daily_cost)}
        </span>
      </div>

      {/* VA */}
      <div className="flex items-center gap-2">
        <Utensils className="w-4 h-4" style={{ color: '#10B981' }} />
        <span className="text-sm font-semibold" style={{ color: '#F8FAFC' }}>
          {formatCurrencyBRL(dailyCosts.va_daily_cost)}
        </span>
      </div>

      {/* Total */}
      <div className="pl-2 border-l border-slate-600">
        <span className="text-sm font-bold" style={{ color: '#F59E0B' }}>
          {formatCurrencyBRL(dailyCosts.vt_daily_cost + dailyCosts.va_daily_cost)}
        </span>
      </div>
    </div>
  );
}

/**
 * Display daily costs in compact format (minimal space)
 */
export function DailyCostsCompact({ dailyCosts }: DailyCostsDisplayProps) {
  return (
    <div className="flex items-center gap-2 text-xs font-semibold">
      <span style={{ color: '#3B82F6' }}>VT: {formatCurrencyBRL(dailyCosts.vt_daily_cost)}</span>
      <span style={{ color: '#64748B' }}>•</span>
      <span style={{ color: '#10B981' }}>VA: {formatCurrencyBRL(dailyCosts.va_daily_cost)}</span>
      <span style={{ color: '#64748B' }}>•</span>
      <span style={{ color: '#F59E0B' }}>Total: {formatCurrencyBRL(dailyCosts.vt_daily_cost + dailyCosts.va_daily_cost)}</span>
    </div>
  );
}

/**
 * Unified display component that switches between variants
 */
export function DailyCostsDisplay({ dailyCosts, variant = 'card', showCents = false }: DailyCostsDisplayProps) {
  switch (variant) {
    case 'inline':
      return <DailyCostsInline dailyCosts={dailyCosts} />;
    case 'compact':
      return <DailyCostsCompact dailyCosts={dailyCosts} />;
    case 'card':
    default:
      return <DailyCostsCard dailyCosts={dailyCosts} showCents={showCents} />;
  }
}
