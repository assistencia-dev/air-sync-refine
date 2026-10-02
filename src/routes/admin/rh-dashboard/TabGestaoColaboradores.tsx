/**
 * Gestão de Colaboradores
 * Cadastro único do RH/DP.
 *
 * Este componente não cria um segundo cadastro: usa exclusivamente o
 * registro central, que é reutilizado por benefícios, ponto, folha e acessos.
 */
import { RhEmployeeRegistry } from '@/components/RhEmployeeRegistry';

export function TabGestaoColaboradores({ initialEmployeeId }: { initialEmployeeId?: string | null }) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-800 bg-[#0F172A] p-5">
        <p className="text-[10px] font-black uppercase tracking-[.2em] text-[#F59E0B]">
          RH · base mestre
        </p>
        <h2 className="mt-1 text-xl font-black text-slate-50">Cadastro único de funcionários</h2>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-400">
          Cadastre o funcionário uma única vez. A mesma ficha é utilizada pelo Departamento Pessoal,
          Folha, Ponto, Vale Passagem, Vale Alimentação e controle de acessos.
        </p>
      </div>
      <RhEmployeeRegistry initialEmployeeId={initialEmployeeId} />
    </div>
  );
}
