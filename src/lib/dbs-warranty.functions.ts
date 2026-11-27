import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type WarrantyScope = {
  id: string;
  companyId: string | null;
  scopeKey: string;
  ownerUserId: string;
  scopedUserIds: string[];
  roleKey: string;
};

const WARRANTY_OPERATIONAL_ROLES = [
  "SUPER_ADMIN",
  "ADMIN_OPERACIONAL",
  "GESTOR_CONTA",
  "GESTOR_REGIONAL",
] as const;

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function requiredId(value: unknown, label: string) {
  const id = String(value ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error(label + " inválido.");
  }
  return id;
}

function optionalId(value: unknown, label: string) {
  return value == null || value === "" ? null : requiredId(value, label);
}

async function resolveWarrantyScope(context: { userId: string }): Promise<WarrantyScope> {
  const { data: user, error } = await supabaseAdmin
    .from("users")
    .select("id,company_id,role_key,status")
    .eq("auth_id", context.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!user || user.status !== "ativo") throw new Error("Acesso às garantias não autorizado.");

  let ownerUserId = user.id;
  if (user.role_key === "FINANCEIRO_OPERADOR") {
    const { data: access, error: accessError } = await (supabaseAdmin as any)
      .from("treasury_viewer_access")
      .select("owner_user_id,enabled")
      .eq("viewer_user_id", user.id)
      .maybeSingle();
    if (accessError || !access || access.enabled !== true) {
      throw new Error("O acesso financeiro está desativado ou sem vínculo com o responsável.");
    }
    const { data: owner, error: ownerError } = await supabaseAdmin
      .from("users")
      .select("id,company_id,role_key,status")
      .eq("id", access.owner_user_id)
      .maybeSingle();
    if (ownerError || !owner || owner.status !== "ativo" || owner.role_key !== "SUPER_ADMIN"
      || owner.company_id !== user.company_id) {
      throw new Error("O responsável pelo escopo financeiro não está ativo ou não corresponde à empresa vinculada.");
    }
    ownerUserId = owner.id;
  } else if (
    user.role_key !== "SUPER_ADMIN"
    && !WARRANTY_OPERATIONAL_ROLES.includes(user.role_key as (typeof WARRANTY_OPERATIONAL_ROLES)[number])
  ) {
    throw new Error("Este perfil não pode consultar garantias.");
  }

  const companyId = user.company_id ?? null;
  const scopeKey = companyId ? "company:" + companyId : "user:" + ownerUserId;
  const scopedUsers = companyId
    ? await supabaseAdmin.from("users").select("id").eq("company_id", companyId).eq("status", "ativo")
    : { data: [{ id: ownerUserId }], error: null };
  if (scopedUsers.error) throw new Error(scopedUsers.error.message);

  return {
    id: user.id,
    companyId,
    scopeKey,
    ownerUserId,
    scopedUserIds: (scopedUsers.data ?? []).map((row: any) => String(row.id)),
    roleKey: String(user.role_key),
  };
}

async function requireWarrantyFinance(context: { userId: string }) {
  const scope = await resolveWarrantyScope(context);
  if (!["SUPER_ADMIN", "FINANCEIRO_OPERADOR"].includes(scope.roleKey)) {
    throw new Error("Cadastro e gestão de garantias financeiras são restritos ao Financeiro.");
  }
  return scope;
}

