import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, ClipboardList, Package, RefreshCw, Send, ShieldCheck, Wrench } from "lucide-react";
import {
  createDbsMaterialRequest,
  getDbsOperationalInventoryOverview,
  reserveDbsOperationalStockForWorkOrder,
} from "@/lib/dbs-control.functions";
import { getDbsWarrantyOverview } from "@/lib/dbs-warranty.functions";

type OperationalSection = "parts" | "request" | "requests" | "warranties";
type RequestType = "part" | "new_part" | "tool" | "supply" | "gas_refill";

type DbsOperationalInventoryPageProps = {
  initialSection?: "parts" | "purchases";
  initialQuoteId?: string;
  initialRequestType?: RequestType;
  requestToken?: number;
};

const requestLabels: Record<RequestType, string> = {
  part: "Peça cadastrada para uma OS",
  new_part: "Solicitar cadastro de peça",
  tool: "Ferramenta / equipamento",
  supply: "Insumo / material de veículo",
  gas_refill: "Recarga de cilindro de gás",
};

const statusLabels: Record<string, string> = {
  pending: "Aguardando Financeiro",
  in_review: "Em análise",
  approved: "Aprovada",
  rejected: "Recusada",
  awaiting_purchase: "Vinculada a compra",
  ready_for_delivery: "Disponível para entrega",
  fulfilled: "Atendida",
  cancelled: "Cancelada",
};

