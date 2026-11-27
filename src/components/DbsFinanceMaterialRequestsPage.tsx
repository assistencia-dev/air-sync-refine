import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ClipboardList, RefreshCw, Send, Truck, XCircle } from "lucide-react";
import {
  decideDbsMaterialRequest,
  fulfillDbsMaterialRequest,
  fulfillDbsGasRefillRequest,
  getDbsFinanceMaterialRequests,
  getDbsPhase2InventoryOverview,
  linkDbsMaterialRequestPurchase,
} from "@/lib/dbs-control.functions";

type QueueStatus = "pending" | "in_review" | "approved" | "rejected" | "awaiting_purchase" | "ready_for_delivery" | "fulfilled" | "cancelled";
type DecisionStatus = "in_review" | "approved" | "rejected" | "awaiting_purchase" | "ready_for_delivery" | "cancelled";

const labels: Record<string, string> = {
  part: "Peça para OS",
  new_part: "Novo cadastro de peça",
  tool: "Ferramenta",
  supply: "Insumo / material de veículo",
  gas_refill: "Recarga de gás",
};
const statusLabels: Record<QueueStatus, string> = {
  pending: "Aguardando análise",
  in_review: "Em análise",
  approved: "Aprovada",
  rejected: "Recusada",
  awaiting_purchase: "Aguardando compra / recebimento",
  ready_for_delivery: "Disponível para entrega",
  fulfilled: "Atendida",
  cancelled: "Cancelada",
};
const statusStyle: Record<QueueStatus, string> = {
  pending: "bg-amber-50 text-amber-800",
  in_review: "bg-blue-50 text-blue-800",
  approved: "bg-emerald-50 text-emerald-800",
  rejected: "bg-rose-50 text-rose-800",
  awaiting_purchase: "bg-violet-50 text-violet-800",
  ready_for_delivery: "bg-cyan-50 text-cyan-800",
  fulfilled: "bg-slate-100 text-slate-700",
  cancelled: "bg-slate-100 text-slate-700",
};

