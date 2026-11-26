import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Boxes, PackageSearch, Search, Warehouse, ArrowLeftRight, ClipboardList, Plus, RotateCcw } from "lucide-react";
import {
  createDbsOperationalStock,
  getDbsOperationalInventoryOverview,
  releaseDbsOperationalStockReservation,
  reserveDbsOperationalStockForWorkOrder,
  transferDbsOperationalStock,
} from "@/lib/dbs-control.functions";

type OperationalPart = {
  id: string; sku: string; name: string; description: string; status: string;
  centralQuantity: number; centralReservedQuantity: number; centralAvailableQuantity: number;
  operationalQuantity: number; operationalReservedQuantity: number;
  operationalAvailableQuantity: number; availableQuantity: number;
};
type OperationalStock = { id: string; name: string; costCenterId: string | null; status: string };
type OperationalBalance = {
  id: string; stockId: string; partId: string; quantity: number;
  reservedQuantity: number; availableQuantity: number; version: number;
};
type OperationalWorkOrder = {
  id: string; protocol: string; status: string; clientId: string | null;
  costCenterId: string | null; createdAt: string; type: string;
};
type OperationalReservation = {
  id: string; stockId: string; workOrderId: string; partId: string; quantity: number;
  purpose: string; status: string; createdAt: string;
};
type OperationalData = {
  parts?: OperationalPart[];
  operationalStocks?: OperationalStock[];
  operationalBalances?: OperationalBalance[];
  costCenters?: Array<{ id: string; code: string; name: string }>;
  workOrders?: OperationalWorkOrder[];
  operationalReservations?: OperationalReservation[];
  asOf?: string;
};

function quantity(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(value);
}
const closedStatuses = new Set(["concluida", "concluída", "completed", "complete", "cancelada", "cancelado", "cancelled"]);