function requestKey() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `dbs-material-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function DbsOperationalInventoryPage({
  initialSection = "parts",
  initialQuoteId = "",
  initialRequestType,
  requestToken = 0,
}: DbsOperationalInventoryPageProps) {
  const queryClient = useQueryClient();
  const [section, setSection] = useState<OperationalSection>(initialRequestType ? "request" : initialSection === "purchases" ? "requests" : "parts");
  const [search, setSearch] = useState("");
  const [requestType, setRequestType] = useState<RequestType>(initialRequestType ?? "part");
  const [partId, setPartId] = useState("");
  const [workOrderId, setWorkOrderId] = useState("");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitLabel, setUnitLabel] = useState("un");
  const [reason, setReason] = useState("");
  const [needByDate, setNeedByDate] = useState("");
  const [vehicleLabel, setVehicleLabel] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [gasCylinderId, setGasCylinderId] = useState("");
  const [destinationStockId, setDestinationStockId] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(requestKey);
  const [usePartId, setUsePartId] = useState("");
  const [useWorkOrderId, setUseWorkOrderId] = useState("");
  const [useStockId, setUseStockId] = useState("");
  const [useQuantity, setUseQuantity] = useState("1");
  const [useError, setUseError] = useState("");
  const [useSuccess, setUseSuccess] = useState("");
  const [useRequestKey, setUseRequestKey] = useState(requestKey);

  useEffect(() => {
    if (!initialRequestType || requestToken < 1) return;
    setRequestType(initialRequestType);
    setSection("request");
    setDescription("");
    setReason("");
    setQuantity("1");
    setErrorMessage("");
    setSuccessMessage("");
    setIdempotencyKey(requestKey());
  }, [initialRequestType, requestToken]);

  const overview = useQuery({
    queryKey: ["dbs-operational-inventory-overview"],
    queryFn: () => getDbsOperationalInventoryOverview(),
    retry: 1,
  });

  const warrantyOverview = useQuery({
    queryKey: ["dbs-warranty-overview"],
    queryFn: () => getDbsWarrantyOverview(),
    enabled: section === "warranties",
    retry: 1,
  });

  const submitRequest = useMutation({
    mutationFn: () => createDbsMaterialRequest({
      data: {
        requestType,
        partId: requestType === "part" ? partId : undefined,
        workOrderId: workOrderId || undefined,
        gasCylinderId: requestType === "gas_refill" ? gasCylinderId : undefined,
        employeeId: employeeId || undefined,
        destinationStockId: destinationStockId || undefined,
        description: description.trim(),
        quantity: Number(quantity),
        unitLabel: requestType === "gas_refill" ? "recarga" : unitLabel.trim() || "un",
        reason: reason.trim(),
        needByDate: needByDate || undefined,
        vehicleLabel: vehicleLabel.trim() || undefined,
        idempotencyKey,
      },
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["dbs-operational-inventory-overview"] });
      setSuccessMessage("Solicitação enviada ao Financeiro.");
      setErrorMessage("");
      setDescription("");
      setReason("");
      setQuantity("1");
      setNeedByDate("");
      setVehicleLabel("");
      setEmployeeId("");
      setGasCylinderId("");
      setDestinationStockId("");
      setIdempotencyKey(requestKey());
      setSection("requests");
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : "Não foi possível enviar a solicitação.");
      setSuccessMessage("");
    },
  });

  const parts = overview.data?.parts ?? [];
  const workOrders = overview.data?.workOrders ?? [];
  const materialRequests = overview.data?.materialRequests ?? [];
  const operationalStocks = overview.data?.operationalStocks ?? [];
  const employees = overview.data?.employees ?? [];
  const gasCylinders = overview.data?.gasCylinders ?? [];
  const canChooseDestination = overview.data?.canChooseDestination === true;
  const supplierWarranties = warrantyOverview.data?.supplierWarranties ?? [];
  const customerWarranties = warrantyOverview.data?.customerWarranties ?? [];
  const warrantyLabel = (expiresOn: string) => {
    const today = new Date();
    const todayKey = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())).toISOString().slice(0, 10);
    if (expiresOn < todayKey) return "Vencida";
    const days = Math.ceil((Date.parse(expiresOn + "T00:00:00Z") - Date.parse(todayKey + "T00:00:00Z")) / 86400000);
    return days <= 30 ? `Vence em ${days} dia(s)` : "Vigente";
  };
  const reservePart = useMutation({
    mutationFn: () => {
      const selectedStock = operationalStocks.find((stock: any) => String(stock.id) === useStockId);
      if (!selectedStock) throw new Error("Selecione o estoque operacional de destino.");
      return reserveDbsOperationalStockForWorkOrder({ data: {
        workOrderId: useWorkOrderId,
        costCenterId: String(selectedStock.cost_center_id),
        stockId: useStockId,
        partId: usePartId,
        quantity: Number(useQuantity),
        purpose: "TROCA_PECA",
        idempotencyKey: useRequestKey,
      } });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["dbs-operational-inventory-overview"] });
      setUseSuccess("Peça reservada para a OS. O consumo será confirmado pelo fluxo de conclusão da ordem.");
      setUseError("");
      setUseRequestKey(requestKey());
    },
    onError: (error) => {
      setUseError(error instanceof Error ? error.message : "Não foi possível reservar a peça.");
      setUseSuccess("");
    },
  });
  const availableParts = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return parts.filter((part: any) => !term
      || String(part.name ?? "").toLocaleLowerCase("pt-BR").includes(term)
      || String(part.sku ?? "").toLocaleLowerCase("pt-BR").includes(term));
  }, [parts, search]);

  const needsPartAndOrder = requestType === "part";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");
    submitRequest.mutate();
  }

  return (
    <section className="min-h-full bg-slate-50 px-3 py-4 text-slate-900 sm:px-5">
      <div className="mx-auto max-w-6xl space-y-4">
        {initialQuoteId && <div role="status" className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">Cotação {initialQuoteId} preservada para análise e conversão pelo Financeiro. O DBS Control não registra compras.</div>}
        <header className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-bold">Peças, estoque e solicitações</h2>
            <p className="mt-1 text-sm text-slate-600">Controle operacional de quantidades. Custos e compras ficam no Financeiro.</p>
          </div>
          <button type="button" onClick={() => void overview.refetch()} disabled={overview.isFetching}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${overview.isFetching ? "animate-spin" : ""}`} /> Atualizar
          </button>
        </header>

        <nav className="flex flex-wrap gap-2" aria-label="Materiais operacionais">
          <button type="button" onClick={() => setSection("parts")} aria-pressed={section === "parts"}
            className={section === "parts" ? "inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-700 px-4 text-sm font-bold text-white" : "inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-slate-700 ring-1 ring-slate-200"}>
            <Package className="h-4 w-4" /> Peças e estoque
          </button>
          <button type="button" onClick={() => setSection("requests")} aria-pressed={section === "requests"}
            className={section === "requests" ? "inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-700 px-4 text-sm font-bold text-white" : "inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-slate-700 ring-1 ring-slate-200"}>
            <ClipboardList className="h-4 w-4" /> Solicitações
          </button>
          <button type="button" onClick={() => { setSection("request"); setSuccessMessage(""); }}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-slate-700 ring-1 ring-slate-200">
            <Send className="h-4 w-4" /> Solicitar material
          </button>
          <button type="button" onClick={() => setSection("warranties")} aria-pressed={section === "warranties"}
            className={section === "warranties" ? "inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-700 px-4 text-sm font-bold text-white" : "inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-slate-700 ring-1 ring-slate-200"}>
            <ShieldCheck className="h-4 w-4" /> Garantias
          </button>
        </nav>

        {errorMessage && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{errorMessage}</div>}
        {successMessage && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{successMessage}</div>}

        {overview.isLoading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">Carregando estoque operacional…</div>
        ) : overview.isError ? (
          <div role="alert" className="rounded-2xl border border-rose-200 bg-white p-6 text-sm text-rose-800">Não foi possível carregar o estoque. Atualize a tela e tente novamente.</div>
        ) : section === "parts" ? (
          <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-bold">Peças cadastradas</h3>
                <p className="text-sm text-slate-600">Consulte disponibilidade sem visualizar informações financeiras.</p>
              </div>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por peça ou SKU"
                className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm sm:max-w-xs" />
            </div>
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="grid grid-cols-[minmax(0,1fr)_90px_90px] gap-2 border-b border-slate-200 bg-slate-100 px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-600">
                <span>Peça</span><span className="text-right">Estoque</span><span className="text-right">Disponível</span>
              </div>
              {availableParts.length === 0 ? <p className="p-5 text-sm text-slate-500">Nenhuma peça encontrada.</p> : availableParts.map((part: any) => {
                const total = Number(part.stock_quantity ?? 0);
                const reserved = Number(part.reserved_quantity ?? 0);
                return <div key={part.id} className="grid grid-cols-[minmax(0,1fr)_90px_90px] gap-2 border-b border-slate-100 px-4 py-3 text-sm last:border-0">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900">{part.name}</p>
                    <p className="text-xs text-slate-500">{part.sku}</p>
                  </div>
                  <span className="text-right tabular-nums">{total.toLocaleString("pt-BR")}</span>
                  <span className="text-right font-semibold tabular-nums">{Math.max(0, total - reserved).toLocaleString("pt-BR")}</span>
                </div>;
              })}
            </div>
            <p className="text-xs text-slate-500">A disponibilidade considera as quantidades reservadas em ordens de serviço.</p>
            <form onSubmit={(e) => { e.preventDefault(); setUseError(""); setUseSuccess(""); reservePart.mutate(); }} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div>
                <h3 className="font-bold">Usar peça em uma OS</h3>
                <p className="mt-1 text-sm text-slate-600">Reserve a quantidade no estoque operacional; a baixa será feita no encerramento da OS.</p>
              </div>
              {useError && <p role="alert" className="text-sm text-rose-700">{useError}</p>}
              {useSuccess && <p role="status" className="text-sm text-emerald-700">{useSuccess}</p>}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-semibold">Peça
                  <select required value={usePartId} onChange={(e) => setUsePartId(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal">
                    <option value="">Selecione</option>
                    {parts.map((part: any) => <option key={part.id} value={part.id}>{part.sku} · {part.name}</option>)}
                  </select>
                </label>
                <label className="block text-sm font-semibold">OS
                  <select required value={useWorkOrderId} onChange={(e) => setUseWorkOrderId(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal">
                    <option value="">Selecione</option>
                    {workOrders.map((order: any) => <option key={order.id} value={order.id}>{order.protocol || order.id} · {order.status}</option>)}
                  </select>
                </label>
                <label className="block text-sm font-semibold">Estoque operacional
                  <select required value={useStockId} onChange={(e) => setUseStockId(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal">
                    <option value="">Selecione</option>
                    {operationalStocks.map((stock: any) => <option key={stock.id} value={stock.id}>{stock.name}</option>)}
                  </select>
                </label>
                <label className="block text-sm font-semibold">Quantidade
                  <input type="number" min="0.0001" step="0.0001" required value={useQuantity} onChange={(e) => setUseQuantity(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 px-3 font-normal" />
                </label>
              </div>
              <button type="submit" disabled={reservePart.isPending || !operationalStocks.length} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-700 px-4 font-bold text-white hover:bg-blue-800 disabled:opacity-50">
                <Package className="h-4 w-4" /> {reservePart.isPending ? "Reservando…" : "Reservar peça para OS"}
              </button>
              {!operationalStocks.length && <p className="text-xs text-amber-700">Não há estoque operacional ativo neste escopo. Solicite ao Financeiro a configuração do destino.</p>}
            </form>
          </div>
        ) : section === "warranties" ? (
          <div className="space-y-4">
            {warrantyOverview.isLoading ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">Carregando garantias…</div>
            ) : warrantyOverview.isError ? (
              <div role="alert" className="rounded-2xl border border-rose-200 bg-white p-5 text-sm text-rose-800">Não foi possível consultar as garantias. Atualize e tente novamente.</div>
            ) : (
              <>
                <section className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-blue-700"/><h3 className="font-bold">Garantia do fornecedor / fabricante</h3></div>
                  <p className="mt-1 text-sm text-slate-600">Consulte cobertura, série, lote e vencimento. Valores de compra e custos não são exibidos.</p>
                  <div className="mt-3 space-y-2">
                    {supplierWarranties.map((row: any) => <article key={row.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div><p className="text-sm font-semibold text-slate-900">{row.partSku} · {row.partName}</p><p className="text-xs text-slate-600">{row.supplierName}</p></div>
                        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">{warrantyLabel(String(row.expires_on))}</span>
                      </div>
                      <div className="mt-2 grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
                        <p>Série: {row.serial_number || "—"} · Lote: {row.lot_number || "—"}</p>
                        <p>Validade: {row.starts_on} até {row.expires_on}</p>
                      </div>
                      {row.terms && <p className="mt-2 text-sm text-slate-700">{row.terms}</p>}
                    </article>)}
                    {!supplierWarranties.length && <p className="text-sm text-slate-500">Nenhuma garantia de fornecedor vinculada a este cadastro.</p>}
                  </div>
                </section>
                <section className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center gap-2"><CalendarClock className="h-5 w-5 text-blue-700"/><h3 className="font-bold">Cobertura DBS ao cliente</h3></div>
                  <p className="mt-1 text-sm text-slate-600">Consulta da cobertura concedida, vinculada à OS e ao item ou serviço registrado.</p>
                  <div className="mt-3 space-y-2">
                    {customerWarranties.map((row: any) => <article key={row.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div><p className="text-sm font-semibold text-slate-900">OS {row.workOrderProtocol || row.work_order_id}</p><p className="text-xs text-slate-600">{row.partName || (row.coverage_type === "service" ? "Serviço" : "Atendimento")} {row.partSku ? "· " + row.partSku : ""}</p></div>
                        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">{warrantyLabel(String(row.expires_on))}</span>
                      </div>
                      <p className="mt-2 text-xs text-slate-600">Validade: {row.starts_on} até {row.expires_on}</p>
                      {row.terms && <p className="mt-2 text-sm text-slate-700">{row.terms}</p>}
                    </article>)}
                    {!customerWarranties.length && <p className="text-sm text-slate-500">Nenhuma cobertura DBS registrada para as OS deste escopo.</p>}
                  </div>
                </section>
              </>
            )}
          </div>
        ) : section === "request" ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.85fr)]">
            <form onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div>
                <h3 className="font-bold">Nova solicitação ao Financeiro</h3>
                <p className="mt-1 text-sm text-slate-600">Informe o que precisa e por que é necessário.</p>
              </div>
              <label className="block text-sm font-semibold">Tipo de necessidade
                <select value={requestType} onChange={(e) => { const next = e.target.value as RequestType; setRequestType(next); setPartId(""); setGasCylinderId(""); setDestinationStockId(""); if (next === "gas_refill") { setQuantity("1"); setUnitLabel("recarga"); } else if (requestType === "gas_refill") { setQuantity("1"); setUnitLabel("un"); } }}
                  className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal">
                  {Object.entries(requestLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              {needsPartAndOrder && <>
                <label className="block text-sm font-semibold">Peça cadastrada
                  <select required value={partId} onChange={(e) => setPartId(e.target.value)}
                    className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal">
                    <option value="">Selecione uma peça</option>
                    {parts.map((part: any) => <option key={part.id} value={part.id}>{part.sku} · {part.name}</option>)}
                  </select>
                </label>
                <label className="block text-sm font-semibold">Ordem de serviço
                  <select required value={workOrderId} onChange={(e) => setWorkOrderId(e.target.value)}
                    className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal">
                    <option value="">Selecione a OS</option>
                    {workOrders.map((order: any) => <option key={order.id} value={order.id}>{order.protocol || order.id} · {order.status}</option>)}
                  </select>
                </label>
              </>}
              {requestType === "gas_refill" && <label className="block text-sm font-semibold">Botija de gás
                <select required value={gasCylinderId} onChange={(e) => {
                  const selected = gasCylinders.find((cylinder: any) => String(cylinder.id) === e.target.value);
                  setGasCylinderId(e.target.value);
                  if (selected) {
                    setEmployeeId(String(selected.employee_id ?? ""));
                    setVehicleLabel(String(selected.vehicle_label ?? ""));
                    setDescription(`Recarga ${selected.refrigerant_type} · série ${selected.serial_number}`);
                  }
                }} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal">
                  <option value="">Selecione uma botija</option>
                  {gasCylinders.map((cylinder: any) => <option key={cylinder.id} value={cylinder.id}>{cylinder.serial_number} · {cylinder.refrigerant_type} · {cylinder.remaining_charges}/{cylinder.total_charges} cargas</option>)}
                </select>
              </label>}
              {requestType !== "part" && requestType !== "gas_refill" && <label className="block text-sm font-semibold">Responsável (opcional)
                <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal">
                  <option value="">Selecione colaborador</option>
                  {employees.map((employee: any) => <option key={employee.id} value={employee.id}>{employee.full_name}</option>)}
                </select>
              </label>}
              {requestType !== "part" && requestType !== "gas_refill" && canChooseDestination && <label className="block text-sm font-semibold">Estoque / veículo de destino (opcional)
                <select value={destinationStockId} onChange={(e) => setDestinationStockId(e.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal">
                  <option value="">Definir depois pelo Financeiro</option>
                  {operationalStocks.map((stock: any) => <option key={stock.id} value={stock.id}>{stock.name}</option>)}
                </select>
              </label>}
              <label className="block text-sm font-semibold">Descrição
                <input required minLength={2} maxLength={240} value={description} onChange={(e) => setDescription(e.target.value)}
                  placeholder={requestType === "part" ? "Ex.: filtro secador 1/2" : "Informe o material ou ferramenta"}
                  className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 px-3 font-normal" />
              </label>
              {requestType === "gas_refill" ? (
                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-sm font-semibold">Quantidade<input readOnly value="1" className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 font-normal" /></label>
                  <label className="block text-sm font-semibold">Unidade<input readOnly value="recarga" className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 font-normal" /></label>
                  <p className="col-span-2 text-xs text-slate-600">Uma solicitação representa uma recarga para a botija escolhida. O Financeiro confirma a compra e define a capacidade de cargas após a recarga.</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm font-semibold">Quantidade
                  <input required type="number" min="0.0001" step="0.0001" value={quantity} onChange={(e) => setQuantity(e.target.value)}
                    className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 px-3 font-normal" />
                </label>
                <label className="block text-sm font-semibold">Unidade
                  <input value={unitLabel} onChange={(e) => setUnitLabel(e.target.value)} maxLength={24}
                    className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 px-3 font-normal" />
                </label>
              </div>
              )}
              <label className="block text-sm font-semibold">Necessidade / justificativa
                <textarea required minLength={5} maxLength={2000} rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
                  placeholder="Explique a necessidade da peça, ferramenta ou insumo."
                  className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2 font-normal" />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-semibold">Veículo (opcional)
                  <input value={vehicleLabel} onChange={(e) => setVehicleLabel(e.target.value)} maxLength={80}
                    className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 px-3 font-normal" />
                </label>
                <label className="block text-sm font-semibold">Precisa até (opcional)
                  <input type="date" value={needByDate} onChange={(e) => setNeedByDate(e.target.value)}
                    className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 px-3 font-normal" />
                </label>
              </div>
              <button type="submit" disabled={submitRequest.isPending}
                className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-700 px-4 font-bold text-white hover:bg-blue-800 disabled:opacity-50">
                <Send className="h-4 w-4" /> {submitRequest.isPending ? "Enviando…" : "Enviar solicitação"}
              </button>
            </form>

            <aside className="space-y-3">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-center gap-2"><Wrench className="h-5 w-5 text-blue-700" /><h3 className="font-bold">Como funciona</h3></div>
                <p className="mt-2 text-sm leading-6 text-slate-600">O DBS Control registra a necessidade. O Financeiro confere o estoque central, aprova a separação ou vincula a solicitação a uma compra. O SKU da peça permanece o mesmo em todo o processo.</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <h3 className="font-bold">Últimas solicitações</h3>
                <div className="mt-3 space-y-2">
                  {materialRequests.slice(0, 6).map((request: any) => <div key={request.id} className="rounded-xl bg-slate-50 p-3">
                    <div className="flex items-start justify-between gap-2"><p className="text-sm font-semibold">{request.description}</p><span className="shrink-0 text-xs font-semibold text-blue-700">{statusLabels[request.status] ?? request.status}</span></div>
                    <p className="mt-1 text-xs text-slate-500">{Number(request.quantity).toLocaleString("pt-BR")} {request.unit_label} · {request.created_at ? new Date(request.created_at).toLocaleDateString("pt-BR") : ""}</p>
                  </div>)}
                  {materialRequests.length === 0 && <p className="text-sm text-slate-500">Nenhuma solicitação registrada.</p>}
                </div>
              </div>
            </aside>
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
            <h3 className="font-bold">Acompanhamento</h3>
            <div className="mt-3 space-y-2">
              {materialRequests.map((request: any) => <div key={request.id} className="flex flex-col gap-2 rounded-xl border border-slate-100 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div><p className="text-sm font-semibold">{request.description}</p><p className="text-xs text-slate-500">{requestLabels[request.request_type as RequestType] ?? request.request_type} · {Number(request.quantity).toLocaleString("pt-BR")} {request.unit_label}</p>{request.reason && <p className="mt-1 text-xs text-slate-600">{request.reason}</p>}</div>
                <span className="w-fit rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-800">{statusLabels[request.status] ?? request.status}</span>
              </div>)}
              {materialRequests.length === 0 && <p className="text-sm text-slate-500">Nenhuma solicitação registrada.</p>}
            </div>
            <button type="button" onClick={() => setSection("parts")} className="mt-4 min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700">Voltar ao estoque</button>
          </div>
        )}
      </div>
    </section>
  );
}