function addWarrantyMonths(startsOn: string, months: number) {
  const [year, month, day] = startsOn.split("-").map(Number);
  const targetMonthIndex = month - 1 + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = (targetMonthIndex % 12) + 1;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, targetMonth - 1, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

function normalizeWarrantyFields(input: any) {
  const startsOn = String(input?.startsOn ?? "").trim();
  const expiresOnProvided = Boolean(String(input?.expiresOn ?? "").trim());
  const durationMonths = input?.durationMonths == null || input.durationMonths === ""
    ? null
    : Number(input.durationMonths);
  if (!isIsoDate(startsOn)) throw new Error("Informe uma data válida de início da garantia.");
  if (durationMonths != null && (!Number.isInteger(durationMonths) || durationMonths < 0 || durationMonths > 600)) {
    throw new Error("Duração da garantia inválida.");
  }
  const expiresOn = expiresOnProvided
    ? String(input.expiresOn).trim()
    : durationMonths != null ? addWarrantyMonths(startsOn, durationMonths) : "";
  if (!isIsoDate(expiresOn) || expiresOn < startsOn) {
    throw new Error("Informe a data de término ou uma duração válida em meses.");
  }
  const terms = String(input?.terms ?? "").trim().slice(0, 4000);
  const notes = String(input?.notes ?? "").trim().slice(0, 2000);
  const evidence = Array.isArray(input?.evidence)
    ? input.evidence.slice(0, 20).map((entry: unknown) => String(entry ?? "").trim().slice(0, 500)).filter(Boolean)
    : [];
  return { startsOn, expiresOn, expiresOnProvided, durationMonths, terms, notes, evidence };
}

export const getDbsWarrantyOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const scope = await resolveWarrantyScope(context);
    const [supplierWarranties, customerWarranties, claims, suppliers, receipts, workOrders, warrantyPolicies, services] = await Promise.all([
      (supabaseAdmin as any).from("dbs_control_supplier_warranties")
        .select("id,part_id,supplier_id,source_receipt_item_id,serial_number,lot_number,quantity_covered,provider_name,start_anchor,starts_on,expires_on,duration_months,terms,document_reference,evidence,status,notes,created_at,updated_at")
        .eq("scope_key", scope.scopeKey).order("expires_on").limit(1500),
      (supabaseAdmin as any).from("dbs_control_customer_warranties")
        .select("id,work_order_id,work_order_part_id,part_id,coverage_type,starts_on,expires_on,duration_months,terms,evidence,status,notes,created_at,updated_at,policy_id,source_receipt_allocation_id,supplier_warranty_id,serial_number,lot_number,quantity_covered")
        .eq("scope_key", scope.scopeKey).order("expires_on").limit(1500),
      (supabaseAdmin as any).from("dbs_control_warranty_claims")
        .select("id,claim_type,supplier_warranty_id,customer_warranty_id,work_order_id,work_order_part_id,claim_reference,issue_description,status,resolution,evidence,opened_by,resolved_by,opened_at,resolved_at,version,updated_at")
        .eq("scope_key", scope.scopeKey).order("opened_at", { ascending: false }).limit(1000),
      (supabaseAdmin as any).from("dbs_control_suppliers")
        .select("id,name,status").eq("scope_key", scope.scopeKey).order("name").limit(500),
      (supabaseAdmin as any).from("dbs_control_purchase_receipts")
        .select("id,purchase_id,receipt_number,received_at").eq("scope_key", scope.scopeKey).order("received_at", { ascending: false }).limit(1000),
      scope.scopedUserIds.length
        ? (supabaseAdmin as any).from("dbs_control_work_orders")
            .select("id,protocol,client_id,type,created_at,created_by_user_id")
            .in("created_by_user_id", scope.scopedUserIds).is("deleted_at", null)
            .order("created_at", { ascending: false }).limit(1000)
        : Promise.resolve({ data: [], error: null }),
      (supabaseAdmin as any).from("dbs_control_customer_warranty_policies")
        .select("id,policy_key,coverage_type,part_id,service_id,duration_months,terms,status,approved_by,approved_at,updated_at")
        .eq("scope_key", scope.scopeKey).order("coverage_type").limit(500),
      (supabaseAdmin as any).from("dbs_control_service_catalog")
        .select("id,name,status").eq("status", "active").order("name").limit(500),
    ]);
    for (const result of [supplierWarranties, customerWarranties, claims, suppliers, receipts, workOrders, warrantyPolicies, services]) {
      if (result.error) throw new Error("Falha ao consultar garantias: " + result.error.message);
    }

    const clientIds = [...new Set((workOrders.data ?? []).map((row: any) => String(row.client_id ?? "")).filter(Boolean))];
    const clients = clientIds.length
      ? await (supabaseAdmin as any).from("dbs_control_clients")
          .select("id,legal_name,trade_name").in("id", clientIds)
      : { data: [], error: null };
    if (clients.error) throw new Error("Falha ao consultar clientes das garantias: " + clients.error.message);

    const receiptIds = (receipts.data ?? []).map((row: any) => row.id);
    const receiptItems = receiptIds.length
      ? await (supabaseAdmin as any).from("dbs_control_purchase_receipt_items")
          .select("id,receipt_id,part_id,quantity_received,serial_number,lot_number")
          .in("receipt_id", receiptIds).limit(3000)
      : { data: [], error: null };
    if (receiptItems.error) throw new Error("Falha ao consultar itens recebidos para garantia: " + receiptItems.error.message);

    const purchaseIds = [...new Set((receipts.data ?? []).map((row: any) => String(row.purchase_id)).filter(Boolean))];
    const purchases = purchaseIds.length
      ? await (supabaseAdmin as any).from("dbs_control_purchases")
          .select("id,supplier_id,supplier_name,purchase_date").eq("scope_key", scope.scopeKey).in("id", purchaseIds)
      : { data: [], error: null };
    if (purchases.error) throw new Error("Falha ao consultar fornecedores dos recebimentos: " + purchases.error.message);

    const workOrderIds = (workOrders.data ?? []).map((row: any) => String(row.id));
    const workOrderParts = workOrderIds.length
      ? await (supabaseAdmin as any).from("dbs_control_work_order_parts")
          .select("id,work_order_id,part_id,quantity,consumption_status").in("work_order_id", workOrderIds).limit(5000)
      : { data: [], error: null };
    if (workOrderParts.error) throw new Error("Falha ao consultar itens das OS para garantia: " + workOrderParts.error.message);

    const workOrderPartIds = (workOrderParts.data ?? []).map((row: any) => String(row.id));
    const receiptAllocations = workOrderPartIds.length
      ? await (supabaseAdmin as any).from("dbs_control_work_order_part_receipt_allocations")
          .select("id,work_order_id,work_order_part_id,receipt_item_id,part_id,supplier_warranty_id,quantity_allocated,serial_number,lot_number,created_at")
          .eq("scope_key", scope.scopeKey).in("work_order_part_id", workOrderPartIds)
          .order("created_at", { ascending: false }).limit(5000)
      : { data: [], error: null };
    if (receiptAllocations.error) throw new Error("Falha ao consultar lotes/séries aplicados nas OS: " + receiptAllocations.error.message);

    const partIds = [...new Set([
      ...(supplierWarranties.data ?? []).map((row: any) => String(row.part_id)),
      ...(customerWarranties.data ?? []).map((row: any) => String(row.part_id ?? "")),
      ...(receiptItems.data ?? []).map((row: any) => String(row.part_id)),
      ...(workOrderParts.data ?? []).map((row: any) => String(row.part_id)),
    ].filter(Boolean))];
    const parts = partIds.length
      ? await (supabaseAdmin as any).from("dbs_control_parts")
          .select("id,sku,name,status").in("id", partIds)
      : { data: [], error: null };
    if (parts.error) throw new Error("Falha ao consultar catálogo de peças das garantias: " + parts.error.message);

    const purchaseById = new Map<string, any>((purchases.data ?? []).map((row: any) => [String(row.id), row]));
    const receiptById = new Map<string, any>((receipts.data ?? []).map((row: any) => [String(row.id), row]));
    const supplierById = new Map<string, any>((suppliers.data ?? []).map((row: any) => [String(row.id), row]));
    const partsById = new Map<string, any>((parts.data ?? []).map((row: any) => [String(row.id), row]));
    const clientsById = new Map<string, any>((clients.data ?? []).map((row: any) => [String(row.id), row]));
    const receiptOptionById = new Map<string, any>();
    const receiptOptions = (receiptItems.data ?? []).map((item: any) => {
      const receipt = receiptById.get(String(item.receipt_id));
      const purchase = receipt ? purchaseById.get(String(receipt.purchase_id)) : null;
      const part = partsById.get(String(item.part_id));
      return {
        id: item.id,
        receiptId: item.receipt_id,
        partId: item.part_id,
        quantityReceived: Number(item.quantity_received),
        serialNumber: item.serial_number ?? null,
        lotNumber: item.lot_number ?? null,
        receiptNumber: String(receipt?.receipt_number ?? ""),
        receivedAt: receipt?.received_at ?? null,
        supplierId: purchase?.supplier_id ?? null,
        supplierName: purchase?.supplier_name ?? "",
        purchaseDate: purchase?.purchase_date ?? null,
        partSku: part?.sku ?? "",
        partName: part?.name ?? "Peça",
      };
    });
    for (const receiptOption of receiptOptions) receiptOptionById.set(String(receiptOption.id), receiptOption);
    const warrantyParts = (partIds.map(id => partsById.get(id)).filter(Boolean) as any[])
      .map(part => ({ id: part.id, sku: part.sku, name: part.name }));
    return {
      scopeKey: scope.scopeKey,
      canManage: ["SUPER_ADMIN", "FINANCEIRO_OPERADOR"].includes(scope.roleKey),
      supplierWarranties: (supplierWarranties.data ?? []).map((row: any) => ({
        ...row,
        supplierName: supplierById.get(String(row.supplier_id))?.name ?? row.provider_name ?? "Fornecedor não informado",
        partSku: partsById.get(String(row.part_id))?.sku ?? "",
        partName: partsById.get(String(row.part_id))?.name ?? "Peça",
        receiptNumber: receiptOptionById.get(String(row.source_receipt_item_id))?.receiptNumber ?? "",
        receivedAt: receiptOptionById.get(String(row.source_receipt_item_id))?.receivedAt ?? null,
        purchaseDate: receiptOptionById.get(String(row.source_receipt_item_id))?.purchaseDate ?? null,
      })),
      customerWarranties: (customerWarranties.data ?? []).map((row: any) => ({
        ...row,
        quantityCovered: Number(row.quantity_covered ?? 1),
        partSku: partsById.get(String(row.part_id))?.sku ?? "",
        partName: partsById.get(String(row.part_id))?.name ?? "",
        workOrderProtocol: (workOrders.data ?? []).find((wo: any) => String(wo.id) === String(row.work_order_id))?.protocol ?? "",
        clientName: (() => {
          const workOrder = (workOrders.data ?? []).find((wo: any) => String(wo.id) === String(row.work_order_id));
          const client = workOrder ? clientsById.get(String(workOrder.client_id ?? "")) : null;
          return client?.trade_name || client?.legal_name || "";
        })(),
      })),
      claims: claims.data ?? [],
      suppliers: suppliers.data ?? [],
      customerWarrantyPolicies: warrantyPolicies.data ?? [],
      services: services.data ?? [],
      parts: warrantyParts,
      receiptItems: receiptOptions,
      workOrderParts: (workOrderParts.data ?? []).map((row: any) => ({
        id: row.id,
        workOrderId: row.work_order_id,
        partId: row.part_id,
        quantity: Number(row.quantity ?? 0),
        consumptionStatus: row.consumption_status ?? null,
        partSku: partsById.get(String(row.part_id))?.sku ?? "",
        partName: partsById.get(String(row.part_id))?.name ?? "Peça",
        receiptAllocations: (receiptAllocations.data ?? []).filter((allocation: any) => String(allocation.work_order_part_id) === String(row.id)),
      })),
      workOrders: (workOrders.data ?? []).map((row: any) => ({
        id: row.id, protocol: row.protocol, clientId: row.client_id, type: row.type, createdAt: row.created_at,
      })),
    };
  });

export const linkDbsWorkOrderPartReceiptItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { workOrderPartId: string; receiptItemId: string; quantity: number; idempotencyKey: string }) => {
    const quantity = Number(input?.quantity);
    const idempotencyKey = String(input?.idempotencyKey ?? "").trim();
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1000000) throw new Error("Quantidade de lote/série inválida.");
    if (idempotencyKey.length < 8 || idempotencyKey.length > 240) throw new Error("Chave de rastreabilidade inválida.");
    return {
      workOrderPartId: requiredId(input?.workOrderPartId, "Item da OS"),
      receiptItemId: requiredId(input?.receiptItemId, "Item do recebimento"),
      quantity, idempotencyKey,
    };
  })
  .handler(async ({ context, data }) => {
    const scope = await requireWarrantyFinance(context);
    const { data: result, error } = await (supabaseAdmin as any).rpc("dbs_control_link_work_order_part_receipt_item", {
      p_actor_user_id: scope.id,
      p_scope_key: scope.scopeKey,
      p_work_order_part_id: data.workOrderPartId,
      p_receipt_item_id: data.receiptItemId,
      p_quantity: data.quantity,
      p_idempotency_key: data.idempotencyKey,
    });
    if (error) throw new Error(error.message);
    return result;
  });

export const createDbsSupplierWarranty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: {
    partId: string; supplierId?: string; sourceReceiptItemId?: string;
    serialNumber?: string; lotNumber?: string; quantityCovered?: number;
    providerName?: string; startAnchor: "invoice_date" | "receipt_date" | "installation_date" | "manual_date";
    startsOn: string; expiresOn?: string; durationMonths?: number | null;
    terms?: string; documentReference?: string; notes?: string; evidence?: string[];
  }) => {
    const fields = normalizeWarrantyFields(input);
    if (!["invoice_date","receipt_date","installation_date","manual_date"].includes(input?.startAnchor)) {
      throw new Error("Origem da data inicial da garantia inválida.");
    }
    const quantity = Number(input?.quantityCovered ?? 1);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1000000) throw new Error("Quantidade coberta inválida.");
    const serialNumber = String(input?.serialNumber ?? "").trim().slice(0,160) || null;
    const lotNumber = String(input?.lotNumber ?? "").trim().slice(0,160) || null;
    if (serialNumber && lotNumber) { /* both identifiers may be useful together */ }
    return {
      partId: requiredId(input.partId, "Peça"),
      supplierId: optionalId(input.supplierId, "Fornecedor"),
      sourceReceiptItemId: optionalId(input.sourceReceiptItemId, "Item do recebimento"),
      serialNumber, lotNumber, quantityCovered: quantity,
      providerName: String(input?.providerName ?? "").trim().slice(0,180) || null,
      startAnchor: input.startAnchor, ...fields,
      documentReference: String(input?.documentReference ?? "").trim().slice(0,240) || null,
    };
  })
  .handler(async ({ context, data }) => {
    const scope = await requireWarrantyFinance(context);
    const part = await (supabaseAdmin as any).from("dbs_control_parts")
      .select("id,supplier_id,status").eq("id", data.partId).maybeSingle();
    if (part.error) throw new Error(part.error.message);
    if (!part.data || part.data.status !== "ativo") throw new Error("Peça não encontrada ou inativa.");

    let receiptSupplierId: string | null = null;
    let effectiveStartsOn = data.startsOn;
    if ((data.startAnchor === "receipt_date" || data.startAnchor === "invoice_date") && !data.sourceReceiptItemId) {
      throw new Error("Vincule o item do recebimento para usar a data de recebimento ou nota fiscal como início da garantia.");
    }
    if (data.sourceReceiptItemId) {
      const item = await (supabaseAdmin as any).from("dbs_control_purchase_receipt_items")
        .select("id,part_id,receipt_id,quantity_received").eq("id", data.sourceReceiptItemId).maybeSingle();
      if (item.error) throw new Error(item.error.message);
      if (!item.data || String(item.data.part_id) !== data.partId) {
        throw new Error("O item do recebimento não corresponde à peça selecionada.");
      }
      if (data.quantityCovered > Number(item.data.quantity_received ?? 0)) {
        throw new Error("A quantidade coberta não pode superar a quantidade recebida neste item.");
      }
      const receipt = await (supabaseAdmin as any).from("dbs_control_purchase_receipts")
        .select("id,purchase_id,scope_key,received_at").eq("id", item.data.receipt_id).eq("scope_key", scope.scopeKey).maybeSingle();
      if (receipt.error) throw new Error(receipt.error.message);
      if (!receipt.data) throw new Error("Recebimento não encontrado no escopo financeiro.");
      const purchase = await (supabaseAdmin as any).from("dbs_control_purchases")
        .select("supplier_id,supplier_name,purchase_date").eq("id", receipt.data.purchase_id).eq("scope_key", scope.scopeKey).maybeSingle();
      if (purchase.error) throw new Error(purchase.error.message);
      if (data.startAnchor === "receipt_date") {
        const receivedAt = String(receipt.data.received_at ?? "");
        if (!isIsoDate(receivedAt.slice(0, 10))) throw new Error("O recebimento não possui data válida para iniciar a garantia.");
        effectiveStartsOn = receivedAt.slice(0, 10);
      } else if (data.startAnchor === "invoice_date") {
        const invoiceDate = String(purchase.data?.purchase_date ?? "");
        if (!isIsoDate(invoiceDate)) throw new Error("A compra não possui data válida de nota fiscal para iniciar a garantia.");
        effectiveStartsOn = invoiceDate;
      }
      receiptSupplierId = purchase.data?.supplier_id ?? null;
      if (data.supplierId && receiptSupplierId && data.supplierId !== receiptSupplierId) {
        throw new Error("O fornecedor escolhido não corresponde ao recebimento informado.");
      }
    }
    const supplierId = data.supplierId ?? receiptSupplierId ?? part.data.supplier_id ?? null;
    if (!supplierId) throw new Error("Selecione o fornecedor ou vincule o item do recebimento.");
    const supplier = await (supabaseAdmin as any).from("dbs_control_suppliers")
      .select("id,status").eq("id", supplierId).eq("scope_key", scope.scopeKey).maybeSingle();
    if (supplier.error) throw new Error(supplier.error.message);
    if (!supplier.data || supplier.data.status !== "active") throw new Error("Fornecedor não encontrado ou inativo.");

    const saved = await (supabaseAdmin as any).from("dbs_control_supplier_warranties").insert({
      company_id: scope.companyId, scope_key: scope.scopeKey, part_id: data.partId,
      supplier_id: supplierId, source_receipt_item_id: data.sourceReceiptItemId,
      serial_number: data.serialNumber, lot_number: data.lotNumber,
      quantity_covered: data.quantityCovered, provider_name: data.providerName,
      start_anchor: data.startAnchor, starts_on: effectiveStartsOn,
      expires_on: data.expiresOnProvided && effectiveStartsOn === data.startsOn
        ? data.expiresOn
        : data.durationMonths != null ? addWarrantyMonths(effectiveStartsOn, data.durationMonths) : data.expiresOn,
      duration_months: data.durationMonths, terms: data.terms, document_reference: data.documentReference,
      notes: data.notes, evidence: data.evidence, created_by: scope.id, updated_by: scope.id,
    }).select("id,part_id,supplier_id,serial_number,lot_number,starts_on,expires_on,status").single();
    if (saved.error) {
      if (saved.error.code === "23505") throw new Error("Já existe garantia ativa cadastrada para este número de série e peça.");
      throw new Error(saved.error.message);
    }
    return saved.data;
  });

