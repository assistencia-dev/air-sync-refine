import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  createDbsPurchase, createDbsSupplier, createDbsMeasureUnit, createDbsUnitConversion,
  getDbsPhase2InventoryOverview, getDbsQuotePurchaseItems, releaseDbsWorkOrderReservation,
  reserveDbsWorkOrderParts, setDbsWorkOrderCostCenter, receiveDbsPurchaseItems,
  reverseDbsInventoryMovement, createDbsCostCenter, createDbsPartCatalog,
  updateDbsPartCatalog, transferDbsStockToTechnician,
} from "@/lib/dbs-control.functions";

export const Route = createFileRoute("/_authenticated/dbs-inventory")({
  component: DbsInventoryPage,
});

function money(cents: unknown) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
    .format(Number(cents ?? 0) / 100);
}

type DbsInventorySection = "parts" | "purchases";
type DbsInventoryPageProps = {
  embedded?: boolean;
  initialSection?: DbsInventorySection;
  initialQuoteId?: string;
};

export function DbsInventoryPage({
  embedded = false,
  initialSection = "parts",
  initialQuoteId,
}: DbsInventoryPageProps = {}) {
  const overview = useQuery({
    queryKey: ["dbs-phase2-inventory-overview"],
    queryFn: () => getDbsPhase2InventoryOverview(),
    retry: 1,
  });
  const [moduleSection, setModuleSection] = useState<DbsInventorySection>(initialSection);
  useEffect(() => {
    setModuleSection(initialSection);
  }, [initialSection]);
  const [partId, setPartId] = useState("");
  const [workOrderId, setWorkOrderId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [purchaseReceiptQuantities, setPurchaseReceiptQuantities] = useState<Record<string, string>>({});
  const [movementReversalReasons, setMovementReversalReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const [message, setMessage] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [catalogPartId, setCatalogPartId] = useState("");
  const [catalogPartName, setCatalogPartName] = useState("");
  const [catalogPartSku, setCatalogPartSku] = useState("");
  const [catalogPartDescription, setCatalogPartDescription] = useState("");
  const [catalogPartSupplierId, setCatalogPartSupplierId] = useState("");
  const [catalogPartUnitId, setCatalogPartUnitId] = useState("");
  const [catalogPartCost, setCatalogPartCost] = useState("");
  const [catalogPartSale, setCatalogPartSale] = useState("");
  const [newCostCenterCode, setNewCostCenterCode] = useState("");
  const [newCostCenterName, setNewCostCenterName] = useState("");
  const [transferEmployeeId, setTransferEmployeeId] = useState("");
  const [transferPartId, setTransferPartId] = useState("");
  const [transferQuantity, setTransferQuantity] = useState("1");
  const [transferVehicleLabel, setTransferVehicleLabel] = useState("");
  const [costCenterId, setCostCenterId] = useState("");
  const [purchaseDocument, setPurchaseDocument] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [newSupplierName, setNewSupplierName] = useState("");
  const [newSupplierCnpj, setNewSupplierCnpj] = useState("");
  const [newSupplierPhone, setNewSupplierPhone] = useState("");
  const [newUnitCode, setNewUnitCode] = useState("");
  const [newUnitName, setNewUnitName] = useState("");
  const [newUnitSymbol, setNewUnitSymbol] = useState("");
  const [conversionFrom, setConversionFrom] = useState("");
  const [conversionTo, setConversionTo] = useState("");
  const [conversionFactor, setConversionFactor] = useState("1");
  const [costCenterWorkOrderId, setCostCenterWorkOrderId] = useState("");
  const [costCenterWorkOrderValue, setCostCenterWorkOrderValue] = useState("");
  const [gasSerialNumber, setGasSerialNumber] = useState("");
  const [gasType, setGasType] = useState("R410A");
  const [gasEmployeeId, setGasEmployeeId] = useState("");
  const [gasVehicleLabel, setGasVehicleLabel] = useState("");
  const [gasTotalCharges, setGasTotalCharges] = useState("10");
  const [gasTareWeight, setGasTareWeight] = useState("");
  const [gasInitialGrossWeight, setGasInitialGrossWeight] = useState("");
  const [quoteImport, setQuoteImport] = useState(() => ({
    quoteId: initialQuoteId ?? (typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("quote_id") || ""),
  }));
  useEffect(() => {
    if (initialQuoteId !== undefined) setQuoteImport({ quoteId: String(initialQuoteId || "") });
  }, [initialQuoteId]);
  const [purchaseLines, setPurchaseLines] = useState<Array<{ partId:string; description:string; quantity:string; unitCost:string; purchaseUnitId:string; conversionFactor:number }>>(
    [{ partId:"", description:"", quantity:"1", unitCost:"", purchaseUnitId:"", conversionFactor:0 }]
  );
  const quotePurchase = useQuery({
    queryKey: ["dbs-quote-purchase-items", quoteImport.quoteId],
    queryFn: () => getDbsQuotePurchaseItems({ data: { quoteId: quoteImport.quoteId } }),
    enabled: Boolean(quoteImport.quoteId),
    retry: 1,
  });

  const data = overview.data;
  const parts = data?.parts ?? [];
  const suppliers = data?.suppliers ?? [];
  const measureUnits = data?.measureUnits ?? [];
  const unitConversions = data?.unitConversions ?? [];
  const costCenters = data?.costCenters ?? [];
  const gasCylinders = data?.gasCylinders ?? [];
  const carStock = data?.carStock ?? [];
  const employees = data?.employees ?? [];
  const workOrders = data?.workOrders ?? [];
  const reservations = data?.reservations ?? [];
  const workOrderFinancials = data?.workOrderFinancials ?? [];

  useEffect(() => {
    if (!quotePurchase.data || !parts.length) return;
    const lines = quotePurchase.data.items.map((item: any) => {
      const part = parts.find((entry: any) => String(entry.id) === String(item.part_id));
      return {
        partId: String(item.part_id),
        description: String(item.description || part?.name || ""),
        quantity: String(item.quantity || 1),
        unitCost: "",
        purchaseUnitId: String(part?.measure_unit_id || ""),
        conversionFactor: 1,
      };
    });
    if (lines.length) setPurchaseLines(lines);
    if (quotePurchase.data.quote?.cost_center_id) setCostCenterId(String(quotePurchase.data.quote.cost_center_id));
    if (quotePurchase.data.quote?.quote_number) {
      setPurchaseDocument((current) => current || String(quotePurchase.data.quote.quote_number));
    }
  }, [quotePurchase.data, parts]);

  useEffect(() => {
    if (!supplierId && suppliers.length === 1) setSupplierId(String(suppliers[0].id));
    if (!costCenterId && costCenters.length === 1) setCostCenterId(String(costCenters[0].id));
  }, [suppliers, costCenters, supplierId, costCenterId]);

  const availableParts = parts.filter((part: any) =>
    Number(part.stock_quantity ?? 0) - Number(part.reserved_quantity ?? 0) > 0
  );

  async function runAction(action: () => Promise<unknown>, success: string): Promise<boolean> {
    setBusy(true);
    setMessage("");
    try {
      await action();
      setMessage(success);
      await overview.refetch();
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
    if (!supplierId || !costCenterId) {
      setMessage("Selecione fornecedor e centro de custo cadastrados.");
      return;
    }
    const items = purchaseLines.map((line) => ({
      partId: line.partId,
      purchaseUnitId: line.purchaseUnitId,
      quantity: Number(line.quantity),
      unitCostCents: Math.round(Number(line.unitCost) * 100),
      conversionFactor: Number(line.conversionFactor),
    }));
    if (items.some((item) => !item.partId || !item.purchaseUnitId || !(item.quantity > 0) || !(item.unitCostCents > 0) || !(item.conversionFactor > 0))) {
      setMessage("Cada item precisa de peça relacional, unidade de compra e conversão ativa para a unidade-base.");
      return;
    }
    const saved = await runAction(() => createDbsPurchase({ data: {
      supplierId, costCenterId,
      documentNumber: purchaseDocument.trim() || undefined,
      purchaseDate,
      idempotencyKey: "purchase-register:" + crypto.randomUUID(),
      items,
    } }), "Pedido registrado para análise financeira. O estoque só será atualizado após aprovação e conferência do recebimento físico.");
    if (saved) {
      setPurchaseDocument("");
      setPurchaseLines([{ partId:"", description:"", quantity:"1", unitCost:"", purchaseUnitId:"", conversionFactor:0 }]);
    }
  }

  function updatePurchaseLine(index: number, patch: Partial<(typeof purchaseLines)[number]>) {
    setPurchaseLines((current) => current.map((line, i) => i === index ? { ...line, ...patch } : line));
  }

  function conversionFor(partIdValue: string, purchaseUnitId: string): number {
    const part = parts.find((entry: any) => String(entry.id) === partIdValue);
    if (!part || !part.measure_unit_id || !purchaseUnitId) return 0;
    if (String(part.measure_unit_id) === purchaseUnitId) return 1;
    const conversion = unitConversions.find((row: any) =>
      String(row.from_unit_id) === purchaseUnitId && String(row.to_unit_id) === String(part.measure_unit_id)
    );
    return conversion ? Number(conversion.factor) : 0;
  }

  function selectCatalogPart(partIdValue: string) {
    setCatalogPartId(partIdValue);
    const part = parts.find((entry: any) => String(entry.id) === partIdValue);
    if (!part) {
      setCatalogPartName("");
      setCatalogPartSku("");
      setCatalogPartDescription("");
      setCatalogPartSupplierId("");
      setCatalogPartUnitId("");
      setCatalogPartCost("");
      setCatalogPartSale("");
      return;
    }
    setCatalogPartName(String(part.name ?? ""));
    setCatalogPartSku(String(part.sku ?? ""));
    setCatalogPartDescription(String(part.description ?? ""));
    setCatalogPartSupplierId(String(part.supplier_id ?? ""));
    setCatalogPartUnitId(String(part.measure_unit_id ?? ""));
    setCatalogPartCost((Number(part.cost_cents ?? 0) / 100).toFixed(2));
    setCatalogPartSale((Number(part.sale_cents ?? 0) / 100).toFixed(2));
  }

  async function saveCatalogPart(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!catalogPartSupplierId || !catalogPartUnitId || !catalogPartName.trim() || !catalogPartSku.trim()) {
      setMessage("Informe código, nome, fornecedor e unidade-base da peça.");
      return;
    }
    const payload = {
      sku: catalogPartSku.trim(),
      name: catalogPartName.trim(),
      description: catalogPartDescription.trim() || undefined,
      supplierId: catalogPartSupplierId,
      measureUnitId: catalogPartUnitId,
      costCents: Math.round(Number(catalogPartCost || 0) * 100),
      saleCents: Math.round(Number(catalogPartSale || 0) * 100),
    };
    let saved = false;
    if (catalogPartId) {
      const selected = parts.find((entry: any) => String(entry.id) === catalogPartId);
      if (!selected) {
        setMessage("A peça selecionada não está mais disponível. Atualize a tela.");
        return;
      }
      saved = await runAction(() => updateDbsPartCatalog({ data: {
        partId: catalogPartId,
        expectedVersion: Number(selected.version),
        ...payload,
      } }), "Cadastro da peça atualizado sem alterar o saldo físico.");
    } else {
      saved = await runAction(() => createDbsPartCatalog({ data: payload }), "Peça cadastrada no catálogo relacional. O saldo inicial permanece zero até o recebimento físico.");
    }
    if (saved) {
      selectCatalogPart("");
      await overview.refetch();
    }
  }

  async function addCostCenter(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = await runAction(() => createDbsCostCenter({ data: {
      code: newCostCenterCode,
      name: newCostCenterName,
    } }), "Centro de custo salvo e disponível para compras, OS e consumo.");
    if (saved) {
      setNewCostCenterCode("");
      setNewCostCenterName("");
      await overview.refetch();
    }
  }

  async function transferStockToTechnician(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!transferEmployeeId || !transferPartId || !(Number(transferQuantity) > 0)) {
      setMessage("Selecione técnico, peça e quantidade para transferir.");
      return;
    }
    const saved = await runAction(() => transferDbsStockToTechnician({ data: {
      employeeId: transferEmployeeId,
      partId: transferPartId,
      quantity: Number(transferQuantity),
      vehicleLabel: transferVehicleLabel.trim() || "Veículo do colaborador",
      idempotencyKey: "car-stock-transfer:" + crypto.randomUUID(),
    } }), "Transferência confirmada: o estoque central foi reduzido e o material ficou sob custódia do técnico.");
    if (saved) {
      setTransferQuantity("1");
      setTransferPartId("");
      await overview.refetch();
    }
  }

  async function addSupplier(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let createdId = "";
    const saved = await runAction(async () => {
      const created: any = await createDbsSupplier({ data: { name:newSupplierName, cnpj:newSupplierCnpj, phone:newSupplierPhone } });
      createdId = String(created?.id ?? "");
    }, "Fornecedor cadastrado e disponível no cadastro da peça e em Compras.");
    if (saved) {
      setNewSupplierName(""); setNewSupplierCnpj(""); setNewSupplierPhone("");
      // Pre-select the new supplier where it is still empty so it is usable at once.
      if (createdId) {
        setCatalogPartSupplierId((current) => current || createdId);
        setSupplierId((current) => current || createdId);
      }
    }
  }
  async function addMeasureUnit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let createdId = "";
    const saved = await runAction(async () => {
      const created: any = await createDbsMeasureUnit({ data: { code:newUnitCode, name:newUnitName, symbol:newUnitSymbol||newUnitCode } });
      createdId = String(created?.id ?? "");
    }, "Unidade de medida cadastrada e disponível como unidade-base.");
    if (saved) {
      setNewUnitCode(""); setNewUnitName(""); setNewUnitSymbol("");
      if (createdId) setCatalogPartUnitId((current) => current || createdId);
    }
  }
  async function addUnitConversion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = await runAction(() => createDbsUnitConversion({ data: { fromUnitId:conversionFrom, toUnitId:conversionTo, factor:Number(conversionFactor) } }), "Conversão de unidade cadastrada.");
    if (saved) { setConversionFactor("1"); await overview.refetch(); }
  }

  async function linkOrderCostCenter(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(!costCenterWorkOrderId||!costCenterWorkOrderValue){setMessage("Selecione a OS e o centro de custo.");return;}
    const saved=await runAction(()=>setDbsWorkOrderCostCenter({data:{workOrderId:costCenterWorkOrderId,costCenterId:costCenterWorkOrderValue}}),"Centro de custo vinculado à ordem de serviço.");
    if(saved){setCostCenterWorkOrderId("");setCostCenterWorkOrderValue("");}
  }

  async function assignWeightedGasCylinder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const tare=Number(gasTareWeight), gross=Number(gasInitialGrossWeight), charges=Number(gasTotalCharges);
    if(!gasSerialNumber.trim()||!gasType.trim()||!gasEmployeeId||!Number.isInteger(charges)||charges<=0||
      !Number.isFinite(tare)||!Number.isFinite(gross)||tare<0||gross<=tare){
      setMessage("Informe série, refrigerante, técnico, quantidade de cargas, tara e peso bruto inicial válidos.");
      return;
    }
    await runAction(async()=>{
      const {data,error}=await (supabase as any).rpc("dbs_control_assign_gas_cylinder_weighted",{
        p_serial_number:gasSerialNumber.trim(),
        p_refrigerant_type:gasType.trim().toUpperCase(),
        p_employee_id:gasEmployeeId,
        p_total_charges:charges,
        p_vehicle_label:gasVehicleLabel.trim()||null,
        p_tare_weight_kg:tare,
        p_initial_gross_weight_kg:gross,
      });
      if(error) throw new Error(error.message);
      return data;
    },"Cilindro cadastrado e vinculado ao técnico com tara e pesagem inicial.");
    setGasSerialNumber("");setGasVehicleLabel("");setGasTotalCharges("10");setGasTareWeight("");setGasInitialGrossWeight("");
  }

  async function initializeExistingCylinderWeights(cylinder:any) {
    const tareRaw=window.prompt("Tara do vasilhame (kg):","");
    if(tareRaw===null)return;
    const grossRaw=window.prompt("Peso bruto atual da botija (kg):","");
    if(grossRaw===null)return;
    const tare=Number(tareRaw.replace(",",".")),gross=Number(grossRaw.replace(",","."));
    if(!Number.isFinite(tare)||!Number.isFinite(gross)||tare<0||gross<=tare){
      setMessage("Pesagem inválida: o peso bruto deve ser maior que a tara.");
      return;
    }
    await runAction(async()=>{
      const {data,error}=await (supabase as any).rpc("dbs_control_initialize_existing_gas_cylinder_weights",{
        p_cylinder_id:cylinder.id,p_tare_weight_kg:tare,p_initial_gross_weight_kg:gross
      });
      if(error)throw new Error(error.message);
      return data;
    },"Tara e pesagem inicial do cilindro registradas.");
  }

  async function reserveParts(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!partId || !workOrderId || !costCenterId || Number(quantity) <= 0) {
      setMessage("Selecione OS, peça, quantidade e centro de custo.");
      return;
    }
    await runAction(async () => {
      await setDbsWorkOrderCostCenter({ data: { workOrderId, costCenterId } });
      return reserveDbsWorkOrderParts({ data: {
        workOrderId,
        idempotencyKey: "reserve:" + crypto.randomUUID(),
        items: [{ partId, quantity: Number(quantity) }],
      } });
    }, "Centro de custo vinculado à OS e reserva registrada.");
  }


  return (
    <main className={embedded ? "min-h-full bg-slate-50 px-4 py-5 text-slate-900 sm:px-6" : "min-h-[100dvh] bg-slate-50 px-4 py-5 text-slate-900 sm:px-6"}>
      <div className="mx-auto max-w-7xl">
        <header className={embedded ? "mb-4 border-b border-slate-200 pb-4" : "mb-6 flex flex-wrap items-center justify-between gap-3"}>
          <div>
            {!embedded && <p className="text-xs font-black uppercase tracking-[0.16em] text-sky-700">DBS CONTROL · FASE 2</p>}
            <h1 className={embedded ? "text-xl font-black" : "mt-1 text-2xl font-black"}>{moduleSection === "parts" ? "Peças & Estoque" : "Compras"}</h1>
            <p className="mt-1 text-sm text-slate-500">{moduleSection === "parts"
              ? "Cadastro, movimentação, estoque central e dos técnicos, reservas e custos de material por OS."
              : "Solicitações a fornecedores e recebimento físico. Aprovação, contas a pagar e pagamentos ficam no DBS Treasury."}</p>
          </div>
          {!embedded && <Link to="/dbs-control" className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700">← Voltar ao DBS CONTROL</Link>}
        </header>

        {!embedded && (
          <nav aria-label="Módulos de materiais" className="mb-5 flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
            <button type="button" aria-pressed={moduleSection === "parts"} onClick={() => setModuleSection("parts")} className={moduleSection === "parts" ? "min-h-11 rounded-xl bg-sky-700 px-5 text-sm font-black text-white" : "min-h-11 rounded-xl border border-slate-200 px-5 text-sm font-bold text-slate-700 hover:bg-slate-50"}>Peças & Estoque</button>
            <button type="button" aria-pressed={moduleSection === "purchases"} onClick={() => setModuleSection("purchases")} className={moduleSection === "purchases" ? "min-h-11 rounded-xl bg-sky-700 px-5 text-sm font-black text-white" : "min-h-11 rounded-xl border border-slate-200 px-5 text-sm font-bold text-slate-700 hover:bg-slate-50"}>Compras</button>
            <span className="ml-auto self-center px-2 text-xs text-slate-500">Operação integrada ao DBS Treasury</span>
          </nav>
        )}

        {message && <div role="status" className="mb-4 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">{message}</div>}
        {overview.isLoading && <p className="rounded-xl bg-white p-5 text-sm text-slate-500">Carregando dados do estoque...</p>}
        {overview.error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <p className="font-bold">Não foi possível carregar Peças & Estoque e Compras.</p>
          <p className="mt-1 break-words">{overview.error instanceof Error ? overview.error.message : "Falha ao carregar dados."}</p>
          <button type="button" onClick={() => { void overview.refetch(); }} className="mt-3 min-h-10 rounded-lg border border-rose-300 bg-white px-4 text-xs font-black text-rose-800">Tentar carregar novamente</button>
        </div>}

        {data && <>
          {moduleSection === "parts" && <>
          <section className="mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 p-5">
              <h2 className="text-lg font-black">Custo de materiais por ordem de serviço</h2>
              <p className="mt-1 text-sm text-slate-500">O DBS Control registra o custo operacional das peças consumidas e envia essa informação para o cálculo do Financeiro. Receita, lucro, contas a pagar e pagamentos são acompanhados exclusivamente no DBS Treasury.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">OS</th><th className="p-3">Registro</th><th className="p-3">Custo de materiais</th><th className="p-3">Atualizado em</th></tr></thead>
                <tbody>{workOrderFinancials.map((row: any) => {
                  const order = workOrders.find((entry: any) => String(entry.id) === String(row.work_order_id));
                  return <tr key={row.work_order_id} className="border-t border-slate-100">
                    <td className="p-3 font-bold">{order?.protocol || String(row.work_order_id).slice(0, 8)}</td>
                    <td className="p-3">{row.status || "Registrado"}</td>
                    <td className="p-3 font-bold">{money(row.parts_cost_cents)}</td>
                    <td className="p-3">{row.updated_at ? new Date(row.updated_at).toLocaleString("pt-BR") : "—"}</td>
                  </tr>;
                })}</tbody>
              </table>
              {!workOrderFinancials.length && <p className="p-5 text-sm text-slate-500">Os custos aparecerão aqui quando materiais forem consumidos e vinculados às OS.</p>}
            </div>
          </section>
          <section className="mb-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs font-bold text-slate-500">Peças cadastradas</p><p className="mt-1 text-2xl font-black">{parts.length}</p></div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs font-bold text-slate-500">Reservas ativas</p><p className="mt-1 text-2xl font-black">{reservations.filter((r: any) => r.status === "reserved").length}</p></div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs font-bold text-slate-500">Unidades livres no estoque</p><p className="mt-1 text-2xl font-black">{parts.reduce((total: number, part: any) => total + Math.max(0, Number(part.stock_quantity ?? 0) - Number(part.reserved_quantity ?? 0)), 0).toLocaleString("pt-BR")}</p></div>
          </section>

          <section className="mb-5 grid gap-4 lg:grid-cols-4">
            <form onSubmit={addSupplier} className="rounded-2xl border border-slate-200 bg-white p-4">
              <h2 className="font-black">Cadastro de fornecedor</h2>
              <p className="mt-1 text-xs text-slate-500">O fornecedor cadastrado é compartilhado pelo catálogo e por Compras.</p>
              <input required value={newSupplierName} onChange={e=>setNewSupplierName(e.target.value)} placeholder="Nome / razão social" className="mt-3 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"/>
              <input value={newSupplierCnpj} onChange={e=>setNewSupplierCnpj(e.target.value)} placeholder="CNPJ / CPF (opcional)" className="mt-2 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"/>
              <input value={newSupplierPhone} onChange={e=>setNewSupplierPhone(e.target.value)} placeholder="Telefone (opcional)" className="mt-2 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"/>
              <button disabled={busy} className="mt-3 min-h-10 w-full rounded-lg bg-sky-700 px-3 text-sm font-bold text-white">Cadastrar fornecedor</button>
            </form>
            <form onSubmit={addCostCenter} className="rounded-2xl border border-slate-200 bg-white p-4">
              <h2 className="font-black">Centro de custo</h2>
              <p className="mt-1 text-xs text-slate-500">Cadastre a classificação que será usada nas compras, OS e consumo.</p>
              <input required maxLength={40} value={newCostCenterCode} onChange={e=>setNewCostCenterCode(e.target.value.toUpperCase())} placeholder="Código (ex.: OPERACAO)" className="mt-3 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"/>
              <input required maxLength={180} value={newCostCenterName} onChange={e=>setNewCostCenterName(e.target.value)} placeholder="Nome do centro de custo" className="mt-2 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"/>
              <button disabled={busy} className="mt-3 min-h-10 w-full rounded-lg bg-sky-700 px-3 text-sm font-bold text-white">Salvar centro de custo</button>
            </form>
            <form onSubmit={addMeasureUnit} className="rounded-2xl border border-slate-200 bg-white p-4">
              <h2 className="font-black">Unidade de medida</h2>
              <p className="mt-1 text-xs text-slate-500">Cadastre unidades-base e unidades de compra (UN, CX, KG, L, M...).</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <input required value={newUnitCode} onChange={e=>setNewUnitCode(e.target.value.toUpperCase())} placeholder="Código (UN)" className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm"/>
                <input required value={newUnitSymbol} onChange={e=>setNewUnitSymbol(e.target.value)} placeholder="Símbolo" className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm"/>
              </div>
              <input required value={newUnitName} onChange={e=>setNewUnitName(e.target.value)} placeholder="Nome da unidade" className="mt-2 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"/>
              <button disabled={busy} className="mt-3 min-h-10 w-full rounded-lg bg-sky-700 px-3 text-sm font-bold text-white">Cadastrar unidade</button>
            </form>
            <form onSubmit={addUnitConversion} className="rounded-2xl border border-slate-200 bg-white p-4">
              <h2 className="font-black">Conversão de unidades</h2>
              <p className="mt-1 text-xs text-slate-500">Defina quantas unidades-base existem em uma unidade de compra.</p>
              <select required value={conversionFrom} onChange={e=>setConversionFrom(e.target.value)} className="mt-3 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"><option value="">Unidade de compra</option>{measureUnits.map((u:any)=><option key={u.id} value={u.id}>{u.code} · {u.name}</option>)}</select>
              <select required value={conversionTo} onChange={e=>setConversionTo(e.target.value)} className="mt-2 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"><option value="">Unidade-base</option>{measureUnits.map((u:any)=><option key={u.id} value={u.id}>{u.code} · {u.name}</option>)}</select>
              <input required type="number" min="0.0001" step="0.0001" value={conversionFactor} onChange={e=>setConversionFactor(e.target.value)} placeholder="Fator (ex.: 12)" className="mt-2 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"/>
              <button disabled={busy} className="mt-3 min-h-10 w-full rounded-lg bg-sky-700 px-3 text-sm font-bold text-white">Salvar conversão</button>
            </form>
          </section>
          {(!suppliers.length || !measureUnits.length || !costCenters.length) && <p className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Para registrar compras, cadastre fornecedor, unidade de medida e centro de custo nesta tela.</p>}
          <section className="mb-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            <form onSubmit={saveCatalogPart} className="rounded-2xl border border-sky-200 bg-white p-5 shadow-sm">
              <div className="mb-3">
                <p className="text-xs font-black uppercase tracking-wider text-sky-700">Catálogo relacional</p>
                <h2 className="mt-1 text-lg font-black">Cadastrar ou completar uma peça</h2>
                <p className="mt-1 text-xs text-slate-500">Vincule fornecedor e unidade-base. A peça entra sem saldo; quantidade só nasce no recebimento.</p>
              </div>
              <label className="block text-xs font-bold text-slate-600">Editar peça existente ou cadastrar nova
                <select value={catalogPartId} onChange={e=>selectCatalogPart(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm">
                  <option value="">Nova peça / insumo</option>
                  {parts.map((part:any)=><option key={part.id} value={part.id}>{part.sku ? part.sku+" · " : ""}{part.name||part.description||part.id}</option>)}
                </select>
              </label>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-bold text-slate-600">SKU / código *
                  <input required maxLength={80} value={catalogPartSku} onChange={e=>setCatalogPartSku(e.target.value.toUpperCase())} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"/>
                </label>
                <label className="text-xs font-bold text-slate-600">Nome da peça / insumo *
                  <input required maxLength={180} value={catalogPartName} onChange={e=>setCatalogPartName(e.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"/>
                </label>
                <label className="text-xs font-bold text-slate-600">Fornecedor *
                  <select required value={catalogPartSupplierId} onChange={e=>setCatalogPartSupplierId(e.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm">
                    <option value="">Selecione fornecedor</option>
                    {suppliers.map((supplier:any)=><option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                  </select>
                </label>
                <label className="text-xs font-bold text-slate-600">Unidade-base *
                  <select required value={catalogPartUnitId} onChange={e=>setCatalogPartUnitId(e.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm">
                    <option value="">Selecione unidade</option>
                    {measureUnits.map((unit:any)=><option key={unit.id} value={unit.id}>{unit.code} · {unit.name}</option>)}
                  </select>
                </label>
                <label className="text-xs font-bold text-slate-600">Custo de referência (R$)
                  <input type="number" min="0" step="0.01" value={catalogPartCost} onChange={e=>setCatalogPartCost(e.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"/>
                </label>
                <label className="text-xs font-bold text-slate-600">Preço de venda (R$)
                  <input type="number" min="0" step="0.01" value={catalogPartSale} onChange={e=>setCatalogPartSale(e.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"/>
                </label>
              </div>
              <label className="mt-3 block text-xs font-bold text-slate-600">Descrição complementar
                <textarea rows={2} maxLength={1000} value={catalogPartDescription} onChange={e=>setCatalogPartDescription(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"/>
              </label>
              <button disabled={busy || !suppliers.length || !measureUnits.length} className="mt-4 min-h-11 w-full rounded-xl bg-sky-700 px-4 text-sm font-black text-white disabled:opacity-40">
                {busy ? "Salvando..." : catalogPartId ? "Salvar cadastro da peça" : "Cadastrar peça no catálogo"}
              </button>
            </form>
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 p-5">
                <h2 className="text-lg font-black">Catálogo de peças e insumos</h2>
                <p className="mt-1 text-xs text-slate-500">{parts.length} itens relacionais · selecione um item à esquerda para completar o cadastro</p>
              </div>
              <div className="max-h-[520px] overflow-auto">
                <table className="w-full min-w-[620px] text-left text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Peça / SKU</th><th className="p-3">Fornecedor</th><th className="p-3">Unidade</th><th className="p-3">Custo</th><th className="p-3">Saldo central</th></tr></thead>
                  <tbody>{parts.map((part:any)=>{
                    const supplier=suppliers.find((row:any)=>String(row.id)===String(part.supplier_id));
                    const unit=measureUnits.find((row:any)=>String(row.id)===String(part.measure_unit_id));
                    return <tr key={part.id} className="border-t border-slate-100">
                      <td className="p-3"><button type="button" onClick={()=>selectCatalogPart(String(part.id))} className="text-left font-bold text-sky-800 hover:underline">{part.name||part.description||"Peça"}<span className="block text-xs font-normal text-slate-500">{part.sku||"Sem SKU"}</span></button></td>
                      <td className="p-3">{supplier?.name||<span className="font-semibold text-amber-700">Vincular</span>}</td>
                      <td className="p-3">{unit?.symbol||unit?.code||<span className="font-semibold text-amber-700">Definir</span>}</td>
                      <td className="p-3">{money(part.cost_cents)}</td>
                      <td className="p-3 font-bold">{Number(part.stock_quantity||0).toLocaleString("pt-BR")} {unit?.symbol||""}</td>
                    </tr>;
                  })}</tbody>
                </table>
                {!parts.length && <p className="p-5 text-sm text-slate-500">Nenhuma peça cadastrada ainda.</p>}
              </div>
            </div>
          </section>

          <section className="mb-5 overflow-hidden rounded-2xl border border-sky-200 bg-white p-5 shadow-sm">
            <div className="mb-4">
              <p className="text-xs font-black uppercase tracking-wider text-sky-700">Controle físico de materiais</p>
              <h2 className="mt-1 text-lg font-black">Estoque central e estoque dos técnicos</h2>
              <p className="mt-1 text-xs text-slate-500">Transferir reduz o saldo central e cria saldo sob custódia do técnico. O consumo no atendimento baixa o veículo e registra o custo da OS.</p>
            </div>
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-semibold text-slate-500">Peças no catálogo</p><p className="text-2xl font-black">{parts.length}</p></div>
              <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-semibold text-slate-500">Saldo físico central</p><p className="text-2xl font-black">{parts.reduce((sum:number,part:any)=>sum+Number(part.stock_quantity||0),0).toLocaleString("pt-BR")}</p></div>
              <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-semibold text-slate-500">Saldos em veículos</p><p className="text-2xl font-black">{carStock.reduce((sum:number,row:any)=>sum+Number(row.quantity||0),0).toLocaleString("pt-BR")}</p></div>
            </div>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
              <div className="overflow-x-auto rounded-xl border border-slate-100">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Material</th><th className="p-3">Saldo físico</th><th className="p-3">Reservado</th><th className="p-3">Disponível</th><th className="p-3">Custo médio</th></tr></thead>
                  <tbody>{parts.map((part:any)=>{
                    const unit=measureUnits.find((row:any)=>String(row.id)===String(part.measure_unit_id));
                    const physical=Number(part.stock_quantity||0),reserved=Number(part.reserved_quantity||0);
                    return <tr key={part.id} className="border-t border-slate-100">
                      <td className="p-3"><strong>{part.name||part.description||"Peça"}</strong><span className="block text-xs text-slate-500">{part.sku||"Sem SKU"}</span></td>
                      <td className="p-3">{physical.toLocaleString("pt-BR")} {unit?.symbol||""}</td>
                      <td className="p-3">{reserved.toLocaleString("pt-BR")}</td>
                      <td className="p-3 font-bold">{Math.max(0,physical-reserved).toLocaleString("pt-BR")}</td>
                      <td className="p-3">{money(part.cost_cents)}</td>
                    </tr>;
                  })}</tbody>
                </table>
              </div>
              <form onSubmit={transferStockToTechnician} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <h3 className="font-black">Transferir para veículo</h3>
                <p className="mt-1 text-xs text-slate-500">Somente saldo livre pode ser transferido. A operação fica registrada no histórico.</p>
                <label className="mt-3 block text-xs font-bold text-slate-600">Técnico responsável *
                  <select required value={transferEmployeeId} onChange={e=>setTransferEmployeeId(e.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm">
                    <option value="">Selecione técnico</option>{employees.map((employee:any)=><option key={employee.id} value={employee.id}>{employee.full_name}</option>)}
                  </select>
                </label>
                <label className="mt-2 block text-xs font-bold text-slate-600">Peça / insumo *
                  <select required value={transferPartId} onChange={e=>setTransferPartId(e.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm">
                    <option value="">Selecione material</option>{parts.filter((part:any)=>Number(part.stock_quantity||0)-Number(part.reserved_quantity||0)>0).map((part:any)=><option key={part.id} value={part.id}>{part.sku||part.name} · livre {Number(part.stock_quantity||0)-Number(part.reserved_quantity||0)}</option>)}
                  </select>
                </label>
                <label className="mt-2 block text-xs font-bold text-slate-600">Veículo / identificação
                  <input value={transferVehicleLabel} onChange={e=>setTransferVehicleLabel(e.target.value)} maxLength={120} placeholder="Placa ou nome do veículo" className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"/>
                </label>
                <label className="mt-2 block text-xs font-bold text-slate-600">Quantidade *
                  <input required type="number" min="0.001" step="0.001" value={transferQuantity} onChange={e=>setTransferQuantity(e.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"/>
                </label>
                <button disabled={busy||!employees.length||!parts.some((part:any)=>Number(part.stock_quantity||0)-Number(part.reserved_quantity||0)>0)} className="mt-4 min-h-10 w-full rounded-lg bg-sky-700 px-3 text-sm font-black text-white disabled:opacity-40">{busy?"Transferindo...":"Confirmar transferência"}</button>
              </form>
            </div>
            <div className="mt-5 overflow-x-auto rounded-xl border border-slate-100">
              <div className="border-b border-slate-100 p-3"><h3 className="font-black">Materiais sob custódia dos técnicos</h3></div>
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Técnico</th><th className="p-3">Veículo</th><th className="p-3">Material</th><th className="p-3">Quantidade</th><th className="p-3">Custo unitário</th></tr></thead>
                <tbody>{carStock.map((row:any)=>{
                  const employee=employees.find((entry:any)=>String(entry.id)===String(row.employee_id));
                  const part=parts.find((entry:any)=>String(entry.id)===String(row.part_id));
                  const unit=measureUnits.find((entry:any)=>String(entry.id)===String(part?.measure_unit_id));
                  return <tr key={row.id} className="border-t border-slate-100">
                    <td className="p-3 font-semibold">{employee?.full_name||"Técnico"}</td><td className="p-3">{row.vehicle_label||"Veículo"}</td>
                    <td className="p-3">{part?.name||part?.sku||"Peça"}</td><td className="p-3 font-bold">{Number(row.quantity||0).toLocaleString("pt-BR")} {unit?.symbol||""}</td><td className="p-3">{money(row.unit_cost_cents)}</td>
                  </tr>;
                })}</tbody>
              </table>
              {!carStock.length && <p className="p-4 text-sm text-slate-500">Nenhum material transferido para veículos ainda.</p>}
            </div>
          </section>

          <section className="mb-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <form onSubmit={linkOrderCostCenter} className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="text-lg font-black">Vincular centro de custo à OS</h2>
              <p className="mt-1 text-xs text-slate-500">Defina a classificação operacional antes do consumo de peças do carro ou gás.</p>
              <label className="mt-3 block text-xs font-bold text-slate-600">Ordem de serviço
                <select required value={costCenterWorkOrderId} onChange={e=>setCostCenterWorkOrderId(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm">
                  <option value="">Selecione a OS</option>
                  {workOrders.map((order:any)=><option key={order.id} value={order.id}>{order.protocol||order.id} · {order.status}</option>)}
                </select>
              </label>
              <label className="mt-3 block text-xs font-bold text-slate-600">Centro de custo
                <select required value={costCenterWorkOrderValue} onChange={e=>setCostCenterWorkOrderValue(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm">
                  <option value="">Selecione o centro de custo</option>
                  {costCenters.map((center:any)=><option key={center.id} value={center.id}>{center.code} · {center.name}</option>)}
                </select>
              </label>
              <button disabled={busy||!workOrders.length||!costCenters.length} className="mt-4 min-h-11 w-full rounded-xl bg-sky-700 px-4 text-sm font-black text-white disabled:opacity-50">Vincular à OS</button>
            </form>
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-black">Cilindros sob custódia</h2><span className="text-xs text-slate-500">{gasCylinders.length} cadastrados</span></div>
              <p className="mt-1 text-xs text-slate-500">Peso líquido = peso bruto atual menos tara. A pesagem na OS atualiza o saldo do cilindro.</p>
              {gasCylinders.length ? <div className="mt-3 space-y-2">
                {gasCylinders.map((cylinder:any)=>{
                  const employee=employees.find((entry:any)=>String(entry.id)===String(cylinder.employee_id));
                  const tare=Number(cylinder.tare_weight_kg),gross=Number(cylinder.current_gross_weight_kg);
                  return <div key={cylinder.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm">
                    <div className="flex flex-wrap justify-between gap-2"><strong>{cylinder.refrigerant_type} · Série {cylinder.serial_number}</strong><span className="text-xs text-slate-500">{employee?.full_name||"Técnico"} · {cylinder.vehicle_label||"Veículo não informado"}</span></div>
                    <p className="mt-1 text-xs text-slate-600">Tara {Number.isFinite(tare)?tare.toFixed(3):"—"} kg · Bruto {Number.isFinite(gross)?gross.toFixed(3):"—"} kg · Líquido {Number.isFinite(gross)&&Number.isFinite(tare)?Math.max(gross-tare,0).toFixed(3):"—"} kg</p>
                    <p className="text-xs text-slate-600">{cylinder.remaining_charges}/{cylinder.total_charges} cargas restantes · {cylinder.status}</p>
                    {(!Number.isFinite(tare)||!Number.isFinite(gross)) && <button type="button" disabled={busy} onClick={()=>void initializeExistingCylinderWeights(cylinder)} className="mt-2 min-h-9 rounded-lg border border-amber-300 bg-amber-50 px-3 text-xs font-bold text-amber-900 disabled:opacity-50">Registrar tara e pesagem inicial</button>}
                  </div>;
                })}
              </div> : <p className="mt-3 text-sm text-slate-500">Nenhum cilindro cadastrado.</p>}
            </div>
          </section>
          <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-5">
            <div className="mb-3"><h2 className="text-lg font-black">Cadastrar / atribuir cilindro de gás</h2><p className="mt-1 text-xs text-slate-500">Atribuição somente pela gestão. Informe tara e peso bruto inicial para habilitar consumo pesado na OS.</p></div>
            <form onSubmit={assignWeightedGasCylinder} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-xs font-bold text-slate-600">Número de série *<input required value={gasSerialNumber} onChange={e=>setGasSerialNumber(e.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"/></label>
              <label className="text-xs font-bold text-slate-600">Refrigerante *<select required value={gasType} onChange={e=>setGasType(e.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"><option>R410A</option><option>R32</option><option>R22</option><option>R134a</option><option>R404A</option><option>R407C</option><option>Outro</option></select></label>
              <label className="text-xs font-bold text-slate-600">Técnico / responsável *<select required value={gasEmployeeId} onChange={e=>setGasEmployeeId(e.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"><option value="">Selecione técnico</option>{employees.map((employee:any)=><option key={employee.id} value={employee.id}>{employee.full_name}</option>)}</select></label>
              <label className="text-xs font-bold text-slate-600">Veículo<input value={gasVehicleLabel} onChange={e=>setGasVehicleLabel(e.target.value)} placeholder="Veículo / placa" className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"/></label>
              <label className="text-xs font-bold text-slate-600">Total de cargas *<input required type="number" min="1" step="1" value={gasTotalCharges} onChange={e=>setGasTotalCharges(e.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"/></label>
              <label className="text-xs font-bold text-slate-600">Tara do vasilhame (kg) *<input required type="number" min="0" step="0.001" value={gasTareWeight} onChange={e=>setGasTareWeight(e.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"/></label>
              <label className="text-xs font-bold text-slate-600">Peso bruto inicial (kg) *<input required type="number" min="0.001" step="0.001" value={gasInitialGrossWeight} onChange={e=>setGasInitialGrossWeight(e.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"/></label>
              <div className="flex items-end"><button disabled={busy||!employees.length} className="min-h-10 w-full rounded-lg bg-sky-700 px-3 text-sm font-bold text-white disabled:opacity-50">Atribuir cilindro</button></div>
            </form>
          </section>
          </>}
          {moduleSection === "purchases" && <>
          <section className="mb-5 rounded-2xl border border-sky-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-wider text-sky-700">Fluxo de suprimentos</p>
                <h2 className="mt-1 text-lg font-black">Nova compra / pedido ao fornecedor</h2>
                <p className="mt-1 text-sm text-slate-500">Registre o preço cotado, fornecedor, peças e centro de custo. O pedido segue ao DBS Treasury para aprovação; o estoque só entra após o recebimento físico.</p>
              </div>
              {quoteImport.quoteId && <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-bold text-sky-800">Origem: cotação {quoteImport.quoteId}</span>}
              {quoteImport.quoteId && quotePurchase.isLoading && <p role="status" className="w-full rounded-lg bg-sky-50 p-3 text-xs text-sky-800">Importando peças relacionais da cotação…</p>}
              {quoteImport.quoteId && quotePurchase.error && <p role="alert" className="w-full rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">Não foi possível importar as peças desta cotação: {quotePurchase.error instanceof Error ? quotePurchase.error.message : "Falha ao consultar a cotação."}</p>}
              {quoteImport.quoteId && quotePurchase.data && !quotePurchase.data.items.length && <p role="alert" className="w-full rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">Esta cotação não possui peças do catálogo relacional. Adicione as peças manualmente antes de registrar o pedido.</p>}
            </div>
            <form onSubmit={submitPurchase} className="grid gap-4">
              <div className="grid gap-3 md:grid-cols-3">
                <label className="text-xs font-bold text-slate-600">Fornecedor cadastrado *
                  <select required value={supplierId} onChange={e=>setSupplierId(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm">
                    <option value="">Selecione o fornecedor</option>
                    {suppliers.map((supplier:any)=><option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                  </select>
                </label>
                <label className="text-xs font-bold text-slate-600">Centro de custo *
                  <select required value={costCenterId} onChange={e=>setCostCenterId(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm">
                    <option value="">Selecione o centro de custo</option>
                    {costCenters.map((center:any)=><option key={center.id} value={center.id}>{center.code} · {center.name}</option>)}
                  </select>
                </label>
                <label className="text-xs font-bold text-slate-600">Nº da cotação / documento
                  <input maxLength={100} value={purchaseDocument} onChange={e => setPurchaseDocument(e.target.value)} placeholder="Referência do fornecedor" className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
                </label>
                <label className="text-xs font-bold text-slate-600">Data da compra *
                  <input type="date" required value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" />
                </label>
              </div>
              <p className="text-xs text-slate-500">As compras usam fornecedores e centros de custo relacionais. O custo é convertido para a unidade-base da peça antes de atualizar o estoque.</p>
              <div className="overflow-x-auto rounded-xl border border-slate-100">
                <table className="w-full min-w-[1080px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Peça relacional</th><th className="p-3">Unidade da compra</th><th className="p-3">Qtd.</th><th className="p-3">Custo unitário (R$)</th><th className="p-3">Conversão</th><th className="p-3">Total</th><th className="p-3"> </th></tr></thead>
                  <tbody>{purchaseLines.map((line, index) => {
                    const part = parts.find((entry: any) => String(entry.id) === line.partId);
                    const factor = conversionFor(line.partId,line.purchaseUnitId);
                    const lineTotal = Number(line.quantity || 0) * Number(line.unitCost || 0);
                    const purchaseUnit = measureUnits.find((u:any)=>String(u.id)===line.purchaseUnitId);
                    const baseUnit = measureUnits.find((u:any)=>String(u.id)===String(part?.measure_unit_id));
                    return <tr key={index} className="border-t border-slate-100">
                      <td className="p-2">
                        <select required value={line.partId} onChange={e => {
                          const selected = parts.find((entry: any) => String(entry.id) === e.target.value);
                          const baseUnitId=String(selected?.measure_unit_id||"");
                          updatePurchaseLine(index,{partId:e.target.value,description:String(selected?.name||selected?.description||""),purchaseUnitId:baseUnitId,conversionFactor:baseUnitId?1:0});
                        }} className="min-h-10 w-full rounded-lg border border-slate-200 px-2 text-sm">
                          <option value="">Selecione a peça cadastrada</option>
                          {parts.filter((entry:any)=>String(entry.status||"ativo").toLowerCase()!=="inativo").map((entry:any)=><option key={entry.id} value={entry.id}>{entry.sku ? entry.sku+" · " : ""}{entry.name||entry.description||entry.id}</option>)}
                        </select>
                        {line.description && <p className="mt-1 text-xs text-slate-500">{line.description}</p>}
                        {part && !part.measure_unit_id && <p className="mt-1 text-xs font-bold text-rose-700">Cadastre a unidade-base da peça antes de comprar.</p>}
                      </td>
                      <td className="p-2">
                        <select required value={line.purchaseUnitId} disabled={!part} onChange={e=>updatePurchaseLine(index,{purchaseUnitId:e.target.value,conversionFactor:conversionFor(line.partId,e.target.value)})} className="min-h-10 w-full rounded-lg border border-slate-200 px-2 text-sm">
                          <option value="">Unidade</option>
                          {measureUnits.map((u:any)=><option key={u.id} value={u.id}>{u.code} · {u.name}</option>)}
                        </select>
                      </td>
                      <td className="p-2"><input aria-label="Quantidade na unidade de compra" type="number" min="0.001" step="0.001" required value={line.quantity} onChange={e=>updatePurchaseLine(index,{quantity:e.target.value})} className="min-h-10 w-24 rounded-lg border border-slate-200 px-2"/></td>
                      <td className="p-2"><input aria-label="Custo unitário na unidade de compra em reais" type="number" min="0.01" step="0.01" required value={line.unitCost} onChange={e=>updatePurchaseLine(index,{unitCost:e.target.value})} placeholder="0,00" className="min-h-10 w-36 rounded-lg border border-slate-200 px-2"/></td>
                      <td className="p-2 whitespace-nowrap text-xs">{factor>0 ? ("1 "+String(purchaseUnit?.symbol||"")+" = "+String(factor)+" "+String(baseUnit?.symbol||"")) : <span className="font-bold text-rose-700">Sem conversão ativa</span>}</td>
                      <td className="p-2 whitespace-nowrap font-bold">{money(Math.round(lineTotal*100))}</td>
                      <td className="p-2"><button type="button" disabled={purchaseLines.length===1} onClick={()=>setPurchaseLines(current=>current.filter((_,i)=>i!==index))} className="rounded-lg border border-rose-200 px-2 py-2 text-xs font-bold text-rose-700 disabled:opacity-30">Remover</button></td>
                    </tr>;
                  })}</tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button type="button" onClick={() => setPurchaseLines(current => [...current, { partId:"", description:"", quantity:"1", unitCost:"", purchaseUnitId:"", conversionFactor:0 }])} className="min-h-10 rounded-xl border border-slate-200 px-4 text-sm font-bold">+ Adicionar peça</button>
                <div className="text-right"><p className="text-xs font-bold text-slate-500">Total estimado da compra</p><p className="text-xl font-black">{money(Math.round(purchaseLines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unitCost || 0), 0) * 100))}</p></div>
                <button disabled={busy || !parts.length} className="min-h-11 rounded-xl bg-sky-700 px-5 py-2 text-sm font-black text-white disabled:opacity-50">{busy ? "Registrando..." : "Enviar pedido para aprovação financeira"}</button>
              </div>
            </form>
          </section>

          <section className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5">
              <div>
                <h2 className="text-lg font-black">Pedidos e recebimento físico</h2>
                <p className="mt-1 text-sm text-slate-500">Acompanhe a liberação e confira as quantidades recebidas. Nenhum pagamento é feito nesta tela.</p>
              </div>
              <Link to="/treasury" className="min-h-10 rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-xs font-black text-sky-800 hover:bg-sky-100">Abrir Financeiro / DBS Treasury</Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>
                  <th className="p-3">Fornecedor</th><th className="p-3">Documento / cotação</th><th className="p-3">Data</th><th className="p-3">Total do pedido</th><th className="p-3">Análise financeira</th><th className="p-3">Recebimento físico</th>
                </tr></thead>
                <tbody>{(data?.purchases ?? []).map((purchase: any) => {
                  const lines = (data?.purchaseItems ?? []).filter((item: any) => String(item.purchase_id) === String(purchase.id));
                  const outstanding = lines.filter((item: any) => Number(item.quantity) > Number(item.quantity_received ?? 0));
                  const selected = outstanding.filter((item: any) => Number(purchaseReceiptQuantities[item.id] ?? 0) > 0);
                  const overReceived = selected.some((item: any) => Number(purchaseReceiptQuantities[item.id]) > Number(item.quantity) - Number(item.quantity_received ?? 0));
                  const approval = purchase.approval_status;
                  return <tr key={purchase.id} className="border-t border-slate-100 align-top">
                    <td className="p-3 font-bold">{suppliers.find((x:any)=>String(x.id)===String(purchase.supplier_id))?.name || purchase.supplier_name}</td>
                    <td className="p-3">{purchase.document_number || "—"}</td>
                    <td className="p-3 whitespace-nowrap">{purchase.purchase_date ? new Date(purchase.purchase_date + "T12:00:00").toLocaleDateString("pt-BR") : "—"}</td>
                    <td className="p-3 font-bold">{money(purchase.total_cents)}</td>
                    <td className="p-3">
                      {approval === "approved" ? <span className="font-bold text-emerald-700">Aprovada no Financeiro</span> :
                        approval === "rejected" ? <div className="max-w-56 text-rose-700"><span className="font-bold">Rejeitada</span>{purchase.rejection_reason && <p className="mt-1 text-xs">{purchase.rejection_reason}</p>}</div> :
                        approval === "legacy_received" ? <span className="font-semibold text-slate-500">Registro anterior</span> :
                        <span className="font-bold text-amber-700">Aguardando DBS Treasury</span>}
                    </td>
                    <td className="p-3">
                      {purchase.status === "received" ? <span className="font-bold text-emerald-700">Recebimento completo</span> :
                        approval !== "approved" ? <span className="text-xs text-slate-500">Liberado após aprovação no Financeiro</span> :
                        !lines.length ? <span className="text-xs text-rose-700">Pedido sem itens cadastrados</span> :
                        !outstanding.length ? <span className="font-bold text-emerald-700">Todos os itens conferidos</span> :
                        <details className="min-w-72">
                          <summary className="min-h-9 cursor-pointer rounded-lg bg-sky-700 px-3 py-2 text-center text-xs font-black text-white">
                            Conferir {outstanding.length} item(ns) pendente(s)
                          </summary>
                          <div className="mt-2 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                            {outstanding.map((item: any) => {
                              const part = parts.find((entry: any) => String(entry.id) === String(item.part_id));
                              const remaining = Math.max(0, Number(item.quantity) - Number(item.quantity_received ?? 0));
                              return <label key={item.id} className="block text-xs font-semibold text-slate-700">
                                <span className="block">{part?.sku ? part.sku + " · " : ""}{part?.name || part?.description || "Peça"}</span>
                                <span className="mt-1 block font-normal text-slate-500">Pedido: {Number(item.quantity).toLocaleString("pt-BR")} · Recebido: {Number(item.quantity_received ?? 0).toLocaleString("pt-BR")} · Falta: {remaining.toLocaleString("pt-BR")}</span>
                                <input aria-label={"Quantidade recebida de " + (part?.name || part?.sku || item.id)} type="number" min="0.001" max={remaining} step="0.001" value={purchaseReceiptQuantities[item.id] ?? ""} onChange={e => setPurchaseReceiptQuantities(prev => ({ ...prev, [item.id]: e.target.value }))} placeholder={"Conferido agora (máx. " + remaining + ")"} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"/>
                              </label>;
                            })}
                            <button type="button" disabled={busy || !selected.length || overReceived} onClick={async () => {
                              const saved = await runAction(() => receiveDbsPurchaseItems({ data: {
                                purchaseId: purchase.id,
                                idempotencyKey: "purchase-receive:" + purchase.id + ":" + crypto.randomUUID(),
                                items: selected.map((item: any) => ({
                                  purchaseItemId: item.id,
                                  quantityReceived: Number(purchaseReceiptQuantities[item.id]),
                                })),
                              } }), "Recebimento físico registrado. O estoque e o custo médio foram atualizados; a parte financeira permanece no DBS Treasury.");
                              if (saved) setPurchaseReceiptQuantities(prev => {
                                const next = { ...prev };
                                for (const item of selected) delete next[item.id];
                                return next;
                              });
                            }} className="min-h-10 w-full rounded-lg bg-emerald-700 px-3 text-xs font-black text-white disabled:opacity-40">Confirmar quantidades recebidas</button>
                            {overReceived && <p className="text-xs font-bold text-rose-700">A quantidade não pode ultrapassar o saldo pendente do pedido.</p>}
                          </div>
                        </details>}
                      {purchase.status === "partially_received" && <p className="mt-1 text-xs font-semibold text-amber-700">Recebimento parcial · {money(purchase.received_total_cents ?? 0)} em materiais recebidos</p>}
                    </td>
                  </tr>;
                })}</tbody>
              </table>
              {!(data?.purchases ?? []).length && <p className="p-5 text-sm text-slate-500">Nenhum pedido de compra registrado neste escopo.</p>}
            </div>
          </section>
          </>}
          {moduleSection === "parts" && <>
          <section className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 p-5">
              <h2 className="text-lg font-black">Histórico imutável de movimentações</h2>
              <p className="mt-1 text-sm text-slate-500">Movimentos não podem ser editados ou apagados. Correções elegíveis são registradas por estorno, com motivo e contrapartida no Ledger.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>
                  <th className="p-3">Data</th><th className="p-3">Peça</th><th className="p-3">Tipo</th><th className="p-3">Quantidade</th><th className="p-3">Saldo após</th><th className="p-3">Correção</th>
                </tr></thead>
                <tbody>{(data?.inventoryMovements ?? []).map((movement: any) => {
                  const part = parts.find((entry: any) => String(entry.id) === String(movement.part_id));
                  const movements = data?.inventoryMovements ?? [];
                  const alreadyReversed = movements.some((entry: any) => entry.reversal_of_movement_id === movement.id);
                  const canReverse = ["receipt", "consume", "return", "adjustment"].includes(String(movement.movement_type))
                    && !movement.work_order_id && !movement.work_order_part_id
                    && !movement.reversal_of_movement_id && !alreadyReversed;
                  const reason = String(movementReversalReasons[movement.id] ?? "");
                  return <tr key={movement.id} className="border-t border-slate-100">
                    <td className="p-3 whitespace-nowrap">{movement.created_at ? new Date(movement.created_at).toLocaleString("pt-BR") : "—"}</td>
                    <td className="p-3 font-semibold">{part?.name ?? part?.sku ?? movement.part_id}</td>
                    <td className="p-3">{movement.movement_type === "reversal" ? "Estorno" : movement.movement_type}</td>
                    <td className="p-3">{Number(movement.quantity_delta).toLocaleString("pt-BR")}</td>
                    <td className="p-3">{Number(movement.balance_after).toLocaleString("pt-BR")}</td>
                    <td className="p-3">
                      {movement.reversal_of_movement_id ? <span className="text-xs font-bold text-emerald-700">Estorno rastreado</span> :
                        alreadyReversed ? <span className="text-xs font-bold text-slate-500">Já estornado</span> :
                        canReverse ? <div className="flex min-w-64 flex-col gap-2">
                          <input aria-label="Motivo do estorno" maxLength={1000} value={reason} onChange={e => setMovementReversalReasons(prev => ({ ...prev, [movement.id]: e.target.value }))} placeholder="Motivo obrigatório (mín. 5 caracteres)" className="min-h-9 rounded-lg border border-slate-200 px-2 text-xs" />
                          <button type="button" disabled={busy || reason.trim().length < 5} onClick={() => void runAction(() => reverseDbsInventoryMovement({ data: {
                            movementId: movement.id,
                            idempotencyKey: "inventory-reversal:" + movement.id + ":" + crypto.randomUUID(),
                            reason,
                          } }), "Estorno registrado no histórico e no Ledger.")} className="min-h-9 rounded-lg bg-amber-700 px-3 text-xs font-black text-white disabled:opacity-40">Registrar estorno</button>
                        </div> : <span className="text-xs text-slate-500">Correção pelo fluxo vinculado</span>}
                    </td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
          </section>
          <section className="grid gap-5 lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.5fr)]">
            <form onSubmit={reserveParts} className="h-fit rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="text-lg font-black">Reservar peças para OS</h2>
              <label className="mt-4 block text-xs font-bold text-slate-600">Ordem de serviço</label>
              <select required value={workOrderId} onChange={e => setWorkOrderId(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm">
                <option value="">Selecione uma OS</option>
                {workOrders.map((order: any) => <option key={order.id} value={order.id}>{order.protocol ?? order.id} · {order.status}</option>)}
              </select>
              <label className="mt-3 block text-xs font-bold text-slate-600">Centro de custo da OS *</label>
              <select required value={costCenterId} onChange={e=>setCostCenterId(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm">
                <option value="">Selecione o centro de custo</option>
                {costCenters.map((center:any)=><option key={center.id} value={center.id}>{center.code} · {center.name}</option>)}
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
          </section>
          </>}
        </>}
      </div>
    </main>
  );
}