function newKey() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `dbs-fulfill-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function DbsFinanceMaterialRequestsPage() {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [purchaseItemIds, setPurchaseItemIds] = useState<Record<string, string>>({});
  const [linkQuantities, setLinkQuantities] = useState<Record<string, string>>({});
  const [destinationStocks, setDestinationStocks] = useState<Record<string, string>>({});
  const [fulfillQuantities, setFulfillQuantities] = useState<Record<string, string>>({});
  const [gasRefillCharges, setGasRefillCharges] = useState<Record<string, string>>({});
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const queue = useQuery({
    queryKey: ["dbs-finance-material-requests"],
    queryFn: async () => {
      const [requests, overview] = await Promise.all([
        getDbsFinanceMaterialRequests(),
        getDbsPhase2InventoryOverview(),
      ]);
      return { ...requests, ...overview };
    },
    retry: 1,
  });

  const decide = useMutation({
    mutationFn: ({ requestId, status, expectedVersion }: { requestId: string; status: DecisionStatus; expectedVersion: number }) =>
      decideDbsMaterialRequest({ data: {
        requestId, status, note: notes[requestId] ?? "", expectedVersion,
      } }),
    onSuccess: async () => {
      setErrorMessage("");
      setSuccessMessage("Etapa da solicitação atualizada.");
      await queryClient.invalidateQueries({ queryKey: ["dbs-finance-material-requests"] });
      await queryClient.invalidateQueries({ queryKey: ["dbs-operational-inventory-overview"] });
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : "Não foi possível atualizar a solicitação.");
      setSuccessMessage("");
    },
  });

  const linkPurchase = useMutation({
    mutationFn: ({ requestId, purchaseItemId, quantity, expectedVersion }: { requestId: string; purchaseItemId: string; quantity: number; expectedVersion: number }) =>
      linkDbsMaterialRequestPurchase({ data: {
        requestId,
        purchaseId: String(purchaseItems.find((item: any) => item.id === purchaseItemId)?.purchase_id ?? ""),
        purchaseItemId,
        quantityLinked: quantity,
        expectedVersion,
      } }),
    onSuccess: async () => {
      setErrorMessage("");
      setSuccessMessage("Item da compra vinculado à solicitação.");
      await queryClient.invalidateQueries({ queryKey: ["dbs-finance-material-requests"] });
      await queryClient.invalidateQueries({ queryKey: ["dbs-operational-inventory-overview"] });
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : "Não foi possível vincular a compra.");
      setSuccessMessage("");
    },
  });

  const fulfill = useMutation({
    mutationFn: ({ requestId, quantity, destinationStockId, expectedVersion }: { requestId: string; quantity: number; destinationStockId: string; expectedVersion: number }) =>
      fulfillDbsMaterialRequest({ data: {
        requestId, quantity, destinationStockId, expectedVersion, idempotencyKey: newKey(),
      } }),
    onSuccess: async () => {
      setErrorMessage("");
      setSuccessMessage("Transferência registrada no estoque operacional.");
      await queryClient.invalidateQueries({ queryKey: ["dbs-finance-material-requests"] });
      await queryClient.invalidateQueries({ queryKey: ["dbs-operational-inventory-overview"] });
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : "Não foi possível transferir o material.");
      setSuccessMessage("");
    },
  });

  const fulfillGasRefill = useMutation({
    mutationFn: ({ requestId, totalChargesAfter, expectedVersion }: { requestId: string; totalChargesAfter: number; expectedVersion: number }) =>
      fulfillDbsGasRefillRequest({ data: {
        requestId, totalChargesAfter, expectedVersion, idempotencyKey: newKey(),
      } }),
    onSuccess: async () => {
      setErrorMessage("");
      setSuccessMessage("Recarga de gás registrada, estoque consumido e custo lançado no Ledger.");
      await queryClient.invalidateQueries({ queryKey: ["dbs-finance-material-requests"] });
      await queryClient.invalidateQueries({ queryKey: ["dbs-operational-inventory-overview"] });
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : "Não foi possível concluir a recarga.");
      setSuccessMessage("");
    },
  });

  const requests = queue.data?.requests ?? [];
  const purchases = queue.data?.purchases ?? [];
  const purchaseItems = queue.data?.purchaseItems ?? [];
  const parts = queue.data?.parts ?? [];
  const operationalStocks = queue.data?.operationalStocks ?? [];
  const partMap = useMemo(() => new Map(parts.map((part: any) => [String(part.id), part])), [parts]);
  const purchaseById = useMemo(() => new Map(purchases.map((purchase: any) => [String(purchase.id), purchase])), [purchases]);

  const openRequests = requests.filter((request: any) => !["fulfilled", "rejected", "cancelled"].includes(request.status));
  const recentRequests = requests.filter((request: any) => ["fulfilled", "rejected", "cancelled"].includes(request.status));

  function decideAction(request: any, status: DecisionStatus) {
    if (status === "rejected" && String(notes[request.id] ?? "").trim().length < 5) {
      setErrorMessage("Informe o motivo da recusa com pelo menos cinco caracteres.");
      return;
    }
    setErrorMessage("");
    decide.mutate({ requestId: request.id, status, expectedVersion: Number(request.version) });
  }

  if (queue.isLoading) return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">Carregando solicitações do DBS Control…</div>;
  if (queue.isError) return <div role="alert" className="rounded-2xl border border-rose-200 bg-white p-6 text-sm text-rose-800">Não foi possível carregar a fila financeira. Atualize e tente novamente.</div>;

  return (
    <section className="min-h-full bg-slate-50 px-3 py-4 text-slate-900 sm:px-5">
      <div className="mx-auto max-w-6xl space-y-4">
        <header className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold"><ClipboardList className="h-5 w-5 text-blue-700" /> Solicitações operacionais</h2>
            <p className="mt-1 text-sm text-slate-600">Analise a necessidade, utilize o saldo central ou vincule uma compra existente e transfira ao estoque operacional.</p>
          </div>
          <button type="button" onClick={() => void queue.refetch()} disabled={queue.isFetching} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${queue.isFetching ? "animate-spin" : ""}`} /> Atualizar fila
          </button>
        </header>

        {errorMessage && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{errorMessage}</div>}
        {successMessage && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{successMessage}</div>}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-3"><p className="text-xs text-slate-500">Em aberto</p><p className="mt-1 text-2xl font-bold tabular-nums">{openRequests.length}</p></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-3"><p className="text-xs text-slate-500">Aguardando análise</p><p className="mt-1 text-2xl font-bold tabular-nums">{requests.filter((r: any) => r.status === "pending").length}</p></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-3"><p className="text-xs text-slate-500">Aguardando compra</p><p className="mt-1 text-2xl font-bold tabular-nums">{requests.filter((r: any) => r.status === "awaiting_purchase").length}</p></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-3"><p className="text-xs text-slate-500">Atendidas</p><p className="mt-1 text-2xl font-bold tabular-nums">{recentRequests.filter((r: any) => r.status === "fulfilled").length}</p></div>
        </div>

        {openRequests.map((request: any) => {
          const linked = (queue.data?.purchaseLinks ?? []).filter((link: any) => link.material_request_id === request.id);
          const candidates = purchaseItems.filter((item: any) =>
            request.part_id ? item.part_id === request.part_id : Boolean(item.part_id));
          const requestedPart = request.part_id ? partMap.get(String(request.part_id)) as any : null;
          const fulfilled = Number(request.fulfilled_quantity ?? 0);
          const remaining = Math.max(0, Number(request.quantity ?? 0) - fulfilled);
          const selectableStocks = operationalStocks.filter((stock: any) => stock.status === "active");
          const isGasRefill = request.request_type === "gas_refill";
          const gasCylinder = request.gasCylinder;
          const linkedPurchaseItem = linked.length > 0
            ? purchaseItems.find((item: any) => String(item.id) === String(linked[0].purchase_item_id))
            : null;
          const gasReceiptReady = Boolean(linkedPurchaseItem && Number(linkedPurchaseItem.quantity_received ?? 0) >= 1);
          return (
            <article key={request.id} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{labels[request.request_type] ?? request.request_type}</p>
                  <h3 className="mt-1 text-base font-bold">{request.description}</h3>
                  {requestedPart && <p className="mt-1 text-sm text-slate-600">SKU {requestedPart.sku} · {requestedPart.name}</p>}
                  {isGasRefill && gasCylinder && <p className="mt-1 text-sm font-semibold text-blue-800">Botija {gasCylinder.serial_number} · {gasCylinder.refrigerant_type} · {gasCylinder.remaining_charges}/{gasCylinder.total_charges} cargas atuais</p>}
                  <p className="mt-1 text-sm text-slate-600">{Number(request.quantity).toLocaleString("pt-BR")} {request.unit_label} solicitados · {fulfilled.toLocaleString("pt-BR")} atendidos</p>
                  {request.work_order_id && <p className="mt-1 text-xs text-slate-500">OS: {request.work_order_id}</p>}
                  <p className="mt-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{request.reason}</p>
                  {request.need_by_date && <p className="mt-1 text-xs text-slate-500">Necessário até: {new Date(request.need_by_date + "T12:00:00").toLocaleDateString("pt-BR")}</p>}
                </div>
                <span className={`w-fit shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ${statusStyle[request.status as QueueStatus] ?? "bg-slate-100 text-slate-700"}`}>{statusLabels[request.status as QueueStatus] ?? request.status}</span>
              </div>

              {["pending", "in_review"].includes(request.status) && (
                <div className="space-y-3 border-t border-slate-100 pt-3">
                  <label className="block text-sm font-semibold">Observação / motivo
                    <textarea rows={2} value={notes[request.id] ?? ""} onChange={(e) => setNotes((current) => ({ ...current, [request.id]: e.target.value }))} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2 font-normal" placeholder="Registre a decisão ou explique a recusa." />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {request.status === "pending" && <button type="button" onClick={() => decideAction(request, "in_review")} disabled={decide.isPending} className="min-h-10 rounded-xl bg-blue-700 px-3 text-sm font-bold text-white">Iniciar análise</button>}
                    {request.status === "in_review" && <>
                      <button type="button" onClick={() => decideAction(request, "approved")} disabled={decide.isPending} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-emerald-700 px-3 text-sm font-bold text-white"><CheckCircle2 className="h-4 w-4" /> Aprovar</button>
                      <button type="button" onClick={() => decideAction(request, "awaiting_purchase")} disabled={decide.isPending} className="min-h-10 rounded-xl border border-blue-200 px-3 text-sm font-bold text-blue-800">Encaminhar para compra</button>
                      <button type="button" onClick={() => decideAction(request, "rejected")} disabled={decide.isPending} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-rose-200 px-3 text-sm font-bold text-rose-700"><XCircle className="h-4 w-4" /> Recusar</button>
                    </>}
                  </div>
                </div>
              )}

              {["approved", "awaiting_purchase", "ready_for_delivery"].includes(request.status) && (
                <div className="grid gap-4 border-t border-slate-100 pt-3 lg:grid-cols-2">
                  <div className="space-y-2">
                    <h4 className="text-sm font-bold">Vincular a uma compra</h4>
                    <p className="text-xs text-slate-600">A vinculação usa o item real da compra e confere o SKU quando a peça já está cadastrada.</p>
                    <select value={purchaseItemIds[request.id] ?? ""} onChange={(e) => setPurchaseItemIds((current) => ({ ...current, [request.id]: e.target.value }))} className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
                      <option value="">Selecione o item comprado</option>
                      {candidates.map((item: any) => {
                        const part = partMap.get(String(item.part_id)) as any;
                        const purchase = purchaseById.get(String(item.purchase_id)) as any;
                        return <option key={item.id} value={item.id}>{part?.sku ?? item.part_id} · {part?.name ?? "Peça"} · Compra {purchase?.purchase_number ?? item.purchase_id} · recebida {Number(item.quantity_received ?? 0)}/{Number(item.quantity ?? 0)}</option>;
                      })}
                    </select>
                    <div className="flex gap-2">
                      {isGasRefill
                        ? <div className="flex min-h-11 w-32 items-center rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-600">1 recarga</div>
                        : <input aria-label="Quantidade vinculada" type="number" min="0.0001" step="0.0001" value={linkQuantities[request.id] ?? String(remaining || 1)} onChange={(e) => setLinkQuantities((current) => ({ ...current, [request.id]: e.target.value }))} className="min-h-11 w-32 rounded-xl border border-slate-200 px-3 text-sm" />}
                      <button type="button" disabled={!purchaseItemIds[request.id] || linkPurchase.isPending} onClick={() => linkPurchase.mutate({ requestId: request.id, purchaseItemId: purchaseItemIds[request.id], quantity: isGasRefill ? 1 : Number(linkQuantities[request.id] ?? remaining), expectedVersion: Number(request.version) })} className="min-h-11 flex-1 rounded-xl border border-blue-200 px-3 text-sm font-bold text-blue-800 disabled:opacity-50">Vincular item</button>
                    </div>
                    {linked.length > 0 && <p className="text-xs text-slate-500">{linked.length} vínculo(s) registrados para esta solicitação.</p>}
                  </div>

                  {isGasRefill ? (
                    <div className="space-y-2 rounded-xl border border-blue-100 bg-blue-50 p-3">
                      <h4 className="text-sm font-bold text-blue-900">Concluir recarga da botija</h4>
                      <p className="text-xs text-blue-900">A recarga exige item comprado, recebimento físico disponível e saldo do SKU no estoque central. O sistema consome uma unidade, atualiza a botija e lança o custo no Ledger.</p>
                      <label className="block text-sm font-semibold text-slate-700">Capacidade após recarga (cargas)
                        <input type="number" min="1" step="1" value={gasRefillCharges[request.id] ?? String(gasCylinder?.total_charges ?? 1)} onChange={(e) => setGasRefillCharges((current) => ({ ...current, [request.id]: e.target.value }))} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal"/>
                      </label>
                      <button type="button" disabled={!gasReceiptReady || !request.part_id || fulfillGasRefill.isPending || !Number.isSafeInteger(Number(gasRefillCharges[request.id] ?? gasCylinder?.total_charges ?? 1)) || Number(gasRefillCharges[request.id] ?? gasCylinder?.total_charges ?? 1) <= 0} onClick={() => fulfillGasRefill.mutate({ requestId: request.id, totalChargesAfter: Number(gasRefillCharges[request.id] ?? gasCylinder?.total_charges ?? 1), expectedVersion: Number(request.version) })} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-700 px-3 text-sm font-bold text-white disabled:opacity-50"><Truck className="h-4 w-4"/> {fulfillGasRefill.isPending ? "Concluindo…" : "Concluir recarga e lançar custo"}</button>
                      {!linked.length && <p className="text-xs text-amber-800">Vincule primeiro a linha de recarga na compra.</p>}
                      {linked.length > 0 && !gasReceiptReady && <p className="text-xs text-amber-800">Aguardando o recebimento físico do item vinculado.</p>}
                    </div>
                  ) : (
                    <div className="space-y-2">
                    <h4 className="text-sm font-bold">Transferir para estoque operacional</h4>
                    <p className="text-xs text-slate-600">A transferência só é confirmada com saldo central disponível e, quando houver compra vinculada, após o recebimento físico.</p>
                    <select value={destinationStocks[request.id] ?? request.destination_stock_id ?? ""} onChange={(e) => setDestinationStocks((current) => ({ ...current, [request.id]: e.target.value }))} className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
                      <option value="">Selecione o estoque de destino</option>
                      {selectableStocks.map((stock: any) => <option key={stock.id} value={stock.id}>{stock.name}</option>)}
                    </select>
                    <div className="flex gap-2">
                      <input aria-label="Quantidade a transferir" type="number" min="0.0001" step="0.0001" value={fulfillQuantities[request.id] ?? String(remaining || 1)} onChange={(e) => setFulfillQuantities((current) => ({ ...current, [request.id]: e.target.value }))} className="min-h-11 w-32 rounded-xl border border-slate-200 px-3 text-sm" />
                      <button type="button" disabled={fulfill.isPending || !request.part_id || !(destinationStocks[request.id] ?? request.destination_stock_id)} onClick={() => fulfill.mutate({ requestId: request.id, quantity: Number(fulfillQuantities[request.id] ?? remaining), destinationStockId: String(destinationStocks[request.id] ?? request.destination_stock_id ?? ""), expectedVersion: Number(request.version) })} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-blue-700 px-3 text-sm font-bold text-white disabled:opacity-50"><Truck className="h-4 w-4" /> Transferir</button>
                    </div>
                    {!request.part_id && <p className="text-xs text-amber-700">Para liberar esta solicitação, vincule primeiro um item de compra para identificar o SKU.</p>}
                  </div>
                  )}
                </div>
              )}
            </article>
          );
        })}

        {openRequests.length === 0 && <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Não há solicitações pendentes de tratamento.</div>}

        {recentRequests.length > 0 && <div className="space-y-2 pt-3">
          <h3 className="text-sm font-bold text-slate-700">Histórico recente</h3>
          {recentRequests.slice(0, 20).map((request: any) => <div key={request.id} className="flex flex-col gap-1 rounded-xl border border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div><p className="text-sm font-semibold">{request.description}</p><p className="text-xs text-slate-500">{labels[request.request_type] ?? request.request_type} · {Number(request.fulfilled_quantity ?? 0).toLocaleString("pt-BR")}/{Number(request.quantity).toLocaleString("pt-BR")} atendidos</p>
              {request.request_type === "gas_refill" && request.gasRefillEvent && <p className="mt-1 text-xs text-slate-600">Botija {request.gasRefillEvent.total_charges_after} cargas · Custo: {(Number(request.gasRefillEvent.total_cost_cents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} · Ledger {request.gasRefillEvent.ledger_entry_id}</p>}</div>
            <span className={`w-fit rounded-full px-3 py-1 text-xs font-bold ${statusStyle[request.status as QueueStatus] ?? "bg-slate-100"}`}>{statusLabels[request.status as QueueStatus] ?? request.status}</span>
          </div>)}
        </div>}
      </div>
    </section>
  );
}
