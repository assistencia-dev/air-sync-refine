import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  createDbsPartSale,
  createDbsPurchase,
  decideDbsPurchaseApproval,
  getDbsPhase2InventoryOverview,
  releaseDbsWorkOrderReservation,
  reserveDbsWorkOrderParts,
  settleDbsPartSale,
  settleDbsPurchase,
  receiveDbsPurchase,
  receiveDbsPurchaseItems,
  getDbsInventoryFinancialOverview,
} from "@/lib/dbs-control.functions";

export const Route = createFileRoute("/_authenticated/dbs-inventory")({
  component: DbsInventoryPage,
});

function money(cents: unknown) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
    .format(Number(cents ?? 0) / 100);
}

function DbsInventoryPage() {
  const overview = useQuery({
    queryKey: ["dbs-phase2-inventory-overview"],
    queryFn: () => getDbsPhase2InventoryOverview(),
    retry: 1,
  });
  const financial = useQuery({
    queryKey: ["dbs-inventory-financial-overview"],
    queryFn: () => getDbsInventoryFinancialOverview(),
    retry: 1,
  });
  const [tab, setTab] = useState<"sales" | "reservations">("sales");
  const [partId, setPartId] = useState("");
  const [workOrderId, setWorkOrderId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [clientId, setClientId] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [settlementAmounts, setSettlementAmounts] = useState<Record<string, string>>({});
  const [purchasePaymentAmounts, setPurchasePaymentAmounts] = useState<Record<string, string>>({});
  const [purchasePaymentMethods, setPurchasePaymentMethods] = useState<Record<string, "cash" | "pix" | "bank_transfer" | "card" | "other">>({});
  const [purchaseRejectionReasons, setPurchaseRejectionReasons] = useState<Record<string, string>>({});
  const [purchaseReceiptQuantities, setPurchaseReceiptQuantities] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const [message, setMessage] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [purchaseDocument, setPurchaseDocument] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [quoteImport] = useState(() => {
    if (typeof window === "undefined") return { quoteId: "", items: [] as any[] };
    const params = new URLSearchParams(window.location.search);
    try {
      const parsed = JSON.parse(params.get("purchase_items") || "[]");
      return { quoteId: params.get("quote_id") || "", items: Array.isArray(parsed) ? parsed : [] };
    } catch {
      return { quoteId: params.get("quote_id") || "", items: [] as any[] };
    }
  });
  const [purchaseLines, setPurchaseLines] = useState<Array<{ partId: string; sku: string; description: string; quantity: string; unitCost: string }>>(
    () => quoteImport.items.length
      ? quoteImport.items.map((item: any) => ({ partId: "", sku: String(item.sku || ""), description: String(item.description || ""), quantity: String(item.quantity || 1), unitCost: "" }))
      : [{ partId: "", sku: "", description: "", quantity: "1", unitCost: "" }]
  );

  const data = overview.data;
  const parts = data?.parts ?? [];
  const workOrders = data?.workOrders ?? [];
  const reservations = data?.reservations ?? [];
  const sales = data?.sales ?? [];
  const workOrderFinancials = data?.workOrderFinancials ?? [];

  useEffect(() => {
    if (!parts.length || !quoteImport.items.length) return;
    setPurchaseLines((current) => current.map((line) => {
      if (line.partId) return line;
      const match = line.sku
        ? parts.find((part: any) => String(part.sku || "").trim().toLocaleLowerCase("pt-BR") === line.sku.trim().toLocaleLowerCase("pt-BR"))
        : null;
      return match ? { ...line, partId: match.id } : line;
    }));
  }, [parts, quoteImport.items.length]);

  const availableParts = parts.filter((part: any) =>
    Number(part.stock_quantity ?? 0) - Number(part.reserved_quantity ?? 0) > 0
  );

  async function runAction(action: () => Promise<unknown>, success: string): Promise<boolean> {
    setBusy(true);
    setMessage("");
    try {
      await action();
      setMessage(success);
      await Promise.all([overview.refetch(), financial.refetch()]);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível concluir a operação.");
      return false;
    } finally {
      setBusy(false);
    }
  }


  async function submitPurchase(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const items = purchaseLines.map((line) => ({
      partId: line.partId,
      quantity: Number(line.quantity),
      unitCostCents: Math.round(Number(line.unitCost) * 100),
    }));
    if (!supplierName.trim()) {
      setMessage("Informe o fornecedor da compra.");
      return;
    }
    if (items.some((item) => !item.partId || !(item.quantity > 0) || !(item.unitCostCents > 0))) {
      setMessage("Confira cada peça, quantidade e custo unitário. Peças cotadas sem SKU correspondente precisam ser vinculadas manualmente ao catálogo.");
      return;
    }
    const saved = await runAction(() => createDbsPurchase({ data: {
      supplierName: supplierName.trim(),
      documentNumber: purchaseDocument.trim() || undefined,
      purchaseDate,
      idempotencyKey: "purchase-register:" + crypto.randomUUID(),
      items,
    } }), "Compra registrada. Contas a pagar foram lançadas; o estoque só será atualizado após o recebimento.");
    if (saved) {
      setSupplierName("");
      setPurchaseDocument("");
      setPurchaseLines([{ partId: "", sku: "", description: "", quantity: "1", unitCost: "" }]);
    }
  }

  function updatePurchaseLine(index: number, patch: Partial<(typeof purchaseLines)[number]>) {
    setPurchaseLines((current) => current.map((line, i) => i === index ? { ...line, ...patch } : line));
  }

  async function reserveParts(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!partId || !workOrderId || Number(quantity) <= 0) return;
    await runAction(() => reserveDbsWorkOrderParts({ data: {
      workOrderId,
      idempotencyKey: "reserve:" + crypto.randomUUID(),
      items: [{ partId, quantity: Number(quantity) }],
    } }), "Reserva registrada com sucesso.");
  }

  async function createSale(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!partId || Number(quantity) <= 0 || Number(salePrice) <= 0) return;
    await runAction(() => createDbsPartSale({ data: {
      clientId: clientId.trim() || null,
      idempotencyKey: "sale:" + crypto.randomUUID(),
      items: [{ partId, quantity: Number(quantity), unitSaleCents: Math.round(Number(salePrice) * 100) }],
    } }), "Venda avulsa registrada. Estoque e Ledger atualizados.");
  }

  return (
    <main className="min-h-[100dvh] bg-slate-50 px-4 py-5 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-sky-700">DBS CONTROL · FASE 2</p>
            <h1 className="mt-1 text-2xl font-black">Compras, estoque e balanço de custos</h1>
            <p className="mt-1 text-sm text-slate-500">Cotações convertidas em pedidos, custos por OS, recebimentos e obrigações do Ledger.</p>
          </div>
          <Link to="/dbs-control" className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700">← Voltar ao DBS CONTROL</Link>
        </header>

        {message && <div role="status" className="mb-4 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">{message}</div>}
        {overview.isLoading && <p className="rounded-xl bg-white p-5 text-sm text-slate-500">Carregando dados do estoque...</p>}
        {overview.error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{overview.error instanceof Error ? overview.error.message : "Falha ao carregar dados."}</div>}

        {data && <>
          {financial.isLoading && <p className="mb-4 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">Carregando balanço de custos e rentabilidade...</p>}
          {financial.error && <div role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">Não foi possível carregar o balanço financeiro: {financial.error instanceof Error ? financial.error.message : "Falha ao consultar os indicadores."}</div>}
          {financial.data && <section className="mb-5">
            <div className="mb-3"><h2 className="text-lg font-black">Balanço de custos e rentabilidade</h2><p className="text-xs text-slate-500">Valores consolidados do Ledger e do estoque relacional.</p></div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Valor em estoque", financial.data.stock_value_cents],
              ["Compras do mês", financial.data.purchases_month_cents],
              ["Contas a pagar", financial.data.accounts_payable_cents],
              ["Custo operacional", financial.data.operating_cost_cents],
              ["Receita de OS", financial.data.revenue_cents],
              ["Lucro bruto", financial.data.gross_profit_cents],
            ].map(([label, value]) => <div key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-bold text-slate-500">{label}</p>
              <p className="mt-1 text-xl font-black">{money(value)}</p>
            </div>)}
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-bold text-slate-500">Margem bruta</p>
              <p className="mt-1 text-xl font-black">{Number(financial.data.gross_margin_pct ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</p>
            </div>
            </div>
          </section>}
          <section className="mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 p-5"><h2 className="text-lg font-black">Custos por ordem de serviço</h2><p className="mt-1 text-sm text-slate-500">Custo de peças consumidas e receita registrada por OS. A margem exibida considera peças, não mão de obra.</p></div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">OS</th><th className="p-3">Status financeiro</th><th className="p-3">Custo de peças</th><th className="p-3">Receita</th><th className="p-3">Receita menos peças</th><th className="p-3">Margem após peças</th></tr></thead>
                <tbody>{workOrderFinancials.map((row: any) => {
                  const order = workOrders.find((entry: any) => String(entry.id) === String(row.work_order_id));
                  const revenue = Number(row.revenue_cents ?? 0);
                  const cost = Number(row.parts_cost_cents ?? 0);
                  const contribution = revenue - cost;
                  const margin = revenue > 0 ? (contribution / revenue) * 100 : null;
                  return <tr key={row.work_order_id} className="border-t border-slate-100">
                    <td className="p-3 font-bold">{order?.protocol || String(row.work_order_id).slice(0, 8)}</td>
                    <td className="p-3">{row.status || "pending"}</td>
                    <td className="p-3">{money(cost)}</td>
                    <td className="p-3">{money(revenue)}</td>
                    <td className={"p-3 font-bold " + (contribution < 0 ? "text-rose-700" : "text-emerald-700")}>{money(contribution)}</td>
                    <td className="p-3">{margin === null ? "Sem receita registrada" : margin.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + "%"}</td>
                  </tr>;
                })}</tbody>
              </table>
              {!workOrderFinancials.length && <p className="p-5 text-sm text-slate-500">Ainda não há custos por OS conciliados neste escopo. Os valores aparecerão conforme as peças forem consumidas e a receita for registrada.</p>}
            </div>
          </section>
          <section className="mb-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs font-bold text-slate-500">Peças cadastradas</p><p className="mt-1 text-2xl font-black">{parts.length}</p></div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs font-bold text-slate-500">Reservas ativas</p><p className="mt-1 text-2xl font-black">{reservations.filter((r: any) => r.status === "reserved").length}</p></div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs font-bold text-slate-500">Vendas registradas</p><p className="mt-1 text-2xl font-black">{sales.length}</p></div>
          </section>

          <div className="mb-5 flex gap-2">
            <button type="button" onClick={() => setTab("sales")} className={tab === "sales" ? "rounded-xl bg-sky-700 px-4 py-2 text-sm font-bold text-white" : "rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold"}>Vendas avulsas</button>
            <button type="button" onClick={() => setTab("reservations")} className={tab === "reservations" ? "rounded-xl bg-sky-700 px-4 py-2 text-sm font-bold text-white" : "rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold"}>Reservas de OS</button>
          </div>


          <section className="mb-5 rounded-2xl border border-sky-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-wider text-sky-700">Fluxo de suprimentos</p>
                <h2 className="mt-1 text-lg font-black">Nova compra / pedido ao fornecedor</h2>
                <p className="mt-1 text-sm text-slate-500">Registre o custo real cotado. O pedido gera contas a pagar; a entrada física no estoque acontece somente em “Receber no estoque”.</p>
              </div>
              {quoteImport.quoteId && <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-bold text-sky-800">Origem: cotação {quoteImport.quoteId}</span>}
            </div>
            <form onSubmit={submitPurchase} className="grid gap-4">
              <div className="grid gap-3 md:grid-cols-3">
                <label className="text-xs font-bold text-slate-600">Fornecedor *
                  <input required maxLength={180} value={supplierName} onChange={e => setSupplierName(e.target.value)} placeholder="Nome do fornecedor" className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
                </label>
                <label className="text-xs font-bold text-slate-600">Nº da cotação / documento
                  <input maxLength={100} value={purchaseDocument} onChange={e => setPurchaseDocument(e.target.value)} placeholder="Referência do fornecedor" className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
                </label>
                <label className="text-xs font-bold text-slate-600">Data da compra *
                  <input type="date" required value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
                </label>
              </div>
              <div className="overflow-x-auto rounded-xl border border-slate-100">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Peça do catálogo</th><th className="p-3">Qtd.</th><th className="p-3">Custo unitário (R$)</th><th className="p-3">Total</th><th className="p-3"> </th></tr></thead>
                  <tbody>{purchaseLines.map((line, index) => {
                    const part = parts.find((entry: any) => String(entry.id) === line.partId);
                    const lineTotal = Number(line.quantity || 0) * Number(line.unitCost || 0);
                    return <tr key={index} className="border-t border-slate-100">
                      <td className="p-2">
                        <select required value={line.partId} onChange={e => {
                          const selected = parts.find((entry: any) => String(entry.id) === e.target.value);
                          updatePurchaseLine(index, { partId: e.target.value, sku: String(selected?.sku || ""), description: String(selected?.name || selected?.description || "") });
                        }} className="min-h-10 w-full rounded-lg border border-slate-200 px-2 text-sm">
                          <option value="">Selecione a peça cadastrada</option>
                          {parts.filter((entry: any) => String(entry.status || "ativo").toLowerCase() !== "inativo").map((entry: any) => <option key={entry.id} value={entry.id}>{entry.sku ? entry.sku + " · " : ""}{entry.name || entry.description || entry.id}</option>)}
                        </select>
                        {line.description && <p className="mt-1 text-xs text-slate-500">Da cotação: {line.description}{line.sku ? " · SKU " + line.sku : ""}</p>}
                        {line.sku && !part && <p className="mt-1 text-xs font-bold text-amber-700">SKU não localizado automaticamente: selecione a peça correta.</p>}
                      </td>
                      <td className="p-2"><input aria-label="Quantidade" type="number" min="0.001" step="0.001" required value={line.quantity} onChange={e => updatePurchaseLine(index, { quantity: e.target.value })} className="min-h-10 w-24 rounded-lg border border-slate-200 px-2" /></td>
                      <td className="p-2"><input aria-label="Custo unitário em reais" type="number" min="0.01" step="0.01" required value={line.unitCost} onChange={e => updatePurchaseLine(index, { unitCost: e.target.value })} placeholder="0,00" className="min-h-10 w-36 rounded-lg border border-slate-200 px-2" /></td>
                      <td className="p-2 whitespace-nowrap font-bold">{money(Math.round(lineTotal * 100))}</td>
                      <td className="p-2"><button type="button" disabled={purchaseLines.length === 1} onClick={() => setPurchaseLines(current => current.filter((_, i) => i !== index))} className="rounded-lg border border-rose-200 px-2 py-2 text-xs font-bold text-rose-700 disabled:opacity-30">Remover</button></td>
                    </tr>;
                  })}</tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button type="button" onClick={() => setPurchaseLines(current => [...current, { partId: "", sku: "", description: "", quantity: "1", unitCost: "" }])} className="min-h-10 rounded-xl border border-slate-200 px-4 text-sm font-bold">+ Adicionar peça</button>
                <div className="text-right"><p className="text-xs font-bold text-slate-500">Total estimado da compra</p><p className="text-xl font-black">{money(Math.round(purchaseLines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unitCost || 0), 0) * 100))}</p></div>
                <button disabled={busy || !parts.length} className="min-h-11 rounded-xl bg-sky-700 px-5 py-2 text-sm font-black text-white disabled:opacity-50">{busy ? "Registrando..." : "Registrar pedido de compra"}</button>
              </div>
            </form>
          </section>

          <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 p-5">
              <h2 className="text-lg font-black">Compras e contas a pagar</h2>
              <p className="mt-1 text-sm text-slate-500">Cada compra recebida gera a obrigação no Ledger. Os pagamentos baixam fornecedores e caixa com partidas dobradas.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1120px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>
                  <th className="p-3">Fornecedor</th><th className="p-3">Data</th><th className="p-3">Compra</th><th className="p-3">Aprovação financeira</th><th className="p-3">Recebimento</th><th className="p-3">Pago</th><th className="p-3">Saldo</th><th className="p-3">Pagamento</th><th className="p-3">Ação</th>
                </tr></thead>
                <tbody>{(data?.purchases ?? []).map((purchase: any) => {
                  const remaining = Math.max(0, Number(purchase.total_cents ?? 0) - Number(purchase.paid_cents ?? 0));
                  return <tr key={purchase.id} className="border-t border-slate-100">
                    <td className="p-3 font-bold">{purchase.supplier_name}</td>
                    <td className="p-3">{purchase.purchase_date ? new Date(purchase.purchase_date + "T12:00:00").toLocaleDateString("pt-BR") : "—"}</td>
                    <td className="p-3">{money(purchase.total_cents)}</td>
                    <td className="p-3">
                      {purchase.approval_status === "approved" ? <span className="font-bold text-emerald-700">Aprovada</span> :
                        purchase.approval_status === "legacy_received" ? <span className="font-semibold text-slate-500">Recebida antes da regra</span> :
                        purchase.approval_status === "rejected" ? <div className="max-w-52 text-rose-700"><span className="font-bold">Rejeitada</span><p className="mt-1 text-xs">{purchase.rejection_reason}</p></div> :
                        <div className="flex min-w-52 flex-col gap-2">
                          <span className="font-bold text-amber-700">Pendente</span>
                          <div className="flex flex-wrap gap-2">
                            <button type="button" disabled={busy} onClick={() => void runAction(() => decideDbsPurchaseApproval({ data: {
                              purchaseId: purchase.id, decision: "approved", expectedVersion: Number(purchase.version),
                            } }), "Compra aprovada. O recebimento no estoque foi liberado.")} className="min-h-9 rounded-lg bg-emerald-700 px-3 text-xs font-black text-white disabled:opacity-40">Aprovar</button>
                            <button type="button" disabled={busy || String(purchaseRejectionReasons[purchase.id] ?? "").trim().length < 5} onClick={() => void runAction(() => decideDbsPurchaseApproval({ data: {
                              purchaseId: purchase.id, decision: "rejected", reason: purchaseRejectionReasons[purchase.id], expectedVersion: Number(purchase.version),
                            } }), "Compra rejeitada. O recebimento no estoque permanece bloqueado.")} className="min-h-9 rounded-lg bg-rose-700 px-3 text-xs font-black text-white disabled:opacity-40">Rejeitar</button>
                          </div>
                          <input aria-label={"Motivo da rejeição da compra de " + purchase.supplier_name} value={purchaseRejectionReasons[purchase.id] ?? ""} onChange={e => setPurchaseRejectionReasons(prev => ({ ...prev, [purchase.id]: e.target.value }))} maxLength={1000} placeholder="Motivo da rejeição (obrigatório)" className="min-h-9 w-full rounded-lg border border-slate-200 px-2 text-xs" />
                        </div>}
                      {purchase.approval_status === "approved" && purchase.approved_at && <p className="mt-1 text-xs text-slate-500">{new Date(purchase.approved_at).toLocaleString("pt-BR")}</p>}
                    </td>
                    <td className="p-3">
                      {purchase.status === "received" ? <span className="font-bold text-emerald-700">Recebimento completo</span> :
                        purchase.approval_status !== "approved" ? <span className="text-xs font-semibold text-amber-700">Aguardando aprovação</span> : (() => {
                          const lines = (data?.purchaseItems ?? []).filter((item: any) => item.purchase_id === purchase.id);
                          const outstanding = lines.filter((item: any) => Number(item.quantity) > Number(item.quantity_received ?? 0));
                          const selected = outstanding.filter((item: any) => Number(purchaseReceiptQuantities[item.id] ?? 0) > 0);
                          return <details className="min-w-64">
                            <summary className="min-h-9 cursor-pointer rounded-lg bg-sky-700 px-3 py-2 text-center text-xs font-black text-white">
                              Conferir recebimento ({outstanding.length} itens pendentes)
                            </summary>
                            <div className="mt-2 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                              {lines.map((item: any) => {
                                const part = parts.find((entry: any) => String(entry.id) === String(item.part_id));
                                const remainingQty = Math.max(0, Number(item.quantity) - Number(item.quantity_received ?? 0));
                                return <label key={item.id} className="grid grid-cols-[minmax(0,1fr)_100px] items-center gap-2 text-xs">
                                  <span className="min-w-0"><strong>{part?.name ?? part?.sku ?? "Peça"}</strong><span className="block text-slate-500">Recebido {Number(item.quantity_received ?? 0)} / {Number(item.quantity)}</span></span>
                                  <input aria-label={"Quantidade conferida " + (part?.name ?? item.id)} type="number" min="0" max={remainingQty} step="0.0001" disabled={remainingQty <= 0} value={purchaseReceiptQuantities[item.id] ?? ""} onChange={e => setPurchaseReceiptQuantities(prev => ({ ...prev, [item.id]: e.target.value }))} placeholder={"máx. " + remainingQty} className="min-h-9 w-full rounded-lg border border-slate-200 bg-white px-2" />
                                </label>;
                              })}
                              <button type="button" disabled={busy || selected.length === 0 || selected.some((item: any) => Number(purchaseReceiptQuantities[item.id]) > Number(item.quantity) - Number(item.quantity_received ?? 0))} onClick={() => void runAction(() => receiveDbsPurchaseItems({ data: {
                                purchaseId: purchase.id,
                                idempotencyKey: "purchase-receipt:" + purchase.id + ":" + crypto.randomUUID(),
                                items: selected.map((item: any) => ({ purchaseItemId: item.id, quantityReceived: Number(purchaseReceiptQuantities[item.id]) })),
                              } }), "Conferência registrada: somente as quantidades recebidas entraram no estoque e no Ledger.").then(ok => {
                                if (ok) setPurchaseReceiptQuantities(prev => {
                                  const next = { ...prev };
                                  for (const item of selected) delete next[item.id];
                                  return next;
                                });
                              })} className="min-h-10 w-full rounded-lg bg-emerald-700 px-3 text-xs font-black text-white disabled:opacity-40">Confirmar quantidades conferidas</button>
                            </div>
                          </details>;
                        })()}
                      {purchase.status === "partially_received" && <p className="mt-1 text-xs font-semibold text-amber-700">Recebimento parcial · {money(purchase.received_total_cents ?? 0)} recebido</p>}
                    </td>
                    <td className="p-3">{money(purchase.paid_cents)}</td>
                    <td className="p-3 font-bold">{money(remaining)}</td>
                    <td className="p-3">
                      <div className="flex gap-2">
                        <input aria-label={"Valor a pagar para " + purchase.supplier_name} type="number" min="0.01" step="0.01" max={(remaining / 100).toFixed(2)} value={purchasePaymentAmounts[purchase.id] ?? ""} onChange={e => setPurchasePaymentAmounts(prev => ({ ...prev, [purchase.id]: e.target.value }))} className="w-24 rounded-lg border border-slate-200 px-2 py-1" placeholder="R$" />
                        <select aria-label="Meio de pagamento" value={purchasePaymentMethods[purchase.id] ?? "pix"} onChange={e => setPurchasePaymentMethods(prev => ({ ...prev, [purchase.id]: e.target.value as any }))} className="rounded-lg border border-slate-200 px-2 py-1">
                          <option value="pix">Pix</option><option value="bank_transfer">Transferência</option><option value="cash">Dinheiro</option><option value="card">Cartão</option><option value="other">Outro</option>
                        </select>
                      </div>
                    </td>
                    <td className="p-3"><button type="button" disabled={busy || remaining <= 0 || !(Number(purchasePaymentAmounts[purchase.id]) > 0)} onClick={() => {
                      const amountCents = Math.round(Number(purchasePaymentAmounts[purchase.id]) * 100);
                      void runAction(() => settleDbsPurchase({ data: {
                        purchaseId: purchase.id,
                        amountCents,
                        paymentMethod: purchasePaymentMethods[purchase.id] ?? "pix",
                        idempotencyKey: "purchase-payment:" + purchase.id + ":" + crypto.randomUUID(),
                      } }), "Pagamento contabilizado no DBS Treasury.");
                    }} className="min-h-9 rounded-lg bg-sky-700 px-3 text-xs font-black text-white disabled:opacity-40">Baixar</button></td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
          </div>
          {tab === "sales" ? <section className="grid gap-5 lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.5fr)]">
            <form onSubmit={createSale} className="h-fit rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="text-lg font-black">Nova venda avulsa</h2>
              <label className="mt-4 block text-xs font-bold text-slate-600">Peça</label>
              <select required value={partId} onChange={e => setPartId(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm">
                <option value="">Selecione uma peça</option>
                {availableParts.map((part: any) => <option key={part.id} value={part.id}>{part.name ?? part.description ?? part.id} · disponível {Number(part.stock_quantity ?? 0) - Number(part.reserved_quantity ?? 0)}</option>)}
              </select>
              <label className="mt-3 block text-xs font-bold text-slate-600">Cliente (UUID, opcional)</label>
              <input value={clientId} onChange={e => setClientId(e.target.value)} placeholder="ID relacional do cliente" className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
              <div className="mt-3 grid grid-cols-2 gap-3">
                <label className="text-xs font-bold text-slate-600">Quantidade<input type="number" min="0.001" step="0.001" required value={quantity} onChange={e => setQuantity(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" /></label>
                <label className="text-xs font-bold text-slate-600">Preço unitário (R$)<input type="number" min="0.01" step="0.01" required value={salePrice} onChange={e => setSalePrice(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" /></label>
              </div>
              <button disabled={busy || !availableParts.length} className="mt-5 min-h-11 w-full rounded-xl bg-sky-700 px-4 py-2 text-sm font-black text-white disabled:opacity-50">{busy ? "Processando..." : "Registrar venda"}</button>
            </form>
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 p-5"><h2 className="text-lg font-black">Vendas recentes</h2></div>
              <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Venda</th><th className="p-3">Data</th><th className="p-3">Total</th><th className="p-3">Status</th><th className="p-3">Receber</th></tr></thead>
                <tbody>{sales.map((sale: any) => <tr key={sale.id} className="border-t border-slate-100">
                  <td className="p-3 font-mono text-xs">{String(sale.id).slice(0, 8)}</td><td className="p-3">{sale.created_at ? new Date(sale.created_at).toLocaleDateString("pt-BR") : "—"}</td><td className="p-3 font-bold">{money(sale.total_cents)}</td><td className="p-3">{sale.status}</td>
                  <td className="p-3"><div className="flex gap-2"><input aria-label="Valor recebido em reais" type="number" min="0.01" step="0.01" value={settlementAmounts[sale.id] ?? ""} onChange={e => setSettlementAmounts(prev => ({ ...prev, [sale.id]: e.target.value }))} className="w-24 rounded-lg border border-slate-200 px-2 py-1" placeholder="R$" /><button disabled={busy || Number(settlementAmounts[sale.id]) <= 0} onClick={() => void runAction(() => settleDbsPartSale({ data: { saleId: sale.id, amountCents: Math.round(Number(settlementAmounts[sale.id]) * 100), paymentMethod: "pix", idempotencyKey: "settle:" + crypto.randomUUID() } }), "Recebimento registrado.")} className="rounded-lg bg-emerald-700 px-3 py-1 text-xs font-bold text-white disabled:opacity-50">Receber</button></div></td>
                </tr>)}</tbody>
              </table></div>
            </div>
          </section> : <section className="grid gap-5 lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.5fr)]">
            <form onSubmit={reserveParts} className="h-fit rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="text-lg font-black">Reservar peças para OS</h2>
              <label className="mt-4 block text-xs font-bold text-slate-600">Ordem de serviço</label>
              <select required value={workOrderId} onChange={e => setWorkOrderId(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm">
                <option value="">Selecione uma OS</option>
                {workOrders.map((order: any) => <option key={order.id} value={order.id}>{order.protocol ?? order.id} · {order.status}</option>)}
              </select>
              <label className="mt-3 block text-xs font-bold text-slate-600">Peça</label>
              <select required value={partId} onChange={e => setPartId(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm">
                <option value="">Selecione uma peça</option>
                {availableParts.map((part: any) => <option key={part.id} value={part.id}>{part.name ?? part.description ?? part.id} · disponível {Number(part.stock_quantity ?? 0) - Number(part.reserved_quantity ?? 0)}</option>)}
              </select>
              <label className="mt-3 block text-xs font-bold text-slate-600">Quantidade<input type="number" min="0.001" step="0.001" required value={quantity} onChange={e => setQuantity(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" /></label>
              <button disabled={busy || !availableParts.length || !workOrders.length} className="mt-5 min-h-11 w-full rounded-xl bg-sky-700 px-4 py-2 text-sm font-black text-white disabled:opacity-50">{busy ? "Processando..." : "Reservar estoque"}</button>
              <p className="mt-3 text-xs text-slate-500">A reserva bloqueia a disponibilidade, mas não baixa o estoque físico. A baixa ocorre ao concluir a OS.</p>
            </form>
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 p-5"><h2 className="text-lg font-black">Reservas recentes</h2></div>
              <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Reserva</th><th className="p-3">OS</th><th className="p-3">Quantidade</th><th className="p-3">Custo capturado</th><th className="p-3">Status</th><th className="p-3">Ação</th></tr></thead>
                <tbody>{reservations.map((reservation: any) => <tr key={reservation.id} className="border-t border-slate-100">
                  <td className="p-3 font-mono text-xs">{String(reservation.id).slice(0, 8)}</td><td className="p-3 font-mono text-xs">{String(reservation.work_order_id).slice(0, 8)}</td><td className="p-3">{reservation.quantity}</td><td className="p-3">{money(Number(reservation.quantity) * Number(reservation.unit_cost_cents))}</td><td className="p-3">{reservation.status}</td>
                  <td className="p-3">{reservation.status === "reserved" ? <button disabled={busy} onClick={() => void runAction(() => releaseDbsWorkOrderReservation({ data: { reservationId: reservation.id, idempotencyKey: "release:" + crypto.randomUUID() } }), "Reserva liberada.")} className="rounded-lg border border-rose-200 px-3 py-1 text-xs font-bold text-rose-700">Liberar</button> : "—"}</td>
                </tr>)}</tbody>
              </table></div>
            </div>
          </section>}
        </>}
      </div>
    </main>
  );
}
