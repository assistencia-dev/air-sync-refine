import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Boxes, PackageSearch, Search, Warehouse } from "lucide-react";
import { getDbsOperationalInventoryOverview } from "@/lib/dbs-control.functions";

type OperationalPart = {
  id: string;
  sku: string;
  name: string;
  description: string;
  status: string;
  centralQuantity: number;
  centralReservedQuantity: number;
  centralAvailableQuantity: number;
  operationalQuantity: number;
  operationalReservedQuantity: number;
  operationalAvailableQuantity: number;
  availableQuantity: number;
};

type OperationalStock = { id: string; name: string; costCenterId: string | null; status: string };
type OperationalBalance = {
  id: string; stockId: string; partId: string; quantity: number;
  reservedQuantity: number; availableQuantity: number; version: number;
};

function quantity(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(value);
}

export function DbsOperationalInventoryPage({ embedded = false }: { embedded?: boolean }) {
  const inventory = useQuery({
    queryKey: ["dbs-operational-inventory-overview"],
    queryFn: () => getDbsOperationalInventoryOverview(),
    retry: 1,
  });
  const [search, setSearch] = useState("");
  const [stockFilter, setStockFilter] = useState<"all" | "available" | "empty">("all");

  const data = inventory.data as {
    parts?: OperationalPart[];
    operationalStocks?: OperationalStock[];
    operationalBalances?: OperationalBalance[];
    asOf?: string;
  } | undefined;
  const parts = data?.parts ?? [];
  const stocks = data?.operationalStocks ?? [];
  const balances = data?.operationalBalances ?? [];

  const filteredParts = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase("pt-BR");
    return parts.filter((part) => {
      const matchesSearch = !normalized
        || part.name.toLocaleLowerCase("pt-BR").includes(normalized)
        || part.sku.toLocaleLowerCase("pt-BR").includes(normalized)
        || part.description.toLocaleLowerCase("pt-BR").includes(normalized);
      const matchesStock = stockFilter === "all"
        || (stockFilter === "available" ? part.availableQuantity > 0 : part.availableQuantity <= 0);
      return matchesSearch && matchesStock && !["inativo", "inactive", "archived"].includes(part.status.toLocaleLowerCase("pt-BR"));
    });
  }, [parts, search, stockFilter]);

  const totalAvailable = parts.reduce((total, part) => total + part.availableQuantity, 0);
  const partsWithStock = parts.filter((part) => part.availableQuantity > 0).length;

  function locationsFor(partId: string) {
    return balances.filter((balance) => balance.partId === partId && balance.quantity > 0)
      .map((balance) => ({
        ...balance,
        name: stocks.find((stock) => stock.id === balance.stockId)?.name ?? "Estoque operacional",
      }));
  }

  return (
    <main className="min-h-full bg-[#f8fafc] px-4 py-4 text-slate-900 sm:px-6 lg:px-7">
      <div className="mx-auto max-w-[1440px]">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="rounded-xl bg-blue-50 p-3 text-blue-700"><Boxes className="h-6 w-6" /></span>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900">Peças & Estoque</h1>
              <p className="mt-1 text-sm text-slate-500">Consulta operacional de peças e quantidades disponíveis.</p>
            </div>
          </div>
          {!embedded && <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600">DBS CONTROL</span>}
        </header>

        <section className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <article className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-2 text-sm text-slate-500"><PackageSearch className="h-4 w-4" /> Peças cadastradas</div>
            <p className="mt-2 text-2xl font-bold tabular-nums">{inventory.isLoading ? "—" : parts.length}</p>
          </article>
          <article className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-2 text-sm text-slate-500"><Boxes className="h-4 w-4" /> Peças com saldo disponível</div>
            <p className="mt-2 text-2xl font-bold tabular-nums">{inventory.isLoading ? "—" : partsWithStock}</p>
          </article>
          <article className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-2 text-sm text-slate-500"><Warehouse className="h-4 w-4" /> Unidades disponíveis</div>
            <p className="mt-2 text-2xl font-bold tabular-nums">{inventory.isLoading ? "—" : quantity(totalAvailable)}</p>
          </article>
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-bold text-slate-900">Catálogo operacional</h2>
              <p className="mt-1 text-xs text-slate-500">O cadastro de valores, custos e compras é administrado pelo Financeiro.</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar peça ou SKU" className="min-h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-blue-500 sm:w-64" />
              </label>
              <select value={stockFilter} onChange={(event) => setStockFilter(event.target.value as typeof stockFilter)} className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-500">
                <option value="all">Todos os saldos</option>
                <option value="available">Com saldo</option>
                <option value="empty">Sem saldo disponível</option>
              </select>
            </div>
          </div>

          {inventory.isLoading && <p className="p-6 text-sm text-slate-500">Carregando catálogo e saldos...</p>}
          {inventory.isError && <div role="alert" className="p-6 text-sm text-rose-700">Não foi possível carregar o estoque operacional. Atualize a tela ou verifique seu acesso.</div>}
          {!inventory.isLoading && !inventory.isError && (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[680px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr><th className="p-3">Peça</th><th className="p-3">SKU</th><th className="p-3">Estoque central</th><th className="p-3">Estoque operacional</th><th className="p-3">Disponível</th></tr>
                  </thead>
                  <tbody>
                    {filteredParts.map((part) => {
                      const locations = locationsFor(part.id);
                      return <tr key={part.id} className="border-t border-slate-100 align-top">
                        <td className="p-3"><p className="font-semibold text-slate-800">{part.name}</p>{part.description && <p className="mt-1 max-w-lg text-xs text-slate-500">{part.description}</p>}</td>
                        <td className="p-3 font-mono text-xs text-slate-600">{part.sku || "—"}</td>
                        <td className="p-3 tabular-nums">{quantity(part.centralAvailableQuantity)}</td>
                        <td className="p-3"><p className="tabular-nums">{quantity(part.operationalAvailableQuantity)}</p>{locations.length > 0 && <p className="mt-1 text-xs text-slate-500">{locations.map((location) => location.name + ": " + quantity(location.availableQuantity)).join(" · ")}</p>}</td>
                        <td className="p-3"><span className={part.availableQuantity > 0 ? "rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700" : "rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600"}>{quantity(part.availableQuantity)}</span></td>
                      </tr>;
                    })}
                  </tbody>
                </table>
              </div>
              <div className="grid gap-2 p-3 md:hidden">
                {filteredParts.map((part) => <article key={part.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><p className="font-semibold">{part.name}</p><p className="mt-1 font-mono text-xs text-slate-500">{part.sku || "—"}</p></div>
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-xs font-bold">{quantity(part.availableQuantity)} un.</span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-2 text-xs">
                    <div><p className="text-slate-500">Estoque central</p><p className="font-semibold">{quantity(part.centralAvailableQuantity)}</p></div>
                    <div><p className="text-slate-500">Estoque operacional</p><p className="font-semibold">{quantity(part.operationalAvailableQuantity)}</p></div>
                  </div>
                </article>)}
              </div>
              {filteredParts.length === 0 && <p className="p-6 text-sm text-slate-500">Nenhuma peça encontrada com esse filtro.</p>}
            </>
          )}
        </section>
        {data?.asOf && <p className="mt-3 text-right text-[11px] text-slate-400">Atualizado em {new Date(data.asOf).toLocaleString("pt-BR")}</p>}
      </div>
    </main>
  );
}
