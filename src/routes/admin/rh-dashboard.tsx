/**
 * RH Dashboard - Complete Unified Dashboard
 * 3-Tab Structure:
 * 1. Gestão de Colaboradores (central CRUD)
 * 2. Vale Passagem (VT-only benefits, recharge batch, durability)
 * 3. Vale Alimentação (VA-only benefits, monthly allocation)
 *
 * CRITICAL: Tabs operate on SEPARATE datasets and queries.
 * VT and VA are completely independent benefit systems.
 */

import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Users, CreditCard, Utensils } from 'lucide-react';

import { TabGestaoColaboradores } from './rh-dashboard/TabGestaoColaboradores';
import { TabValePassagem } from './rh-dashboard/TabValePassagem';
import { TabValeAlimentacao } from './rh-dashboard/TabValeAlimentacao';

export const Route = createFileRoute('/admin/rh-dashboard')({
  component: RHDashboard,
  head: () => ({
    meta: [
      { title: 'RH Dashboard | DBS Air' },
      { name: 'description', content: 'Gestão de colaboradores e benefícios (Vale Passagem e Vale Alimentação)' },
    ],
  }),
});

/**
 * RH Dashboard - Main Component
 */
function RHDashboard() {
  const [activeTab, setActiveTab] = useState('gestao');

  return (
    <div className="min-h-screen" style={{ background: '#090D16' }}>
      {/* Header */}
      <div className="border-b border-slate-800/80 sticky top-0 z-40" style={{ background: '#0F172A' }}>
        <div className="container max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg flex items-center justify-center" style={{ background: 'rgba(245, 158, 11, 0.2)' }}>
              <Users className="w-6 h-6" style={{ color: '#F59E0B' }} />
            </div>
            <div>
              <h1 className="text-3xl font-bold" style={{ color: '#F8FAFC' }}>
                Gestão de RH
              </h1>
              <p className="text-sm mt-1" style={{ color: '#94A3B8' }}>
                Colaboradores, Vale Passagem e Vale Alimentação
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="container max-w-7xl mx-auto px-4 py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          {/* Tab List */}
          <TabsList className="grid w-full grid-cols-3" style={{ background: 'rgba(30, 41, 59, 0.5)', borderColor: '#334155', borderWidth: '1px' }}>
            <TabsTrigger
              value="gestao"
              className="flex items-center gap-2 data-[state=active]:font-bold data-[state=active]:text-white"
              style={{
                color: activeTab === 'gestao' ? '#F59E0B' : '#94A3B8',
              }}
            >
              <Users className="w-4 h-4" />
              <span className="hidden sm:inline">Gestão de Colaboradores</span>
              <span className="sm:hidden">Colaboradores</span>
            </TabsTrigger>

            <TabsTrigger
              value="vt"
              className="flex items-center gap-2 data-[state=active]:font-bold data-[state=active]:text-white"
              style={{
                color: activeTab === 'vt' ? '#F59E0B' : '#94A3B8',
              }}
            >
              <CreditCard className="w-4 h-4" />
              <span className="hidden sm:inline">Vale Passagem</span>
              <span className="sm:hidden">VT</span>
            </TabsTrigger>

            <TabsTrigger
              value="va"
              className="flex items-center gap-2 data-[state=active]:font-bold data-[state=active]:text-white"
              style={{
                color: activeTab === 'va' ? '#F59E0B' : '#94A3B8',
              }}
            >
              <Utensils className="w-4 h-4" />
              <span className="hidden sm:inline">Vale Alimentação</span>
              <span className="sm:hidden">VA</span>
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: Gestão de Colaboradores */}
          <TabsContent value="gestao" className="space-y-6">
            <TabGestaoColaboradores />
          </TabsContent>

          {/* Tab 2: Vale Passagem */}
          <TabsContent value="vt" className="space-y-6">
            <TabValePassagem />
          </TabsContent>

          {/* Tab 3: Vale Alimentação */}
          <TabsContent value="va" className="space-y-6">
            <TabValeAlimentacao />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