export const createDbsCustomerWarranty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: {
    workOrderId: string; coverageType: "part" | "service" | "work_order";
    workOrderPartId?: string; startsOn: string; expiresOn?: string;
    durationMonths?: number | null; terms?: string; notes?: string; evidence?: string[];
  }) => {
    const fields = normalizeWarrantyFields(input);
    if (!["part","service","work_order"].includes(input?.coverageType)) throw new Error("Tipo de cobertura DBS inválido.");
    return {
      workOrderId: requiredId(input.workOrderId, "OS"),
      coverageType: input.coverageType,
      workOrderPartId: optionalId(input.workOrderPartId, "Item da OS"),
      ...fields,
    };
  })
  .handler(async ({ context, data }) => {
    const scope = await requireWarrantyFinance(context);
    const workOrder = await (supabaseAdmin as any).from("dbs_control_work_orders")
      .select("id,created_by_user_id,client_id").eq("id", data.workOrderId)
      .in("created_by_user_id", scope.scopedUserIds).is("deleted_at", null).maybeSingle();
    if (workOrder.error) throw new Error(workOrder.error.message);
    if (!workOrder.data) throw new Error("OS não encontrada no escopo financeiro.");
    let partId: string | null = null;
    if (data.workOrderPartId) {
      const orderPart = await (supabaseAdmin as any).from("dbs_control_work_order_parts")
        .select("id,work_order_id,part_id").eq("id", data.workOrderPartId)
        .eq("work_order_id", data.workOrderId).maybeSingle();
      if (orderPart.error) throw new Error(orderPart.error.message);
      if (!orderPart.data) throw new Error("Peça não encontrada nesta OS.");
      partId = orderPart.data.part_id;
    }
    if (data.coverageType === "part" && !data.workOrderPartId) {
      throw new Error("Selecione a peça instalada a partir dos itens registrados na OS.");
    }
    const saved = await (supabaseAdmin as any).from("dbs_control_customer_warranties").insert({
      company_id: scope.companyId, scope_key: scope.scopeKey,
      work_order_id: data.workOrderId, work_order_part_id: data.workOrderPartId,
      part_id: partId, coverage_type: data.coverageType,
      starts_on: data.startsOn, expires_on: data.expiresOn,
      duration_months: data.durationMonths, terms: data.terms,
      notes: data.notes, evidence: data.evidence, created_by: scope.id, updated_by: scope.id,
    }).select("id,work_order_id,part_id,coverage_type,starts_on,expires_on,status").single();
    if (saved.error) throw new Error(saved.error.message);
    return saved.data;
  });

