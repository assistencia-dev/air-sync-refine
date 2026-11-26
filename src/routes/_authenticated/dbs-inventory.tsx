import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Archive, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { decideDbsPurchaseApprovalFromTreasury } from "@/lib/treasury.functions";
import {
  createDbsPurchase, createDbsSupplier, createDbsMeasureUnit, createDbsUnitConversion,
  createDbsOperationalStock, setDbsOperationalStockStatus, transferDbsOperationalStock, reserveDbsOperationalStockForWorkOrder, releaseDbsOperationalStockReservation,
  getDbsPhase2InventoryOverview, getDbsQuotePurchaseItems, releaseDbsWorkOrderReservation,
  setDbsWorkOrderCostCenter, receiveDbsPurchaseItems,
  reverseDbsInventoryMovement, createDbsCostCenter, createDbsPartCatalog,
  saveDbsInventoryPricingPolicy, updateDbsPartCatalog,
  updateDbsInventoryMasterData, setDbsInventoryRecordStatus, deleteDbsInventoryRecord,
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

async function getPersistentPurchaseIdempotencyKey(namespace: string, fingerprint: string) {
  const bytes = new TextEncoder().encode(fingerprint);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const fingerprintHash = Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0")).join("");
  const storageKey = "dbs-control:" + namespace + ":" + fingerprintHash;
  let key: string | null = null;
  try { key = window.localStorage.getItem(storageKey); } catch { /* private browsing fallback */ }
  if (!key) {
    key = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
    try { window.localStorage.setItem(storageKey, key); } catch { /* request remains valid for this attempt */ }
  }
  return { key, storageKey };
}

function clearPersistentPurchaseIdempotencyKey(storageKey: string) {
  try { window.localStorage.removeItem(storageKey); } catch { /* no persistent key was stored */ }
}

type DbsInventorySection = "parts" | "purchases";
type InventoryRecordEntity = "part" | "supplier" | "cost_center" | "measure_unit" | "unit_conversion";
type PendingInventoryDelete = { entity: InventoryRecordEntity; id: string; label: string };
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
  type SettingsView = "suppliers" | "cost-centers" | "units" | "conversions" | "pricing";
  type InventoryDrawer = "new-part" | "new-purchase" | "transfer" | "reservation" | "supplier" | "cost-center" | "unit" | "conversion" | "link-cost-center" | "gas-cylinder" | "operational-stock" | null;
  const [partsView, setPartsView] = useState<PartsView>("catalog");
  const [purchasesView, setPurchasesView] = useState<PurchasesView>("new");
  const [settingsView, setSettingsView] = useState<SettingsView>("suppliers");
  const [activeDrawer, setActiveDrawer] = useState<InventoryDrawer>(null);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogFilter, setCatalogFilter] = useState<"all" | "stock" | "setup">("all");
  const [catalogStatusFilter, setCatalogStatusFilter] = useState<"active" | "archived" | "all">("active");
  const [masterRecordId, setMasterRecordId] = useState("");
  const [pendingDelete, setPendingDelete] = useState<PendingInventoryDelete | null>(null);
  useEffect(() => {
    setModuleSection(initialSection);
  }, [initialSection]);

  useEffect(() => {
    if (!pricingPolicy) {
      setPricingExpectedVersion(0);
      return;
    }
    setPricingMethod(pricingPolicy.pricing_method === "gross_margin" ? "gross_margin" : "markup");
    setPricingRate((Number(pricingPolicy.rate_bps) / 100).toFixed(2));
    setPricingExpectedVersion(Number(pricingPolicy.version) || 0);
  }, [pricingPolicy?.version, pricingPolicy?.pricing_method, pricingPolicy?.rate_bps]);
  useEffect(() => {
    const openFromHeader = (event: Event) => {
      const drawer = (event as CustomEvent<{ drawer?: string }>).detail?.drawer;
      if (drawer === "part") {
        setModuleSection("parts");
        setPartsView("catalog");
        setCatalogPartId("");
        setCatalogPartSku("");
        setCatalogPartName("");
        setCatalogPartDescription("");
        setCatalogPartSupplierId("");
        setCatalogPartUnitId("");
        setCatalogPartPurchaseUnitId("");
        setCatalogPartCost("");
        setActiveDrawer("new-part");
      } else if (drawer === "purchase") {
        setModuleSection("purchases");
        setPurchasesView("new");
        setActiveDrawer("new-purchase");
      }
    };
    window.addEventListener("dbs-inventory-open-drawer", openFromHeader as EventListener);
    return () => window.removeEventListener("dbs-inventory-open-drawer", openFromHeader as EventListener);
  }, []);
  useEffect(() => {
    if (initialQuoteId) {
      setModuleSection("purchases");
      setPurchasesView("new");
      setActiveDrawer("new-purchase");
    }
  }, [initialQuoteId]);
  const [partId, setPartId] = useState("");
  const [reservationPartSearch, setReservationPartSearch] = useState("");
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
  const [catalogPartPurchaseUnitId, setCatalogPartPurchaseUnitId] = useState("");
  const [catalogPartCost, setCatalogPartCost] = useState("");
  const [pricingMethod, setPricingMethod] = useState<"markup" | "gross_margin">("markup");
  const [pricingRate, setPricingRate] = useState("");
  const [pricingExpectedVersion, setPricingExpectedVersion] = useState(0);
  const [newCostCenterCode, setNewCostCenterCode] = useState("");
  const [newCostCenterName, setNewCostCenterName] = useState("");
  const [transferSourceStockId, setTransferSourceStockId] = useState("central");
  const [transferDestinationStockId, setTransferDestinationStockId] = useState("");
  const [operationalStockName, setOperationalStockName] = useState("");
  const [operationalStockCostCenterId, setOperationalStockCostCenterId] = useState("");
  const [reservationStockId, setReservationStockId] = useState("");
  const [reservationPurpose, setReservationPurpose] = useState<"TROCA_PECA"|"ATIVO_EQUIPAMENTO">("TROCA_PECA");
  const [reservationClientFilter, setReservationClientFilter] = useState("");
  const [reservationClientSearch, setReservationClientSearch] = useState("");
  const [reservationDateFrom, setReservationDateFrom] = useState("");
  const [reservationDateTo, setReservationDateTo] = useState("");
  const [reservationFiltersApplied, setReservationFiltersApplied] = useState(false);
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
  const pricingPolicy = data?.pricingPolicy ?? null;
  const catalogCalculatedSaleCents = (() => {
    if (!pricingPolicy) return null;
    const cost = Math.round(Number(catalogPartCost || 0) * 100);
    const rate = Number(pricingPolicy.rate_bps);
    if (!Number.isSafeInteger(cost) || cost < 0 || !Number.isInteger(rate) || rate <= 0) return null;
    const raw = pricingPolicy.pricing_method === "markup"
      ? cost * (10000 + rate) / 10000
      : pricingPolicy.pricing_method === "gross_margin" && rate < 10000 ? cost * 10000 / (10000 - rate) : Number.NaN;
    const result = Math.round(raw);
    return Number.isSafeInteger(result) && result >= 0 && result <= 2147483647 ? result : null;
  })();
  const parts = data?.parts ?? [];
  const suppliers = data?.suppliers ?? [];
  const measureUnits = data?.measureUnits ?? [];
  const unitConversions = data?.unitConversions ?? [];
  const costCenters = data?.costCenters ?? [];
  const activeParts = parts.filter((part: any) => String(part.status ?? "ativo").toLowerCase() !== "inativo");
  const activeSuppliers = suppliers.filter((supplier: any) => String(supplier.status ?? "active") === "active");
  const activeMeasureUnits = measureUnits.filter((unit: any) => String(unit.status ?? "active") === "active");
  const activeCostCenters = costCenters.filter((center: any) => String(center.status ?? "active") === "active");
  const gasCylinders = data?.gasCylinders ?? [];
  const carStock = data?.carStock ?? [];
  const operationalStocks = data?.operationalStocks ?? [];
  const operationalBalances = data?.operationalBalances ?? [];
  const operationalMovements = data?.operationalMovements ?? [];
  const operationalReservations = data?.operationalReservations ?? [];
  const movementUsers = data?.movementUsers ?? [];
  const clients = data?.clients ?? [];
  const employees = data?.employees ?? [];
  const workOrders = data?.workOrders ?? [];
  const selectedOperationalStock = operationalStocks.find((stock:any)=>String(stock.id)===String(reservationStockId)&&stock.status==="active");
  const selectedOperationalBalance = operationalBalances.find((row:any)=>String(row.stock_id)===String(selectedOperationalStock?.id)&&String(row.part_id)===String(partId));
  const selectedPart = activeParts.find((part:any)=>String(part.id)===String(partId));
  const selectedCentralAvailable = Math.max(0,Number(selectedPart?.stock_quantity??0)-Number(selectedPart?.reserved_quantity??0));
  const filteredReservationOrders = reservationFiltersApplied && (reservationClientFilter||reservationDateFrom||reservationDateTo)
    ? workOrders.filter((order:any)=>{
      const date=String(order.created_at??"").slice(0,10);
      return (!reservationClientFilter||String(order.client_id)===reservationClientFilter)&&(!reservationDateFrom||date>=reservationDateFrom)&&(!reservationDateTo||date<=reservationDateTo);
    }) : [];
  const reservations = [...(data?.reservations ?? []).map((r:any)=>({...r,is_operational:false})), ...(data?.operationalReservations ?? []).map((r:any)=>({...r,is_operational:true}))];
  const workOrderFinancials = data?.workOrderFinancials ?? [];
  const pendingPurchases = (data?.purchases ?? []).filter((purchase: any) =>
    purchase.approval_status === "pending" && purchase.status !== "cancelled"
  );
  const purchasesAwaitingReceipt = (data?.purchases ?? []).filter((purchase: any) =>
    purchase.approval_status === "approved" && purchase.status !== "received" && purchase.status !== "cancelled"
  );
  const purchasesOpen = (data?.purchases ?? []).filter((purchase: any) =>
    purchase.status !== "received" && purchase.status !== "cancelled" && purchase.approval_status !== "rejected"
  );
  const activePartsMissingMasterData = parts.filter((part: any) =>
    part.status === "ativo" && (!part.supplier_id || !part.measure_unit_id)
  ).length;
  const purchaseSetupIncomplete =
    suppliers.length === 0 || measureUnits.length === 0 || costCenters.length === 0 || activePartsMissingMasterData > 0;
  const visibleParts = parts.filter((part: any) => {
    const query = catalogSearch.trim().toLocaleLowerCase("pt-BR");
    const catalogSupplierLabel = suppliers.find((row: any) => String(row.id) === String(part.supplier_id))?.name ?? "";
    const matchesQuery = !query || [part.name, part.description, part.sku, catalogSupplierLabel].some(value => String(value ?? "").toLocaleLowerCase("pt-BR").includes(query));
    const active = String(part.status ?? "ativo").toLowerCase() !== "inativo";
    const matchesStatus = catalogStatusFilter === "all" || (catalogStatusFilter === "active" && active) || (catalogStatusFilter === "archived" && !active);
    const matchesFilter = catalogFilter === "all"
      || (catalogFilter === "stock" && Number(part.stock_quantity ?? 0) > 0)
      || (catalogFilter === "setup" && (!part.supplier_id || !part.measure_unit_id));
    return matchesQuery && matchesStatus && matchesFilter;
  });

  useEffect(() => {
    if (!quotePurchase.data || !parts.length) return;
    const lines = quotePurchase.data.items.map((item: any) => {
      const part = parts.find((entry: any) => String(entry.id) === String(item.part_id));
      const purchaseUnitId=String(part?.purchase_measure_unit_id || part?.measure_unit_id || "");
      return {
        partId: String(item.part_id),
        description: String(item.description || part?.name || ""),
        quantity: String(item.quantity || 1),
        unitCost: "",
        purchaseUnitId,
        conversionFactor: conversionFor(String(item.part_id),purchaseUnitId),
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

  const availableParts = activeParts.filter((part: any) =>
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
    if (quoteImport.quoteId && (!quotePurchase.data || quotePurchase.error)) {
      setMessage("Aguarde a importação completa do orçamento de origem ou corrija a consulta antes de registrar a compra.");
      return;
    }
    const sourceQuoteId = quotePurchase.data?.quote?.id ? String(quotePurchase.data.quote.id) : undefined;
    const purchaseFingerprint = JSON.stringify({
      supplierId, costCenterId, documentNumber: purchaseDocument.trim(), purchaseDate, sourceQuoteId, items,
    });
    const operation = await getPersistentPurchaseIdempotencyKey("purchase-register", purchaseFingerprint);
    const saved = await runAction(() => createDbsPurchase({ data: {
      supplierId, costCenterId,
      documentNumber: purchaseDocument.trim() || undefined,
      purchaseDate,
      sourceQuoteId,
      idempotencyKey: "purchase-register:" + operation.key,
      items,
    } }), "Pedido registrado para análise financeira. O estoque só será atualizado após aprovação e conferência do recebimento físico.");
    if (saved) {
      clearPersistentPurchaseIdempotencyKey(operation.storageKey);
      setPurchaseDocument("");
      setPurchaseLines([{ partId:"", description:"", quantity:"1", unitCost:"", purchaseUnitId:"", conversionFactor:0 }]);
      setActiveDrawer(null);
    }
  }

  function updatePurchaseLine(index: number, patch: Partial<(typeof purchaseLines)[number]>) {
    setPurchaseLines((current) => current.map((line, i) => i === index ? { ...line, ...patch } : line));
  }

  async function confirmPurchaseReceipt(purchase: any, selected: any[]) {
    const items = selected.map((item: any) => ({
      purchaseItemId: String(item.id),
      quantityReceived: Number(purchaseReceiptQuantities[item.id]) * Number(item.conversion_factor || 1),
    }));
    if (!items.length || items.some((item) => !Number.isFinite(item.quantityReceived) || item.quantityReceived <= 0)) {
      setMessage("Informe quantidades válidas para os itens conferidos.");
      return;
    }
    const fingerprint = JSON.stringify({ purchaseId: String(purchase.id), items });
    const operation = await getPersistentPurchaseIdempotencyKey("purchase-receipt", fingerprint);
    const saved = await runAction(() => receiveDbsPurchaseItems({ data: {
      purchaseId: purchase.id,
      idempotencyKey: "purchase-receive:" + purchase.id + ":" + operation.key,
      items,
    } }), "Recebimento físico registrado. O estoque e o custo médio foram atualizados; a parte financeira permanece no DBS Treasury.");
    if (saved) {
      clearPersistentPurchaseIdempotencyKey(operation.storageKey);
      setPurchaseReceiptQuantities((previous) => {
        const next = { ...previous };
        for (const item of selected) delete next[item.id];
        return next;
      });
    }
  }

  function conversionFor(partIdValue: string, purchaseUnitId: string): number {
    const part = parts.find((entry: any) => String(entry.id) === partIdValue);
    if (!part || !part.measure_unit_id || !purchaseUnitId) return 0;
    if (String(part.measure_unit_id) === purchaseUnitId) return 1;
    const conversion = unitConversions.find((row: any) =>
      String(row.from_unit_id) === purchaseUnitId && String(row.to_unit_id) === String(part.measure_unit_id)
    );
    return conversion && String(conversion.status ?? "active") === "active" ? Number(conversion.factor) : 0;
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
      setCatalogPartPurchaseUnitId("");
      setCatalogPartCost("");
      return;
    }
    setCatalogPartName(String(part.name ?? ""));
    setCatalogPartSku(String(part.sku ?? ""));
    setCatalogPartDescription(String(part.description ?? ""));
    setCatalogPartSupplierId(String(part.supplier_id ?? ""));
    setCatalogPartUnitId(String(part.measure_unit_id ?? ""));
    setCatalogPartPurchaseUnitId(String(part.purchase_measure_unit_id ?? ""));
    setCatalogPartCost((Number(part.cost_cents ?? 0) / 100).toFixed(2));
  }

  async function saveCatalogPart(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pricingPolicy) {
      setMessage("Configure a política de preço de revenda no Financeiro antes de cadastrar peças.");
      setPartsView("settings");
      setSettingsView("pricing");
      return;
    }
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
      purchaseMeasureUnitId: catalogPartPurchaseUnitId || undefined,
      costCents: Math.round(Number(catalogPartCost || 0) * 100),
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
      setMasterRecordId("");
      setActiveDrawer(null);
    }
  }

  async function savePricingPolicy(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const percentage = Number(pricingRate);
    if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 990) {
      setMessage("Informe um percentual maior que zero e de até 990%.");
      return;
    }
    const rateBps = Math.round(percentage * 100);
    if (pricingMethod === "gross_margin" && rateBps >= 10000) {
      setMessage("A margem bruta precisa ser menor que 100%.");
      return;
    }
    const saved = await runAction(() => saveDbsInventoryPricingPolicy({ data: {
      pricingMethod,
      rateBps,
      expectedVersion: pricingExpectedVersion,
    } }), "Política atualizada. Os preços do catálogo foram recalculados sem movimentar o estoque.");
    if (saved) {
      setPricingExpectedVersion(pricingExpectedVersion + 1);
      void overview.refetch();
    }
  }

  function openNewMasterRecord() {
    setMasterRecordId("");
    if (settingsView === "suppliers") {
      setNewSupplierName(""); setNewSupplierCnpj(""); setNewSupplierPhone(""); setActiveDrawer("supplier");
    } else if (settingsView === "cost-centers") {
      setNewCostCenterCode(""); setNewCostCenterName(""); setActiveDrawer("cost-center");
    } else if (settingsView === "units") {
      setNewUnitCode(""); setNewUnitName(""); setNewUnitSymbol(""); setActiveDrawer("unit");
    } else {
      setConversionFrom(""); setConversionTo(""); setConversionFactor("1"); setActiveDrawer("conversion");
    }
  }

  function openEditMasterRecord(entity: Exclude<InventoryRecordEntity, "part">, record: any) {
    if (entity === "measure_unit" && record.is_system) {
      setMessage("Unidades padrão do sistema são protegidas contra edição.");
      return;
    }
    setMasterRecordId(String(record.id));
    if (entity === "supplier") {
      setNewSupplierName(String(record.name ?? "")); setNewSupplierCnpj(String(record.cnpj ?? "")); setNewSupplierPhone(String(record.phone ?? "")); setActiveDrawer("supplier");
    } else if (entity === "cost_center") {
      setNewCostCenterCode(String(record.code ?? "")); setNewCostCenterName(String(record.name ?? "")); setActiveDrawer("cost-center");
    } else if (entity === "measure_unit") {
      setNewUnitCode(String(record.code ?? "")); setNewUnitName(String(record.name ?? "")); setNewUnitSymbol(String(record.symbol ?? record.code ?? "")); setActiveDrawer("unit");
    } else {
      setConversionFrom(String(record.from_unit_id ?? "")); setConversionTo(String(record.to_unit_id ?? "")); setConversionFactor(String(record.factor ?? "1")); setActiveDrawer("conversion");
    }
  }

  async function changeInventoryRecordStatus(entity: InventoryRecordEntity, record: any) {
    const isActive = entity === "part"
      ? String(record.status ?? "ativo").toLowerCase() !== "inativo"
      : String(record.status ?? "active") === "active";
    await runAction(
      () => setDbsInventoryRecordStatus({ data: { entity, id: String(record.id), action: isActive ? "archive" : "restore" } }),
      isActive ? "Cadastro arquivado. O histórico foi preservado." : "Cadastro restaurado e disponível novamente nas operações.",
    );
  }

  function requestInventoryDelete(entity: InventoryRecordEntity, record: any, label: string) {
    setPendingDelete({ entity, id: String(record.id), label });
  }

  async function confirmInventoryDelete() {
    if (!pendingDelete) return;
    const target = pendingDelete;
    const saved = await runAction(() => deleteDbsInventoryRecord({ data: { entity: target.entity, id: target.id } }), "Cadastro excluído definitivamente.");
    if (saved) {
      setPendingDelete(null);
      if (masterRecordId === target.id) { setMasterRecordId(""); setActiveDrawer(null); }
    }
  }

  function inventoryRecordActions(entity: InventoryRecordEntity, record: any, label: string) {
    const isActive = entity === "part"
      ? String(record.status ?? "ativo").toLowerCase() !== "inativo"
      : String(record.status ?? "active") === "active";
    const protectedUnit = entity === "measure_unit" && Boolean(record.is_system);
    return <div className="flex flex-wrap items-center gap-1.5">
      <button type="button" disabled={protectedUnit} onClick={() => {
        if (entity === "part") { selectCatalogPart(String(record.id)); setActiveDrawer("new-part"); }
        else openEditMasterRecord(entity, record);
      }} aria-label={"Editar " + label} title="Editar cadastro" className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:border-sky-300 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-40">
        <Pencil className="h-3.5 w-3.5" /> Editar
      </button>
      <button type="button" disabled={protectedUnit} onClick={() => void changeInventoryRecordStatus(entity, record)} aria-label={(isActive ? "Arquivar " : "Restaurar ") + label} title={isActive ? "Arquivar cadastro" : "Restaurar cadastro"} className={"inline-flex min-h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold " + (isActive ? "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100" : "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100") + " disabled:cursor-not-allowed disabled:opacity-40"}>
        {isActive ? <Archive className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}{isActive ? "Arquivar" : "Restaurar"}
      </button>
      <button type="button" disabled={protectedUnit} onClick={() => requestInventoryDelete(entity, record, label)} aria-label={"Excluir " + label} title="Excluir definitivamente" className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-2.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40">
        <Trash2 className="h-3.5 w-3.5" /> Excluir
      </button>
    </div>;
  }

  async function addCostCenter(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = masterRecordId
      ? await runAction(() => updateDbsInventoryMasterData({ data: { entity: "cost_center", id: masterRecordId, code: newCostCenterCode, name: newCostCenterName } }), "Centro de custo atualizado.")
      : await runAction(() => createDbsCostCenter({ data: { code: newCostCenterCode, name: newCostCenterName } }), "Centro de custo salvo e disponível para compras, OS e consumo.");
    if (saved) { setNewCostCenterCode(""); setNewCostCenterName(""); setMasterRecordId(""); setActiveDrawer(null); }
  }

  async function createOperationalStock(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(!operationalStockCostCenterId||operationalStockName.trim().length<2){setMessage("Informe o centro de custo e o nome do estoque operacional.");return;}
    const saved=await runAction(()=>createDbsOperationalStock({data:{costCenterId:operationalStockCostCenterId,name:operationalStockName.trim()}}),"Estoque operacional criado e vinculado ao centro de custo.");
    if(saved){setOperationalStockName("");setOperationalStockCostCenterId("");setActiveDrawer(null);}
  }

  async function toggleOperationalStockStatus(stock:any) {
    const nextStatus=stock.status==="active"?"inactive":"active";
    await runAction(()=>setDbsOperationalStockStatus({data:{stockId:String(stock.id),status:nextStatus}}),
      nextStatus==="active"?"Estoque operacional ativado.":"Estoque operacional arquivado sem apagar histórico ou saldos.");
  }

  async function transferStockToTechnician(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const source=transferSourceStockId==="central"?null:transferSourceStockId;
    const destination=transferDestinationStockId==="central"?null:transferDestinationStockId;
    if(!transferPartId||!(Number(transferQuantity)>0)||(!source&&!destination)||transferSourceStockId===transferDestinationStockId){
      setMessage("Selecione peça, quantidade, origem e destino diferentes.");return;
    }
    const saved=await runAction(()=>transferDbsOperationalStock({data:{
      partId:transferPartId,quantity:Number(transferQuantity),sourceStockId:source,destinationStockId:destination,
      idempotencyKey:"operational-transfer:"+crypto.randomUUID(),reference:transferVehicleLabel.trim()
    }}),"Transferência transacional concluída e registrada no histórico.");
    if(saved){setTransferQuantity("1");setTransferPartId("");setTransferSourceStockId("central");setTransferDestinationStockId("");setActiveDrawer(null);}
  }

  async function addSupplier(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (masterRecordId) {
      const saved = await runAction(() => updateDbsInventoryMasterData({ data: { entity: "supplier", id: masterRecordId, name: newSupplierName, cnpj: newSupplierCnpj, phone: newSupplierPhone } }), "Fornecedor atualizado.");
      if (saved) { setNewSupplierName(""); setNewSupplierCnpj(""); setNewSupplierPhone(""); setMasterRecordId(""); setActiveDrawer(null); }
      return;
    }
    let createdId = "";
    const saved = await runAction(async () => {
      const created: any = await createDbsSupplier({ data: { name:newSupplierName, cnpj:newSupplierCnpj, phone:newSupplierPhone } });
      createdId = String(created?.id ?? "");
    }, "Fornecedor cadastrado e disponível no cadastro da peça e em Compras.");
    if (saved) {
      setNewSupplierName(""); setNewSupplierCnpj(""); setNewSupplierPhone(""); setActiveDrawer(null);
      if (createdId) { setCatalogPartSupplierId((current) => current || createdId); setSupplierId((current) => current || createdId); }
    }
  }
  async function addMeasureUnit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (masterRecordId) {
      const selected = measureUnits.find((unit: any) => String(unit.id) === masterRecordId);
      const saved = await runAction(() => updateDbsInventoryMasterData({ data: { entity: "measure_unit", id: masterRecordId, code: newUnitCode, name: newUnitName, symbol: newUnitSymbol || newUnitCode, decimalPlaces: Number(selected?.decimal_places ?? 3) } }), "Unidade de medida atualizada.");
      if (saved) { setNewUnitCode(""); setNewUnitName(""); setNewUnitSymbol(""); setMasterRecordId(""); setActiveDrawer(null); }
      return;
    }
    let createdId = "";
    const saved = await runAction(async () => {
      const created: any = await createDbsMeasureUnit({ data: { code:newUnitCode, name:newUnitName, symbol:newUnitSymbol||newUnitCode } });
      createdId = String(created?.id ?? "");
    }, "Unidade de medida cadastrada e disponível como unidade-base.");
    if (saved) { setNewUnitCode(""); setNewUnitName(""); setNewUnitSymbol(""); setActiveDrawer(null); if (createdId) setCatalogPartUnitId((current) => current || createdId); }
  }
  async function addUnitConversion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (masterRecordId) {
      const saved = await runAction(() => updateDbsInventoryMasterData({ data: { entity: "unit_conversion", id: masterRecordId, fromUnitId: conversionFrom, toUnitId: conversionTo, factor: Number(conversionFactor) } }), "Conversão de unidade atualizada.");
      if (saved) { setConversionFactor("1"); setConversionFrom(""); setConversionTo(""); setMasterRecordId(""); setActiveDrawer(null); }
      return;
    }
    const saved = await runAction(() => createDbsUnitConversion({ data: { fromUnitId:conversionFrom, toUnitId:conversionTo, factor:Number(conversionFactor) } }), "Conversão de unidade cadastrada.");
    if (saved) { setConversionFactor("1"); setConversionFrom(""); setConversionTo(""); setActiveDrawer(null); }
  }

  async function linkOrderCostCenter(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(!costCenterWorkOrderId||!costCenterWorkOrderValue){setMessage("Selecione a OS e o centro de custo.");return;}
    const saved=await runAction(()=>setDbsWorkOrderCostCenter({data:{workOrderId:costCenterWorkOrderId,costCenterId:costCenterWorkOrderValue}}),"Centro de custo vinculado à ordem de serviço.");
    if(saved){setCostCenterWorkOrderId("");setCostCenterWorkOrderValue("");setActiveDrawer(null);}
  }

  async function assignWeightedGasCylinder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const tare=Number(gasTareWeight), gross=Number(gasInitialGrossWeight), charges=Number(gasTotalCharges);
    if(!gasSerialNumber.trim()||!gasType.trim()||!gasEmployeeId||!Number.isInteger(charges)||charges<=0||
      !Number.isFinite(tare)||!Number.isFinite(gross)||tare<0||gross<=tare){
      setMessage("Informe série, refrigerante, técnico, quantidade de cargas, tara e peso bruto inicial válidos.");
      return;
    }
    const saved=await runAction(async()=>{
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
    if (saved) {
      setGasSerialNumber("");setGasVehicleLabel("");setGasTotalCharges("10");setGasTareWeight("");setGasInitialGrossWeight("");
      setActiveDrawer(null);
    }
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
    if (!partId || !workOrderId || !costCenterId || !reservationStockId || Number(quantity) <= 0) {
      setMessage("Selecione OS, peça, quantidade e centro de custo.");
      return;
    }
    const saved = await runAction(async () => {
      await setDbsWorkOrderCostCenter({ data: { workOrderId, costCenterId } });
      return reserveDbsOperationalStockForWorkOrder({data:{
        workOrderId,costCenterId,stockId:reservationStockId,partId,quantity:Number(quantity),purpose:reservationPurpose,
        idempotencyKey:"operational-reserve:"+crypto.randomUUID()
      }});
    }, "Reserva registrada no estoque operacional do centro de custo; o estoque central não foi alterado.");
    if (saved) setActiveDrawer(null);
  }


  return (
    <main className="dbs-operations-page min-h-full bg-[#f8fafc] px-4 py-4 text-slate-900 sm:px-6 lg:px-7">
      <div className="mx-auto max-w-[1440px]">
        {!embedded && <header className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
          <div className="flex min-w-0 items-center gap-3">
            <BrandLogo frameClassName="rounded-lg px-2 py-1" imageClassName="h-8 w-auto max-w-[132px] object-contain" />
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">{moduleSection === "parts" ? "Peças & Estoque" : "Compras"}</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/dbs-control" className="inline-flex min-h-10 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">Menu principal</Link>
            <button type="button" onClick={()=>moduleSection==="parts"?(setCatalogPartId(""),setActiveDrawer("new-part")):setActiveDrawer("new-purchase")} className="inline-flex min-h-10 items-center rounded-lg bg-[#1557a0] px-4 text-sm font-semibold text-white">{moduleSection==="parts"?"+ Nova peça":"+ Nova compra"}</button>
          </div>
        </header>}
        {!embedded && <nav aria-label="Módulos" className="mb-5 flex gap-6 border-b border-slate-200">
          <button type="button" aria-pressed={moduleSection==="parts"} onClick={()=>{setModuleSection("parts");setActiveDrawer(null);}} className={moduleSection==="parts"?"dbs-op-tab is-active":"dbs-op-tab"}>Peças & Estoque</button>
          <button type="button" aria-pressed={moduleSection==="purchases"} onClick={()=>{setModuleSection("purchases");setActiveDrawer(null);}} className={moduleSection==="purchases"?"dbs-op-tab is-active":"dbs-op-tab"}>Compras</button>
        </nav>}
        {moduleSection === "parts" && <nav aria-label="Peças e Estoque" className="dbs-op-tabs mb-5">
          <button type="button" role="tab" aria-selected={partsView==="catalog"} onClick={()=>setPartsView("catalog")} className={partsView==="catalog"?"dbs-op-tab is-active":"dbs-op-tab"}>Catálogo de Peças</button>
          <button type="button" role="tab" aria-selected={partsView==="stock"} onClick={()=>setPartsView("stock")} className={partsView==="stock"?"dbs-op-tab is-active":"dbs-op-tab"}>Estoques</button>
          <button type="button" role="tab" aria-selected={partsView==="reservations"} onClick={()=>setPartsView("reservations")} className={partsView==="reservations"?"dbs-op-tab is-active":"dbs-op-tab"}>Reservas para OS <span className="dbs-op-count">{reservations.filter((item:any)=>item.status==="reserved").length}</span></button>
          <button type="button" role="tab" aria-selected={partsView==="settings"} onClick={()=>setPartsView("settings")} className={partsView==="settings"?"dbs-op-tab is-active":"dbs-op-tab"}>Cadastros Básicos {(!suppliers.length||!measureUnits.length||!costCenters.length)&&<span className="dbs-op-dot" aria-label="Configuração pendente"/>}</button>
        </nav>}
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
<Sheet open={activeDrawer === "new-part"} onOpenChange={(open)=>setActiveDrawer(open?"new-part":null)}>
  <SheetContent side="right" className="dbs-operations-drawer w-[96vw] max-w-[560px] overflow-y-auto border-l border-slate-200 bg-white p-5 sm:p-7">
    <SheetHeader className="mb-6 border-b border-slate-100 pb-4"><SheetTitle className="text-xl font-semibold tracking-tight text-slate-900">{catalogPartId ? "Editar peça" : "Nova peça"}</SheetTitle></SheetHeader>
    <form onSubmit={saveCatalogPart} className="space-y-4">
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
                <label className="text-xs font-bold text-slate-600">Unidade de controle / consumo *
                  <select required value={catalogPartUnitId} onChange={e=>setCatalogPartUnitId(e.target.value)} className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
                    <option value="">Selecione unidade de estoque</option>{activeMeasureUnits.map((unit:any)=><option key={unit.id} value={unit.id}>{unit.code} · {unit.name}</option>)}
                  </select>
                </label>
                <label className="text-xs font-bold text-slate-600">Unidade de compra / entrada (opcional)
                  <select value={catalogPartPurchaseUnitId} onChange={e=>setCatalogPartPurchaseUnitId(e.target.value)} className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
                    <option value="">Igual à unidade de controle</option>{activeMeasureUnits.map((unit:any)=><option key={unit.id} value={unit.id}>{unit.code} · {unit.name}</option>)}
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
  </SheetContent>
</Sheet>
          
          
          

          </>}
          {partsView === "settings" && <>
            <nav className="dbs-op-tabs mb-5" aria-label="Cadastros básicos">
              <button type="button" role="tab" aria-selected={settingsView==="suppliers"} onClick={()=>setSettingsView("suppliers")} className={settingsView==="suppliers"?"dbs-op-tab is-active":"dbs-op-tab"}>Fornecedores <span className="dbs-op-count">{suppliers.length}</span></button>
              <button type="button" role="tab" aria-selected={settingsView==="cost-centers"} onClick={()=>setSettingsView("cost-centers")} className={settingsView==="cost-centers"?"dbs-op-tab is-active":"dbs-op-tab"}>Centros de custo <span className="dbs-op-count">{costCenters.length}</span></button>
              <button type="button" role="tab" aria-selected={settingsView==="units"} onClick={()=>setSettingsView("units")} className={settingsView==="units"?"dbs-op-tab is-active":"dbs-op-tab"}>Unidades <span className="dbs-op-count">{measureUnits.length}</span></button>
              <button type="button" role="tab" aria-selected={settingsView==="conversions"} onClick={()=>setSettingsView("conversions")} className={settingsView==="conversions"?"dbs-op-tab is-active":"dbs-op-tab"}>Conversões <span className="dbs-op-count">{unitConversions.length}</span></button>
            </nav>
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
                <div>{(!suppliers.length||!measureUnits.length||!costCenters.length)&&<p className="text-xs text-amber-700">Complete os cadastros básicos para liberar o fluxo de compras.</p>}</div>
                <button type="button" onClick={openNewMasterRecord} className="min-h-10 rounded-lg bg-[#1557a0] px-4 text-sm font-semibold text-white">+ Adicionar</button>
              </div>
              {settingsView==="suppliers"&&<div className="divide-y divide-slate-100">{suppliers.map((supplier:any)=><div key={supplier.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"><div className="min-w-0"><p className="text-sm font-medium text-slate-900">{supplier.name}</p><p className="text-xs text-slate-500">{supplier.cnpj||"Sem CNPJ/CPF"} {supplier.phone?"· "+supplier.phone:""}</p></div>{inventoryRecordActions("supplier",supplier,supplier.name)}</div>)}{!suppliers.length&&<p className="px-5 py-8 text-center text-sm text-slate-500">Nenhum fornecedor cadastrado.</p>}</div>}
              {settingsView==="cost-centers"&&<div className="divide-y divide-slate-100">{costCenters.map((center:any)=><div key={center.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"><div className="min-w-0"><p className="text-sm font-medium text-slate-900">{center.name}</p><p className="text-xs text-slate-500">{center.code}</p></div>{inventoryRecordActions("cost_center",center,center.name)}</div>)}{!costCenters.length&&<p className="px-5 py-8 text-center text-sm text-slate-500">Nenhum centro de custo cadastrado.</p>}</div>}
              {settingsView==="units"&&<div className="divide-y divide-slate-100">{measureUnits.map((unit:any)=><div key={unit.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"><div className="min-w-0"><p className="text-sm font-medium text-slate-900">{unit.name} {unit.is_system&&<span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">Padrão</span>}</p><p className="text-xs text-slate-500">{unit.code} · {unit.symbol||unit.code}</p></div>{inventoryRecordActions("measure_unit",unit,unit.name)}</div>)}{!measureUnits.length&&<p className="px-5 py-8 text-center text-sm text-slate-500">Nenhuma unidade cadastrada.</p>}</div>}
              {settingsView==="conversions"&&<div className="divide-y divide-slate-100">{unitConversions.map((conversion:any)=>{const from=measureUnits.find((u:any)=>String(u.id)===String(conversion.from_unit_id));const to=measureUnits.find((u:any)=>String(u.id)===String(conversion.to_unit_id));const label=(from?.code||"Compra")+" → "+(to?.code||"Base");return <div key={conversion.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"><div><p className="text-sm font-medium text-slate-900">{from?.name||"Unidade de compra"} → {to?.name||"Unidade-base"}</p><p className="text-xs text-slate-500">{from?.symbol||from?.code||"—"} para {to?.symbol||to?.code||"—"} · {Number(conversion.factor).toLocaleString("pt-BR")} ×</p></div>{inventoryRecordActions("unit_conversion",conversion,label)}</div>;})}{!unitConversions.length&&<p className="px-5 py-8 text-center text-sm text-slate-500">Nenhuma conversão cadastrada.</p>}</div>}
            </section>
            <Sheet open={activeDrawer==="supplier"} onOpenChange={(open)=>setActiveDrawer(open?"supplier":null)}><SheetContent side="right" className="dbs-operations-drawer w-[96vw] max-w-[480px] overflow-y-auto bg-white p-5 sm:p-7"><SheetHeader className="mb-6 border-b border-slate-100 pb-4"><SheetTitle>{masterRecordId ? "Editar fornecedor" : "Novo fornecedor"}</SheetTitle></SheetHeader><form onSubmit={addSupplier} className="space-y-3">
              <input required value={newSupplierName} onChange={e=>setNewSupplierName(e.target.value)} placeholder="Nome / razão social" className="mt-3 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"/>
              <input value={newSupplierCnpj} onChange={e=>setNewSupplierCnpj(e.target.value)} placeholder="CNPJ / CPF (opcional)" className="mt-2 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"/>
              <input value={newSupplierPhone} onChange={e=>setNewSupplierPhone(e.target.value)} placeholder="Telefone (opcional)" className="mt-2 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"/>
              <button disabled={busy} className="mt-3 min-h-10 w-full rounded-lg bg-sky-700 px-3 text-sm font-bold text-white">{masterRecordId ? "Salvar fornecedor" : "Cadastrar fornecedor"}</button>
            </form></SheetContent></Sheet>
            <Sheet open={activeDrawer==="cost-center"} onOpenChange={(open)=>setActiveDrawer(open?"cost-center":null)}><SheetContent side="right" className="dbs-operations-drawer w-[96vw] max-w-[480px] overflow-y-auto bg-white p-5 sm:p-7"><SheetHeader className="mb-6 border-b border-slate-100 pb-4"><SheetTitle>{masterRecordId ? "Editar centro de custo" : "Novo centro de custo"}</SheetTitle></SheetHeader><form onSubmit={addCostCenter} className="space-y-3">
              <input required maxLength={40} value={newCostCenterCode} onChange={e=>setNewCostCenterCode(e.target.value.toUpperCase())} placeholder="Código (ex.: OPERACAO)" className="mt-3 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"/>
              <input required maxLength={180} value={newCostCenterName} onChange={e=>setNewCostCenterName(e.target.value)} placeholder="Nome do centro de custo" className="mt-2 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"/>
              <button disabled={busy} className="mt-3 min-h-10 w-full rounded-lg bg-sky-700 px-3 text-sm font-bold text-white">{masterRecordId ? "Salvar alterações" : "Salvar centro de custo"}</button>
            </form></SheetContent></Sheet>
            <Sheet open={activeDrawer==="unit"} onOpenChange={(open)=>setActiveDrawer(open?"unit":null)}><SheetContent side="right" className="dbs-operations-drawer w-[96vw] max-w-[480px] overflow-y-auto bg-white p-5 sm:p-7"><SheetHeader className="mb-6 border-b border-slate-100 pb-4"><SheetTitle>{masterRecordId ? "Editar unidade" : "Nova unidade"}</SheetTitle></SheetHeader><form onSubmit={addMeasureUnit} className="space-y-3">
              <div className="mt-3 grid grid-cols-2 gap-2">
                <input required value={newUnitCode} onChange={e=>setNewUnitCode(e.target.value.toUpperCase())} placeholder="Código (UN)" className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"/>
                <input required value={newUnitSymbol} onChange={e=>setNewUnitSymbol(e.target.value)} placeholder="Símbolo" className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"/>
              </div>
              <input required value={newUnitName} onChange={e=>setNewUnitName(e.target.value)} placeholder="Nome da unidade" className="mt-2 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"/>
              <button disabled={busy} className="mt-3 min-h-10 w-full rounded-lg bg-sky-700 px-3 text-sm font-bold text-white">{masterRecordId ? "Salvar unidade" : "Cadastrar unidade"}</button>
            </form></SheetContent></Sheet>
            <Sheet open={activeDrawer==="conversion"} onOpenChange={(open)=>setActiveDrawer(open?"conversion":null)}><SheetContent side="right" className="dbs-operations-drawer w-[96vw] max-w-[480px] overflow-y-auto bg-white p-5 sm:p-7"><SheetHeader className="mb-6 border-b border-slate-100 pb-4"><SheetTitle>{masterRecordId ? "Editar conversão" : "Nova conversão"}</SheetTitle></SheetHeader><form onSubmit={addUnitConversion} className="space-y-3">
              <select required value={conversionFrom} onChange={e=>setConversionFrom(e.target.value)} className="mt-3 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"><option value="">Unidade de compra</option>{measureUnits.map((u:any)=><option key={u.id} value={u.id}>{u.code} · {u.name}</option>)}</select>
              <select required value={conversionTo} onChange={e=>setConversionTo(e.target.value)} className="mt-2 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"><option value="">Unidade-base</option>{measureUnits.map((u:any)=><option key={u.id} value={u.id}>{u.code} · {u.name}</option>)}</select>
              <input required type="number" min="0.0001" step="0.0001" value={conversionFactor} onChange={e=>setConversionFactor(e.target.value)} placeholder="Fator (ex.: 12)" className="mt-2 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"/>
              {conversionFrom && conversionTo && conversionFrom!==conversionTo && Number(conversionFactor)>0 && <p className="rounded-xl border border-sky-100 bg-sky-50 p-3 text-sm text-sky-950">Regra configurada: <strong>1 {(measureUnits.find((u:any)=>String(u.id)===conversionFrom)?.symbol||measureUnits.find((u:any)=>String(u.id)===conversionFrom)?.code)} ({measureUnits.find((u:any)=>String(u.id)===conversionFrom)?.name})</strong> equivale a <strong>{Number(conversionFactor).toLocaleString("pt-BR")} {(measureUnits.find((u:any)=>String(u.id)===conversionTo)?.symbol||measureUnits.find((u:any)=>String(u.id)===conversionTo)?.code)} ({measureUnits.find((u:any)=>String(u.id)===conversionTo)?.name})</strong> no estoque.</p>}
              <button disabled={busy} className="mt-3 min-h-10 w-full rounded-lg bg-sky-700 px-3 text-sm font-bold text-white">{masterRecordId ? "Salvar conversão" : "Cadastrar conversão"}</button>
            </form></SheetContent></Sheet>
          </>}
          {partsView === "catalog" && <>
          <section className="mb-6">
            
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-5">
                <div><p className="text-xs text-slate-500">{parts.length} itens cadastrados no catálogo</p></div>
              </div>
              <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-[minmax(0,1fr)_190px]">
                <input type="search" aria-label="Buscar peças" value={catalogSearch} onChange={e=>setCatalogSearch(e.target.value)} placeholder="Buscar por nome, SKU ou fornecedor..." className="min-h-10 w-full rounded-lg border border-slate-200 bg-[#f8fafc] px-3 text-sm outline-none focus:border-sky-400 focus:bg-white focus:ring-2 focus:ring-sky-100"/>
                <select aria-label="Filtrar peças" value={catalogFilter} onChange={e=>setCatalogFilter(e.target.value as "all"|"stock"|"setup")} className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm"><option value="all">Todas as peças</option><option value="stock">Com saldo físico</option><option value="setup">Cadastro incompleto</option></select>
              </div>
              <div className="hidden max-h-[520px] overflow-auto md:block">
                <table className="w-full min-w-[600px] text-left text-sm">
                  <thead className="sticky top-0 bg-slate-50/95 text-[11px] font-bold uppercase tracking-wide text-slate-500"><tr><th className="p-3">Peça / SKU</th><th className="p-3">Fornecedor</th><th className="p-3">Unidade</th><th className="p-3">Custo</th><th className="p-3">Saldo central</th><th className="p-3 text-right">Ações</th></tr></thead>
                  <tbody>{visibleParts.map((part:any)=>{
                    const supplier=suppliers.find((row:any)=>String(row.id)===String(part.supplier_id));
                    const unit=measureUnits.find((row:any)=>String(row.id)===String(part.measure_unit_id));
                    return <tr key={part.id} className="border-t border-slate-100">
                      <td className="p-3"><button type="button" onClick={()=>{selectCatalogPart(String(part.id));setActiveDrawer("new-part");}} className="text-left font-bold text-sky-800 hover:underline">{part.name||part.description||"Peça"}<span className="block text-xs font-normal text-slate-500">{part.sku||"Sem SKU"}</span></button></td>
                      <td className="p-3">{supplier?.name||<span className="font-semibold text-amber-700">Vincular</span>}</td>
                      <td className="p-3">{unit?.symbol||unit?.code||<span className="font-semibold text-amber-700">Definir</span>}</td>
                      <td className="p-3">{money(part.cost_cents)}</td>
                      <td className="p-3 font-bold">{Number(part.stock_quantity||0).toLocaleString("pt-BR")} {unit?.symbol||""}</td>
                      <td className="p-3 text-right">{inventoryRecordActions("part",part,part.name||part.sku||"Peça")}</td>
                    </tr>;
                  })}</tbody>
                </table>
                {!visibleParts.length && <p className="p-5 text-sm text-slate-500">{catalogSearch || catalogFilter !== "all" ? "Nenhuma peça encontrada." : "Nenhuma peça cadastrada ainda."}</p>}
              </div>
              <div className="grid gap-2 p-3 md:hidden">
                {visibleParts.map((part:any) => {
                  const supplier = suppliers.find((row:any)=>String(row.id)===String(part.supplier_id));
                  const unit = measureUnits.find((row:any)=>String(row.id)===String(part.measure_unit_id));
                  return <article key={part.id} className="rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm">
                    <button type="button" onClick={()=>{selectCatalogPart(String(part.id));setActiveDrawer("new-part");}} className="block w-full text-left">
                      <span className="block font-bold text-slate-900">{part.name||part.description||"Peça"}</span>
                      <span className="mt-0.5 block text-xs text-slate-500">{part.sku||"Sem SKU"} · Toque para editar</span>
                      <span className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600">
                        <span>Fornecedor: <strong>{supplier?.name||"Vincular"}</strong></span>
                        <span>Unidade: <strong>{unit?.symbol||unit?.code||"Definir"}</strong></span>
                        <span>Custo: <strong>{money(part.cost_cents)}</strong></span>
                        <span>Saldo: <strong>{Number(part.stock_quantity||0).toLocaleString("pt-BR")}</strong></span>
                      </span>
                    </button>
                    <div className="mt-3 border-t border-slate-100 pt-3">{inventoryRecordActions("part",part,part.name||part.sku||"Peça")}</div>
                  </article>;
                })}
                {!visibleParts.length && <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Nenhuma peça encontrada.</p>}
              </div>
            </div>
          </section>
          </>}
          {partsView === "stock" && <>
<section aria-label="Resumo do estoque" className="mb-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-medium text-slate-500">Peças no catálogo</p><p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{parts.length}</p></div>
            <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-medium text-slate-500">SKUs com saldo central</p><p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{parts.filter((part:any)=>Number(part.stock_quantity||0)>0).length}</p></div>
            <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-medium text-slate-500">Estoques operacionais ativos</p><p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{operationalStocks.filter((stock:any)=>stock.status==="active").length}</p></div>
          </section>
<details className="mb-5 overflow-hidden rounded-xl border border-slate-200 bg-white"><summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-900">Custos de materiais por OS</summary><div className="overflow-x-auto border-t border-slate-100"><table className="w-full min-w-[600px] text-left text-sm"><thead className="bg-[#f8fafc] text-xs font-semibold uppercase text-slate-500"><tr><th className="px-4 py-3">OS</th><th className="px-4 py-3">Registro</th><th className="px-4 py-3">Custo</th><th className="px-4 py-3">Atualizado</th></tr></thead><tbody>{workOrderFinancials.map((row:any)=>{const order=workOrders.find((entry:any)=>String(entry.id)===String(row.work_order_id));return <tr key={row.work_order_id} className="border-t border-slate-100"><td className="px-4 py-3 font-medium">{order?.protocol||String(row.work_order_id).slice(0,8)}</td><td className="px-4 py-3">{row.status||"Registrado"}</td><td className="px-4 py-3 font-semibold">{money(row.parts_cost_cents)}</td><td className="px-4 py-3">{row.updated_at?new Date(row.updated_at).toLocaleString("pt-BR"):"—"}</td></tr>;})}</tbody></table>{!workOrderFinancials.length&&<p className="p-4 text-sm text-slate-500">Os custos aparecerão aqui quando materiais forem consumidos e vinculados às OS.</p>}</div></details>
          <section className="mb-5 overflow-hidden rounded-2xl border border-sky-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-slate-900">Estoque Central</h2>
              <button type="button" onClick={()=>{setTransferPartId("");setActiveDrawer("transfer");}} className="min-h-10 rounded-lg bg-[#1557a0] px-4 text-sm font-semibold text-white hover:bg-[#104982]">+ Transferir</button>
            </div>
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">SKUs com saldo físico</p><p className="text-xl font-black">{parts.filter((p:any)=>Number(p.stock_quantity||0)>0).length}</p></div>
              <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">SKUs com reserva central</p><p className="text-xl font-black">{parts.filter((p:any)=>Number(p.reserved_quantity||0)>0).length}</p></div>
              <div className="rounded-xl bg-sky-50 p-3"><p className="text-xs text-sky-800">SKUs disponíveis no central</p><p className="text-xl font-black text-sky-900">{parts.filter((p:any)=>Number(p.stock_quantity||0)-Number(p.reserved_quantity||0)>0).length}</p></div>
            </div>
            <div className="grid gap-4">
              <div className="hidden overflow-x-auto rounded-xl border border-slate-100 md:block">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Material</th><th className="p-3">Saldo físico</th><th className="p-3">Reservado</th><th className="p-3">Disponível</th><th className="p-3">Custo médio</th><th className="p-3 text-right">Ação</th></tr></thead>
                  <tbody>{parts.map((part:any)=>{
                    const unit=measureUnits.find((row:any)=>String(row.id)===String(part.measure_unit_id));
                    const physical=Number(part.stock_quantity||0),reserved=Number(part.reserved_quantity||0);
                    return <tr key={part.id} className="border-t border-slate-100">
                      <td className="p-3"><strong>{part.name||part.description||"Peça"}</strong><span className="block text-xs text-slate-500">{part.sku||"Sem SKU"}</span></td>
                      <td className="p-3">{physical.toLocaleString("pt-BR")} {unit?.symbol||""}</td>
                      <td className="p-3">{reserved.toLocaleString("pt-BR")}</td>
                      <td className="p-3 font-bold">{Math.max(0,physical-reserved).toLocaleString("pt-BR")}</td>
                      <td className="p-3">{money(part.cost_cents)}</td>
                      <td className="p-3 text-right"><button type="button" disabled={Math.max(0,physical-reserved)<=0} onClick={()=>{setTransferPartId(String(part.id));setActiveDrawer("transfer");}} className="min-h-8 rounded-md border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-sky-50 disabled:opacity-40">Transferir</button></td>
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
                    <button type="button" disabled={Math.max(0,physical-reserved)<=0} onClick={()=>{setTransferPartId(String(part.id));setActiveDrawer("transfer");}} className="mt-3 min-h-9 w-full rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-sky-50 disabled:opacity-40">Transferir</button>
                  </article>;
                })}
              </div>
              
            </div>
            <section className="mt-6 overflow-hidden rounded-xl border border-sky-100">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-sky-50/60 p-4">
                <div><h3 className="font-black text-slate-900">Estoques Operacionais por Centro de Custo</h3><p className="mt-1 text-xs text-slate-600">Saldos independentes do Estoque Central, com reserva e histórico próprios.</p></div>
                <button type="button" onClick={()=>setActiveDrawer("operational-stock")} className="min-h-10 rounded-lg bg-[#1557a0] px-4 text-xs font-bold text-white">+ Novo estoque operacional</button>
              </div>
              <div className="grid gap-3 p-4 sm:grid-cols-3">
                <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Estoques ativos</p><p className="text-xl font-black">{operationalStocks.filter((s:any)=>s.status==="active").length}</p></div>
                <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Centros vinculados</p><p className="text-xl font-black">{new Set(operationalStocks.map((s:any)=>s.cost_center_id)).size}</p></div>
                <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">SKUs com saldo operacional</p><p className="text-xl font-black">{new Set(operationalBalances.filter((b:any)=>Number(b.quantity||0)>0).map((b:any)=>b.part_id)).size}</p></div>
                <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">SKUs com reserva operacional</p><p className="text-xl font-black">{new Set(operationalBalances.filter((b:any)=>Number(b.reserved_quantity||0)>0).map((b:any)=>b.part_id)).size}</p></div>
                <div className="rounded-xl bg-sky-50 p-3"><p className="text-xs text-sky-800">SKUs disponíveis operacionais</p><p className="text-xl font-black text-sky-900">{new Set(operationalBalances.filter((b:any)=>Number(b.quantity||0)-Number(b.reserved_quantity||0)>0).map((b:any)=>b.part_id)).size}</p></div>
                <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Movimentações recentes</p><p className="text-xl font-black">{operationalMovements.length}</p></div>
              </div>
              <div className="overflow-x-auto px-4 pb-4">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Estoque operacional</th><th className="p-3">Centro de custo</th><th className="p-3">Peça</th><th className="p-3">Físico</th><th className="p-3">Reservado</th><th className="p-3">Disponível</th></tr></thead>
                  <tbody>{operationalStocks.flatMap((stock:any)=>{
                    const cc=costCenters.find((x:any)=>x.id===stock.cost_center_id);
                    const rows=operationalBalances.filter((b:any)=>b.stock_id===stock.id);
                    return rows.length?rows.map((balance:any,index:number)=>{const part=parts.find((p:any)=>p.id===balance.part_id);const unit=measureUnits.find((u:any)=>u.id===part?.measure_unit_id);return <tr key={balance.id} className="border-t border-slate-100"><td className="p-3 font-semibold">{stock.name}<span className={stock.status==="active"?"ml-2 rounded-full bg-emerald-50 px-2 py-1 text-[10px] text-emerald-800":"ml-2 rounded-full bg-slate-100 px-2 py-1 text-[10px] text-slate-600"}>{stock.status==="active"?"Ativo":"Arquivado"}</span>{index===0&&<button type="button" disabled={busy} onClick={()=>void toggleOperationalStockStatus(stock)} className="mt-1 block text-[10px] font-bold text-sky-700 underline">{stock.status==="active"?"Arquivar":"Reativar"}</button>}</td><td className="p-3">{cc?.code} · {cc?.name}</td><td className="p-3">{part?.sku} · {part?.name}</td><td className="p-3">{Number(balance.quantity).toLocaleString("pt-BR")} {unit?.symbol||""}</td><td className="p-3">{Number(balance.reserved_quantity).toLocaleString("pt-BR")}</td><td className="p-3 font-black">{Math.max(0,Number(balance.quantity)-Number(balance.reserved_quantity)).toLocaleString("pt-BR")}</td></tr>;})
                    :[<tr key={stock.id} className="border-t border-slate-100"><td className="p-3 font-semibold">{stock.name}<span className={stock.status==="active"?"ml-2 rounded-full bg-emerald-50 px-2 py-1 text-[10px] text-emerald-800":"ml-2 rounded-full bg-slate-100 px-2 py-1 text-[10px] text-slate-600"}>{stock.status==="active"?"Ativo":"Arquivado"}</span><button type="button" disabled={busy} onClick={()=>void toggleOperationalStockStatus(stock)} className="mt-1 block text-[10px] font-bold text-sky-700 underline">{stock.status==="active"?"Arquivar":"Reativar"}</button></td><td className="p-3">{cc?.code} · {cc?.name}</td><td colSpan={4} className="p-3 text-slate-400">Sem saldo movimentado</td></tr>];
                  })}</tbody>
                </table>
                {!operationalStocks.length&&<p className="p-4 text-sm text-slate-500">Nenhum estoque operacional cadastrado. Crie um e vincule a um centro de custo ativo.</p>}
              </div>
              <div className="border-t border-slate-100 p-4">
                <h4 className="mb-2 text-sm font-black">Histórico transacional operacional</h4>
                <div className="space-y-2">{operationalMovements.slice(0,12).map((movement:any)=>{const part=parts.find((p:any)=>p.id===movement.part_id);const source=operationalStocks.find((s:any)=>s.id===movement.source_stock_id);const destination=operationalStocks.find((s:any)=>s.id===movement.destination_stock_id);const order=workOrders.find((o:any)=>String(o.id)===String(movement.work_order_id));const route=movement.movement_type==="ENTRADA"?"Compra → Estoque Central":movement.movement_type==="SAIDA_OS"?(source?.name||"Estoque Operacional")+" → OS "+(order?.protocol||String(movement.work_order_id||"").slice(0,8)):(source?.name||"Estoque Central")+" → "+(destination?.name||"Estoque Central");const purchaseLabel=movement.movement_type==="ENTRADA"&&movement.purchase_id?" · Compra "+String(movement.purchase_id).slice(0,8):"";return <div key={movement.id} className="flex flex-wrap justify-between gap-2 rounded-lg bg-slate-50 p-3 text-xs"><div><strong>{movement.movement_type}</strong><span className="ml-2 text-slate-600">{part?.sku} · {part?.name}</span><p className="mt-1 text-slate-500">{route}{purchaseLabel} {(movement.reference?"· "+movement.reference:"")}<span className="block text-slate-500">Responsável: {movementUsers.find((u:any)=>String(u.id)===String(movement.created_by))?.full_name||movementUsers.find((u:any)=>String(u.id)===String(movement.created_by))?.username||"Usuário do sistema"}</span></p></div><div className="text-right"><strong>{Number(movement.quantity).toLocaleString("pt-BR")}</strong><p className="text-slate-500">{new Date(movement.created_at).toLocaleString("pt-BR")}</p></div></div>;})}
                  {!operationalMovements.length&&<p className="text-xs text-slate-500">O histórico será preenchido pelas transferências e entradas operacionais.</p>}
                </div>
              </div>
            </section>
            <div className="mt-5 overflow-hidden rounded-xl border border-slate-100">
              <div className="border-b border-slate-100 p-3"><h3 className="font-black">Custódia legada de veículos e técnicos</h3><p className="text-xs text-slate-500">Registros históricos mantidos para consulta; novas transferências usam Estoques Operacionais.</p></div>
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
            
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h3 className="text-sm font-semibold text-slate-900">Centro de custo da OS</h3>
              <p className="mt-1 text-xs text-slate-500">Vincule a classificação antes do consumo.</p>
              <button type="button" onClick={()=>setActiveDrawer("link-cost-center")} className="mt-3 min-h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">Vincular à OS</button>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-slate-900">Cilindros sob custódia</h2><span className="text-xs text-slate-500">{gasCylinders.length} cadastrados</span></div><button type="button" onClick={()=>setActiveDrawer("gas-cylinder")} className="min-h-9 rounded-lg bg-[#1557a0] px-3 text-xs font-semibold text-white hover:bg-[#104982]">+ Cilindro</button></div>
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

          <Sheet open={activeDrawer==="transfer"} onOpenChange={(open)=>setActiveDrawer(open?"transfer":null)}>
            <SheetContent side="right" className="dbs-operations-drawer w-[96vw] max-w-[520px] overflow-y-auto border-l border-slate-200 bg-white p-5 sm:p-7">
              <SheetHeader className="mb-6 border-b border-slate-100 pb-4"><SheetTitle>Transferir entre estoques</SheetTitle><SheetDescription>Movimentação atômica com validação de saldo, responsável e histórico.</SheetDescription></SheetHeader>
              <form onSubmit={transferStockToTechnician} className="space-y-4">
                <label className="block text-xs font-bold text-slate-600">Origem *
                  <select required value={transferSourceStockId} onChange={e=>{setTransferSourceStockId(e.target.value);if(e.target.value===transferDestinationStockId)setTransferDestinationStockId("");}} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
                    <option value="central">Estoque Central</option>{operationalStocks.filter((s:any)=>s.status==="active").map((s:any)=>{const cc=costCenters.find((c:any)=>c.id===s.cost_center_id);return <option key={s.id} value={s.id}>{cc?.code} · {s.name}</option>;})}
                  </select>
                </label>
                <label className="block text-xs font-bold text-slate-600">Destino *
                  <select required value={transferDestinationStockId} onChange={e=>setTransferDestinationStockId(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
                    <option value="">Selecione destino</option><option value="central" disabled={transferSourceStockId==="central"}>Estoque Central</option>{operationalStocks.filter((s:any)=>s.status==="active"&&s.id!==transferSourceStockId).map((s:any)=>{const cc=costCenters.find((c:any)=>c.id===s.cost_center_id);return <option key={s.id} value={s.id}>{cc?.code} · {s.name}</option>;})}
                  </select>
                </label>
                <label className="block text-xs font-bold text-slate-600">Peça / insumo *
                  <select required value={transferPartId} onChange={e=>setTransferPartId(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
                    <option value="">Selecione material</option>{activeParts.map((part:any)=>{const b=operationalBalances.find((x:any)=>x.stock_id===transferSourceStockId&&x.part_id===part.id);const free=transferSourceStockId==="central"?Math.max(0,Number(part.stock_quantity||0)-Number(part.reserved_quantity||0)):Math.max(0,Number(b?.quantity||0)-Number(b?.reserved_quantity||0));return <option key={part.id} value={part.id}>{part.sku||part.name} · disponível {free.toLocaleString("pt-BR")}</option>;})}
                  </select>
                </label>
                <label className="block text-xs font-bold text-slate-600">Quantidade *
                  <input required type="number" min="0.001" step="0.001" value={transferQuantity} onChange={e=>setTransferQuantity(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm"/>
                </label>
                <label className="block text-xs font-bold text-slate-600">Referência / documento
                  <input value={transferVehicleLabel} onChange={e=>setTransferVehicleLabel(e.target.value)} maxLength={180} placeholder="OS, nota ou justificativa" className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm"/>
                </label>
                <button disabled={busy||!transferPartId||!transferDestinationStockId||transferSourceStockId===transferDestinationStockId||!operationalStocks.length} className="min-h-11 w-full rounded-xl bg-sky-700 px-4 text-sm font-black text-white disabled:opacity-40">{busy?"Transferindo...":"Confirmar transferência"}</button>
              </form>
            </SheetContent>
          </Sheet>
          <Sheet open={activeDrawer==="operational-stock"} onOpenChange={open=>setActiveDrawer(open?"operational-stock":null)}>
            <SheetContent side="right" className="dbs-operations-drawer w-[96vw] max-w-[480px] overflow-y-auto bg-white p-6">
              <SheetHeader className="mb-5 border-b border-slate-100 pb-4"><SheetTitle>Novo estoque operacional</SheetTitle><SheetDescription>Cada estoque pertence a um único centro de custo.</SheetDescription></SheetHeader>
              <form onSubmit={createOperationalStock} className="space-y-4">
                <label className="block text-xs font-bold text-slate-600">Centro de custo *
                  <select required value={operationalStockCostCenterId} onChange={e=>setOperationalStockCostCenterId(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm"><option value="">Selecione centro de custo</option>{activeCostCenters.map((cc:any)=><option key={cc.id} value={cc.id}>{cc.code} · {cc.name}</option>)}</select>
                </label>
                <label className="block text-xs font-bold text-slate-600">Nome do estoque *
                  <input required minLength={2} maxLength={160} value={operationalStockName} onChange={e=>setOperationalStockName(e.target.value)} placeholder="Ex.: Almoxarifado DML, Viatura 01, Base RJ" className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm"/>
                </label>
                <button disabled={busy||!activeCostCenters.length} className="min-h-11 w-full rounded-xl bg-sky-700 text-sm font-black text-white disabled:opacity-40">Criar estoque operacional</button>
              </form>
            </SheetContent>
          </Sheet>
          <Sheet open={activeDrawer==="link-cost-center"} onOpenChange={(open)=>setActiveDrawer(open?"link-cost-center":null)}>
            <SheetContent side="right" className="dbs-operations-drawer w-[96vw] max-w-[480px] overflow-y-auto border-l border-slate-200 bg-white p-5 sm:p-7">
              <SheetHeader className="mb-6 border-b border-slate-100 pb-4"><SheetTitle>Vincular centro de custo à OS</SheetTitle></SheetHeader>
              <form onSubmit={linkOrderCostCenter} className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-600">Filtros prévios da OS</p>
                <label className="block text-xs font-bold text-slate-600">Cliente<input list="dbs-reservation-clients" value={reservationClientSearch} onChange={e=>{const v=e.target.value;setReservationClientSearch(v);const match=clients.find((cl:any)=>(cl.trade_name||cl.legal_name)===v);setReservationClientFilter(match?String(match.id):"");setReservationFiltersApplied(false);setCostCenterWorkOrderId("");}} placeholder="Nome ou razão social" className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"/></label>
                <div className="mt-2 grid grid-cols-2 gap-2"><label className="text-xs font-bold text-slate-600">De<input type="date" value={reservationDateFrom} onChange={e=>{setReservationDateFrom(e.target.value);setReservationFiltersApplied(false);setCostCenterWorkOrderId("");}} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs"/></label><label className="text-xs font-bold text-slate-600">Até<input type="date" min={reservationDateFrom||undefined} value={reservationDateTo} onChange={e=>{setReservationDateTo(e.target.value);setReservationFiltersApplied(false);setCostCenterWorkOrderId("");}} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs"/></label></div>
                <button type="button" disabled={!reservationClientFilter&&!reservationDateFrom&&!reservationDateTo} onClick={()=>setReservationFiltersApplied(true)} className="mt-2 min-h-9 w-full rounded-lg bg-slate-800 text-xs font-bold text-white disabled:opacity-40">Aplicar filtros</button>
              </div>
              <label className="mt-3 block text-xs font-bold text-slate-600">Ordem de serviço
                <select required disabled={!reservationFiltersApplied||!filteredReservationOrders.length} value={costCenterWorkOrderId} onChange={e=>setCostCenterWorkOrderId(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm disabled:bg-slate-100">
                  <option value="">Aplique os filtros para listar OS</option>
                  {filteredReservationOrders.map((order:any)=>{const cl=clients.find((x:any)=>x.id===order.client_id);return <option key={order.id} value={order.id}>{order.protocol||order.id} · {cl?.trade_name||cl?.legal_name||"Cliente"} · {String(order.created_at||"").slice(0,10)}</option>;})}
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
            </SheetContent>
          </Sheet>
          <Sheet open={activeDrawer==="gas-cylinder"} onOpenChange={(open)=>setActiveDrawer(open?"gas-cylinder":null)}>
            <SheetContent side="right" className="dbs-operations-drawer w-[96vw] max-w-[600px] overflow-y-auto border-l border-slate-200 bg-white p-5 sm:p-7">
              <SheetHeader className="mb-6 border-b border-slate-100 pb-4"><SheetTitle>Cadastrar cilindro de gás</SheetTitle><SheetDescription>Informe identificação, técnico e pesagem inicial.</SheetDescription></SheetHeader>
              <form onSubmit={assignWeightedGasCylinder} className="grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-bold text-slate-600">Número de série *<input required value={gasSerialNumber} onChange={e=>setGasSerialNumber(e.target.value)} className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"/></label>
              <label className="text-xs font-bold text-slate-600">Refrigerante *<select required value={gasType} onChange={e=>setGasType(e.target.value)} className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"><option>R410A</option><option>R32</option><option>R22</option><option>R134a</option><option>R404A</option><option>R407C</option><option>Outro</option></select></label>
              <label className="text-xs font-bold text-slate-600">Técnico / responsável *<select required value={gasEmployeeId} onChange={e=>setGasEmployeeId(e.target.value)} className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"><option value="">Selecione técnico</option>{employees.map((employee:any)=><option key={employee.id} value={employee.id}>{employee.full_name}</option>)}</select></label>
              <label className="text-xs font-bold text-slate-600">Veículo<input value={gasVehicleLabel} onChange={e=>setGasVehicleLabel(e.target.value)} placeholder="Veículo / placa" className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"/></label>
              <label className="text-xs font-bold text-slate-600">Total de cargas *<input required type="number" min="1" step="1" value={gasTotalCharges} onChange={e=>setGasTotalCharges(e.target.value)} className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"/></label>
              <label className="text-xs font-bold text-slate-600">Tara do vasilhame (kg) *<input required type="number" min="0" step="0.001" value={gasTareWeight} onChange={e=>setGasTareWeight(e.target.value)} className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"/></label>
              <label className="text-xs font-bold text-slate-600">Peso bruto inicial (kg) *<input required type="number" min="0.001" step="0.001" value={gasInitialGrossWeight} onChange={e=>setGasInitialGrossWeight(e.target.value)} className="mt-1 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100"/></label>
              <div className="flex items-end"><button disabled={busy||!employees.length} className="min-h-10 w-full rounded-lg bg-sky-700 px-3 text-sm font-bold text-white disabled:opacity-50">Atribuir cilindro</button></div>
            </form>
            </SheetContent>
          </Sheet>
          </>}
          </>}
          {moduleSection === "purchases" && <>
          <nav className="dbs-op-tabs mb-5" aria-label="Compras">
            <button type="button" role="tab" aria-selected={purchasesView==="new"} onClick={()=>setPurchasesView("new")} className={purchasesView==="new"?"dbs-op-tab is-active":"dbs-op-tab"}>Pedidos em aberto</button>
            <button type="button" role="tab" aria-selected={purchasesView==="approval"} onClick={()=>setPurchasesView("approval")} className={purchasesView==="approval"?"dbs-op-tab is-active":"dbs-op-tab"}>Aprovações <span className="dbs-op-count">{pendingPurchases.length}</span></button>
            <button type="button" role="tab" aria-selected={purchasesView==="orders"} onClick={()=>setPurchasesView("orders")} className={purchasesView==="orders"?"dbs-op-tab is-active":"dbs-op-tab"}>Recebimento físico <span className="dbs-op-count">{purchasesAwaitingReceipt.length}</span></button>
          </nav>
          {purchasesView === "approval" && <>
          <section aria-label="Fila de aprovação financeira de compras" className="mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-900">Pedidos aguardando aprovação</h2>
              <span className="dbs-op-count" aria-label="Pedidos pendentes">{pendingPurchases.length}</span>
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[1040px] text-left text-sm">
                <thead className="bg-[#f8fafc] text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <tr><th className="px-4 py-3">Fornecedor / pedido</th><th className="px-4 py-3">Centro de custo</th><th className="px-4 py-3">Data</th><th className="px-4 py-3">Valor</th><th className="px-4 py-3">Motivo da rejeição</th><th className="px-4 py-3 text-right">Ações</th></tr>
                </thead>
                <tbody>
                  {pendingPurchases.map((purchase: any) => {
                    const id = String(purchase.id);
                    const reason = String(purchaseRejectionReasons[id] ?? "");
                    const center = costCenters.find((item: any) => String(item.id) === String(purchase.cost_center_id));
                    const sourceQuote = (data?.sourceQuotes ?? []).find((quote: any) => String(quote.id) === String(purchase.source_quote_id));
                    const lines = (data?.purchaseItems ?? []).filter((item: any) => String(item.purchase_id) === id);
                    const isSaving = busy && purchaseApprovalBusyId === id;
                    return <tr key={id} className="border-t border-slate-100 align-middle hover:bg-slate-50/70">
                      <td className="px-4 py-3"><p className="font-medium text-slate-900">{String(purchase.supplier_name ?? "Fornecedor")}</p><p className="mt-0.5 text-xs text-slate-500">{String(purchase.document_number ?? "Pedido sem documento")}</p>
                        <details className="mt-2 max-w-[420px]">
                          <summary className="cursor-pointer text-xs font-semibold text-sky-700">Conferir composição ({lines.length} item(ns))</summary>
                          {sourceQuote?.quote_number && <p className="mt-2 text-xs text-slate-500">Orçamento de origem: {sourceQuote.quote_number}</p>}
                          <div className="mt-2 space-y-2">
                            {lines.map((line: any) => {
                              const part = parts.find((entry: any) => String(entry.id) === String(line.part_id));
                              const unit = measureUnits.find((entry: any) => String(entry.id) === String(line.purchase_unit_id));
                              return <div key={line.id} className="rounded-lg bg-slate-50 p-2 text-xs">
                                <p className="font-semibold text-slate-800">{part?.sku ? String(part.sku) + " · " : ""}{part?.name || part?.description || "Peça sem nome"}</p>
                                <p className="mt-1 text-slate-600">{Number(line.purchase_quantity ?? 0).toLocaleString("pt-BR")} {unit?.symbol || unit?.code || "un."} × {money(line.purchase_unit_cost_cents)} = <strong>{money(line.total_cents)}</strong></p>
                              </div>;
                            })}
                            {!lines.length && <p className="text-xs text-rose-700">Itens não carregados. Não aprove até atualizar e conferir o pedido.</p>}
                          </div>
                        </details>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{center?.code ? String(center.code) + " · " : ""}{center?.name ?? "Não informado"}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-600">{purchase.purchase_date ? new Date(String(purchase.purchase_date) + "T12:00:00").toLocaleDateString("pt-BR") : "—"}</td>
                      <td className="px-4 py-3 whitespace-nowrap font-semibold text-slate-900">{money(purchase.total_cents)}</td>
                      <td className="px-4 py-3"><input aria-label={"Motivo da rejeição da compra " + id} value={reason} onChange={(event) => setPurchaseRejectionReasons((current) => ({ ...current, [id]: event.target.value }))} maxLength={1000} placeholder="Obrigatório para rejeitar" className="min-h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs font-normal"/></td>
                      <td className="px-4 py-3"><div className="flex justify-end gap-2">
                        {data?.canApprovePurchases === true ? <>
                          <button type="button" disabled={busy || purchaseApprovalBusyId !== null || !lines.length} onClick={() => void decidePurchaseApproval(purchase, "approved")} className="min-h-9 rounded-lg bg-emerald-700 px-3 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-40">{isSaving ? "Salvando..." : "Aprovar"}</button>
                          <button type="button" disabled={busy || purchaseApprovalBusyId !== null || reason.trim().length < 5} onClick={() => void decidePurchaseApproval(purchase, "rejected")} className="min-h-9 rounded-lg border border-rose-200 bg-white px-3 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-40">Rejeitar</button>
                        </> : <span className="text-xs text-slate-500">Somente consulta · aprovação exclusiva do SUPER_ADMIN</span>}
                      </div></td>
                    </tr>;
                  })}
                </tbody>
              </table>
              {!pendingPurchases.length && <p className="px-5 py-10 text-center text-sm text-slate-500">Nenhum pedido aguardando aprovação financeira.</p>}
            </div>
            <div className="space-y-3 p-4 md:hidden">
              {pendingPurchases.map((purchase: any) => {
                const id = String(purchase.id);
                const reason = String(purchaseRejectionReasons[id] ?? "");
                const center = costCenters.find((item: any) => String(item.id) === String(purchase.cost_center_id));
                const sourceQuote = (data?.sourceQuotes ?? []).find((quote: any) => String(quote.id) === String(purchase.source_quote_id));
                const lines = (data?.purchaseItems ?? []).filter((item: any) => String(item.purchase_id) === id);
                const isSaving = busy && purchaseApprovalBusyId === id;
                return <article key={id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-slate-900">{String(purchase.supplier_name ?? "Fornecedor")}</p><p className="text-xs text-slate-500">{String(purchase.document_number ?? "Pedido sem documento")}</p><p className="mt-1 text-xs text-slate-500">{center?.code ? String(center.code) + " · " : ""}{center?.name ?? "Não informado"}</p></div><strong className="text-sm text-slate-900">{money(purchase.total_cents)}</strong></div>
                  <details className="mt-3 rounded-lg bg-slate-50 p-3">
                    <summary className="cursor-pointer text-xs font-semibold text-sky-700">Conferir composição ({lines.length} item(ns))</summary>
                    {sourceQuote?.quote_number && <p className="mt-2 text-xs text-slate-500">Orçamento de origem: {sourceQuote.quote_number}</p>}
                    <div className="mt-2 space-y-2">
                      {lines.map((line: any) => {
                        const part = parts.find((entry: any) => String(entry.id) === String(line.part_id));
                        const unit = measureUnits.find((entry: any) => String(entry.id) === String(line.purchase_unit_id));
                        return <div key={line.id} className="rounded-lg border border-slate-200 bg-white p-2 text-xs">
                          <p className="font-semibold text-slate-800">{part?.sku ? String(part.sku) + " · " : ""}{part?.name || part?.description || "Peça sem nome"}</p>
                          <p className="mt-1 text-slate-600">{Number(line.purchase_quantity ?? 0).toLocaleString("pt-BR")} {unit?.symbol || unit?.code || "un."} × {money(line.purchase_unit_cost_cents)} = <strong>{money(line.total_cents)}</strong></p>
                        </div>;
                      })}
                      {!lines.length && <p className="text-xs text-rose-700">Itens não carregados. Não aprove até atualizar e conferir o pedido.</p>}
                    </div>
                  </details>
                  {data?.canApprovePurchases === true ? <>
                    <label className="mt-3 block text-xs font-medium text-slate-600">Motivo da rejeição<input aria-label={"Motivo da rejeição da compra " + id} value={reason} onChange={(event) => setPurchaseRejectionReasons((current) => ({ ...current, [id]: event.target.value }))} maxLength={1000} placeholder="Obrigatório para rejeitar" className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs"/></label>
                    <div className="mt-3 flex gap-2"><button type="button" disabled={busy || purchaseApprovalBusyId !== null || !lines.length} onClick={() => void decidePurchaseApproval(purchase, "approved")} className="min-h-10 flex-1 rounded-lg bg-emerald-700 px-3 text-xs font-semibold text-white disabled:opacity-40">{isSaving ? "Salvando..." : "Aprovar"}</button><button type="button" disabled={busy || purchaseApprovalBusyId !== null || reason.trim().length < 5} onClick={() => void decidePurchaseApproval(purchase, "rejected")} className="min-h-10 flex-1 rounded-lg border border-rose-200 px-3 text-xs font-semibold text-rose-700 disabled:opacity-40">Rejeitar</button></div>
                  </> : <p className="mt-3 text-xs text-slate-500">Acesso somente para consulta. Aprovação exclusiva do SUPER_ADMIN.</p>}
                </article>;
              })}
              {!pendingPurchases.length && <p className="py-8 text-center text-sm text-slate-500">Nenhum pedido aguardando aprovação financeira.</p>}
            </div>
          </section>
          </>}
          {purchasesView === "new" && <>
            {purchaseSetupIncomplete && <section aria-label="Cadastros necessários para compras" className="mb-5 flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-amber-950">Prepare os cadastros antes da primeira compra</h2>
                <p className="mt-1 text-xs leading-5 text-amber-900">
                  Fornecedores: {suppliers.length} · Unidades de medida: {measureUnits.length} · Centros de custo: {costCenters.length}
                  {activePartsMissingMasterData > 0 ? ` · Peças ativas sem fornecedor ou unidade-base: ${activePartsMissingMasterData}` : ""}.
                  Confira os cadastros e vincule fornecedor e unidade-base às peças existentes antes de registrar pedidos.
                </p>
              </div>
              <button type="button" onClick={() => { setModuleSection("parts"); setPartsView("settings"); setSettingsView("suppliers"); setActiveDrawer(null); }} className="min-h-10 shrink-0 rounded-lg border border-amber-300 bg-white px-4 text-xs font-semibold text-amber-950 hover:bg-amber-100">
                Abrir Cadastros Básicos
              </button>
            </section>}
                      <Sheet open={activeDrawer==="new-purchase"} onOpenChange={(open)=>setActiveDrawer(open?"new-purchase":null)}>
            <SheetContent side="right" className="dbs-operations-drawer w-[98vw] max-w-[820px] overflow-y-auto border-l border-slate-200 bg-white p-5 sm:p-7">
              <SheetHeader className="mb-6 border-b border-slate-100 pb-4"><SheetTitle className="text-xl font-semibold tracking-tight text-slate-900">Nova compra</SheetTitle><SheetDescription>Fornecedor, centro de custo, cotação e itens do pedido.</SheetDescription></SheetHeader>
              <section className="space-y-4">
            <div className="border-b border-slate-100 pb-3">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Dados da compra</h2>
              </div>
              {quoteImport.quoteId && <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-bold text-sky-800">Origem: cotação {quoteImport.quoteId}</span>}
              {quoteImport.quoteId && quotePurchase.isLoading && <p role="status" className="w-full rounded-lg bg-sky-50 p-3 text-xs text-sky-800">Importando peças relacionais da cotação…</p>}
              {quoteImport.quoteId && quotePurchase.error && <p role="alert" className="w-full rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">Não foi possível importar as peças desta cotação: {quotePurchase.error instanceof Error ? quotePurchase.error.message : "Falha ao consultar a cotação."}</p>}
              {quoteImport.quoteId && quotePurchase.data && !quotePurchase.data.items.length && <p role="alert" className="w-full rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">Esta cotação não possui peças do catálogo relacional. Adicione as peças manualmente antes de registrar o pedido.</p>}
            </div>
            </div>
            <form onSubmit={submitPurchase} className="grid gap-5 pt-2">
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
                          const purchaseUnitId=String(selected?.purchase_measure_unit_id||baseUnitId);
                          updatePurchaseLine(index,{partId:e.target.value,description:String(selected?.name||selected?.description||""),purchaseUnitId,conversionFactor:purchaseUnitId?conversionFor(String(selected?.id||""),purchaseUnitId):0});
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
                        const purchaseUnitId=String(selected?.purchase_measure_unit_id||baseUnitId);
                        updatePurchaseLine(index,{partId:e.target.value,description:String(selected?.name||selected?.description||""),purchaseUnitId,conversionFactor:purchaseUnitId?conversionFor(String(selected?.id||""),purchaseUnitId):0});
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
            </SheetContent>
          </Sheet>
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
                <div><h2 className="text-base font-semibold text-slate-900">Pedidos em aberto</h2><p className="mt-1 text-xs text-slate-500">{purchasesOpen.length} pedidos em aberto</p></div>
              </div>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-[#f8fafc] text-[11px] font-semibold uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Fornecedor</th><th className="px-4 py-3">Cotação / documento</th><th className="px-4 py-3">Data</th><th className="px-4 py-3">Valor</th><th className="px-4 py-3">Status</th></tr></thead>
                  <tbody>{purchasesOpen.map((purchase:any)=>{
                    const status=purchase.approval_status==="approved"?"Aprovada":purchase.approval_status==="rejected"?"Rejeitada":purchase.status==="received"?"Recebida":"Aguardando aprovação";
                    const tone=purchase.approval_status==="approved"||purchase.status==="received"?"bg-emerald-50 text-emerald-700":purchase.approval_status==="rejected"?"bg-rose-50 text-rose-700":"bg-amber-50 text-amber-800";
                    return <tr key={purchase.id} className="border-t border-slate-100 hover:bg-slate-50/70"><td className="px-4 py-3 font-medium text-slate-900">{suppliers.find((item:any)=>String(item.id)===String(purchase.supplier_id))?.name||purchase.supplier_name||"Fornecedor"}</td><td className="px-4 py-3 text-slate-600">{purchase.document_number||"—"}</td><td className="px-4 py-3 text-slate-600">{purchase.purchase_date?new Date(purchase.purchase_date+"T12:00:00").toLocaleDateString("pt-BR"):"—"}</td><td className="px-4 py-3 font-semibold text-slate-900">{money(purchase.total_cents)}</td><td className="px-4 py-3"><span className={"inline-flex rounded-full px-2.5 py-1 text-xs font-medium "+tone}>{status}</span></td></tr>;
                  })}</tbody>
                </table>
                {!purchasesOpen.length&&<p className="px-5 py-10 text-center text-sm text-slate-500">Nenhum pedido registrado. Use “Nova compra” para começar.</p>}
              </div>
              <div className="space-y-2 p-3 md:hidden">
                {purchasesOpen.map((purchase:any)=><article key={purchase.id} className="rounded-lg border border-slate-100 p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium text-slate-900">{suppliers.find((item:any)=>String(item.id)===String(purchase.supplier_id))?.name||purchase.supplier_name||"Fornecedor"}</p><p className="mt-1 text-xs text-slate-500">{purchase.document_number||"Sem documento"} · {purchase.purchase_date?new Date(purchase.purchase_date+"T12:00:00").toLocaleDateString("pt-BR"):"—"}</p></div><strong className="whitespace-nowrap text-sm text-slate-900">{money(purchase.total_cents)}</strong></div></article>)}
                {!purchasesOpen.length&&<p className="py-8 text-center text-sm text-slate-500">Nenhum pedido registrado.</p>}
              </div>
            </section>
          </>}          {purchasesView === "orders" && <>
          <section className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 bg-white p-5 sm:p-6">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Pedidos aguardando recebimento</h2>
              </div>
              <Link to="/treasury" className="min-h-10 rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-xs font-black text-sky-800 hover:bg-sky-100">Abrir Financeiro / DBS Treasury</Link>
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>
                  <th className="p-3">Fornecedor</th><th className="p-3">Documento / cotação</th><th className="p-3">Data</th><th className="p-3">Total do pedido</th><th className="p-3">Análise financeira</th><th className="p-3">Recebimento físico</th>
                </tr></thead>
                <tbody>{purchasesAwaitingReceipt.map((purchase: any) => {
                  const lines = (data?.purchaseItems ?? []).filter((item: any) => String(item.purchase_id) === String(purchase.id));
                  const outstanding = lines.filter((item: any) => Number(item.quantity) > Number(item.quantity_received ?? 0));
                  const selected = outstanding.filter((item: any) => Number(purchaseReceiptQuantities[item.id] ?? 0) > 0);
                  const overReceived = selected.some((item: any) => Number(purchaseReceiptQuantities[item.id]) > (Number(item.quantity) - Number(item.quantity_received ?? 0)) / Math.max(Number(item.conversion_factor ?? 1),0.000001));
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
                              const factor=Math.max(Number(item.conversion_factor??1),0.000001);
                              const remainingPurchase=remaining/factor;
                              const purchaseUnit=measureUnits.find((u:any)=>String(u.id)===String(item.purchase_unit_id));
                              const baseUnit=measureUnits.find((u:any)=>String(u.id)===String(part?.measure_unit_id));
                              return <label key={item.id} className="block text-xs font-semibold text-slate-700">
                                <span className="block">{part?.sku ? part.sku + " · " : ""}{part?.name || part?.description || "Peça"}</span>
                                <span className="mt-1 block font-normal text-slate-500">Pedido: {Number(item.purchase_quantity??(Number(item.quantity)/factor)).toLocaleString("pt-BR")} {purchaseUnit?.code||""} = {Number(item.quantity).toLocaleString("pt-BR")} {baseUnit?.code||""} · Recebido: {Number(item.quantity_received??0).toLocaleString("pt-BR")} {baseUnit?.code||""} · Falta: {remaining.toLocaleString("pt-BR")} {baseUnit?.code||""}</span>
                                <input aria-label={"Quantidade recebida em "+(purchaseUnit?.code||"unidade de compra")+" de "+(part?.name||part?.sku||item.id)} type="number" min="0.001" max={remainingPurchase} step="0.001" value={purchaseReceiptQuantities[item.id] ?? ""} onChange={e => setPurchaseReceiptQuantities(prev => ({ ...prev, [item.id]: e.target.value }))} placeholder={"Conferido agora em "+(purchaseUnit?.code||"unidade de compra")+" (máx. "+remainingPurchase.toLocaleString("pt-BR")+")"} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"/>
                              </label>;
                            })}
                            <button type="button" disabled={busy || !selected.length || overReceived} onClick={() => void confirmPurchaseReceipt(purchase, selected)} className="min-h-10 w-full rounded-lg bg-emerald-700 px-3 text-xs font-black text-white disabled:opacity-40">Confirmar quantidades recebidas</button>
                            {overReceived && <p className="text-xs font-bold text-rose-700">A quantidade não pode ultrapassar o saldo pendente do pedido.</p>}
                          </div>
                        </details>}
                      {purchase.status === "partially_received" && <p className="mt-1 text-xs font-semibold text-amber-700">Recebimento parcial · {money(purchase.received_total_cents ?? 0)} em materiais recebidos</p>}
                    </td>
                  </tr>;
                })}</tbody>
              </table>
              {!purchasesAwaitingReceipt.length && <p className="p-5 text-sm text-slate-500">Nenhum pedido aprovado aguardando recebimento físico.</p>}
            </div>
            <div className="space-y-3 p-3 md:hidden">
              {purchasesAwaitingReceipt.map((purchase:any) => {
                const lines=(data?.purchaseItems??[]).filter((item:any)=>String(item.purchase_id)===String(purchase.id));
                const outstanding=lines.filter((item:any)=>Number(item.quantity)>Number(item.quantity_received??0));
                const selected=outstanding.filter((item:any)=>Number(purchaseReceiptQuantities[item.id]??0)>0);
                const overReceived=selected.some((item:any)=>Number(purchaseReceiptQuantities[item.id])>(Number(item.quantity)-Number(item.quantity_received??0))/Math.max(Number(item.conversion_factor??1),0.000001));
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
                              const factor=Math.max(Number(item.conversion_factor??1),0.000001);
                              const remainingPurchase=remaining/factor;
                              const purchaseUnit=measureUnits.find((u:any)=>String(u.id)===String(item.purchase_unit_id));
                              const baseUnit=measureUnits.find((u:any)=>String(u.id)===String(part?.measure_unit_id));
                              return <label key={item.id} className="block text-xs font-semibold text-slate-700">
                                <span className="block">{part?.sku?part.sku+" · ":""}{part?.name||part?.description||"Peça"}</span>
                                <span className="mt-1 block font-normal text-slate-500">Pedido: {Number(item.purchase_quantity??(Number(item.quantity)/factor)).toLocaleString("pt-BR")} {purchaseUnit?.code||""} = {Number(item.quantity).toLocaleString("pt-BR")} {baseUnit?.code||""} · Recebido: {Number(item.quantity_received??0).toLocaleString("pt-BR")} {baseUnit?.code||""} · Falta: {remaining.toLocaleString("pt-BR")} {baseUnit?.code||""}</span>
                                <input aria-label={"Quantidade recebida em "+(purchaseUnit?.code||"unidade de compra")+" de "+(part?.name||part?.sku||item.id)} type="number" min="0.001" max={remainingPurchase} step="0.001" value={purchaseReceiptQuantities[item.id]??""} onChange={e=>setPurchaseReceiptQuantities(prev=>({...prev,[item.id]:e.target.value}))} placeholder={"Conferido agora em "+(purchaseUnit?.code||"unidade de compra")+" (máx. "+remainingPurchase.toLocaleString("pt-BR")+")"} className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"/>
                              </label>;
                            })}
                            <button type="button" disabled={busy||!selected.length||overReceived} onClick={()=>void confirmPurchaseReceipt(purchase,selected)} className="min-h-11 w-full rounded-lg bg-emerald-700 px-3 text-xs font-black text-white disabled:opacity-40">Confirmar quantidades recebidas</button>
                            {overReceived&&<p className="text-xs font-bold text-rose-700">A quantidade não pode ultrapassar o saldo pendente do pedido.</p>}
                          </div>
                        </details>}
                      {purchase.status==="partially_received"&&<p className="mt-2 font-semibold text-amber-700">Recebimento parcial · {money(purchase.received_total_cents??0)} em materiais recebidos</p>}
                    </div>
                  </div>
                </article>;
              })}
              {!purchasesAwaitingReceipt.length&&<p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Nenhum pedido aprovado aguardando recebimento físico.</p>}
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
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            
            <Sheet open={activeDrawer==="reservation"} onOpenChange={(open)=>setActiveDrawer(open?"reservation":null)}>
  <SheetContent side="right" className="dbs-operations-drawer w-[96vw] max-w-[520px] overflow-y-auto border-l border-slate-200 bg-white p-5 sm:p-7">
    <SheetHeader className="mb-6 border-b border-slate-100 pb-4"><SheetTitle>Nova reserva para OS</SheetTitle><SheetDescription>Selecione a ordem, centro de custo, peça e quantidade.</SheetDescription></SheetHeader>
    <form onSubmit={reserveParts} className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-600">Filtre as OS antes de pesquisar *</p>
                <label className="block text-xs font-bold text-slate-600">Buscar cliente
                  <input list="dbs-reservation-clients" value={reservationClientSearch} onChange={e=>{const value=e.target.value;setReservationClientSearch(value);const found=clients.find((cl:any)=>(cl.trade_name||cl.legal_name)===value);setReservationClientFilter(found?String(found.id):"");setReservationFiltersApplied(false);setWorkOrderId("");}} placeholder="Digite nome ou razão social" className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"/>
                  <datalist id="dbs-reservation-clients">{clients.filter((cl:any)=>cl.status!=="inativo").map((cl:any)=><option key={cl.id} value={cl.trade_name||cl.legal_name}/>)}</datalist>
                </label>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <label className="text-xs font-bold text-slate-600">Data inicial<input type="date" value={reservationDateFrom} onChange={e=>{setReservationDateFrom(e.target.value);setReservationFiltersApplied(false);setWorkOrderId("");}} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs"/></label>
                  <label className="text-xs font-bold text-slate-600">Data final<input type="date" min={reservationDateFrom||undefined} value={reservationDateTo} onChange={e=>{setReservationDateTo(e.target.value);setReservationFiltersApplied(false);setWorkOrderId("");}} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs"/></label>
                </div>
                <button type="button" disabled={!reservationClientFilter&&!reservationDateFrom&&!reservationDateTo} onClick={()=>setReservationFiltersApplied(true)} className="mt-3 min-h-10 w-full rounded-lg bg-slate-800 text-xs font-bold text-white disabled:opacity-40">Aplicar filtros e carregar OS</button>
              </div>
              <label className="mt-4 block text-xs font-bold text-slate-600">Ordem de serviço</label>
              <select required disabled={!reservationFiltersApplied||!filteredReservationOrders.length} value={workOrderId} onChange={e=>{setWorkOrderId(e.target.value);const o=workOrders.find((x:any)=>String(x.id)===e.target.value);setCostCenterId(String(o?.cost_center_id||""));setReservationStockId("");setPartId("");setReservationPartSearch("");}} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm disabled:bg-slate-100">
                <option value="">{!reservationFiltersApplied?"Aplique cliente e/ou período primeiro":"Selecione uma OS filtrada"}</option>
                {filteredReservationOrders.map((order: any) => {const client=clients.find((cl:any)=>cl.id===order.client_id);return <option key={order.id} value={order.id}>{order.protocol||order.id} · {client?.trade_name||client?.legal_name||"Cliente"} · {String(order.created_at||"").slice(0,10)} · {order.status}</option>;})}
              </select>
              {reservationFiltersApplied&&!filteredReservationOrders.length&&<p className="text-xs text-amber-700">Nenhuma OS encontrada com os filtros aplicados.</p>}
              <label className="mt-3 block text-xs font-bold text-slate-600">Centro de custo da OS *</label>
              <select required value={costCenterId} onChange={e=>{setCostCenterId(e.target.value);setReservationStockId("");setPartId("");}} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100">
                <option value="">Selecione o centro de custo</option>
                {activeCostCenters.map((center:any)=><option key={center.id} value={center.id}>{center.code} · {center.name}</option>)}
              </select>
              <label className="mt-3 block text-xs font-bold text-slate-600">Estoque operacional *</label>
              <select required value={reservationStockId} onChange={e=>{setReservationStockId(e.target.value);setPartId("");}} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
                <option value="">Selecione o estoque deste centro</option>
                {operationalStocks.filter((s:any)=>String(s.cost_center_id)===String(costCenterId)&&s.status==="active").map((s:any)=><option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              {costCenterId&&!operationalStocks.some((s:any)=>String(s.cost_center_id)===String(costCenterId)&&s.status==="active")&&<p className="text-xs font-semibold text-rose-700">Nenhum estoque operacional cadastrado neste centro. Crie em Estoques antes de reservar.</p>}
              <label className="mt-3 block text-xs font-bold text-slate-600">Finalidade do material *</label>
              <select required value={reservationPurpose} onChange={e=>setReservationPurpose(e.target.value as "TROCA_PECA"|"ATIVO_EQUIPAMENTO")} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"><option value="TROCA_PECA">Troca de Peça</option><option value="ATIVO_EQUIPAMENTO">Ativo / Equipamento</option></select>
              <span className={reservationPurpose==="TROCA_PECA"?"inline-flex rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-800":"inline-flex rounded-full bg-violet-50 px-3 py-1 text-xs font-bold text-violet-800"}>{reservationPurpose==="TROCA_PECA"?"Troca de Peça":"Ativo / Equipamento"}</span>
              <label className="mt-3 block text-xs font-bold text-slate-600">Peça</label>
              <input list="dbs-reservation-parts" required value={reservationPartSearch} onChange={e=>{const value=e.target.value;setReservationPartSearch(value);const match=activeParts.find((part:any)=>{const base=(String(part.sku||"")+" · "+String(part.name||part.description||part.id)).trim();return value===base;});setPartId(match?String(match.id):"");}} placeholder="Digite código/SKU ou nome da peça" className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm"/>
              <datalist id="dbs-reservation-parts">
                {activeParts.map((part:any)=>{const unit=measureUnits.find((u:any)=>String(u.id)===String(part.measure_unit_id));const bal=operationalBalances.find((b:any)=>String(b.stock_id)===String(selectedOperationalStock?.id)&&String(b.part_id)===String(part.id));const opFree=Math.max(0,Number(bal?.quantity??0)-Number(bal?.reserved_quantity??0));const centralFree=Math.max(0,Number(part.stock_quantity??0)-Number(part.reserved_quantity??0));const label=(String(part.sku||"")+" · "+String(part.name||part.description||part.id)).trim();return <option key={part.id} value={label}>{unit?.symbol||unit?.code||"un"} · operacional {opFree.toLocaleString("pt-BR")} · central {centralFree.toLocaleString("pt-BR")}</option>;})}
              </datalist>
              <label className="mt-3 block text-xs font-bold text-slate-600">Quantidade<input type="number" min="0.001" step="0.001" required value={quantity} onChange={e => setQuantity(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm transition focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100" /></label>
              {partId && <div className="rounded-xl border border-slate-200 p-3 text-xs"><p>Saldo no estoque operacional: <strong>{Math.max(0,Number(selectedOperationalBalance?.quantity??0)-Number(selectedOperationalBalance?.reserved_quantity??0)).toLocaleString("pt-BR")}</strong></p><p className="mt-1">Saldo livre no Estoque Central: <strong>{selectedCentralAvailable.toLocaleString("pt-BR")}</strong></p>{!selectedOperationalStock&&<p className="mt-2 font-bold text-rose-700">Este centro de custo ainda não possui Estoque Operacional. Cadastre-o antes de reservar.</p>}{selectedOperationalStock&&selectedCentralAvailable>0&&Number(selectedOperationalBalance?.quantity??0)===0&&<p className="mt-2 text-sky-800">O estoque operacional está zerado. Há saldo central; use + Transferir para abastecer este centro de custo.</p>}{selectedOperationalStock&&Number(quantity)>Math.max(0,Number(selectedOperationalBalance?.quantity??0)-Number(selectedOperationalBalance?.reserved_quantity??0))&&<p className="mt-2 font-bold text-rose-700">Saldo operacional insuficiente. A reserva não será abatida do Estoque Central.</p>}</div>}
              <button disabled={busy || !selectedOperationalStock || !reservationFiltersApplied || !workOrderId || !partId || Number(quantity)<=0 || Number(quantity)>Math.max(0,Number(selectedOperationalBalance?.quantity??0)-Number(selectedOperationalBalance?.reserved_quantity??0))} className="mt-5 min-h-11 w-full rounded-xl bg-sky-700 px-4 py-2 text-sm font-black text-white disabled:opacity-50">{busy ? "Processando..." : "Reservar estoque"}</button>
              <p className="mt-3 text-xs text-slate-500">A reserva bloqueia a disponibilidade, mas não baixa o estoque físico. A baixa ocorre ao concluir a OS.</p>
            </form>
  </SheetContent>
</Sheet>
<div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4"><p className="text-xs text-slate-500">{reservations.length} reservas registradas</p><button type="button" onClick={()=>{setWorkOrderId("");setCostCenterId("");setReservationStockId("");setPartId("");setReservationPartSearch("");setQuantity("1");setReservationPurpose("TROCA_PECA");setReservationClientFilter("");setReservationClientSearch("");setReservationDateFrom("");setReservationDateTo("");setReservationFiltersApplied(false);setActiveDrawer("reservation");}} className="min-h-10 rounded-lg bg-[#1557a0] px-4 text-sm font-semibold text-white">+ Nova reserva</button></div>
              <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[620px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Reserva</th><th className="p-3">OS / finalidade</th><th className="p-3">Peça / estoque</th><th className="p-3">Quantidade</th><th className="p-3">Custo capturado</th><th className="p-3">Status</th><th className="p-3">Ação</th></tr></thead>
                <tbody>{reservations.map((reservation: any) => <tr key={reservation.id} className="border-t border-slate-100">
                  <td className="p-3 font-mono text-xs">{String(reservation.id).slice(0, 8)}</td><td className="p-3 font-mono text-xs">{String(workOrders.find((o:any)=>o.id===reservation.work_order_id)?.protocol||reservation.work_order_id).slice(0, 18)}<span className="ml-2 rounded-full bg-sky-50 px-2 py-1 text-[10px] font-bold text-sky-800">{reservation.purpose==="ATIVO_EQUIPAMENTO"?"Ativo / Equipamento":reservation.purpose==="TROCA_PECA"?"Troca de Peça":"Legada"}</span><span className="mt-1 block text-[10px] text-slate-500">{clients.find((cl:any)=>cl.id===workOrders.find((o:any)=>o.id===reservation.work_order_id)?.client_id)?.trade_name||clients.find((cl:any)=>cl.id===workOrders.find((o:any)=>o.id===reservation.work_order_id)?.client_id)?.legal_name||"Cliente"}</span></td><td className="p-3">{parts.find((p:any)=>p.id===reservation.part_id)?.sku} · {parts.find((p:any)=>p.id===reservation.part_id)?.name}<span className="block text-[10px] text-slate-500">{reservation.is_operational?operationalStocks.find((s:any)=>s.id===reservation.stock_id)?.name:"Estoque legado"}</span></td><td className="p-3">{reservation.quantity}</td><td className="p-3">{money(Number(reservation.quantity) * Number(reservation.unit_cost_cents))}</td><td className="p-3">{reservation.status}</td>
                  <td className="p-3">{reservation.status === "reserved" ? <button disabled={busy} onClick={() => void runAction(() => reservation.is_operational ? releaseDbsOperationalStockReservation({data:{reservationId:reservation.id,idempotencyKey:"op-release:"+crypto.randomUUID()}}) : releaseDbsWorkOrderReservation({ data: { reservationId: reservation.id, idempotencyKey: "release:" + crypto.randomUUID() } }), "Reserva liberada.")} className="rounded-lg border border-rose-200 px-3 py-1 text-xs font-bold text-rose-700">Liberar</button> : "—"}</td>
                </tr>)}</tbody>
              </table></div>
              <div className="grid gap-2 p-3 md:hidden">
                {reservations.map((reservation:any)=><article key={reservation.id} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-start justify-between gap-3"><div><p className="font-mono text-xs font-bold">{String(reservation.id).slice(0,8)}</p><p className="mt-1 text-xs text-slate-500">OS {String(workOrders.find((o:any)=>o.id===reservation.work_order_id)?.protocol||reservation.work_order_id).slice(0,18)}</p><p className="text-xs text-slate-600">{parts.find((p:any)=>p.id===reservation.part_id)?.sku} · {parts.find((p:any)=>p.id===reservation.part_id)?.name}</p><span className="mt-1 inline-flex rounded-full bg-sky-50 px-2 py-1 text-[10px] font-bold text-sky-800">{reservation.purpose==="ATIVO_EQUIPAMENTO"?"Ativo / Equipamento":reservation.purpose==="TROCA_PECA"?"Troca de Peça":"Reserva legada"}</span></div><span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold">{reservation.status}</span></div>
                  <div className="mt-2 grid grid-cols-2 gap-2 border-t border-slate-100 pt-2 text-xs"><div><p className="text-slate-500">Quantidade</p><p className="font-bold">{reservation.quantity}</p></div><div><p className="text-slate-500">Custo capturado</p><p className="font-bold">{money(Number(reservation.quantity)*Number(reservation.unit_cost_cents))}</p></div></div>
                  {reservation.status==="reserved"&&<button type="button" disabled={busy} onClick={()=>void runAction(()=>reservation.is_operational?releaseDbsOperationalStockReservation({data:{reservationId:reservation.id,idempotencyKey:"op-release:"+crypto.randomUUID()}}):releaseDbsWorkOrderReservation({data:{reservationId:reservation.id,idempotencyKey:"release:"+crypto.randomUUID()}}),"Reserva liberada.")} className="mt-3 min-h-10 w-full rounded-lg border border-rose-200 text-xs font-bold text-rose-700">Liberar reserva</button>}
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