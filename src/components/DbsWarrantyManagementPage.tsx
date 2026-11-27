import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, CheckCircle2, ClipboardCheck, FileClock, Package, ShieldCheck } from "lucide-react";
import {
  createDbsCustomerWarranty,
  createDbsSupplierWarranty,
  linkDbsWorkOrderPartReceiptItem,
  getDbsWarrantyClaimHistory,
  getDbsWarrantyOverview,
  openDbsWarrantyClaim,
  updateDbsWarrantyClaim,
} from "@/lib/dbs-warranty.functions";

type WarrantyTab = "supplier" | "customer" | "claims";
type ClaimType = "supplier" | "customer";

function idempotencyKey() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `dbs-warranty-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function expiryLabel(dateValue: string) {
  const today = new Date();
  const todayKey = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())).toISOString().slice(0, 10);
  if (dateValue < todayKey) return "Vencida";
  const diff = Math.ceil((Date.parse(dateValue + "T00:00:00Z") - Date.parse(todayKey + "T00:00:00Z")) / 86400000);
  return diff <= 30 ? `Vence em ${diff} dia(s)` : "Vigente";
}

function dateToday() {
  return new Date().toISOString().slice(0, 10);
}

const warrantyStartAnchorLabels: Record<string, string> = {
  invoice_date: "Nota fiscal",
  receipt_date: "Recebimento",
  installation_date: "Instalação",
  manual_date: "Manual",
};

const warrantyCoverageTypeLabels: Record<string, string> = {
  service: "Serviço",
  work_order: "Atendimento",
  part: "Peça",
};

const claimStatusLabel: Record<string, string> = {
  opened: "Aberto",
  under_review: "Em análise",
  approved: "Aprovado",
  rejected: "Recusado",
  replaced: "Substituído",
  credited: "Creditado",
  closed: "Encerrado",
};

export function DbsWarrantyManagementPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<WarrantyTab>("supplier");
  const [supplierPartId, setSupplierPartId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [receiptItemId, setReceiptItemId] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [lotNumber, setLotNumber] = useState("");
  const [providerName, setProviderName] = useState("");
  const [startAnchor, setStartAnchor] = useState<"invoice_date"|"receipt_date"|"installation_date"|"manual_date">("receipt_date");
  const [supplierStartsOn, setSupplierStartsOn] = useState(dateToday());
  const [supplierExpiresOn, setSupplierExpiresOn] = useState("");
  const [supplierDuration, setSupplierDuration] = useState("");
  const [supplierTerms, setSupplierTerms] = useState("");
  const [supplierDocument, setSupplierDocument] = useState("");
  const [customerWorkOrderId, setCustomerWorkOrderId] = useState("");
  const [coverageType, setCoverageType] = useState<"part"|"service"|"work_order">("part");
  const [customerWorkOrderPartId, setCustomerWorkOrderPartId] = useState("");
  const [customerStartsOn, setCustomerStartsOn] = useState(dateToday());
  const [customerExpiresOn, setCustomerExpiresOn] = useState("");
  const [customerDuration, setCustomerDuration] = useState("");
  const [customerTerms, setCustomerTerms] = useState("");
  const [traceReceiptItemId, setTraceReceiptItemId] = useState("");
  const [traceQuantity, setTraceQuantity] = useState("1");
  const [claimType, setClaimType] = useState<ClaimType>("supplier");
  const [claimWarrantyId, setClaimWarrantyId] = useState("");
  const [claimIssue, setClaimIssue] = useState("");
  const [claimKey, setClaimKey] = useState(idempotencyKey);
  const [claimNotes, setClaimNotes] = useState<Record<string, string>>({});
  const [claimStatus, setClaimStatus] = useState<Record<string, string>>({});
  const [historyClaimId, setHistoryClaimId] = useState("");
  const [message, setMessage] = useState("");
  const [warrantySearch, setWarrantySearch] = useState("");

  const overview = useQuery({
    queryKey: ["dbs-warranty-overview"],
    queryFn: () => getDbsWarrantyOverview(),
    retry: 1,
  });

  const claimHistory = useQuery({
    queryKey: ["dbs-warranty-claim-history", historyClaimId],
    queryFn: () => getDbsWarrantyClaimHistory({ data: { claimId: historyClaimId } }),
    enabled: Boolean(historyClaimId),
    retry: 1,
  });
  const data = overview.data;
  const supplierWarranties = data?.supplierWarranties ?? [];
  const customerWarranties = data?.customerWarranties ?? [];
  const claims = data?.claims ?? [];
  const parts = data?.parts ?? [];
  const suppliers = data?.suppliers ?? [];
  const receipts = data?.receiptItems ?? [];
  const workOrders = data?.workOrders ?? [];
  const workOrderParts = (data?.workOrderParts ?? []).filter((row: any) => String(row.workOrderId) === String(customerWorkOrderId));
  const selectedWorkOrderPart = workOrderParts.find((row: any) => String(row.id) === String(customerWorkOrderPartId));
  const traceableReceiptItems = receipts.filter((row: any) => String(row.partId) === String(selectedWorkOrderPart?.partId));
  const traceAllocatedQuantity = (selectedWorkOrderPart?.receiptAllocations ?? []).reduce((sum: number, row: any) => sum + Number(row.quantity_allocated || 0), 0);
  const traceRemainingQuantity = Math.max(0, Number(selectedWorkOrderPart?.quantity || 0) - traceAllocatedQuantity);
  const searchKey = warrantySearch.trim().toLocaleLowerCase("pt-BR");
  const filteredSupplierWarranties = useMemo(() => supplierWarranties.filter((row: any) => !searchKey ||
    [row.partSku,row.partName,row.supplierName,row.serial_number,row.lot_number,row.receiptNumber,row.document_reference,row.provider_name]
      .some(value => String(value ?? "").toLocaleLowerCase("pt-BR").includes(searchKey))), [supplierWarranties, searchKey]);
  const filteredReceiptItems = useMemo(() => receipts.filter((row: any) =>
    Boolean(row.serialNumber || row.lotNumber) && (!searchKey ||
      [row.partSku,row.partName,row.supplierName,row.serialNumber,row.lotNumber,row.receiptNumber]
        .some(value => String(value ?? "").toLocaleLowerCase("pt-BR").includes(searchKey)))), [receipts, searchKey]);
  const filteredCustomerWarranties = useMemo(() => customerWarranties.filter((row: any) => !searchKey ||
    [row.partSku,row.partName,row.workOrderProtocol,row.clientName,row.work_order_id,row.coverage_type]
      .some(value => String(value ?? "").toLocaleLowerCase("pt-BR").includes(searchKey))), [customerWarranties, searchKey]);
  const filteredClaims = useMemo(() => claims.filter((row: any) => {
    if (!searchKey) return true;
    const warranty = row.claim_type === "supplier"
      ? supplierWarranties.find((item: any) => String(item.id) === String(row.supplier_warranty_id))
      : customerWarranties.find((item: any) => String(item.id) === String(row.customer_warranty_id));
    return [row.claim_reference,row.issue_description,row.status,row.resolution,warranty?.partSku,warranty?.partName,
      warranty?.serial_number,warranty?.lot_number,warranty?.workOrderProtocol,warranty?.clientName,warranty?.supplierName]
      .some(value => String(value ?? "").toLocaleLowerCase("pt-BR").includes(searchKey));
  }), [claims, supplierWarranties, customerWarranties, searchKey]);

  const supplierMutation = useMutation({
    mutationFn: () => createDbsSupplierWarranty({ data: {
      partId: supplierPartId,
      supplierId: supplierId || undefined,
      sourceReceiptItemId: receiptItemId || undefined,
      serialNumber,
      lotNumber,
      providerName,
      startAnchor,
      startsOn: supplierStartsOn,
      expiresOn: supplierExpiresOn || undefined,
      durationMonths: supplierDuration ? Number(supplierDuration) : undefined,
      terms: supplierTerms,
      documentReference: supplierDocument,
    } }),
    onSuccess: async () => {
      setMessage("Garantia do fornecedor registrada e vinculada ao catálogo.");
      setSerialNumber(""); setLotNumber(""); setProviderName(""); setSupplierTerms(""); setSupplierDocument("");
      setSupplierExpiresOn(""); setSupplierDuration(""); setReceiptItemId("");
      await queryClient.invalidateQueries({ queryKey: ["dbs-warranty-overview"] });
    },
    onError: error => setMessage(error instanceof Error ? error.message : "Não foi possível registrar a garantia."),
  });

  const customerMutation = useMutation({
    mutationFn: () => createDbsCustomerWarranty({ data: {
      workOrderId: customerWorkOrderId,
      coverageType,
      workOrderPartId: coverageType === "part" ? customerWorkOrderPartId || undefined : undefined,
      startsOn: customerStartsOn,
      expiresOn: customerExpiresOn || undefined,
      durationMonths: customerDuration ? Number(customerDuration) : undefined,
      terms: customerTerms,
    } }),
    onSuccess: async () => {
      setMessage("Cobertura de garantia DBS vinculada à OS.");
      setCustomerWorkOrderPartId(""); setCustomerTerms(""); setCustomerExpiresOn(""); setCustomerDuration("");
      await queryClient.invalidateQueries({ queryKey: ["dbs-warranty-overview"] });
    },
    onError: error => setMessage(error instanceof Error ? error.message : "Não foi possível registrar a cobertura."),
  });

  const traceReceiptMutation = useMutation({
    mutationFn: () => linkDbsWorkOrderPartReceiptItem({ data: {
      workOrderPartId: customerWorkOrderPartId,
      receiptItemId: traceReceiptItemId,
      quantity: Number(traceQuantity),
      idempotencyKey: idempotencyKey(),
    } }),
    onSuccess: async () => {
      setMessage("Lote/série vinculado ao item consumido da OS; a rastreabilidade foi registrada no histórico.");
      setTraceReceiptItemId(""); setTraceQuantity("1");
      await queryClient.invalidateQueries({ queryKey: ["dbs-warranty-overview"] });
    },
    onError: error => setMessage(error instanceof Error ? error.message : "Não foi possível vincular o lote/série à OS."),
  });

  const openClaimMutation = useMutation({
    mutationFn: () => openDbsWarrantyClaim({ data: {
      claimType, warrantyId: claimWarrantyId, issueDescription: claimIssue, idempotencyKey: claimKey,
    } }),
    onSuccess: async () => {
      setMessage("Chamado de garantia aberto e registrado no histórico.");
      setClaimIssue(""); setClaimWarrantyId(""); setClaimKey(idempotencyKey());
      await queryClient.invalidateQueries({ queryKey: ["dbs-warranty-overview"] });
    },
    onError: error => setMessage(error instanceof Error ? error.message : "Não foi possível abrir o chamado."),
  });

  const updateClaimMutation = useMutation({
    mutationFn: (claim: any) => updateDbsWarrantyClaim({ data: {
      claimId: String(claim.id),
      status: (claimStatus[claim.id] || claim.status) as "opened"|"under_review"|"approved"|"rejected"|"replaced"|"credited"|"closed",
      note: claimNotes[claim.id] ?? "",
      expectedVersion: Number(claim.version),
      idempotencyKey: idempotencyKey(),
    } }),
    onSuccess: async () => {
      setMessage("Status e histórico do chamado atualizados.");
      await queryClient.invalidateQueries({ queryKey: ["dbs-warranty-overview"] });
      if (historyClaimId) await queryClient.invalidateQueries({ queryKey: ["dbs-warranty-claim-history", historyClaimId] });
    },
    onError: error => setMessage(error instanceof Error ? error.message : "Não foi possível atualizar o chamado."),
  });

  const alerts = useMemo(() => {
    const all = [
      ...supplierWarranties.map((row: any) => ({ ...row, warrantyOrigin: "Fornecedor" })),
      ...customerWarranties.map((row: any) => ({ ...row, warrantyOrigin: "DBS" })),
    ];
    return all.filter((row: any) => row.status !== "void" && expiryLabel(String(row.expires_on)) !== "Vigente");
  }, [supplierWarranties, customerWarranties]);


  if (overview.isLoading) return <div className="p-6 text-sm text-slate-600">Carregando garantias…</div>;
  if (overview.isError) return <div role="alert" className="m-5 rounded-xl border border-rose-200 bg-white p-5 text-sm text-rose-800">Não foi possível carregar as garantias. Atualize a tela e tente novamente.</div>;

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-blue-700"><ShieldCheck className="h-4 w-4" /> DBS · Garantias</div>
          <h1 className="mt-1 text-xl font-bold text-slate-900">Garantias de peças, serviços e OS</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">A garantia do fornecedor/fabricante e a cobertura oferecida pela DBS ficam separadas e vinculadas à origem.</p>
        </div>
        <button type="button" onClick={() => void queryClient.invalidateQueries({ queryKey: ["dbs-warranty-overview"] })} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700">
          <CalendarClock className="h-4 w-4" /> Atualizar
        </button>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-xs font-semibold uppercase text-slate-500">Garantias fornecedor</div><div className="mt-1 text-2xl font-bold text-slate-900">{supplierWarranties.length}</div></div>
        <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-xs font-semibold uppercase text-slate-500">Coberturas DBS</div><div className="mt-1 text-2xl font-bold text-slate-900">{customerWarranties.length}</div></div>
        <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-xs font-semibold uppercase text-slate-500">Vencidas ou próximas</div><div className="mt-1 flex items-center gap-2 text-2xl font-bold text-amber-700"><AlertTriangle className="h-5 w-5" /> {alerts.length}</div></div>
      </div>

      {alerts.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><strong>Atenção a prazos:</strong> existem garantias vencidas ou com vencimento nos próximos 30 dias. Confira cada registro antes de autorizar qualquer atendimento.</div>}
      {message && <div role="status" className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{message}</div>}

      <label className="block max-w-2xl text-sm font-semibold text-slate-700">Consultar garantia por peça, SKU, série, lote, fornecedor, recebimento, cliente ou OS
        <input value={warrantySearch} onChange={e=>setWarrantySearch(e.target.value)} placeholder="Digite peça, número de série, cliente, protocolo..." className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal"/>
      </label>
      <nav className="flex flex-wrap gap-2" aria-label="Módulos de garantia">
        {([
          ["supplier","Garantias do fornecedor"],
          ["customer","Coberturas DBS"],
          ["claims","Chamados de garantia"],
        ] as const).map(([key,label]) => <button key={key} type="button" onClick={() => setTab(key)} aria-pressed={tab===key} className={tab===key ? "min-h-10 rounded-xl bg-blue-700 px-4 text-sm font-bold text-white" : "min-h-10 rounded-xl bg-white px-4 text-sm font-semibold text-slate-700 ring-1 ring-slate-200"}>{label}</button>)}
      </nav>

      {tab === "supplier" && <div className="grid gap-5 xl:grid-cols-[minmax(300px,0.9fr)_minmax(0,1.5fr)]">
        {data?.canManage && <form onSubmit={e => { e.preventDefault(); supplierMutation.mutate(); }} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="font-bold text-slate-900">Registrar garantia de fornecedor</h2>
          <label className="block text-sm font-semibold text-slate-700">Peça
            <select required value={supplierPartId} onChange={e => { setSupplierPartId(e.target.value); setReceiptItemId(""); }} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2.5 font-normal">
              <option value="">Selecione a peça</option>{parts.map((p:any)=><option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}
            </select>
          </label>
          <label className="block text-sm font-semibold text-slate-700">Item do recebimento (recomendado)
            <select value={receiptItemId} onChange={e => { const selected=receipts.find((r:any)=>String(r.id)===e.target.value);setReceiptItemId(e.target.value);if(selected){setSupplierPartId(String(selected.partId));setSupplierId(String(selected.supplierId||""));setSerialNumber(String(selected.serialNumber||""));setLotNumber(String(selected.lotNumber||""));if(startAnchor==="receipt_date"&&selected.receivedAt)setSupplierStartsOn(String(selected.receivedAt).slice(0,10));if(startAnchor==="invoice_date"&&selected.purchaseDate)setSupplierStartsOn(String(selected.purchaseDate).slice(0,10));} }} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2.5 font-normal">
              <option value="">Sem vínculo de recebimento</option>{receipts.filter((r:any)=>!supplierPartId||String(r.partId)===supplierPartId).map((r:any)=><option key={r.id} value={r.id}>{r.partSku} · {r.receiptNumber||"Recebimento"} · {r.serialNumber?"Série "+r.serialNumber+" · ":""}{r.lotNumber?"Lote "+r.lotNumber+" · ":""}{r.receivedAt?String(r.receivedAt).slice(0,10):""} · {r.supplierName}</option>)}
            </select>
          </label>
          <label className="block text-sm font-semibold text-slate-700">Fornecedor
            <select value={supplierId} onChange={e=>setSupplierId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2.5 font-normal"><option value="">Usar fornecedor do cadastro/recebimento</option>{suppliers.map((s:any)=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-semibold text-slate-700">Número de série<input value={serialNumber} onChange={e=>setSerialNumber(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 p-2.5 font-normal" /></label>
            <label className="block text-sm font-semibold text-slate-700">Lote<input value={lotNumber} onChange={e=>setLotNumber(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 p-2.5 font-normal" /></label>
          </div>
          <label className="block text-sm font-semibold text-slate-700">Fabricante / prestador (opcional)<input value={providerName} onChange={e=>setProviderName(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 p-2.5 font-normal" /></label>
          <label className="block text-sm font-semibold text-slate-700">Início conforme documento
            <select value={startAnchor} onChange={e=>{const next=e.target.value as typeof startAnchor;setStartAnchor(next);const selected=receipts.find((r:any)=>String(r.id)===receiptItemId);if(next==="receipt_date"&&selected?.receivedAt)setSupplierStartsOn(String(selected.receivedAt).slice(0,10));if(next==="invoice_date"&&selected?.purchaseDate)setSupplierStartsOn(String(selected.purchaseDate).slice(0,10));}} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2.5 font-normal"><option value="receipt_date">Recebimento físico</option><option value="invoice_date">Nota fiscal</option><option value="installation_date">Instalação</option><option value="manual_date">Data manual</option></select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-semibold text-slate-700">Início<input type="date" required value={supplierStartsOn} onChange={e=>setSupplierStartsOn(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 p-2.5 font-normal" /></label>
            <label className="block text-sm font-semibold text-slate-700">Término<input type="date" value={supplierExpiresOn} onChange={e=>setSupplierExpiresOn(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 p-2.5 font-normal" /></label>
          </div>
          <label className="block text-sm font-semibold text-slate-700">Duração em meses (alternativa à data de término)<input type="number" min="0" max="600" value={supplierDuration} onChange={e=>setSupplierDuration(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 p-2.5 font-normal" /></label>
          <label className="block text-sm font-semibold text-slate-700">Termos da garantia<textarea value={supplierTerms} onChange={e=>setSupplierTerms(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-slate-200 p-2.5 font-normal" /></label>
          <label className="block text-sm font-semibold text-slate-700">Nota/documento de referência<input value={supplierDocument} onChange={e=>setSupplierDocument(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 p-2.5 font-normal" /></label>
          <button disabled={supplierMutation.isPending || !supplierPartId || (!supplierExpiresOn && !supplierDuration)} className="min-h-11 w-full rounded-xl bg-blue-700 px-4 font-bold text-white disabled:opacity-50">{supplierMutation.isPending?"Salvando…":"Registrar garantia"}</button>
        </form>}
        <section className="space-y-3">
          <h2 className="font-bold text-slate-900">Garantias de fornecedor cadastradas</h2>
          {filteredSupplierWarranties.map((row:any)=><article key={row.id} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-2"><div><div className="font-semibold text-slate-900">{row.partSku} · {row.partName}</div><div className="mt-1 text-sm text-slate-600">{row.supplierName}</div></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{expiryLabel(row.expires_on)}</span></div>
            <div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2"><div>Série/lote: {row.serial_number||"—"} / {row.lot_number||"—"}</div><div>Período: {row.starts_on} até {row.expires_on}</div><div>Origem: {warrantyStartAnchorLabels[String(row.start_anchor)] ?? String(row.start_anchor)}</div><div>Quantidade coberta: {row.quantity_covered}</div>{row.receiptNumber&&<div>Recebimento: {row.receiptNumber} {row.receivedAt? "· "+String(row.receivedAt).slice(0,10):""}</div>}</div>
            {row.terms&&<p className="mt-3 text-sm text-slate-700">{row.terms}</p>}
            {row.document_reference&&<p className="mt-1 text-xs text-slate-500">Documento: {row.document_reference}</p>}
            <button type="button" onClick={()=>{setClaimType("supplier");setClaimWarrantyId(row.id);setTab("claims");}} className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-700"><ClipboardCheck className="h-4 w-4"/> Abrir chamado</button>
          </article>)}
          {!filteredSupplierWarranties.length&&<p className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">Nenhuma garantia de fornecedor corresponde à pesquisa.</p>}
          <div className="space-y-3 border-t border-slate-200 pt-4">
            <h3 className="font-bold text-slate-900">Série e lote registrados no recebimento</h3>
            <p className="text-xs text-slate-500">Itens identificados fisicamente, mesmo quando o fornecedor não informou prazo de garantia.</p>
            {filteredReceiptItems.map((row:any)=>{
              const warranty=supplierWarranties.find((item:any)=>String(item.source_receipt_item_id)===String(row.id));
              return <article key={row.id} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold">{row.partSku} · {row.partName}</p>
                  <span className={warranty?"rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700":"rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800"}>{warranty?"Garantia cadastrada":"Sem prazo de garantia informado"}</span></div>
                <p className="mt-1 text-xs text-slate-600">Série: {row.serialNumber||"—"} · Lote: {row.lotNumber||"—"}</p>
                <p className="mt-1 text-xs text-slate-500">Recebimento {row.receiptNumber||"—"} · {row.receivedAt?String(row.receivedAt).slice(0,10):"Data não informada"} · {row.supplierName||"Fornecedor não informado"}</p>
              </article>;
            })}
            {!filteredReceiptItems.length&&<p className="text-sm text-slate-500">Nenhum recebimento com série ou lote informado.</p>}
          </div>
        </section>
      </div>}

      {tab === "customer" && <div className="grid gap-5 xl:grid-cols-[minmax(300px,0.9fr)_minmax(0,1.5fr)]">
        {data?.canManage && <form onSubmit={e=>{e.preventDefault();customerMutation.mutate();}} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="font-bold text-slate-900">Registrar cobertura de garantia DBS</h2>
          <label className="block text-sm font-semibold text-slate-700">Ordem de Serviço
            <select required value={customerWorkOrderId} onChange={e=>{setCustomerWorkOrderId(e.target.value);setCustomerWorkOrderPartId("");}} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2.5 font-normal"><option value="">Selecione a OS</option>{workOrders.map((wo:any)=><option key={wo.id} value={wo.id}>{wo.protocol||wo.id} · {wo.type||"OS"}</option>)}</select>
          </label>
          <label className="block text-sm font-semibold text-slate-700">Cobertura
            <select value={coverageType} onChange={e=>setCoverageType(e.target.value as typeof coverageType)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2.5 font-normal"><option value="part">Peça instalada</option><option value="service">Serviço executado</option><option value="work_order">OS / atendimento</option></select>
          </label>
          {coverageType==="part"&&<label className="block text-sm font-semibold text-slate-700">Peça realmente registrada na OS<select required value={customerWorkOrderPartId} onChange={e=>{setCustomerWorkOrderPartId(e.target.value);setTraceReceiptItemId("");setTraceQuantity("1");}} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2.5 font-normal"><option value="">Selecione o item da OS</option>{workOrderParts.map((p:any)=><option key={p.id} value={p.id}>{p.partSku} · {p.partName} · {Number(p.quantity||0).toLocaleString("pt-BR")} un.</option>)}</select></label>}
          <div className="grid grid-cols-2 gap-3"><label className="block text-sm font-semibold text-slate-700">Início<input type="date" required value={customerStartsOn} onChange={e=>setCustomerStartsOn(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 p-2.5 font-normal"/></label><label className="block text-sm font-semibold text-slate-700">Término<input type="date" value={customerExpiresOn} onChange={e=>setCustomerExpiresOn(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 p-2.5 font-normal"/></label></div>
          <label className="block text-sm font-semibold text-slate-700">Duração em meses (alternativa à data de término)<input type="number" min="0" max="600" value={customerDuration} onChange={e=>setCustomerDuration(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 p-2.5 font-normal"/></label>
          <label className="block text-sm font-semibold text-slate-700">Termos da cobertura DBS<textarea value={customerTerms} onChange={e=>setCustomerTerms(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-slate-200 p-2.5 font-normal"/></label>
          <button disabled={customerMutation.isPending || !customerWorkOrderId || (!customerExpiresOn && !customerDuration) || (coverageType==="part"&&!customerWorkOrderPartId)} className="min-h-11 w-full rounded-xl bg-blue-700 px-4 font-bold text-white disabled:opacity-50">{customerMutation.isPending?"Salvando…":"Registrar cobertura DBS"}</button>
        </form>}
        {customerWorkOrderId && customerWorkOrderPartId && selectedWorkOrderPart && <section className="space-y-3 rounded-2xl border border-sky-200 bg-sky-50/50 p-4 xl:col-span-2">
          <div><h3 className="font-bold text-slate-900">Rastreabilidade de lote e série aplicada na OS</h3><p className="mt-1 text-sm text-slate-600">Vincule o lote ou número de série do recebimento ao item que já consta como consumido na OS. O sistema confere a peça e impede exceder as quantidades recebidas ou consumidas.</p></div>
          {selectedWorkOrderPart.consumptionStatus === "consumed" ? <form onSubmit={e=>{e.preventDefault();traceReceiptMutation.mutate();}} className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(120px,0.7fr)_auto] sm:items-end">
            <label className="text-sm font-semibold text-slate-700">Lote / série do recebimento
              <select required value={traceReceiptItemId} onChange={e=>{const item=traceableReceiptItems.find((row:any)=>String(row.id)===e.target.value);setTraceReceiptItemId(e.target.value);if(item?.serialNumber)setTraceQuantity("1");}} className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 bg-white p-2.5 font-normal">
                <option value="">Selecione o recebimento da peça</option>{traceableReceiptItems.map((row:any)=><option key={row.id} value={row.id}>{row.partSku} · {row.receiptNumber||"Recebimento"} · {row.serialNumber?"Série "+row.serialNumber+" · ":""}{row.lotNumber?"Lote "+row.lotNumber+" · ":""}Qtd. recebida: {row.quantityReceived}</option>)}
              </select>
            </label>
            <label className="text-sm font-semibold text-slate-700">Quantidade utilizada
              <input required type="number" min="0.0001" step="0.0001" max={traceRemainingQuantity} value={traceQuantity} onChange={e=>setTraceQuantity(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 font-normal"/>
            </label>
            <button type="submit" disabled={traceReceiptMutation.isPending||!traceReceiptItemId||!Number(traceQuantity)||Number(traceQuantity)<=0||Number(traceQuantity)>traceRemainingQuantity||traceRemainingQuantity<=0} className="min-h-11 rounded-lg bg-sky-800 px-4 text-sm font-bold text-white disabled:opacity-50">{traceReceiptMutation.isPending?"Vinculando…":"Vincular lote / série"}</button>
          </form> : <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">A rastreabilidade só pode ser vinculada após o consumo da peça estar registrado na OS.</p>}
          <p className="text-xs text-slate-500">Quantidade ainda sem identificação de lote/série neste item da OS: {traceRemainingQuantity.toLocaleString("pt-BR")}</p>
          <div className="space-y-2">
            <h4 className="text-sm font-bold text-slate-800">Lotes e séries já vinculados</h4>
            {(selectedWorkOrderPart.receiptAllocations??[]).map((allocation:any)=>{const warranty=supplierWarranties.find((row:any)=>String(row.id)===String(allocation.supplier_warranty_id));return <article key={allocation.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><strong>Série: {allocation.serial_number||"—"} · Lote: {allocation.lot_number||"—"}</strong><span>Quantidade: {Number(allocation.quantity_allocated).toLocaleString("pt-BR")}</span></div><p className="mt-1 text-xs text-slate-500">{warranty ? "Garantia fornecedor até "+warranty.expires_on : "Sem garantia de fornecedor vinculada a este recebimento"}</p></article>;})}
            {!(selectedWorkOrderPart.receiptAllocations??[]).length&&<p className="text-sm text-slate-500">Nenhum lote/série vinculado a este item da OS.</p>}
          </div>
        </section>}
        <section className="space-y-3">
          <h2 className="font-bold text-slate-900">Coberturas DBS vinculadas à OS</h2>
          {filteredCustomerWarranties.map((row:any)=><article key={row.id} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-2"><div><div className="font-semibold text-slate-900">OS {row.workOrderProtocol||row.work_order_id}</div><div className="mt-1 text-sm text-slate-600">{row.partName || (warrantyCoverageTypeLabels[String(row.coverage_type)] ?? String(row.coverage_type))} {row.partSku&&"· "+row.partSku}</div>{row.clientName&&<div className="mt-1 text-xs text-slate-500">Cliente: {row.clientName}</div>}</div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{expiryLabel(row.expires_on)}</span></div>
            <div className="mt-3 text-sm text-slate-600">Período: {row.starts_on} até {row.expires_on}</div>
            {row.terms&&<p className="mt-2 text-sm text-slate-700">{row.terms}</p>}
            <button type="button" onClick={()=>{setClaimType("customer");setClaimWarrantyId(row.id);setTab("claims");}} className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-700"><ClipboardCheck className="h-4 w-4"/> Abrir chamado</button>
          </article>)}
          {!customerWarranties.length&&<p className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">Nenhuma cobertura DBS cadastrada.</p>}
        </section>
      </div>}

      {tab === "claims" && <div className="grid gap-5 xl:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.7fr)]">
        <form onSubmit={e=>{e.preventDefault();openClaimMutation.mutate();}} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="font-bold text-slate-900">Abrir chamado de garantia</h2>
          <label className="block text-sm font-semibold text-slate-700">Origem
            <select value={claimType} onChange={e=>{setClaimType(e.target.value as ClaimType);setClaimWarrantyId("");}} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2.5 font-normal"><option value="supplier">Fornecedor / fabricante</option><option value="customer">Cobertura DBS</option></select>
          </label>
          <label className="block text-sm font-semibold text-slate-700">Garantia
            <select required value={claimWarrantyId} onChange={e=>setClaimWarrantyId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2.5 font-normal"><option value="">Selecione</option>{(claimType==="supplier"?supplierWarranties:customerWarranties).map((w:any)=><option key={w.id} value={w.id}>{claimType==="supplier"?w.partSku+" · "+w.serial_number:w.workOrderProtocol||w.work_order_id} · até {w.expires_on}</option>)}</select>
          </label>
          <label className="block text-sm font-semibold text-slate-700">Relato do defeito / solicitação<textarea required minLength={5} maxLength={4000} value={claimIssue} onChange={e=>setClaimIssue(e.target.value)} rows={5} className="mt-1 w-full rounded-lg border border-slate-200 p-2.5 font-normal" placeholder="Descreva o problema e a evidência disponível."/></label>
          <button disabled={openClaimMutation.isPending || !claimWarrantyId || claimIssue.trim().length<5} className="min-h-11 w-full rounded-xl bg-blue-700 px-4 font-bold text-white disabled:opacity-50">{openClaimMutation.isPending?"Abrindo…":"Abrir chamado"}</button>
        </form>
        <section className="space-y-3">
          <h2 className="font-bold text-slate-900">Histórico de chamados</h2>
          {filteredClaims.map((claim:any)=><article key={claim.id} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><div className="font-semibold text-slate-900">{claim.claim_type==="supplier"?"Fornecedor / fabricante":"Cobertura DBS"}</div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">{claimStatusLabel[claim.status]||claim.status}</span></div>
            <p className="mt-2 text-sm text-slate-700">{claim.issue_description}</p>
            <p className="mt-1 text-xs text-slate-500">Aberto em {String(claim.opened_at).slice(0,10)} · Versão {claim.version}</p>
            <button type="button" onClick={() => setHistoryClaimId(current => current === claim.id ? "" : claim.id)} className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-700"><FileClock className="h-4 w-4"/>{historyClaimId === claim.id ? "Ocultar histórico" : "Ver histórico"}</button>
            {historyClaimId === claim.id && <div className="mt-3 rounded-xl bg-slate-50 p-3">
              {claimHistory.isLoading ? <p className="text-xs text-slate-500">Carregando histórico…</p> : claimHistory.isError ? <p className="text-xs text-rose-700">Não foi possível carregar o histórico.</p> : (claimHistory.data ?? []).map((event:any)=><div key={event.id} className="border-l-2 border-blue-200 py-1 pl-3 text-xs text-slate-600">
                <p className="font-semibold text-slate-800">{event.from_status ? (claimStatusLabel[event.from_status] || event.from_status) + " → " : ""}{claimStatusLabel[event.to_status] || event.to_status}</p>
                {event.note && <p className="mt-0.5">{event.note}</p>}
                <p className="mt-0.5 text-[11px] text-slate-400">{new Date(event.created_at).toLocaleString("pt-BR")}</p>
              </div>)}
            </div>}
            {claim.resolution&&<p className="mt-2 text-sm text-slate-600">Decisão: {claim.resolution}</p>}
            {data?.canManage&&<div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1.5fr_auto]">
              <select value={claimStatus[claim.id]||claim.status} onChange={e=>setClaimStatus(current=>({...current,[claim.id]:e.target.value}))} className="min-h-10 rounded-lg border border-slate-200 bg-white px-2 text-sm"><option value="under_review">Em análise</option><option value="approved">Aprovado</option><option value="rejected">Recusado</option><option value="replaced">Substituído</option><option value="credited">Creditado</option><option value="closed">Encerrado</option></select>
              <input value={claimNotes[claim.id]||""} onChange={e=>setClaimNotes(current=>({...current,[claim.id]:e.target.value}))} placeholder="Parecer / justificativa" className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm"/>
              <button type="button" onClick={()=>updateClaimMutation.mutate(claim)} disabled={updateClaimMutation.isPending} className="min-h-10 rounded-lg bg-slate-900 px-3 text-xs font-bold text-white disabled:opacity-50">Atualizar</button>
            </div>}
          </article>)}
          {!claims.length&&<p className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">Nenhum chamado de garantia aberto.</p>}
        </section>
      </div>}
    </div>
  );
}