export const openDbsWarrantyClaim = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { claimType: "supplier" | "customer"; warrantyId: string; issueDescription: string; idempotencyKey: string }) => {
    const issueDescription = String(input?.issueDescription ?? "").trim();
    const idempotencyKey = String(input?.idempotencyKey ?? "").trim();
    if (input?.claimType !== "supplier" && input?.claimType !== "customer") throw new Error("Tipo de garantia inválido.");
    if (issueDescription.length < 5 || issueDescription.length > 4000) throw new Error("Descreva o problema em 5 a 4.000 caracteres.");
    if (idempotencyKey.length < 8 || idempotencyKey.length > 240) throw new Error("Chave de segurança do chamado inválida.");
    return { claimType: input.claimType, warrantyId: requiredId(input.warrantyId, "Garantia"), issueDescription, idempotencyKey };
  })
  .handler(async ({ context, data }) => {
    const scope = await resolveWarrantyScope(context);
    const { data: result, error } = await (supabaseAdmin as any).rpc("dbs_control_open_warranty_claim", {
      p_actor_user_id: scope.id,
      p_claim_type: data.claimType,
      p_warranty_id: data.warrantyId,
      p_issue_description: data.issueDescription,
      p_idempotency_key: data.idempotencyKey,
    });
    if (error) throw new Error(error.message);
    return result;
  });