export function DbsOperationalInventoryPage({ embedded = false }: { embedded?: boolean }) {
  const inventory = useQuery({
    queryKey: ["dbs-operational-inventory-overview"],
    queryFn: () => getDbsOperationalInventoryOverview(),
    retry: 1,
  });
  const [search, setSearch] = useState("");
  const [stockFilter, setStockFilter] = useState<"all" | "available" | "empty">("all");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [transferPartId, setTransferPartId] = useState("");
  const [transferQuantity, setTransferQuantity] = useState("1");
  const [transferSourceId, setTransferSourceId] = useState("");
  const [transferDestinationId, setTransferDestinationId] = useState("");
  const [transferReference, setTransferReference] = useState("");
  const [reserveWorkOrderId, setReserveWorkOrderId] = useState("");
  const [reserveStockId, setReserveStockId] = useState("");
  const [reservePartId, setReservePartId] = useState("");
  const [reserveQuantity, setReserveQuantity] = useState("1");
  const [reservePurpose, setReservePurpose] = useState<"TROCA_PECA" | "ATIVO_EQUIPAMENTO">("TROCA_PECA");
  const [newStockCenterId, setNewStockCenterId] = useState("");
  const [newStockName, setNewStockName] = useState("");

  const data = inventory.data as OperationalData | undefined;
  const parts = data?.parts ?? [];
  const stocks = data?.operationalStocks ?? [];
  const balances = data?.operationalBalances ?? [];
  const costCenters = data?.costCenters ?? [];
  const workOrders = (data?.workOrders ?? []).filter((order) => !closedStatuses.has(order.status.trim().toLocaleLowerCase("pt-BR")));
  const reservations = data?.operationalReservations ?? [];

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
  const activeParts = parts.filter((part) => !["inativo", "inactive", "archived"].includes(part.status.toLocaleLowerCase("pt-BR")));
  const selectedReserveStock = stocks.find((stock) => stock.id === reserveStockId);
  const canReserve = Boolean(
    reserveWorkOrderId && reserveStockId && selectedReserveStock?.costCenterId
    && reservePartId && Number(reserveQuantity) > 0,
  );

  function locationsFor(partId: string) {
    return balances.filter((balance) => balance.partId === partId && balance.quantity > 0)
      .map((balance) => ({
        ...balance,
        name: stocks.find((stock) => stock.id === balance.stockId)?.name ?? "Estoque operacional",
      }));
  }

  async function runAction(action: () => Promise<unknown>, success: string): Promise<unknown> {
    setBusy(true);
    setNotice("");
    try {
      const result = await action();
      await inventory.refetch();
      setNotice(success);
      return result;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível concluir a operação.");
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function saveTransfer(event: FormEvent) {
    event.preventDefault();
    if (!transferPartId || !Number.isFinite(Number(transferQuantity)) || Number(transferQuantity) <= 0
      || (!transferSourceId && !transferDestinationId) || transferSourceId === transferDestinationId) {
      setNotice("Informe a peça, quantidade e estoques de origem e destino diferentes.");
      return;
    }
    await runAction(() => transferDbsOperationalStock({ data: {
      partId: transferPartId,
      quantity: Number(transferQuantity),
      sourceStockId: transferSourceId || null,
      destinationStockId: transferDestinationId || null,
      idempotencyKey: "op-transfer:" + crypto.randomUUID(),
      reference: transferReference.trim() || "Transferência pelo DBS CONTROL",
    } }), "Transferência registrada no histórico de estoque.");
    setTransferReference("");
  }

  async function saveReservation(event: FormEvent) {
    event.preventDefault();
    if (!canReserve || !selectedReserveStock?.costCenterId) {
      setNotice("Selecione uma OS, um estoque operacional e uma peça com quantidade válida.");
      return;
    }
    await runAction(() => reserveDbsOperationalStockForWorkOrder({ data: {
      workOrderId: reserveWorkOrderId,
      costCenterId: selectedReserveStock.costCenterId!,
      stockId: reserveStockId,
      partId: reservePartId,
      quantity: Number(reserveQuantity),
      purpose: reservePurpose,
      idempotencyKey: "op-reserve:" + crypto.randomUUID(),
    } }), "Peça reservada para a OS. A baixa física ocorrerá no fluxo de conclusão.");
  }

  async function saveOperationalStock(event: FormEvent) {
    event.preventDefault();
    if (!newStockCenterId || newStockName.trim().length < 2) {
      setNotice("Selecione o centro de custo e informe o nome do estoque.");
      return;
    }
    const result = await runAction(() => createDbsOperationalStock({ data: {
      costCenterId: newStockCenterId,
      name: newStockName.trim(),
    } }), "Estoque operacional criado.");
    if (result !== undefined) setNewStockName("");
  }

  return (
    <main className="min-h-full bg-[#f8fafc] px-4 py-4 text-slate-900 sm:px-6 lg:px-7">
      <div className="mx-auto max-w-[1440px]">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="rounded-xl bg-blue-50 p-3 text-blue-700"><Boxes className="h-6 w-6" /></span>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900">Peças & Estoque</h1>
              <p className="mt-1 text-sm text-slate-500">Consulta e movimentação física de peças, sem acesso a valores financeiros.</p>
            </div>
          </div>
          {!embedded && <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600">DBS CONTROL</span>}
        </header>

        {notice && <div role="status" aria-live="polite" className="mb-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">{notice}</div>}

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

        <section className="mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white">
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

        {!inventory.isLoading && !inventory.isError && <>
          <section className="mb-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
            <form onSubmit={saveReservation} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center gap-2"><ClipboardList className="h-5 w-5 text-blue-700" /><h2 className="font-bold">Usar peça em uma OS</h2></div>
              <p className="mb-4 text-xs text-slate-500">Reserve a quantidade no estoque operacional vinculado à OS. A baixa física acontece no fluxo de conclusão já existente.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-semibold text-slate-600">Ordem de serviço
                  <select required value={reserveWorkOrderId} onChange={(event) => setReserveWorkOrderId(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-normal">
                    <option value="">Selecione a OS</option>
                    {workOrders.map((order) => <option key={order.id} value={order.id}>{order.protocol} · {order.status}</option>)}
                  </select>
                </label>
                <label className="text-xs font-semibold text-slate-600">Estoque operacional
                  <select required value={reserveStockId} onChange={(event) => setReserveStockId(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-normal">
                    <option value="">Selecione o estoque</option>
                    {stocks.map((stock) => <option key={stock.id} value={stock.id}>{stock.name}</option>)}
                  </select>
                </label>
                <label className="text-xs font-semibold text-slate-600 sm:col-span-2">Peça
                  <select required value={reservePartId} onChange={(event) => setReservePartId(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-normal">
                    <option value="">Selecione a peça</option>
                    {activeParts.map((part) => <option key={part.id} value={part.id}>{part.sku} · {part.name} (disp. {quantity(part.operationalAvailableQuantity)})</option>)}
                  </select>
                </label>
                <label className="text-xs font-semibold text-slate-600">Quantidade
                  <input required type="number" min="0.001" step="0.001" value={reserveQuantity} onChange={(event) => setReserveQuantity(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-normal" />
                </label>
                <label className="text-xs font-semibold text-slate-600">Finalidade
                  <select value={reservePurpose} onChange={(event) => setReservePurpose(event.target.value as typeof reservePurpose)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-normal">
                    <option value="TROCA_PECA">Troca de peça</option>
                    <option value="ATIVO_EQUIPAMENTO">Ativo / equipamento</option>
                  </select>
                </label>
              </div>
              <button type="submit" disabled={busy || !canReserve || Number(reserveQuantity) > (balances.find((row) => row.stockId === reserveStockId && row.partId === reservePartId)?.availableQuantity ?? 0)} className="mt-4 min-h-11 w-full rounded-xl bg-blue-700 px-4 text-sm font-bold text-white disabled:opacity-50">{busy ? "Processando..." : "Reservar peça para a OS"}</button>
              {!stocks.length && <p className="mt-2 text-xs text-amber-700">Cadastre o estoque operacional do centro de custo antes de reservar.</p>}
            </form>

            <form onSubmit={saveTransfer} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-3 flex items-center gap-2"><ArrowLeftRight className="h-5 w-5 text-blue-700" /><h2 className="font-bold">Transferir estoque</h2></div>
              <p className="mb-4 text-xs text-slate-500">Transfira entre o Estoque Central e os estoques operacionais. O sistema registra o movimento e valida o saldo disponível.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-semibold text-slate-600 sm:col-span-2">Peça
                  <select required value={transferPartId} onChange={(event) => setTransferPartId(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-normal">
                    <option value="">Selecione a peça</option>
                    {activeParts.map((part) => <option key={part.id} value={part.id}>{part.sku} · {part.name}</option>)}
                  </select>
                </label>
                <label className="text-xs font-semibold text-slate-600">Origem
                  <select value={transferSourceId} onChange={(event) => setTransferSourceId(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-normal">
                    <option value="">Estoque Central</option>
                    {stocks.map((stock) => <option key={stock.id} value={stock.id}>{stock.name}</option>)}
                  </select>
                </label>
                <label className="text-xs font-semibold text-slate-600">Destino
                  <select value={transferDestinationId} onChange={(event) => setTransferDestinationId(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-normal">
                    <option value="">Estoque Central</option>
                    {stocks.map((stock) => <option key={stock.id} value={stock.id}>{stock.name}</option>)}
                  </select>
                </label>
                <label className="text-xs font-semibold text-slate-600">Quantidade
                  <input required type="number" min="0.001" step="0.001" value={transferQuantity} onChange={(event) => setTransferQuantity(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-normal" />
                </label>
                <label className="text-xs font-semibold text-slate-600">Referência (opcional)
                  <input value={transferReference} onChange={(event) => setTransferReference(event.target.value)} maxLength={180} placeholder="Ex.: envio para equipe" className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-normal" />
                </label>
              </div>
              <button type="submit" disabled={busy || !transferPartId || (!transferSourceId && !transferDestinationId) || transferSourceId === transferDestinationId} className="mt-4 min-h-11 w-full rounded-xl bg-blue-700 px-4 text-sm font-bold text-white disabled:opacity-50">{busy ? "Processando..." : "Confirmar transferência"}</button>
            </form>
          </section>

          <section className="mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
              <div><h2 className="font-bold">Criar estoque operacional</h2><p className="mt-1 text-xs text-slate-500">O estoque é vinculado a um centro de custo já cadastrado.</p></div>
              <Warehouse className="h-5 w-5 text-slate-400" />
            </div>
            <form onSubmit={saveOperationalStock} className="grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <label className="text-xs font-semibold text-slate-600">Centro de custo
                <select required value={newStockCenterId} onChange={(event) => setNewStockCenterId(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-normal">
                  <option value="">Selecione</option>
                  {costCenters.map((center) => <option key={center.id} value={center.id}>{center.code} · {center.name}</option>)}
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-600">Nome do estoque
                <input required minLength={2} maxLength={160} value={newStockName} onChange={(event) => setNewStockName(event.target.value)} placeholder="Ex.: Veículo equipe 01" className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-normal" />
              </label>
              <button type="submit" disabled={busy || costCenters.length === 0} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-slate-800 px-4 text-sm font-bold text-white disabled:opacity-50"><Plus className="h-4 w-4" /> Criar estoque</button>
            </form>
            {costCenters.length === 0 && <p className="px-4 pb-4 text-xs text-amber-700">Nenhum centro de custo ativo disponível para vincular um estoque.</p>}
          </section>

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
              <div><h2 className="font-bold">Reservas de peças para OS</h2><p className="mt-1 text-xs text-slate-500">A reserva bloqueia a disponibilidade; a baixa é feita pela conclusão da OS.</p></div>
              <button type="button" onClick={() => void inventory.refetch()} disabled={busy} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700"><RotateCcw className="h-3.5 w-3.5" /> Atualizar</button>
            </div>
            <div className="divide-y divide-slate-100">
              {reservations.map((reservation) => <article key={reservation.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="font-semibold">{parts.find((part) => part.id === reservation.partId)?.name ?? "Peça"}</p>
                  <p className="mt-1 text-xs text-slate-500">OS {workOrders.find((order) => order.id === reservation.workOrderId)?.protocol ?? reservation.workOrderId} · {stocks.find((stock) => stock.id === reservation.stockId)?.name ?? "Estoque"} · {quantity(reservation.quantity)} un.</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">{reservation.status === "reserved" ? "Reservada" : reservation.status === "consumed" ? "Consumida" : "Liberada"}</span>
                  {reservation.status === "reserved" && <button type="button" disabled={busy} onClick={() => void runAction(() => releaseDbsOperationalStockReservation({ data: { reservationId: reservation.id, idempotencyKey: "op-release:" + crypto.randomUUID() } }), "Reserva liberada.")} className="min-h-9 rounded-lg border border-rose-200 px-3 text-xs font-bold text-rose-700 disabled:opacity-50">Liberar</button>}
                </div>
              </article>)}
              {reservations.length === 0 && <p className="p-6 text-sm text-slate-500">Nenhuma reserva registrada.</p>}
            </div>
          </section>
        </>}

        {data?.asOf && <p className="mt-3 text-right text-[11px] text-slate-400">Atualizado em {new Date(data.asOf).toLocaleString("pt-BR")}</p>}
      </div>
    </main>
  );
}
