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
import { useEffect, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Users, CreditCard, Utensils, Clock3, BriefcaseBusiness } from 'lucide-react';
import { RhPontoWorkspace } from '@/components/RhPontoWorkspace';
import { RhDpCenter } from '@/components/RhDpCenter';

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
  const [openEmployeeId, setOpenEmployeeId] = useState<string | null>(null);
  useEffect(() => {
    const employeeId = sessionStorage.getItem('DBS_RH_OPEN_EMPLOYEE');
    if (employeeId) {
      sessionStorage.removeItem('DBS_RH_OPEN_EMPLOYEE');
      setOpenEmployeeId(employeeId);
      setActiveTab('gestao');
    }
  }, []);

  return (
    <div className="min-h-screen" style={{ background: '#090D16' }}>
      {/* Header */}
      <div className="border-b border-slate-800/80 sticky top-0 z-40" style={{ background: '#0F172A' }}>
        <div className="container max-w-7xl mx-auto px-4 py-5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center shadow-inner" style={{ background: 'rgba(245, 158, 11, 0.16)' }}>
              <Users className="w-6 h-6" style={{ color: '#F59E0B' }} />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight" style={{ color: '#F8FAFC' }}>
                Gestão de RH
              </h1>
              <p className="text-sm mt-1" style={{ color: '#94A3B8' }}>
                Cadastro único, Departamento Pessoal, ponto, benefícios e folha
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="container max-w-7xl mx-auto px-4 py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          {/* Tab List */}
          <TabsList className="flex h-auto w-full flex-wrap gap-2 rounded-2xl border border-slate-700 bg-[#111827] p-2 shadow-lg">
            <TabsTrigger
              value="dp"
              className="min-h-11 flex-1 basis-[145px] rounded-xl px-3 py-2.5 text-xs font-bold transition-all data-[state=active]:font-black data-[state=active]:text-white data-[state=active]:shadow-md"
              style={{ color: activeTab === 'dp' ? '#F59E0B' : '#94A3B8' }}
            >
              <BriefcaseBusiness className="w-4 h-4" />
              <span className="hidden sm:inline">Departamento Pessoal</span>
              <span className="sm:hidden">DP</span>
            </TabsTrigger>

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

            <TabsTrigger
              value="ponto"
              className="flex items-center gap-2 data-[state=active]:font-bold data-[state=active]:text-white"
              style={{
                color: activeTab === 'ponto' ? '#F59E0B' : '#94A3B8',
              }}
            >
              <Clock3 className="w-4 h-4" />
              <span className="hidden sm:inline">Folha de Ponto</span>
              <span className="sm:hidden">Ponto</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="dp" className="space-y-6">
            <RhDpCenter />
          </TabsContent>

          {/* Tab 1: Gestão de Colaboradores */}
          <TabsContent value="gestao" className="space-y-6">
            <TabGestaoColaboradores initialEmployeeId={openEmployeeId} />
          </TabsContent>

          {/* Tab 2: Vale Passagem */}
          <TabsContent value="vt" className="space-y-6">
            <TabValePassagem />
          </TabsContent>

          {/* Tab 3: Vale Alimentação */}
          <TabsContent value="va" className="space-y-6">
            <TabValeAlimentacao />
          </TabsContent>

          {/* Tab 4: Folha de Ponto */}
          <TabsContent value="ponto" className="space-y-6">
            <RhPontoWorkspace />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