export const updateDbsWarrantyClaim = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: {
    claimId: string; status: "opened" | "under_review" | "approved" | "rejected" | "replaced" | "credited" | "closed";
    note?: string; expectedVersion: number; idempotencyKey: string;
  }) => {
    const idempotencyKey = String(input?.idempotencyKey ?? "").trim();
    const note = String(input?.note ?? "").trim();
    if (!["opened","under_review","approved","rejected","replaced","credited","closed"].includes(input?.status)) throw new Error("Status de garantia inválido.");
    if (!Number.isSafeInteger(input?.expectedVersion) || input.expectedVersion < 1) throw new Error("Versão do chamado inválida.");
    if (idempotencyKey.length < 8 || idempotencyKey.length > 240) throw new Error("Chave de segurança do chamado inválida.");
    if (["rejected","replaced","credited"].includes(input.status) && note.length < 5) throw new Error("Informe a justificativa da decisão.");
    return { claimId: requiredId(input.claimId, "Chamado"), status: input.status, note, expectedVersion: input.expectedVersion, idempotencyKey };
  })
  .handler(async ({ context, data }) => {
    const scope = await requireWarrantyFinance(context);
    const { data: result, error } = await (supabaseAdmin as any).rpc("dbs_control_update_warranty_claim", {
      p_actor_user_id: scope.id,
      p_claim_id: data.claimId,
      p_status: data.status,
      p_note: data.note,
      p_expected_version: data.expectedVersion,
      p_idempotency_key: data.idempotencyKey,
    });
    if (error) throw new Error(error.message);
    return result;
  });

export const getDbsWarrantyClaimHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: { claimId: string }) => ({ claimId: requiredId(input?.claimId, "Chamado") }))
  .handler(async ({ context, data }) => {
    const scope = await resolveWarrantyScope(context);
    const claim = await (supabaseAdmin as any).from("dbs_control_warranty_claims")
      .select("id").eq("id", data.claimId).eq("scope_key", scope.scopeKey).maybeSingle();
    if (claim.error) throw new Error(claim.error.message);
    if (!claim.data) throw new Error("Chamado de garantia não encontrado.");
    const history = await (supabaseAdmin as any).from("dbs_control_warranty_claim_history")
      .select("id,from_status,to_status,note,changed_by,created_at")
      .eq("claim_id", data.claimId).eq("scope_key", scope.scopeKey).order("created_at");
    if (history.error) throw new Error(history.error.message);
    return history.data ?? [];
  });
