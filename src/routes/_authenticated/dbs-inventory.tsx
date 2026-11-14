import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { decideDbsPurchaseApprovalFromTreasury } from "@/lib/treasury.functions";
import {
  createDbsPurchase, createDbsSupplier, createDbsMeasureUnit, createDbsUnitConversion,
  getDbsPhase2InventoryOverview, getDbsQuotePurchaseItems, releaseDbsWorkOrderReservation,
  reserveDbsWorkOrderParts, setDbsWorkOrderCostCenter, receiveDbsPurchaseItems,
  reverseDbsInventoryMovement, createDbsCostCenter, createDbsPartCatalog,
  updateDbsPartCatalog, transferDbsStockToTechnician,
} from "@/lib/dbs-control.functions";

export const Route = createFileRoute("/_authenticated/dbs-inventory")({
  validateSearch: (search: Record<string, unknown>): { section: DbsInventorySection; quote_id?: string } => ({
    section: search.section === "purchases" ? "purchases" : "parts",
    quote_id: typeof search.quote_id === "string" && search.quote_id ? search.quote_id : undefined,
  }),
  component: DbsInventoryRoute,
});

function DbsInventoryRoute() {
  const search = Route.useSearch();
  return <DbsInventoryPage initialSection={search.section} initialQuoteId={search.quote_id} />;
}

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
  type PartsView = "catalog" | "stock" | "reservations" | "settings";
  type PurchasesView = "new" | "approval" | "orders";
  const [partsView, setPartsView] = useState<PartsView>("catalog");
  const [purchasesView, setPurchasesView] = useState<PurchasesView>("new");
  useEffect(() => {
    setModuleSection(initialSection);
  }, [initialSection]);
  const [partId, setPartId] = useState("");
  const [workOrderId, setWorkOrderId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [purchaseReceiptQuantities, setPurchaseReceiptQuantities] = useState<Record<string, string>>({});
  const [movementReversalReasons, setMovementReversalReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [purchaseApprovalBusyId, setPurchaseApprovalBusyId] = useState<string | null>(null);
  const [purchaseRejectionReasons, setPurchaseRejectionReasons] = useState<Record<string, string>>({});

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
  const pendingPurchases = (data?.purchases ?? []).filter((purchase: any) =>
    purchase.approval_status === "pending" && purchase.status !== "cancelled"
  );
  const purchasesAwaitingReceipt = (data?.purchases ?? []).filter((purchase: any) =>
    purchase.approval_status === "approved" && purchase.status !== "received" && purchase.status !== "cancelled"
  );

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


  async function decidePurchaseApproval(purchase: any, decision: "approved" | "rejected") {
    const purchaseId = String(purchase.id ?? "");
    const reason = String(purchaseRejectionReasons[purchaseId] ?? "").trim();
    if (decision === "rejected" && reason.length < 5) {
      setMessage("Informe o motivo da rejeição com pelo menos 5 caracteres.");
      return;
    }
    setPurchaseApprovalBusyId(purchaseId);
    const saved = await runAction(() => decideDbsPurchaseApprovalFromTreasury({ data: {
      purchaseId,
      decision,
      reason: decision === "rejected" ? reason : undefined,
      expectedVersion: Number(purchase.version),
    } }), decision === "approved"
      ? "Compra aprovada. O compromisso foi lançado no DBS Treasury e o recebimento físico foi liberado."
      : "Compra rejeitada. O pedido foi bloqueado para recebimento.");
    if (saved) {
      setPurchaseRejectionReasons((current) => {
        const next = { ...current };
        delete next[purchaseId];
        return next;
      });
    }
    setPurchaseApprovalBusyId(null);
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
    <main className={embedded ? "min-h-full bg-[#f4f7fb] px-4 py-5 text-slate-900 sm:px-6 lg:px-7" : "min-h-[100dvh] bg-[#f4f7fb] px-4 py-5 text-slate-900 sm:px-6 lg:px-7"}>
      <div className="mx-auto max-w-7xl">
        <header className={embedded ? "mb-6 rounded-2xl border border-slate-200 bg-white px-5 py-5 shadow-sm sm:px-6" : "mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"}>
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-sky-700">DBS CONTROL · MATERIAIS E SUPRIMENTOS</p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">{moduleSection === "parts" ? "Peças & Estoque" : "Compras"}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{moduleSection === "parts"
              ? "Catálogo de materiais, saldo disponível, reservas, movimentações e custos vinculados às ordens de serviço."
              : "Pedidos a fornecedores, análise financeira e conferência do recebimento físico dos materiais."}</p>
          </div>
          {!embedded && <Link to="/dbs-control" className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition hover:border-sky-200 hover:bg-sky-50 hover:text-sky-800">← Voltar ao DBS CONTROL</Link>}
        </header>

        {!embedded && (
          <nav aria-label="Módulos de materiais" className="mb-6 flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
            <button type="button" aria-pressed={moduleSection === "parts"} onClick={() => setModuleSection("parts")} className={moduleSection === "parts" ? "min-h-11 rounded-xl bg-[#0f4f91] px-5 text-sm font-black text-white shadow-sm" : "min-h-11 rounded-xl px-5 text-sm font-bold text-slate-600 transition hover:bg-slate-50"}>Peças & Estoque</button>
            <button type="button" aria-pressed={moduleSection === "purchases"} onClick={() => setModuleSection("purchases")} className={moduleSection === "purchases" ? "min-h-11 rounded-xl bg-[#0f4f91] px-5 text-sm font-black text-white shadow-sm" : "min-h-11 rounded-xl px-5 text-sm font-bold text-slate-600 transition hover:bg-slate-50"}>Compras</button>
            <span className="ml-auto hidden self-center px-2 text-xs font-medium text-slate-500 sm:block">Estoque · suprimentos · DBS Treasury</span>
          </nav>
        )}

        {moduleSection === "parts" && (
          <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4" aria-label="Áreas de Peças e Estoque">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.14em] text-sky-700">PEÇAS & ESTOQUE</p>
                <h2 className="mt-0.5 text-base font-bold text-slate-900">O que você precisa fazer?</h2>
              </div>
              <span className="text-xs text-slate-500">Escolha uma área para continuar</span>
            </div>
            <nav className="grid grid-cols-2 gap-2 xl:grid-cols-4" aria-label="Tarefas de estoque">
              {([
                ["catalog", "Peças", "Cadastrar e localizar materiais", "01"],
                ["stock", "Estoque", "Saldos, transferências e cilindros", "02"],
                ["reservations", "Reservas para OS", "Separar material para atendimento", "03"],
                ["settings", "Cadastros básicos", "Fornecedores, unidades e custos", "04"],
              ] as const).map(([key, title, description, number]) => (
                <button key={key} type="button" aria-pressed={partsView === key} onClick={() => setPartsView(key)}
                  className={partsView === key
                    ? "flex min-h-[76px] items-center gap-3 rounded-xl border border-sky-700 bg-sky-50 px-3 py-3 text-left shadow-sm ring-1 ring-sky-100"
                    : "flex min-h-[76px] items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-left transition hover:border-sky-200 hover:bg-slate-50"}>
                  <span className={partsView === key ? "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#0f4f91] text-xs font-black text-white" : "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-black text-slate-500"}>{number}</span>
                  <span className="min-w-0">
                    <span className={partsView === key ? "block text-sm font-black text-sky-950" : "block text-sm font-bold text-slate-800"}>{title}</span>
                    <span className="mt-0.5 block text-[11px] leading-4 text-slate-500">{description}</span>
                  </span>
                </button>
              ))}
            </nav>
          </section>
        )}
        {message && <div role="status" className="mb-5 flex items-start gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm leading-6 text-sky-950 shadow-sm"><span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-sky-600" />{message}</div>}
        {overview.isLoading && <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm font-medium text-slate-500 shadow-sm">Carregando dados de materiais e compras...</div>}
        {overview.error && <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm leading-6 text-rose-800 shadow-sm">
          <p className="font-bold">Não foi possível carregar Peças & Estoque e Compras.</p>
          <p className="mt-1 break-words">{overview.error instanceof Error ? overview.error.message : "Falha ao carregar dados."}</p>
          <button type="button" onClick={() => { void overview.refetch(); }} className="mt-3 min-h-10 rounded-lg border border-rose-300 bg-white px-4 text-xs font-black text-rose-800">Tentar carregar novamente</button>
        </div>}

        {data && <>
          {moduleSection === "parts" && <>
          {partsView === "catalog" && <>
          <details className="mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 transition hover:bg-slate-50">
              <span className="min-w-0">
                <span className="block text-base font-black text-slate-900">Custos de materiais por ordem de serviço</span>
                <span className="mt-1 block text-sm font-normal text-slate-500">Relatório operacional por OS · consulte o custo registrado em cada atendimento</span>
              </span>
              <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700">Ver relatório</span>
            </summary>
            <section className="mb-0 overflow-hidden border-t border-slate-100 bg-white">
            <div className="border-b border-slate-100 p-5">
              <h2 className="text-lg font-black">Custo de materiais por ordem de serviço</h2>
              <p className="mt-1 text-sm text-slate-500">O DBS Control registra o custo operacional das peças consumidas e envia essa informação para o cálculo do Financeiro. Receita, lucro, contas a pagar e pagamentos são acompanhados exclusivamente no DBS Treasury.</p>
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">OS</th><th className="p-3">Registro</th><th className="p-3">Custo de materiais</th><th className="p-3">Atualizado em</th></tr></thead>
                <tbody>{workOrderFinancials.map((row: any) => {
                  const order = workOrders.find((entry: any) => String(entry.id) === String(row.work_order_id));
                  return <tr key={row.work_order_id} className="border-t border-slate-100 transition hover:bg-sky-50/40">
                    <td className="p-3 font-bold">{order?.protocol || String(row.work_order_id).slice(0, 8)}</td>
                    <td className="p-3">{row.status || "Registrado"}</td>
                    <td className="p-3 font-bold">{money(row.parts_cost_cents)}</td>
                    <td className="p-3">{row.updated_at ? new Date(row.updated_at).toLocaleString("pt-BR") : "—"}</td>
                  </tr>;
                })}</tbody>
              </table>
              {!workOrderFinancials.length && <p className="p-5 text-sm text-slate-500">Os custos aparecerão aqui quando materiais forem consumidos e vinculados às OS.</p>}
            </div>
            <div className="grid gap-2 p-3 md:hidden">
              {workOrderFinancials.map((row:any)=>{
                const order=workOrders.find((entry:any)=>String(entry.id)===String(row.work_order_id));
                return <article key={row.work_order_id} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-start justify-between gap-3"><div><p className="font-bold">{order?.protocol||String(row.work_order_id).slice(0,8)}</p><p className="text-xs text-slate-500">{row.status||"Registrado"}</p></div><p className="text-sm font-black">{money(row.parts_cost_cents)}</p></div>
                  <p className="mt-2 text-xs text-slate-500">Atualizado: {row.updated_at?new Date(row.updated_at).toLocaleString("pt-BR"):"—"}</p>
                </article>;
              })}
              {!workOrderFinancials.length&&<p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Os custos aparecerão aqui quando materiais forem consumidos e vinculados às OS.</p>}
            </div>
            </section>
          </details>
          <section aria-label="Resumo do estoque" className="mb-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm font-semibold text-slate-500">Peças cadastradas</p><p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{parts.length}</p><p className="mt-1 text-xs text-slate-500">Itens no catálogo relacional</p></div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm font-semibold text-slate-500">Reservas ativas</p><p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{reservations.filter((r: any) => r.status === "reserved").length}</p><p className="mt-1 text-xs text-slate-500">Separadas para ordens de serviço</p></div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm font-semibold text-slate-500">Unidades livres no estoque</p><p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{parts.reduce((total: number, part: any) => total + Math.max(0, Number(part.stock_quantity ?? 0) - Number(part.reserved_quantity ?? 0)), 0).toLocaleString("pt-BR")}</p><p className="mt-1 text-xs text-slate-500">Disponíveis para nova reserva</p></div>
          </section>

          </>}
          {partsView === "settings" && <>
          <details className="mb-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-4 transition hover:bg-slate-50 sm:px-5">
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2 text-base font-black text-slate-900">
                  Configurações de cadastro
                  {(!suppliers.length || !measureUnits.length || !costCenters.length) ? <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-800">Configuração pendente</span> : <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-800">Cadastros prontos</span>}
                </span>
                <span className="mt-1 block text-sm font-normal text-slate-500">{suppliers.length} fornecedores · {costCenters.length} centros de custo · {measureUnits.length} unidades · {unitConversions.length} conversões</span>
              </span>
              <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700">Gerenciar</span>
            </summary>
            <section className="grid gap-4 border-t border-slate-100 bg-slate-50/70 p-4 sm:p-5 sm:grid-cols-2 2xl:grid-cols-4">
            <form onSubmit={addSupplier} className="rounded-2xl border border-slate-200 bg-white p-4">
              <h2 className="font-black">Cadastro de fornecedor</h2>
              <p className="mt-1 text-xs text-slate-500">O fornecedor cadastrado é compartilhado pelo catálogo e por Compras.</p>
              <input required value={newSupplierName} onChange={e=>setNewSupplierName(e.target.value)} placeholder="Nome / razão social" className="mt-3 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"/>
              <input value={newSupplierCnpj} onChange={e=>setNewSupplierCnpj(e.target.value)} placeholder="CNPJ / CPF (opcional)" className="mt-2 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"/>
              <input value={newSupplierPhone} onChange={e=>setNewSupplierPhone(e.target.value)} placeholder="Telefone (opcional)" className="mt-2 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"/>
              <button disabled={busy} className="mt-3 min-h-10 w-full rounded-lg bg-sky-700 px-3 text-sm font-bold text-white">Cadastrar fornecedor</button>
            </form>
            <form onSubmit={addCostCenter} className="rounded-2xl border border-slate-200 bg-white p-4">
              <h2 className="font-black">Centro de custo</h2>
              <p className="mt-1 text-xs text-slate-500">Cadastre a classificação que será usada nas compras, OS e consumo.</p>
              <input required maxLength={40} value={newCostCenterCode} onChange={e=>setNewCostCenterCode(e.target.value.toUpperCase())} placeholder="Código (ex.: OPERACAO)" className="mt-3 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"/>
              <input required maxLength={180} value={newCostCenterName} onChange={e=>setNewCostCenterName(e.target.value)} placeholder="Nome do centro de custo" className="mt-2 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"/>
              <button disabled={busy} className="mt-3 min-h-10 w-full rounded-lg bg-sky-700 px-3 text-sm font-bold text-white">Salvar centro de custo</button>
            </form>
            <form onSubmit={addMeasureUnit} className="rounded-2xl border border-slate-200 bg-white p-4">
              <h2 className="font-black">Unidade de medida</h2>
              <p className="mt-1 text-xs text-slate-500">Cadastre unidades-base e unidades de compra (UN, CX, KG, L, M...).</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <input required value={newUnitCode} onChange={e=>setNewUnitCode(e.target.value.toUpperCase())} placeholder="Código (UN)" className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"/>
                <input required value={newUnitSymbol} onChange={e=>setNewUnitSymbol(e.target.value)} placeholder="Símbolo" className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"/>
              </div>
              <input required value={newUnitName} onChange={e=>setNewUnitName(e.target.value)} placeholder="Nome da unidade" className="mt-2 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"/>
              <button disabled={busy} className="mt-3 min-h-10 w-full rounded-lg bg-sky-700 px-3 text-sm font-bold text-white">Cadastrar unidade</button>
            </form>
            <form onSubmit={addUnitConversion} className="rounded-2xl border border-slate-200 bg-white p-4">
              <h2 className="font-black">Conversão de unidades</h2>
              <p className="mt-1 text-xs text-slate-500">Defina quantas unidades-base existem em uma unidade de compra.</p>
              <select required value={conversionFrom} onChange={e=>setConversionFrom(e.target.value)} className="mt-3 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"><option value="">Unidade de compra</option>{measureUnits.map((u:any)=><option key={u.id} value={u.id}>{u.code} · {u.name}</option>)}</select>
              <select required value={conversionTo} onChange={e=>setConversionTo(e.target.value)} className="mt-2 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"><option value="">Unidade-base</option>{measureUnits.map((u:any)=><option key={u.id} value={u.id}>{u.code} · {u.name}</option>)}</select>
              <input required type="number" min="0.0001" step="0.0001" value={conversionFactor} onChange={e=>setConversionFactor(e.target.value)} placeholder="Fator (ex.: 12)" className="mt-2 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"/>
              <button disabled={busy} className="mt-3 min-h-10 w-full rounded-lg bg-sky-700 px-3 text-sm font-bold text-white">Salvar conversão</button>
            </form>
            </section>
          </>}
          {partsView === "catalog" && <>
          <section className="mb-6 grid gap-5 xl:grid-cols-[minmax(360px,0.9fr)_minmax(0,1.1fr)]">
            <form onSubmit={saveCatalogPart} className="rounded-2xl border border-sky-200/80 bg-white p-5 shadow-sm sm:p-6">
              <div className="mb-5 border-b border-slate-100 pb-4">
                <p className="text-[11px] font-black uppercase tracking-[0.14em] text-sky-700">CATÁLOGO RELACIONAL</p>
                <h2 className="mt-1 text-xl font-black tracking-tight text-slate-950">Cadastrar ou editar peça</h2>
                <p className="mt-2 text-sm leading-5 text-slate-500">Vincule o fornecedor e a unidade-base. O saldo é criado somente no recebimento físico.</p>
              </div>
              <label className="block text-xs font-bold text-slate-600">Editar peça existente ou cadastrar nova
                <select value={catalogPartId} onChange={e=>selectCatalogPart(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100">
                  <option value="">Nova peça / insumo</option>
                  {parts.map((part:any)=><option key={part.id} value={part.id}>{part.sku ? part.sku+" · " : ""}{part.name||part.description||part.id}</option>)}
                </select>
              </label>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-bold text-slate-600">SKU / código *
                  <input required maxLength={80} value={catalogPartSku} onChange={e=>setCatalogPartSku(e.target.value.toUpperCase())} className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"/>
                </label>
                <label className="text-xs font-bold text-slate-600">Nome da peça / insumo *
                  <input required maxLength={180} value={catalogPartName} onChange={e=>setCatalogPartName(e.target.value)} className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"/>
                </label>
                <label className="text-xs font-bold text-slate-600">Fornecedor *
                  <select required value={catalogPartSupplierId} onChange={e=>setCatalogPartSupplierId(e.target.value)} className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100">
                    <option value="">Selecione fornecedor</option>
                    {suppliers.map((supplier:any)=><option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                  </select>
                </label>
                <label className="text-xs font-bold text-slate-600">Unidade-base *
                  <select required value={catalogPartUnitId} onChange={e=>setCatalogPartUnitId(e.target.value)} className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100">
                    <option value="">Selecione unidade</option>
                    {measureUnits.map((unit:any)=><option key={unit.id} value={unit.id}>{unit.code} · {unit.name}</option>)}
                  </select>
                </label>
                <label className="text-xs font-bold text-slate-600">Custo de referência (R$)
                  <input type="number" min="0" step="0.01" value={catalogPartCost} onChange={e=>setCatalogPartCost(e.target.value)} className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"/>
                </label>
                <label className="text-xs font-bold text-slate-600">Preço de venda (R$)
                  <input type="number" min="0" step="0.01" value={catalogPartSale} onChange={e=>setCatalogPartSale(e.target.value)} className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"/>
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
              <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-100 p-5 sm:p-6">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.14em] text-sky-700">BASE DE MATERIAIS</p>
                  <h2 className="mt-1 text-xl font-black tracking-tight text-slate-950">Catálogo de peças e insumos</h2>
                  <p className="mt-1 text-sm text-slate-500">Selecione um item para editar seus dados.</p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700">{parts.length} {parts.length === 1 ? "item" : "itens"}</span>
              </div>
              <div className="hidden max-h-[520px] overflow-auto md:block">
                <table className="w-full min-w-[600px] text-left text-sm">
                  <thead className="sticky top-0 bg-slate-50/95 text-[11px] font-bold uppercase tracking-wide text-slate-500"><tr><th className="p-3">Peça / SKU</th><th className="p-3">Fornecedor</th><th className="p-3">Unidade</th><th className="p-3">Custo</th><th className="p-3">Saldo central</th></tr></thead>
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
              <div className="grid gap-2 p-3 md:hidden">
                {parts.map((part:any) => {
                  const supplier = suppliers.find((row:any)=>String(row.id)===String(part.supplier_id));
                  const unit = measureUnits.find((row:any)=>String(row.id)===String(part.measure_unit_id));
                  return <button key={part.id} type="button" onClick={()=>selectCatalogPart(String(part.id))} className="rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm">
                    <span className="block font-bold text-slate-900">{part.name||part.description||"Peça"}</span>
                    <span className="mt-0.5 block text-xs text-slate-500">{part.sku||"Sem SKU"} · Toque para editar</span>
                    <span className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600">
                      <span>Fornecedor: <strong>{supplier?.name||"Vincular"}</strong></span>
                      <span>Unidade: <strong>{unit?.symbol||unit?.code||"Definir"}</strong></span>
                      <span>Custo: <strong>{money(part.cost_cents)}</strong></span>
                      <span>Saldo: <strong>{Number(part.stock_quantity||0).toLocaleString("pt-BR")}</strong></span>
                    </span>
                  </button>;
                })}
                {!parts.length && <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Nenhuma peça cadastrada ainda.</p>}
              </div>
            </div>
          </>}
          {partsView === "stock" && <>
          <section className="mb-5 overflow-hidden rounded-2xl border border-sky-200 bg-white p-5 shadow-sm">
            <div className="mb-4">
              <p className="text-xs font-black uppercase tracking-wider text-sky-700">Controle físico de materiais</p>
              <h2 className="mt-1 text-xl font-black tracking-tight text-slate-950">Estoque central e estoque dos técnicos</h2>
              <p className="mt-1 text-xs text-slate-500">Transferir reduz o saldo central e cria saldo sob custódia do técnico. O consumo no atendimento baixa o veículo e registra o custo da OS.</p>
            </div>
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-semibold text-slate-500">Peças no catálogo</p><p className="text-2xl font-black">{parts.length}</p></div>
              <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-semibold text-slate-500">Saldo físico central</p><p className="text-2xl font-black">{parts.reduce((sum:number,part:any)=>sum+Number(part.stock_quantity||0),0).toLocaleString("pt-BR")}</p></div>
              <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-semibold text-slate-500">Saldos em veículos</p><p className="text-2xl font-black">{carStock.reduce((sum:number,row:any)=>sum+Number(row.quantity||0),0).toLocaleString("pt-BR")}</p></div>
            </div>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
              <div className="hidden overflow-x-auto rounded-xl border border-slate-100 md:block">
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
              <div className="grid gap-2 md:hidden">
                {parts.map((part:any) => {
                  const unit=measureUnits.find((row:any)=>String(row.id)===String(part.measure_unit_id));
                  const physical=Number(part.stock_quantity||0), reserved=Number(part.reserved_quantity||0);
                  return <article key={part.id} className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div><p className="font-bold text-slate-900">{part.name||part.description||"Peça"}</p><p className="text-xs text-slate-500">{part.sku||"Sem SKU"}</p></div>
                      <p className="text-right text-sm font-black text-sky-800">{Math.max(0,physical-reserved).toLocaleString("pt-BR")} <span className="text-xs font-medium">{unit?.symbol||""} livres</span></p>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-100 pt-2 text-xs">
                      <div><p className="text-slate-500">Físico</p><p className="font-bold">{physical.toLocaleString("pt-BR")}</p></div>
                      <div><p className="text-slate-500">Reservado</p><p className="font-bold">{reserved.toLocaleString("pt-BR")}</p></div>
                      <div><p className="text-slate-500">Custo médio</p><p className="font-bold">{money(part.cost_cents)}</p></div>
                    </div>
                  </article>;
                })}
              </div>
              <form onSubmit={transferStockToTechnician} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <h3 className="font-black">Transferir para veículo</h3>
                <p className="mt-1 text-xs text-slate-500">Somente saldo livre pode ser transferido. A operação fica registrada no histórico.</p>
                <label className="mt-3 block text-xs font-bold text-slate-600">Técnico responsável *
                  <select required value={transferEmployeeId} onChange={e=>setTransferEmployeeId(e.target.value)} className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100">
                    <option value="">Selecione técnico</option>{employees.map((employee:any)=><option key={employee.id} value={employee.id}>{employee.full_name}</option>)}
                  </select>
                </label>
                <label className="mt-2 block text-xs font-bold text-slate-600">Peça / insumo *
                  <select required value={transferPartId} onChange={e=>setTransferPartId(e.target.value)} className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100">
                    <option value="">Selecione material</option>{parts.filter((part:any)=>Number(part.stock_quantity||0)-Number(part.reserved_quantity||0)>0).map((part:any)=><option key={part.id} value={part.id}>{part.sku||part.name} · livre {Number(part.stock_quantity||0)-Number(part.reserved_quantity||0)}</option>)}
                  </select>
                </label>
                <label className="mt-2 block text-xs font-bold text-slate-600">Veículo / identificação
                  <input value={transferVehicleLabel} onChange={e=>setTransferVehicleLabel(e.target.value)} maxLength={120} placeholder="Placa ou nome do veículo" className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"/>
                </label>
                <label className="mt-2 block text-xs font-bold text-slate-600">Quantidade *
                  <input required type="number" min="0.001" step="0.001" value={transferQuantity} onChange={e=>setTransferQuantity(e.target.value)} className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"/>
                </label>
                <button disabled={busy||!employees.length||!parts.some((part:any)=>Number(part.stock_quantity||0)-Number(part.reserved_quantity||0)>0)} className="mt-4 min-h-10 w-full rounded-lg bg-sky-700 px-3 text-sm font-black text-white disabled:opacity-40">{busy?"Transferindo...":"Confirmar transferência"}</button>
              </form>
            </div>
            <div className="mt-5 overflow-hidden rounded-xl border border-slate-100">
              <div className="border-b border-slate-100 p-3"><h3 className="font-black">Materiais sob custódia dos técnicos</h3></div>
              <div className="hidden overflow-x-auto md:block">
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
              </div>
              <div className="grid gap-2 p-3 md:hidden">
                {carStock.map((row:any)=>{
                  const employee=employees.find((entry:any)=>String(entry.id)===String(row.employee_id));
                  const part=parts.find((entry:any)=>String(entry.id)===String(row.part_id));
                  const unit=measureUnits.find((entry:any)=>String(entry.id)===String(part?.measure_unit_id));
                  return <article key={row.id} className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="flex items-start justify-between gap-2"><div><p className="font-bold">{part?.name||part?.sku||"Peça"}</p><p className="text-xs text-slate-500">{employee?.full_name||"Técnico"} · {row.vehicle_label||"Veículo"}</p></div><p className="text-sm font-black">{Number(row.quantity||0).toLocaleString("pt-BR")} {unit?.symbol||""}</p></div>
                    <p className="mt-2 text-xs text-slate-500">Custo unitário: {money(row.unit_cost_cents)}</p>
                  </article>;
                })}
                {!carStock.length&&<p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Nenhum material transferido para veículos ainda.</p>}
              </div>
            </div>
          </section>

          <section className="mb-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <form onSubmit={linkOrderCostCenter} className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="text-lg font-black">Vincular centro de custo à OS</h2>
              <p className="mt-1 text-xs text-slate-500">Defina a classificação operacional antes do consumo de peças do carro ou gás.</p>
              <label className="mt-3 block text-xs font-bold text-slate-600">Ordem de serviço
                <select required value={costCenterWorkOrderId} onChange={e=>setCostCenterWorkOrderId(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100">
                  <option value="">Selecione a OS</option>
                  {workOrders.map((order:any)=><option key={order.id} value={order.id}>{order.protocol||order.id} · {order.status}</option>)}
                </select>
              </label>
              <label className="mt-3 block text-xs font-bold text-slate-600">Centro de custo
                <select required value={costCenterWorkOrderValue} onChange={e=>setCostCenterWorkOrderValue(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100">
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
              <label className="text-xs font-bold text-slate-600">Número de série *<input required value={gasSerialNumber} onChange={e=>setGasSerialNumber(e.target.value)} className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"/></label>
              <label className="text-xs font-bold text-slate-600">Refrigerante *<select required value={gasType} onChange={e=>setGasType(e.target.value)} className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"><option>R410A</option><option>R32</option><option>R22</option><option>R134a</option><option>R404A</option><option>R407C</option><option>Outro</option></select></label>
              <label className="text-xs font-bold text-slate-600">Técnico / responsável *<select required value={gasEmployeeId} onChange={e=>setGasEmployeeId(e.target.value)} className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"><option value="">Selecione técnico</option>{employees.map((employee:any)=><option key={employee.id} value={employee.id}>{employee.full_name}</option>)}</select></label>
              <label className="text-xs font-bold text-slate-600">Veículo<input value={gasVehicleLabel} onChange={e=>setGasVehicleLabel(e.target.value)} placeholder="Veículo / placa" className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"/></label>
              <label className="text-xs font-bold text-slate-600">Total de cargas *<input required type="number" min="1" step="1" value={gasTotalCharges} onChange={e=>setGasTotalCharges(e.target.value)} className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"/></label>
              <label className="text-xs font-bold text-slate-600">Tara do vasilhame (kg) *<input required type="number" min="0" step="0.001" value={gasTareWeight} onChange={e=>setGasTareWeight(e.target.value)} className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"/></label>
              <label className="text-xs font-bold text-slate-600">Peso bruto inicial (kg) *<input required type="number" min="0.001" step="0.001" value={gasInitialGrossWeight} onChange={e=>setGasInitialGrossWeight(e.target.value)} className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"/></label>
              <div className="flex items-end"><button disabled={busy||!employees.length} className="min-h-10 w-full rounded-lg bg-sky-700 px-3 text-sm font-bold text-white disabled:opacity-50">Atribuir cilindro</button></div>
            </form>
          </section>
          </>}
          </>}
          {moduleSection === "purchases" && <>
          <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4" aria-label="Etapas de compras">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.14em] text-sky-700">COMPRAS</p>
                <h2 className="mt-0.5 text-base font-bold text-slate-900">Em que etapa está o pedido?</h2>
              </div>
              <span className="text-xs text-slate-500">Do pedido ao recebimento</span>
            </div>
            <nav className="grid gap-2 md:grid-cols-3" aria-label="Etapas da compra">
              <button type="button" aria-pressed={purchasesView === "new"} onClick={() => setPurchasesView("new")}
                className={purchasesView === "new" ? "flex min-h-[82px] items-center gap-3 rounded-xl border border-sky-700 bg-sky-50 p-3 text-left ring-1 ring-sky-100" : "flex min-h-[82px] items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-sky-200 hover:bg-slate-50"}>
                <span className={purchasesView === "new" ? "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#0f4f91] text-sm font-black text-white" : "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-sm font-black text-slate-500"}>01</span>
                <span className="min-w-0"><span className="block text-sm font-black text-slate-900">Nova compra</span><span className="mt-0.5 block text-xs text-slate-500">Montar e enviar pedido</span></span>
              </button>
              <button type="button" aria-pressed={purchasesView === "approval"} onClick={() => setPurchasesView("approval")}
                className={purchasesView === "approval" ? "flex min-h-[82px] items-center gap-3 rounded-xl border border-sky-700 bg-sky-50 p-3 text-left ring-1 ring-sky-100" : "flex min-h-[82px] items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-sky-200 hover:bg-slate-50"}>
                <span className={purchasesView === "approval" ? "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#0f4f91] text-sm font-black text-white" : "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-sm font-black text-slate-500"}>02</span>
                <span className="min-w-0"><span className="flex items-center gap-2 text-sm font-black text-slate-900">Aprovações <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-900">{pendingPurchases.length}</span></span><span className="mt-0.5 block text-xs text-slate-500">Analisar pedidos enviados</span></span>
              </button>
              <button type="button" aria-pressed={purchasesView === "orders"} onClick={() => setPurchasesView("orders")}
                className={purchasesView === "orders" ? "flex min-h-[82px] items-center gap-3 rounded-xl border border-sky-700 bg-sky-50 p-3 text-left ring-1 ring-sky-100" : "flex min-h-[82px] items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-sky-200 hover:bg-slate-50"}>
                <span className={purchasesView === "orders" ? "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#0f4f91] text-sm font-black text-white" : "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-sm font-black text-slate-500"}>03</span>
                <span className="min-w-0"><span className="flex items-center gap-2 text-sm font-black text-slate-900">Pedidos e recebimento <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-black text-sky-900">{purchasesAwaitingReceipt.length}</span></span><span className="mt-0.5 block text-xs text-slate-500">Acompanhar e conferir materiais</span></span>
              </button>
            </nav>
          </section>
          {purchasesView === "approval" && <>
          <section aria-label="Fila de aprovação financeira de compras" className="mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-5 py-5 sm:px-6">
              <div className="min-w-0">
                <p className="text-[11px] font-black uppercase tracking-[0.14em] text-sky-700">ETAPA 1 · APROVAÇÃO FINANCEIRA</p>
                <h2 className="mt-1 text-xl font-black tracking-tight text-slate-950">Pedidos aguardando aprovação</h2>
                <p className="mt-2 max-w-3xl text-sm leading-5 text-slate-600">A aprovação registra o compromisso no DBS Treasury. O estoque só é liberado depois da conferência física dos itens.</p>
              </div>
              <div className="flex min-w-[126px] items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-sm font-black text-amber-800">{pendingPurchases.length}</span>
                <span className="text-xs font-bold leading-4 text-amber-900">Pedidos<br/>pendentes</span>
              </div>
            </div>
            <div className="grid gap-3 p-4">
              {pendingPurchases.length ? pendingPurchases.map((purchase: any) => {
                const id = String(purchase.id);
                const reason = String(purchaseRejectionReasons[id] ?? "");
                const center = costCenters.find((item: any) => String(item.id) === String(purchase.cost_center_id));
                const isSaving = busy && purchaseApprovalBusyId === id;
                return (
                  <article key={id} className="grid gap-4 rounded-2xl border border-slate-200 border-l-4 border-l-amber-400 bg-white p-4 shadow-sm sm:p-5 md:grid-cols-[minmax(0,1fr)_minmax(240px,0.8fr)_140px] md:items-center">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-slate-900">{String(purchase.supplier_name ?? "Fornecedor")}</p>
                      <p className="mt-1 break-words text-xs text-slate-500">{String(purchase.document_number ?? "Pedido sem documento")} · {purchase.purchase_date ? new Date(String(purchase.purchase_date) + "T12:00:00").toLocaleDateString("pt-BR") : "—"}</p>
                      <p className="mt-2 text-sm font-black text-slate-900">{money(purchase.total_cents)}</p>
                      <p className="text-xs text-slate-500">Centro de custo: {center?.code ? String(center.code) + " · " : ""}{center?.name ?? "Não informado"}</p>
                    </div>
                    <label className="block text-xs font-bold text-slate-600">Motivo da rejeição
                      <input aria-label={"Motivo da rejeição da compra " + id} value={reason} onChange={(event) => setPurchaseRejectionReasons((current) => ({ ...current, [id]: event.target.value }))} maxLength={1000} placeholder="Obrigatório para rejeitar" className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs font-normal" />
                    </label>
                    <div className="flex flex-wrap gap-2 md:flex-col">
                      <button type="button" disabled={busy || purchaseApprovalBusyId !== null} onClick={() => void decidePurchaseApproval(purchase, "approved")} className="min-h-10 flex-1 rounded-lg bg-emerald-700 px-4 text-xs font-black text-white transition hover:bg-emerald-800 disabled:opacity-40">{isSaving ? "Salvando..." : "Aprovar"}</button>
                      <button type="button" disabled={busy || purchaseApprovalBusyId !== null || reason.trim().length < 5} onClick={() => void decidePurchaseApproval(purchase, "rejected")} className="min-h-10 flex-1 rounded-lg border border-rose-200 bg-white px-4 text-xs font-black text-rose-700 transition hover:bg-rose-50 disabled:opacity-40">Rejeitar</button>
                    </div>
                  </article>
                );
              }) : <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-center">
                <p className="text-sm font-bold text-slate-700">Nenhum pedido aguardando aprovação financeira</p>
                <p className="mt-1 text-xs text-slate-500">Os novos pedidos registrados nesta tela aparecerão aqui para análise.</p>
              </div>}
            </div>
          </section>
          </>}
          {purchasesView === "new" && <>
          <section className="mb-6 overflow-hidden rounded-2xl border border-sky-200/80 bg-white shadow-sm">
            <div className="border-b border-slate-100 bg-gradient-to-r from-sky-50/70 to-white p-5 sm:p-6">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-wider text-sky-700">Fluxo de suprimentos</p>
                <h2 className="mt-1 text-xl font-black tracking-tight text-slate-950">Nova compra / pedido ao fornecedor</h2>
                <p className="mt-1 text-sm text-slate-500">Registre o preço cotado, fornecedor, peças e centro de custo. O pedido segue para aprovação financeira nesta tela; o estoque só entra após o recebimento físico.</p>
              </div>
              {quoteImport.quoteId && <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-bold text-sky-800">Origem: cotação {quoteImport.quoteId}</span>}
              {quoteImport.quoteId && quotePurchase.isLoading && <p role="status" className="w-full rounded-lg bg-sky-50 p-3 text-xs text-sky-800">Importando peças relacionais da cotação…</p>}
              {quoteImport.quoteId && quotePurchase.error && <p role="alert" className="w-full rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">Não foi possível importar as peças desta cotação: {quotePurchase.error instanceof Error ? quotePurchase.error.message : "Falha ao consultar a cotação."}</p>}
              {quoteImport.quoteId && quotePurchase.data && !quotePurchase.data.items.length && <p role="alert" className="w-full rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">Esta cotação não possui peças do catálogo relacional. Adicione as peças manualmente antes de registrar o pedido.</p>}
            </div>
            </div>
            <form onSubmit={submitPurchase} className="grid gap-5 p-5 sm:p-6">
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <label className="text-xs font-bold text-slate-600">Fornecedor cadastrado *
                  <select required value={supplierId} onChange={e=>setSupplierId(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100">
                    <option value="">Selecione o fornecedor</option>
                    {suppliers.map((supplier:any)=><option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                  </select>
                </label>
                <label className="text-xs font-bold text-slate-600">Centro de custo *
                  <select required value={costCenterId} onChange={e=>setCostCenterId(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100">
                    <option value="">Selecione o centro de custo</option>
                    {costCenters.map((center:any)=><option key={center.id} value={center.id}>{center.code} · {center.name}</option>)}
                  </select>
                </label>
                <label className="text-xs font-bold text-slate-600">Nº da cotação / documento
                  <input maxLength={100} value={purchaseDocument} onChange={e => setPurchaseDocument(e.target.value)} placeholder="Referência do fornecedor" className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100" />
                </label>
                <label className="text-xs font-bold text-slate-600">Data da compra *
                  <input type="date" required value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100" />
                </label>
              </div>
              <div className="rounded-xl border border-sky-100 bg-sky-50/60 px-4 py-3 text-sm leading-5 text-sky-950"><strong className="font-bold">Como funciona:</strong> a compra usa fornecedor e centro de custo cadastrados. O valor é convertido para a unidade-base; o estoque só muda após aprovação e recebimento.</div>
              <div className="hidden overflow-x-auto rounded-xl border border-slate-100 md:block">
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
                        <select value={line.partId} onChange={e => {
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
                        <select value={line.purchaseUnitId} disabled={!part} onChange={e=>updatePurchaseLine(index,{purchaseUnitId:e.target.value,conversionFactor:conversionFor(line.partId,e.target.value)})} className="min-h-10 w-full rounded-lg border border-slate-200 px-2 text-sm">
                          <option value="">Unidade</option>
                          {measureUnits.map((u:any)=><option key={u.id} value={u.id}>{u.code} · {u.name}</option>)}
                        </select>
                      </td>
                      <td className="p-2"><input aria-label="Quantidade na unidade de compra" type="number" min="0.001" step="0.001" value={line.quantity} onChange={e=>updatePurchaseLine(index,{quantity:e.target.value})} className="min-h-10 w-24 rounded-lg border border-slate-200 px-2"/></td>
                      <td className="p-2"><input aria-label="Custo unitário na unidade de compra em reais" type="number" min="0.01" step="0.01" value={line.unitCost} onChange={e=>updatePurchaseLine(index,{unitCost:e.target.value})} placeholder="0,00" className="min-h-10 w-36 rounded-lg border border-slate-200 px-2"/></td>
                      <td className="p-2 whitespace-nowrap text-xs">{factor>0 ? ("1 "+String(purchaseUnit?.symbol||"")+" = "+String(factor)+" "+String(baseUnit?.symbol||"")) : <span className="font-bold text-rose-700">Sem conversão ativa</span>}</td>
                      <td className="p-2 whitespace-nowrap font-bold">{money(Math.round(lineTotal*100))}</td>
                      <td className="p-2"><button type="button" disabled={purchaseLines.length===1} onClick={()=>setPurchaseLines(current=>current.filter((_,i)=>i!==index))} className="rounded-lg border border-rose-200 px-2 py-2 text-xs font-bold text-rose-700 disabled:opacity-30">Remover</button></td>
                    </tr>;
                  })}</tbody>
                </table>
              </div>
              <div className="space-y-3 md:hidden">
                {purchaseLines.map((line,index) => {
                  const part=parts.find((entry:any)=>String(entry.id)===line.partId);
                  const factor=conversionFor(line.partId,line.purchaseUnitId);
                  const purchaseUnit=measureUnits.find((u:any)=>String(u.id)===line.purchaseUnitId);
                  const baseUnit=measureUnits.find((u:any)=>String(u.id)===String(part?.measure_unit_id));
                  const lineTotal=Number(line.quantity||0)*Number(line.unitCost||0);
                  return <article key={index} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <p className="text-sm font-black text-slate-800">Item {index+1}</p>
                      <button type="button" disabled={purchaseLines.length===1} onClick={()=>setPurchaseLines(current=>current.filter((_,i)=>i!==index))} className="min-h-9 rounded-lg border border-rose-200 px-3 text-xs font-bold text-rose-700 disabled:opacity-30">Remover</button>
                    </div>
                    <label className="block text-xs font-bold text-slate-600">Peça cadastrada *
                      <select value={line.partId} onChange={e=>{
                        const selected=parts.find((entry:any)=>String(entry.id)===e.target.value);
                        const baseUnitId=String(selected?.measure_unit_id||"");
                        updatePurchaseLine(index,{partId:e.target.value,description:String(selected?.name||selected?.description||""),purchaseUnitId:baseUnitId,conversionFactor:baseUnitId?1:0});
                      }} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100">
                        <option value="">Selecione a peça cadastrada</option>
                        {parts.filter((entry:any)=>String(entry.status||"ativo").toLowerCase()!=="inativo").map((entry:any)=><option key={entry.id} value={entry.id}>{entry.sku?entry.sku+" · ":""}{entry.name||entry.description||entry.id}</option>)}
                      </select>
                    </label>
                    {part&&!part.measure_unit_id&&<p className="mt-1 text-xs font-bold text-rose-700">Cadastre a unidade-base da peça antes de comprar.</p>}
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <label className="text-xs font-bold text-slate-600">Unidade da compra *
                        <select value={line.purchaseUnitId} disabled={!part} onChange={e=>updatePurchaseLine(index,{purchaseUnitId:e.target.value,conversionFactor:conversionFor(line.partId,e.target.value)})} className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-2 text-sm">
                          <option value="">Unidade</option>{measureUnits.map((u:any)=><option key={u.id} value={u.id}>{u.code} · {u.name}</option>)}
                        </select>
                      </label>
                      <label className="text-xs font-bold text-slate-600">Quantidade *
                        <input aria-label="Quantidade na unidade de compra" type="number" min="0.001" step="0.001" value={line.quantity} onChange={e=>updatePurchaseLine(index,{quantity:e.target.value})} className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 px-2 text-sm"/>
                      </label>
                      <label className="col-span-2 text-xs font-bold text-slate-600">Custo unitário na unidade de compra (R$) *
                        <input aria-label="Custo unitário na unidade de compra em reais" type="number" min="0.01" step="0.01" value={line.unitCost} onChange={e=>updatePurchaseLine(index,{unitCost:e.target.value})} placeholder="0,00" className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"/>
                      </label>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs">
                      <span className={factor>0?"text-slate-600":"font-bold text-rose-700"}>{factor>0?("1 "+String(purchaseUnit?.symbol||"")+" = "+String(factor)+" "+String(baseUnit?.symbol||"")):"Sem conversão ativa"}</span>
                      <span className="text-sm font-black text-slate-900">{money(Math.round(lineTotal*100))}</span>
                    </div>
                  </article>;
                })}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
                <button type="button" onClick={() => setPurchaseLines(current => [...current, { partId:"", description:"", quantity:"1", unitCost:"", purchaseUnitId:"", conversionFactor:0 }])} className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-800">+ Adicionar peça</button>
                <div className="text-right"><p className="text-xs font-bold text-slate-500">Total estimado da compra</p><p className="mt-1 text-2xl font-black tracking-tight text-slate-950">{money(Math.round(purchaseLines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unitCost || 0), 0) * 100))}</p></div>
                <button disabled={busy || !parts.length} className="min-h-12 rounded-xl bg-[#0f4f91] px-6 py-2 text-sm font-black text-white shadow-sm transition hover:bg-[#0a3e75] disabled:opacity-50">{busy ? "Registrando..." : "Enviar pedido para aprovação financeira"}</button>
              </div>
            </form>
          </section>

          </>}
          {purchasesView === "orders" && <>
          <section className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 bg-white p-5 sm:p-6">
              <div>
                <h2 className="text-xl font-black tracking-tight text-slate-950">Pedidos e recebimento físico</h2>
                <p className="mt-1 text-sm text-slate-500">Acompanhe a liberação e confira as quantidades recebidas. Nenhum pagamento é feito nesta tela.</p>
              </div>
              <Link to="/treasury" className="min-h-10 rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-xs font-black text-sky-800 hover:bg-sky-100">Abrir Financeiro / DBS Treasury</Link>
            </div>
            <div className="hidden overflow-x-auto md:block">
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
                        <span className="font-bold text-amber-700">Aguardando aprovação financeira</span>}
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
            <div className="space-y-3 p-3 md:hidden">
              {(data?.purchases ?? []).map((purchase:any) => {
                const lines=(data?.purchaseItems??[]).filter((item:any)=>String(item.purchase_id)===String(purchase.id));
                const outstanding=lines.filter((item:any)=>Number(item.quantity)>Number(item.quantity_received??0));
                const selected=outstanding.filter((item:any)=>Number(purchaseReceiptQuantities[item.id]??0)>0);
                const overReceived=selected.some((item:any)=>Number(purchaseReceiptQuantities[item.id])>Number(item.quantity)-Number(item.quantity_received??0));
                const approval=purchase.approval_status;
                const purchaseSupplierDisplayName=suppliers.find((x:any)=>String(x.id)===String(purchase.supplier_id))?.name||purchase.supplier_name;
                return <article key={purchase.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><p className="font-black text-slate-900">{purchaseSupplierDisplayName}</p><p className="mt-0.5 break-words text-xs text-slate-500">{purchase.document_number||"Sem documento"} · {purchase.purchase_date?new Date(purchase.purchase_date+"T12:00:00").toLocaleDateString("pt-BR"):"—"}</p></div>
                    <p className="shrink-0 text-sm font-black text-slate-900">{money(purchase.total_cents)}</p>
                  </div>
                  <div className="mt-3 border-t border-slate-100 pt-3 text-xs">
                    {approval==="approved"?<p className="font-bold text-emerald-700">Aprovada no Financeiro</p>:
                      approval==="rejected"?<div className="text-rose-700"><p className="font-bold">Rejeitada</p>{purchase.rejection_reason&&<p className="mt-1">{purchase.rejection_reason}</p>}</div>:
                      approval==="legacy_received"?<p className="font-semibold text-slate-500">Registro anterior</p>:
                      <p className="font-bold text-amber-700">Aguardando aprovação financeira</p>}
                    <div className="mt-2">
                      {purchase.status==="received"?<span className="font-bold text-emerald-700">Recebimento completo</span>:
                        approval!=="approved"?<span className="text-slate-500">Recebimento liberado após aprovação financeira.</span>:
                        !lines.length?<span className="text-rose-700">Pedido sem itens cadastrados.</span>:
                        !outstanding.length?<span className="font-bold text-emerald-700">Todos os itens conferidos.</span>:
                        <details className="mt-2">
                          <summary className="min-h-10 cursor-pointer rounded-lg bg-sky-700 px-3 py-2.5 text-center text-xs font-black text-white">Conferir {outstanding.length} item(ns) pendente(s)</summary>
                          <div className="mt-2 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                            {outstanding.map((item:any)=>{
                              const part=parts.find((entry:any)=>String(entry.id)===String(item.part_id));
                              const remaining=Math.max(0,Number(item.quantity)-Number(item.quantity_received??0));
                              return <label key={item.id} className="block text-xs font-semibold text-slate-700">
                                <span className="block">{part?.sku?part.sku+" · ":""}{part?.name||part?.description||"Peça"}</span>
                                <span className="mt-1 block font-normal text-slate-500">Pedido: {Number(item.quantity).toLocaleString("pt-BR")} · Recebido: {Number(item.quantity_received??0).toLocaleString("pt-BR")} · Falta: {remaining.toLocaleString("pt-BR")}</span>
                                <input aria-label={"Quantidade recebida de "+(part?.name||part?.sku||item.id)} type="number" min="0.001" max={remaining} step="0.001" value={purchaseReceiptQuantities[item.id]??""} onChange={e=>setPurchaseReceiptQuantities(prev=>({...prev,[item.id]:e.target.value}))} placeholder={"Conferido agora (máx. "+remaining+")"} className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"/>
                              </label>;
                            })}
                            <button type="button" disabled={busy||!selected.length||overReceived} onClick={async()=>{
                              const saved=await runAction(()=>receiveDbsPurchaseItems({data:{
                                purchaseId:purchase.id,
                                idempotencyKey:"purchase-receive:"+purchase.id+":"+crypto.randomUUID(),
                                items:selected.map((item:any)=>({purchaseItemId:item.id,quantityReceived:Number(purchaseReceiptQuantities[item.id])})),
                              }}),"Recebimento físico registrado. O estoque e o custo médio foram atualizados; a parte financeira permanece no DBS Treasury.");
                              if(saved)setPurchaseReceiptQuantities(prev=>{
                                const next={...prev};
                                for(const item of selected)delete next[item.id];
                                return next;
                              });
                            }} className="min-h-11 w-full rounded-lg bg-emerald-700 px-3 text-xs font-black text-white disabled:opacity-40">Confirmar quantidades recebidas</button>
                            {overReceived&&<p className="text-xs font-bold text-rose-700">A quantidade não pode ultrapassar o saldo pendente do pedido.</p>}
                          </div>
                        </details>}
                      {purchase.status==="partially_received"&&<p className="mt-2 font-semibold text-amber-700">Recebimento parcial · {money(purchase.received_total_cents??0)} em materiais recebidos</p>}
                    </div>
                  </div>
                </article>;
              })}
              {!(data?.purchases??[]).length&&<p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Nenhum pedido de compra registrado neste escopo.</p>}
            </div>
          </section>
          </>}
          </>}
          {moduleSection === "parts" && partsView === "stock" && <>
          <section className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 p-5">
              <h2 className="text-lg font-black">Histórico imutável de movimentações</h2>
              <p className="mt-1 text-sm text-slate-500">Movimentos não podem ser editados ou apagados. Correções elegíveis são registradas por estorno, com motivo e contrapartida no Ledger.</p>
            </div>
            <div className="hidden overflow-x-auto md:block">
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
            <div className="grid gap-2 p-3 md:hidden">
              {(data?.inventoryMovements??[]).map((movement:any)=>{
                const part=parts.find((entry:any)=>String(entry.id)===String(movement.part_id));
                const movements=data?.inventoryMovements??[];
                const alreadyReversed=movements.some((entry:any)=>entry.reversal_of_movement_id===movement.id);
                const canReverse=["receipt","consume","return","adjustment"].includes(String(movement.movement_type))
                  &&!movement.work_order_id&&!movement.work_order_part_id
                  &&!movement.reversal_of_movement_id&&!alreadyReversed;
                const reason=String(movementReversalReasons[movement.id]??"");
                return <article key={movement.id} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-start justify-between gap-3"><div><p className="font-bold">{part?.name??part?.sku??movement.part_id}</p><p className="text-xs text-slate-500">{movement.created_at?new Date(movement.created_at).toLocaleString("pt-BR"):"—"}</p></div><span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold">{movement.movement_type==="reversal"?"Estorno":movement.movement_type}</span></div>
                  <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-2 text-xs"><div><p className="text-slate-500">Quantidade</p><p className="font-bold">{Number(movement.quantity_delta).toLocaleString("pt-BR")}</p></div><div><p className="text-slate-500">Saldo após</p><p className="font-bold">{Number(movement.balance_after).toLocaleString("pt-BR")}</p></div></div>
                  <div className="mt-3">
                    {movement.reversal_of_movement_id?<span className="text-xs font-bold text-emerald-700">Estorno rastreado</span>:
                      alreadyReversed?<span className="text-xs font-bold text-slate-500">Já estornado</span>:
                      canReverse?<div className="space-y-2">
                        <input aria-label="Motivo do estorno" maxLength={1000} value={reason} onChange={e=>setMovementReversalReasons(prev=>({...prev,[movement.id]:e.target.value}))} placeholder="Motivo obrigatório (mín. 5 caracteres)" className="min-h-10 w-full rounded-lg border border-slate-200 px-3 text-xs"/>
                        <button type="button" disabled={busy||reason.trim().length<5} onClick={()=>void runAction(()=>reverseDbsInventoryMovement({data:{movementId:movement.id,idempotencyKey:"inventory-reversal:"+movement.id+":"+crypto.randomUUID(),reason}}),"Estorno registrado no histórico e no Ledger.")} className="min-h-10 w-full rounded-lg bg-amber-700 px-3 text-xs font-black text-white disabled:opacity-40">Registrar estorno</button>
                      </div>:<span className="text-xs text-slate-500">Correção pelo fluxo vinculado</span>}
                  </div>
                </article>;
              })}
              {!(data?.inventoryMovements??[]).length&&<p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Nenhuma movimentação registrada ainda.</p>}
            </div>
          </section>
          </>}
          {moduleSection === "parts" && partsView === "reservations" && <>
          <section className="grid gap-5 lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.5fr)]">
            <form onSubmit={reserveParts} className="h-fit rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="text-lg font-black">Reservar peças para OS</h2>
              <label className="mt-4 block text-xs font-bold text-slate-600">Ordem de serviço</label>
              <select required value={workOrderId} onChange={e => setWorkOrderId(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100">
                <option value="">Selecione uma OS</option>
                {workOrders.map((order: any) => <option key={order.id} value={order.id}>{order.protocol ?? order.id} · {order.status}</option>)}
              </select>
              <label className="mt-3 block text-xs font-bold text-slate-600">Centro de custo da OS *</label>
              <select required value={costCenterId} onChange={e=>setCostCenterId(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100">
                <option value="">Selecione o centro de custo</option>
                {costCenters.map((center:any)=><option key={center.id} value={center.id}>{center.code} · {center.name}</option>)}
              </select>
              <label className="mt-3 block text-xs font-bold text-slate-600">Peça</label>
              <select required value={partId} onChange={e => setPartId(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100">
                <option value="">Selecione uma peça</option>
                {availableParts.map((part: any) => <option key={part.id} value={part.id}>{part.name ?? part.description ?? part.id} · disponível {Number(part.stock_quantity ?? 0) - Number(part.reserved_quantity ?? 0)}</option>)}
              </select>
              <label className="mt-3 block text-xs font-bold text-slate-600">Quantidade<input type="number" min="0.001" step="0.001" required value={quantity} onChange={e => setQuantity(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100" /></label>
              <button disabled={busy || !availableParts.length || !workOrders.length} className="mt-5 min-h-11 w-full rounded-xl bg-sky-700 px-4 py-2 text-sm font-black text-white disabled:opacity-50">{busy ? "Processando..." : "Reservar estoque"}</button>
              <p className="mt-3 text-xs text-slate-500">A reserva bloqueia a disponibilidade, mas não baixa o estoque físico. A baixa ocorre ao concluir a OS.</p>
            </form>
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 p-5"><h2 className="text-lg font-black">Reservas recentes</h2></div>
              <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[620px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Reserva</th><th className="p-3">OS</th><th className="p-3">Quantidade</th><th className="p-3">Custo capturado</th><th className="p-3">Status</th><th className="p-3">Ação</th></tr></thead>
                <tbody>{reservations.map((reservation: any) => <tr key={reservation.id} className="border-t border-slate-100">
                  <td className="p-3 font-mono text-xs">{String(reservation.id).slice(0, 8)}</td><td className="p-3 font-mono text-xs">{String(reservation.work_order_id).slice(0, 8)}</td><td className="p-3">{reservation.quantity}</td><td className="p-3">{money(Number(reservation.quantity) * Number(reservation.unit_cost_cents))}</td><td className="p-3">{reservation.status}</td>
                  <td className="p-3">{reservation.status === "reserved" ? <button disabled={busy} onClick={() => void runAction(() => releaseDbsWorkOrderReservation({ data: { reservationId: reservation.id, idempotencyKey: "release:" + crypto.randomUUID() } }), "Reserva liberada.")} className="rounded-lg border border-rose-200 px-3 py-1 text-xs font-bold text-rose-700">Liberar</button> : "—"}</td>
                </tr>)}</tbody>
              </table></div>
              <div className="grid gap-2 p-3 md:hidden">
                {reservations.map((reservation:any)=><article key={reservation.id} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-start justify-between gap-3"><div><p className="font-mono text-xs font-bold">{String(reservation.id).slice(0,8)}</p><p className="mt-1 text-xs text-slate-500">OS {String(reservation.work_order_id).slice(0,8)}</p></div><span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold">{reservation.status}</span></div>
                  <div className="mt-2 grid grid-cols-2 gap-2 border-t border-slate-100 pt-2 text-xs"><div><p className="text-slate-500">Quantidade</p><p className="font-bold">{reservation.quantity}</p></div><div><p className="text-slate-500">Custo capturado</p><p className="font-bold">{money(Number(reservation.quantity)*Number(reservation.unit_cost_cents))}</p></div></div>
                  {reservation.status==="reserved"&&<button type="button" disabled={busy} onClick={()=>void runAction(()=>releaseDbsWorkOrderReservation({data:{reservationId:reservation.id,idempotencyKey:"release:"+crypto.randomUUID()}}),"Reserva liberada.")} className="mt-3 min-h-10 w-full rounded-lg border border-rose-200 text-xs font-bold text-rose-700">Liberar reserva</button>}
                </article>)}
                {!reservations.length&&<p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Nenhuma reserva registrada ainda.</p>}
              </div>
            </div>
          </section>
          </>}
        </>}
      </div>
    </main>
  );
}