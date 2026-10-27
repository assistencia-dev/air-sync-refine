import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type DbsControlUser = {
  id: string;
  company_id: string | null;
  role_key: string;
  status: string;
  created_by?: string | null;
};

type DeleteDbsControlWorkOrderInput = {
  requestId?: string;
  workOrderId?: string;
  protocol?: string;
};

async function requireDbsControlUser(context: { userId: string }) {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id, company_id, role_key, status, created_by")
    .eq("auth_id", context.userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data || data.status !== "ativo") throw new Error("Usuário inativo ou não encontrado.");

  const allowed = ["SUPER_ADMIN", "ADMIN_OPERACIONAL", "GESTOR_CONTA", "GESTOR_REGIONAL", "COLABORADOR"];
  if (!allowed.includes(data.role_key)) throw new Error("Acesso ao DBS CONTROL não autorizado.");

  return data as DbsControlUser;
}

async function resolveDbsControlScope(user: DbsControlUser) {
  if (user.company_id) return { scopeKey: `company:${user.company_id}`, ownerUserId: user.id, companyId: user.company_id };
  if (user.role_key !== "COLABORADOR") return { scopeKey: `user:${user.id}`, ownerUserId: user.id, companyId: null as string | null };
  if (user.created_by) {
    const { data: creator, error } = await supabaseAdmin.from("users").select("id, company_id, role_key, status").eq("id", user.created_by).maybeSingle();
    if (error) throw new Error(error.message);
    if (creator && creator.status === "ativo" && ["SUPER_ADMIN", "ADMIN_OPERACIONAL", "GESTOR_CONTA", "GESTOR_REGIONAL"].includes(creator.role_key)) {
      return creator.company_id
        ? { scopeKey: `company:${creator.company_id}`, ownerUserId: creator.id, companyId: creator.company_id as string }
        : { scopeKey: `user:${creator.id}`, ownerUserId: creator.id, companyId: null as string | null };
    }
  }
  const { data: admins, error: adminError } = await supabaseAdmin.from("users").select("id, company_id, role_key").eq("status", "ativo").in("role_key", ["SUPER_ADMIN", "ADMIN_OPERACIONAL", "GESTOR_CONTA", "GESTOR_REGIONAL"]);
  if (adminError) throw new Error(adminError.message);
  const ids = (admins ?? []).map((a: any) => String(a.id));
  const { data: snapshots, error: snapshotError } = ids.length
    ? await supabaseAdmin.from("dbs_control_snapshots").select("scope_key, owner_user_id, company_id, updated_at").in("owner_user_id", ids).order("updated_at", { ascending: false })
    : { data: [], error: null };
  if (snapshotError) throw new Error(snapshotError.message);
  const candidates = (snapshots ?? []).filter((row: any) => {
    const owner: any = (admins ?? []).find((a: any) => String(a.id) === String(row.owner_user_id));
    return !user.company_id || String(row.company_id ?? owner?.company_id ?? "") === String(user.company_id);
  });
  if (candidates.length === 1) {
    const row: any = candidates[0];
    const owner: any = (admins ?? []).find((a: any) => String(a.id) === String(row.owner_user_id));
    return { scopeKey: String(row.scope_key), ownerUserId: String(row.owner_user_id), companyId: (row.company_id ?? owner?.company_id ?? null) as string | null };
  }
  if (candidates.length > 1) throw new Error("Há mais de uma base administrativa possível. Vincule o colaborador à empresa correta no RH.");
  throw new Error("A base compartilhada ainda não foi criada pela administração. Os dados locais foram preservados.");
}

function normalizeState(state: Record<string, unknown>) {
  return {
    ...state,
    tecnicos: Array.isArray(state.tecnicos) ? state.tecnicos : [],
    clientes: Array.isArray(state.clientes) ? state.clientes : [],
    equipamentos: Array.isArray(state.equipamentos) ? state.equipamentos : [],
    pecas: Array.isArray(state.pecas) ? state.pecas : [],
    servicos: Array.isArray(state.servicos) ? state.servicos : [],
    compras: Array.isArray(state.compras) ? state.compras : [],
    ordens: Array.isArray(state.ordens) ? state.ordens : [],
    sites: Array.isArray(state.sites) ? state.sites : [],
    locais: Array.isArray(state.locais) ? state.locais : [],
  };
}

async function getCollaboratorEmployee(userId: string) {
  const { data: user, error: userError } = await supabaseAdmin
    .from("users")
    .select("id, email, company_id")
    .eq("id", userId)
    .maybeSingle();
  if (userError) throw new Error(userError.message);

  const direct = await supabaseAdmin
    .from("rh_employees")
    .select("id, full_name, unit, is_active, registration_data, dbs_control_base_id, dbs_control_can_issue_work_orders")
    .eq("ponto_portal_user_id", userId)
    .eq("dbs_control_access_enabled", true)
    .eq("is_active", true)
    .maybeSingle();

  if (direct.error) throw new Error(direct.error.message);

  let data = direct.data;
  if (!data) {
    const access = await supabaseAdmin
      .from("rh_employee_access")
      .select("employee_id")
      .eq("user_id", userId)
      .eq("access_enabled", true)
      .maybeSingle();

    if (access.error) throw new Error(access.error.message);
    if (access.data?.employee_id) {
      const fallback = await supabaseAdmin
        .from("rh_employees")
        .select("id, full_name, unit, is_active, registration_data, dbs_control_access_enabled, dbs_control_base_id, dbs_control_can_issue_work_orders")
        .eq("id", access.data.employee_id)
        .eq("is_active", true)
        .maybeSingle();
      if (fallback.error) throw new Error(fallback.error.message);
      if (fallback.data?.dbs_control_access_enabled) {
        data = fallback.data;
      }
    }
  }

  if (!data) return null;
  const registrationEmail = String((data.registration_data as Record<string, unknown> | null)?.email ?? "").trim().toLowerCase();
  return {
    ...data,
    login_email: String(user?.email ?? "").trim().toLowerCase() || registrationEmail || null,
    user_company_id: user?.company_id ?? null,
  };
}

async function getCollaboratorBaseScope(employee: any) {
  const baseId = String(employee?.dbs_control_base_id ?? "").trim();
  if (!baseId) return { baseId: null, baseName: null, canIssueWorkOrders: false, clientIds: [] as string[] };
  const [baseResult, linksResult] = await Promise.all([
    (supabaseAdmin as any).from("dbs_control_bases").select("id, company_id, name, status").eq("id", baseId).maybeSingle(),
    (supabaseAdmin as any).from("dbs_control_base_clients").select("client_id").eq("base_id", baseId),
  ]);
  if (baseResult.error) throw new Error(baseResult.error.message);
  if (linksResult.error) throw new Error(linksResult.error.message);
  if (baseResult.data?.company_id && employee?.user_company_id && String(baseResult.data.company_id) !== String(employee.user_company_id)) {
    return { baseId: null, baseName: null, canIssueWorkOrders: false, clientIds: [] as string[] };
  }
  // Status é normalizado para tolerar valores legados com caixa/espaços
  // diferentes sem relaxar a regra de base ativa.
  const active = normalizeDbsStatus(baseResult.data?.status) === "ativo";
  const clientIds: string[] = active
    ? [...new Set<string>((linksResult.data ?? [])
      .map((row: any) => String(row.client_id ?? "").trim())
      .filter(Boolean))]
    : [];
  return {
    baseId: active ? baseId : null,
    baseName: active ? String(baseResult.data?.name ?? "").trim() : null,
    canIssueWorkOrders: Boolean(active && employee?.dbs_control_can_issue_work_orders),
    clientIds,
  };
}

function isWorkOrderHiddenFromCollaborator(order: any): boolean {
  if (!order || typeof order !== "object") return true;
  if (order.deleted_at || order.deletedAt || order.excluidaEm || order.arquivadaEm) return true;
  const status = String(order.status ?? order.situacao ?? order.statusOS ?? "")
    .trim()
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return status.includes("cancelad");
}

function filterCollaboratorState(
  state: Record<string, unknown>,
  employeeId: string,
  loginEmail?: string | null,
  scope: { clientIds?: string[]; canIssueWorkOrders?: boolean } = {},
) {
  const normalized = normalizeState(state);
  const normalizedEmail = String(loginEmail ?? "").trim().toLowerCase();
  const technicians = (normalized.tecnicos as any[]).filter((tech) =>
    String(tech?.employeeId ?? "") === employeeId ||
    (normalizedEmail && String(tech?.email ?? "").trim().toLowerCase() === normalizedEmail)
  );
  const technicianIds = new Set(technicians.map((tech) => String(tech.id)));

  // employeeId é a referência canônica. tecnicoId continua sendo aceito para
  // preservar OS antigas que ainda não receberam o vínculo central do RH.
  const orders = (normalized.ordens as any[])
    .filter((order) =>
      !isWorkOrderHiddenFromCollaborator(order) && (
        String(order?.employeeId ?? "") === employeeId ||
        technicianIds.has(String(order?.tecnicoId))
      )
    )
    .map((order) => (
      String(order?.employeeId ?? "") === employeeId
        ? order
        : { ...order, employeeId }
    ));
  const clientIds = new Set([
    ...orders.map((order) => String(order?.clienteId)).filter(Boolean),
    ...(scope.canIssueWorkOrders ? (scope.clientIds ?? []).map(String) : []),
  ]);
  const equipmentIds = new Set<string>();
  for (const order of orders) {
    if (order?.equipamentoId != null) equipmentIds.add(String(order.equipamentoId));
    for (const equipmentId of Array.isArray(order?.equipamentosIds) ? order.equipamentosIds : []) {
      if (equipmentId != null) equipmentIds.add(String(equipmentId));
    }
  }
  const serviceIds = new Set(orders.map((order) => String(order?.servicoId)).filter(Boolean));

  const partsUsed = new Set<string>();
  for (const order of orders) {
    for (const part of Array.isArray(order?.pecasUsadas) ? order.pecasUsadas : []) {
      if (part?.id != null) partsUsed.add(String(part.id));
    }
  }

  return {
    ...normalized,
    tecnicos: technicians,
    ordens: orders,
    clientes: (normalized.clientes as any[]).filter((item) => clientIds.has(String(item?.id))),
    equipamentos: (normalized.equipamentos as any[]).filter((item) =>
      equipmentIds.has(String(item?.id)) || (scope.canIssueWorkOrders && clientIds.has(String(item?.clienteId ?? item?.client_id)))
    ),
    servicos: scope.canIssueWorkOrders
      ? (normalized.servicos as any[])
      : (normalized.servicos as any[]).filter((item) => serviceIds.has(String(item?.id))),
    sites: (normalized.sites as any[]).filter((item) => clientIds.has(String(item?.clienteId ?? item?.client_id))),
    locais: (normalized.locais as any[]).filter((item) => clientIds.has(String(item?.clienteId ?? item?.client_id))),
    pecas: (normalized.pecas as any[]).filter((item) => partsUsed.has(String(item?.id))),
    compras: [],
  };
}

function mergeAppendOnlyCollaboratorObservations(currentOrder: any, incomingOrder: any) {
  const merged: Record<string, string> = {};
  const fields = ["observacao", "observacaoTecnico", "observacaoComplementarTecnico"];

  for (const field of fields) {
    const currentValue = currentOrder?.[field];
    const incomingValue = incomingOrder?.[field];
    if (currentValue != null && typeof currentValue !== "string") continue;
    if (typeof incomingValue !== "string") continue;

    const existing = String(currentValue ?? "").trim();
    const incoming = incomingValue.trim();
    if (!incoming || incoming === existing) continue;

    // Normal client update: the submitted history extends the stored history.
    if (existing ? incoming.startsWith(`${existing}\n\n[`) : incoming.startsWith("[")) {
      merged[field] = incoming;
      continue;
    }

    // Concurrent update: keep the server history and append only new timestamped entries.
    const knownEntries = new Set(existing.split(/\n\n/).map((entry) => entry.trim()).filter(Boolean));
    const additions = incoming
      .split(/\n\n/)
      .map((entry) => entry.trim())
      .filter((entry) => /^\[[^\]]+\]\s+/.test(entry) && !knownEntries.has(entry));
    if (additions.length) merged[field] = [existing, ...additions].filter(Boolean).join("\n\n");
  }

  return merged;
}

function normalizeDbsStatus(value: unknown): string {
  return String(value ?? "").trim().toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function mergeDbsRecord(canonical: Record<string, unknown>, current: Record<string, unknown> | undefined) {
  if (!current) return { ...canonical };
  // A tabela operacional é a fonte de verdade para campos que ela armazena.
  // O snapshot legado só pode completar campos canônicos vazios; nunca pode
  // substituir status, conclusão, assinatura ou observação já gravados no banco.
  const merged: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(canonical)) {
    if (value !== null && value !== undefined && !(typeof value === "string" && value.trim() === "")) {
      merged[key] = value;
    } else if (!(key in merged) || merged[key] === null || merged[key] === undefined || (typeof merged[key] === "string" && (merged[key] as string).trim() === "")) {
      merged[key] = value;
    }
  }
  return merged;
}

type DbsControlHydrationScope = {
  employeeId?: string;
  clientIds?: string[];
  canIssueWorkOrders?: boolean;
};

async function fetchAllDbsControlWorkOrders(scope: DbsControlHydrationScope = {}) {
  // Keyset/cursor pagination: never use offset for the operational list. UUID
  // ordering is stable and avoids scanning/skipping thousands of rows as the
  // operation receives new OS records.
  const rows: any[] = [];
  const pageSize = 500;
  let cursor: string | null = null;

  for (;;) {
    let query = supabaseAdmin
      .from("dbs_control_work_orders")
      .select("id,protocol,protocolo,client_id,site_id,assigned_employee_id,service_id,type,priority,status,scheduled_at,started_at,completed_at,sla_deadline,description,technical_opinion,diagnostico,observation,servico_executado,latitude,longitude,signature_name,signature_data,assinatura_path,signature_path,execution_checklist,completion_status_code,geolocation_captured_at,total_cents,version,idempotency_key,deleted_at,created_at,updated_at")
      .order("id", { ascending: true })
      .limit(pageSize);

    if (scope.employeeId) query = query.eq("assigned_employee_id", scope.employeeId);
    if (cursor) query = query.gt("id", cursor);

    const { data, error } = await query;
    if (error) return { data: null, error };

    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) break;

    const nextCursor = String(page[page.length - 1]?.id ?? "").trim();
    if (!nextCursor || nextCursor === cursor) {
      return { data: null, error: new Error("Paginação por cursor não avançou; leitura interrompida por segurança.") };
    }
    cursor = nextCursor;
  }

  return { data: rows, error: null };
}

async function hydrateDbsControlStateFromCanonicalDb(
  state: Record<string, unknown>,
  companyId: string | null,
  scopeKey?: string,
  collaboratorScope?: DbsControlHydrationScope,
) {
  if (!companyId && !scopeKey) return normalizeState(state);

  // Em modo colaborador, primeiro buscamos somente as OS atribuídas. Os IDs
  // dos clientes dessas OS são adicionados ao escopo da base antes das demais
  // consultas, evitando transportar milhares de clientes/equipamentos do
  // administrativo para um celular que precisa de dezenas.
  const scopedEmployeeId = String(collaboratorScope?.employeeId ?? "").trim();
  const isScopedCollaborator = Boolean(scopedEmployeeId);
  const ordersResult = await fetchAllDbsControlWorkOrders(
    isScopedCollaborator ? { employeeId: scopedEmployeeId } : {},
  );
  if (ordersResult.error) throw new Error(ordersResult.error.message);
  const orderRows = ordersResult.data ?? [];
  const scopedClientIds = isScopedCollaborator
    ? [...new Set([
        ...(collaboratorScope?.clientIds ?? []).map(String),
        ...orderRows.map((row: any) => String(row?.client_id ?? "")).filter(Boolean),
      ])]
    : [];
  const scopedOrderIds = isScopedCollaborator ? orderRows.map((row: any) => String(row.id)) : [];
  const scopedServiceIds = isScopedCollaborator ? [...new Set(orderRows.map((row: any) => String(row?.service_id ?? "")).filter(Boolean))] : [];
  const noRows = { data: [], error: null };
  const inScope = (values: string[]) => values.length > 0;

  const [
    clientsResult,
    sitesResult,
    equipmentResult,
    servicesResult,
    partsResult,
    employeesResult,
    orderEquipmentResult,
    orderPartsResult,
    legacyRecordsResult,
    legacyMapResult,
  ] = await Promise.all([
    (() => {
      const query = supabaseAdmin.from("dbs_control_clients")
        .select("id,legal_name,trade_name,cnpj,phone,email,notes,status,updated_at");
      return isScopedCollaborator
        ? (inScope(scopedClientIds) ? query.in("id", scopedClientIds) : noRows)
        : query;
    })(),
    (() => {
      const query = supabaseAdmin.from("dbs_control_sites")
        .select("id,client_id,name,address_json,contact_name,contact_phone,contact_email,notes,status,updated_at");
      return isScopedCollaborator
        ? (inScope(scopedClientIds) ? query.in("client_id", scopedClientIds) : noRows)
        : query;
    })(),
    (() => {
      const query = supabaseAdmin.from("dbs_control_equipment")
        .select("id,client_id,site_id,tag_code,equipment_type,brand,model,serial_number,capacity,environment,installation_date,status,technical_notes,updated_at");
      return isScopedCollaborator
        ? (inScope(scopedClientIds) ? query.in("client_id", scopedClientIds) : noRows)
        : query;
    })(),
    (() => {
      const query = supabaseAdmin.from("dbs_control_service_catalog")
        .select("id,name,description,estimated_hours,table_value_cents,status,updated_at");
      if (!isScopedCollaborator) return query;
      // Emissão precisa do catálogo ativo; execução sem emissão só precisa dos
      // serviços já vinculados às OS atribuídas.
      const ids = scopedServiceIds;
      if (!collaboratorScope?.canIssueWorkOrders && !inScope(ids)) return noRows;
      if (collaboratorScope?.canIssueWorkOrders && !inScope(ids)) return query.eq("status", "ativo");
      return collaboratorScope?.canIssueWorkOrders
        ? query.or(`status.eq.ativo,id.in.(${ids.join(",")})`)
        : query.in("id", ids);
    })(),
    (() => {
      const query = supabaseAdmin.from("dbs_control_parts")
        .select("id,sku,name,description,stock_quantity,cost_cents,sale_cents,status,updated_at");
      return isScopedCollaborator ? noRows : query;
    })(),
    (() => {
      const query = supabaseAdmin.from("rh_employees")
        .select("id,full_name,is_active,source_system,source_key,registration_data,updated_at");
      return isScopedCollaborator ? query.eq("id", scopedEmployeeId) : query;
    })(),
    (() => {
      const query = supabaseAdmin.from("dbs_control_work_order_equipment")
        .select("work_order_id,equipment_id");
      return isScopedCollaborator
        ? (inScope(scopedOrderIds) ? query.in("work_order_id", scopedOrderIds) : noRows)
        : query;
    })(),
    (() => {
      const query = supabaseAdmin.from("dbs_control_work_order_parts")
        .select("work_order_id,part_id,quantity,unit_cents");
      return isScopedCollaborator
        ? (inScope(scopedOrderIds) ? query.in("work_order_id", scopedOrderIds) : noRows)
        : query;
    })(),
    scopeKey
      ? supabaseAdmin.from("dbs_control_entity_records")
        .select("entity_type,record_key,payload,version,updated_at")
        .eq("scope_key", scopeKey)
        .is("deleted_at", null)
      : Promise.resolve({ data: [], error: null }),
    scopeKey
      ? supabaseAdmin.from("dbs_control_legacy_id_map")
        .select("entity_type,legacy_key,canonical_id")
        .eq("scope_key", scopeKey)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const results = [
    clientsResult,
    sitesResult,
    equipmentResult,
    servicesResult,
    partsResult,
    employeesResult,
    ordersResult,
    orderEquipmentResult,
    orderPartsResult,
    legacyRecordsResult,
    legacyMapResult,
  ];
  const firstError = results.find((result) => result.error)?.error;
  if (firstError) throw new Error(firstError.message);

  const legacyIdMap = new Map<string, string>(
    (legacyMapResult.data ?? []).map((row: any) => [
      `${String(row.entity_type)}:${String(row.legacy_key)}`,
      String(row.canonical_id),
    ]),
  );
  const mapLegacyId = (entityType: string, value: unknown) => {
    const raw = String(value ?? "").trim();
    return raw ? (legacyIdMap.get(`${entityType}:${raw}`) ?? raw) : raw;
  };
  const remapLegacyState = (source: Record<string, unknown>) => {
    const next = { ...source } as Record<string, any>;
    const remap = (key: string, entityType: string, transform?: (item: any) => any) => {
      if (!Array.isArray(next[key])) return;
      next[key] = next[key].map((item: any) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return item;
        const mapped = { ...item, id: mapLegacyId(entityType, item.id) };
        return transform ? transform(mapped) : mapped;
      });
    };
    remap("clientes", "client");
    remap("sites", "site", (item) => ({ ...item, clienteId: mapLegacyId("client", item.clienteId ?? item.client_id) }));
    remap("locais", "site", (item) => ({ ...item, clienteId: mapLegacyId("client", item.clienteId ?? item.client_id) }));
    remap("equipamentos", "equipment", (item) => ({
      ...item,
      clienteId: mapLegacyId("client", item.clienteId ?? item.client_id),
      client_id: mapLegacyId("client", item.client_id ?? item.clienteId),
      siteId: mapLegacyId("site", item.siteId ?? item.localId ?? item.site_id),
      localId: mapLegacyId("site", item.localId ?? item.siteId ?? item.site_id),
    }));
    remap("servicos", "service");
    remap("pecas", "part");
    const remapOrder = (item: any) => ({
      ...item,
      id: mapLegacyId("work_order", item.id),
      clienteId: mapLegacyId("client", item.clienteId ?? item.client_id),
      client_id: mapLegacyId("client", item.client_id ?? item.clienteId),
      siteId: mapLegacyId("site", item.siteId ?? item.localId ?? item.site_id),
      localId: mapLegacyId("site", item.localId ?? item.siteId ?? item.site_id),
      servicoId: mapLegacyId("service", item.servicoId ?? item.service_id),
      equipamentoId: mapLegacyId("equipment", item.equipamentoId),
      equipamentosIds: Array.isArray(item.equipamentosIds)
        ? item.equipamentosIds.map((id: unknown) => mapLegacyId("equipment", id))
        : item.equipamentosIds,
      pecasUsadas: Array.isArray(item.pecasUsadas)
        ? item.pecasUsadas.map((part: any) => ({ ...part, id: mapLegacyId("part", part?.id) }))
        : item.pecasUsadas,
    });
    if (Array.isArray(next.ordens)) next.ordens = next.ordens.map(remapOrder);
    if (Array.isArray(next.osHistorico)) next.osHistorico = next.osHistorico.map(remapOrder);
    return next;
  };
  const current = remapLegacyState(normalizeState(state));
  const byId = (items: unknown[]): Map<string, any> => {
    const entries: Array<[string, any]> = [];
    for (const item of items as any[]) {
      const id = String(item?.id ?? "");
      if (id) entries.push([id, item]);
    }
    return new Map<string, any>(entries);
  };
  const mergeArray = (
    currentItems: unknown[],
    incomingItems: unknown[],
    options: { preserveCompletedWorkOrderStatus?: boolean } = {},
  ) => {
    const incomingById = byId(incomingItems);
    const result = (currentItems as any[]).map((item) => {
      const canonical = incomingById.get(String(item?.id ?? "")) ?? {};
      const merged = mergeDbsRecord(canonical, item);
      if (options.preserveCompletedWorkOrderStatus) {
        const isCompleted = (value: unknown) =>
          ["concluída", "concluida", "concluído", "concluido"].includes(
            String(value ?? "").trim().toLocaleLowerCase("pt-BR"),
          );
        // Uma conclusão já presente no snapshot não pode ser rebaixada por uma
        // linha canônica ainda desatualizada. Se o banco também confirma conclusão,
        // o status canônico continua prevalecendo.
        if (isCompleted(item?.status) && !isCompleted(canonical?.status)) {
          merged.status = item.status;
        }
      }
      return merged;
    });
    const currentIds = new Set(result.map((item) => String(item?.id ?? "")));
    for (const item of incomingItems as any[]) {
      const id = String(item?.id ?? "");
      if (id && !currentIds.has(id)) result.push(item);
    }
    return result;
  };

  const canonicalClients = (clientsResult.data ?? []).map((row: any) => ({
    id: String(row.id),
    nome: row.trade_name || row.legal_name || "Cliente sem nome",
    razaoSocial: row.legal_name || row.trade_name || "",
    nomeFantasia: row.trade_name || "",
    cnpj: row.cnpj || "",
    contato: row.phone || row.email || "",
    telefone: row.phone || "",
    email: row.email || "",
    status: row.status || "ativo",
    observacoes: row.notes || "",
  }));

  const canonicalSites = (sitesResult.data ?? []).map((row: any) => ({
    id: String(row.id),
    clienteId: String(row.client_id),
    nome: row.name || "Local",
    endereco: row.address_json && typeof row.address_json === "object"
      ? [
          row.address_json.logradouro,
          row.address_json.numero,
          row.address_json.complemento,
          row.address_json.bairro,
          row.address_json.cidade,
          row.address_json.uf,
          row.address_json.cep,
        ].filter(Boolean).join(", ")
      : String(row.address_json || ""),
    contato: row.contact_name || "",
    telefone: row.contact_phone || "",
    email: row.contact_email || "",
    observacoes: row.notes || "",
    status: row.status || "ativo",
  }));

  const canonicalEquipment = (equipmentResult.data ?? []).map((row: any) => ({
    id: String(row.id),
    clienteId: String(row.client_id),
    siteId: row.site_id ? String(row.site_id) : null,
    localId: row.site_id ? String(row.site_id) : null,
    tag: row.tag_code || "",
    patrimonio: row.tag_code || "",
    codigo: row.tag_code || "",
    tipo: row.equipment_type || "",
    nome: row.equipment_type || row.model || "Equipamento",
    descricao: row.technical_notes || "",
    marca: row.brand || "",
    fabricante: row.brand || "",
    modelo: row.model || "",
    serie: row.serial_number || "",
    numeroSerie: row.serial_number || "",
    capacidade: row.capacity || "",
    ambiente: row.environment || "",
    localizacao: row.environment || "",
    dataInstalacao: row.installation_date || "",
    status: row.status || "ativo",
    observacoes: row.technical_notes || "",
  }));

  const canonicalServices = (servicesResult.data ?? []).map((row: any) => ({
    id: String(row.id),
    nome: row.name || "Serviço",
    descricao: row.description || "",
    valor: Number(row.table_value_cents || 0) / 100,
    valorTabela: Number(row.table_value_cents || 0) / 100,
    horasEstimadas: row.estimated_hours ?? null,
    status: row.status || "ativo",
  }));

  const canonicalParts = (partsResult.data ?? []).map((row: any) => ({
    id: String(row.id),
    sku: row.sku || "",
    nome: row.name || "Peça",
    name: row.name || "Peça",
    descricao: row.description || "",
    qtd: Number(row.stock_quantity || 0),
    stock_quantity: Number(row.stock_quantity || 0),
    custo: Number(row.cost_cents || 0) / 100,
    venda: Number(row.sale_cents || 0) / 100,
    status: row.status || "ativo",
  }));

  const canonicalTechnicians = (employeesResult.data ?? [])
    .filter((row: any) => row.is_active !== false)
    .map((row: any) => {
      const registration = row.registration_data && typeof row.registration_data === "object" ? row.registration_data : {};
      return {
        id: String(row.id),
        employeeId: String(row.id),
        nome: row.full_name || "Colaborador",
        email: String(registration.email || "").trim().toLowerCase(),
        fone: registration.phone || registration.telefone || "",
        telefone: registration.phone || registration.telefone || "",
        posicao: registration.position || registration.cargo || "Técnico",
        sourceSystem: row.source_system || "",
        fieldControlId: row.source_key || "",
      };
    });

  const statusMap: Record<string, string> = {
    aberta: "Aberta",
    em_atendimento: "Em atendimento",
    andamento: "Em atendimento",
    concluida: "Concluída",
    concluída: "Concluída",
    concluido: "Concluída",
    concluído: "Concluída",
    concluida_com_pendencia: "Concluída com pendência",
    concluída_com_pendência: "Concluída com pendência",
    pendencia: "Concluída com pendência",
    aguardando_peca: "Aguardando peça",
    aguardando_peça: "Aguardando peça",
    aguardando_aprovacao: "Aguardando aprovação",
    aguardando_aprovação: "Aguardando aprovação",
    retorno_necessario: "Retorno necessário",
    retorno_necessário: "Retorno necessário",
    cancelada: "Cancelada",
    cancelado: "Cancelada",
    aguardando_cliente: "Aguardando cliente",
  };

  const equipmentLinks = new Map<string, string[]>();
  for (const link of orderEquipmentResult.data ?? []) {
    const orderId = String((link as any).work_order_id);
    const equipmentId = String((link as any).equipment_id);
    const list = equipmentLinks.get(orderId) ?? [];
    if (!list.includes(equipmentId)) list.push(equipmentId);
    equipmentLinks.set(orderId, list);
  }

  const partLinks = new Map<string, any[]>();
  for (const link of orderPartsResult.data ?? []) {
    const orderId = String((link as any).work_order_id);
    const list = partLinks.get(orderId) ?? [];
    list.push({
      id: String((link as any).part_id),
      qtd: Number((link as any).quantity || 0),
      quantity: Number((link as any).quantity || 0),
      venda: Number((link as any).unit_cents || 0) / 100,
      unit_cents: (link as any).unit_cents ?? null,
    });
    partLinks.set(orderId, list);
  }

  const canonicalOrders = (ordersResult.data ?? []).map((row: any) => {
    const equipmentIds = equipmentLinks.get(String(row.id)) ?? [];
    const assignedEmployeeId = row.assigned_employee_id ? String(row.assigned_employee_id) : null;
    const mappedStatus = statusMap[String(row.status || "").trim().toLowerCase()] || row.status || "Em Atendimento";
    return {
      id: String(row.id),
      protocolo: row.protocolo || row.protocol || "",
      data: row.created_at ? new Date(row.created_at).toLocaleDateString("pt-BR") : "",
      dataCriacao: row.created_at || "",
      clienteId: String(row.client_id),
      siteId: row.site_id ? String(row.site_id) : null,
      localId: row.site_id ? String(row.site_id) : null,
      equipamentoId: equipmentIds[0] || null,
      equipamentosIds: equipmentIds,
      pecasUsadas: partLinks.get(String(row.id)) ?? [],
      tecnicoId: assignedEmployeeId,
      employeeId: assignedEmployeeId,
      servicoId: row.service_id ? String(row.service_id) : null,
      tipo: row.type || "corretiva",
      prioridade: row.priority || "normal",
      status: mappedStatus,
      scheduledAt: row.scheduled_at || null,
      startedAt: row.started_at || null,
      completedAt: row.completed_at || null,
      sla: row.sla_deadline || null,
      desc: row.description || "",
      diagnostico: row.diagnostico || row.technical_opinion || "",
      observacao: row.servico_executado || row.observation || "",
      trabalhoExecutado: row.servico_executado || row.observation || "",
      latitude: row.latitude ?? null,
      longitude: row.longitude ?? null,
      checklistTecnico: row.execution_checklist?.checklistTecnico ?? {},
      checklist: Array.isArray(row.execution_checklist?.checklist) ? row.execution_checklist.checklist : [],
      parametrosOperacionais: row.execution_checklist?.parametrosOperacionais ?? {},
      completionStatusCode: row.completion_status_code || null,
      geolocationCapturedAt: row.geolocation_captured_at || null,
      signature_name: row.signature_name || null,
      assinaturaStoragePath: row.assinatura_path || row.signature_path || null,
      assinatura: row.assinatura_path || row.signature_path ? null : (row.signature_data || null),
      deleted_at: row.deleted_at || null,
      excluidaEm: row.deleted_at || null,
      version: Number(row.version || 1),
      idempotency_key: row.idempotency_key || null,
      valor: Number(row.total_cents || 0) / 100,
    };
  });

  const sites = mergeArray(Array.isArray((current as any).sites) ? (current as any).sites : [], canonicalSites);
  const locais = mergeArray(Array.isArray((current as any).locais) ? (current as any).locais : [], canonicalSites);

  // O snapshot conserva campos legados, mas não pode apagar uma conclusão já
  // registrada no banco operacional. O status canônico concluído sempre prevalece.
  const mergedOrders = mergeArray(current.ordens as unknown[], canonicalOrders, { preserveCompletedWorkOrderStatus: true }).map((merged: any) => {
    const canonical = canonicalOrders.find((order: any) =>
      String(order.id) === String(merged?.id) ||
      (String(order.protocolo ?? "").trim() &&
        String(order.protocolo ?? "").trim() === String(merged?.protocolo ?? "").trim())
    ) as any;
    if (!canonical) return merged;
    const canonicalCompleted = String(canonical.status ?? "").trim() === "Concluída";
    const snapshotCompleted = ["concluída", "concluida", "concluído", "concluido"].includes(
      String(merged?.status ?? "").trim().toLocaleLowerCase("pt-BR")
    );
    return {
      ...merged,
      status: canonicalCompleted ? "Concluída" : (snapshotCompleted ? merged.status : canonical.status),
      scheduledAt: canonical.scheduledAt ?? merged.scheduledAt ?? null,
      startedAt: canonical.startedAt ?? merged.startedAt ?? null,
      completedAt: canonical.completedAt ?? merged.completedAt ?? null,
      concluidoEm: canonical.completedAt ?? merged.concluidoEm ?? merged.completedAt ?? null,
      diagnostico: canonical.diagnostico || merged.diagnostico || "",
      observacao: canonical.observacao || merged.observacao || "",
      assinatura: canonical.assinatura || merged.assinatura || null,
      signature_name: canonical.signature_name || merged.signature_name || null,
      valor: canonical.valor ?? merged.valor,
    };
  });

  const legacyCompras = (legacyRecordsResult.data ?? [])
    .filter((row: any) => row.entity_type === "compra")
    .map((row: any) => ({ ...(row.payload && typeof row.payload === "object" ? row.payload : {}), version: row.version }));
  const legacyOrcamentos = (legacyRecordsResult.data ?? [])
    .filter((row: any) => row.entity_type === "orcamento")
    .map((row: any) => ({ ...(row.payload && typeof row.payload === "object" ? row.payload : {}), version: row.version }));

  return {
    ...current,
    clientes: mergeArray(current.clientes as unknown[], canonicalClients),
    equipamentos: mergeArray(current.equipamentos as unknown[], canonicalEquipment),
    servicos: mergeArray(current.servicos as unknown[], canonicalServices),
    pecas: mergeArray(current.pecas as unknown[], canonicalParts),
    tecnicos: mergeArray(current.tecnicos as unknown[], canonicalTechnicians),
    ordens: mergedOrders,
    compras: mergeArray(current.compras as unknown[], legacyCompras),
    orcamentos: mergeArray(Array.isArray((current as any).orcamentos) ? (current as any).orcamentos : [], legacyOrcamentos),
    sites,
    locais,
  };
}


const DBS_CONTROL_ATTACHMENT_BUCKET = "dbs-control-os";
const DBS_CONTROL_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const DBS_CONTROL_ATTACHMENT_TYPES: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
};

function stripStoredAttachmentPayloads(state: Record<string, unknown>) {
  const next = normalizeState(state);
  next.ordens = (next.ordens as any[]).map((order) => {
    const copy = { ...order };
    if (copy.assinaturaStoragePath) copy.assinatura = null;
    if (copy.fotoAntesStoragePath) copy.fotoAntes = null;
    if (copy.fotoDepoisStoragePath) copy.fotoDepois = null;
    return copy;
  });
  return next;
}

async function hydrateStoredAttachmentUrls(state: Record<string, unknown>) {
  const next = normalizeState(state);
  next.ordens = await Promise.all((next.ordens as any[]).map(async (order) => {
    const copy = { ...order };
    const fields = [["assinaturaStoragePath", "assinatura"], ["fotoAntesStoragePath", "fotoAntes"], ["fotoDepoisStoragePath", "fotoDepois"]] as const;
    for (const [pathField, valueField] of fields) {
      const path = String(copy[pathField] ?? "").trim();
      if (!path) continue;
      const { data, error } = await supabaseAdmin.storage.from(DBS_CONTROL_ATTACHMENT_BUCKET).createSignedUrl(path, 3600);
      if (!error && data?.signedUrl) copy[valueField] = data.signedUrl;
    }
    return copy;
  }));
  return next;
}

export const uploadDbsControlOsAttachment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: {
    orderId: string; attachmentType: "foto_antes" | "foto_depois" | "assinatura";
    fileName: string; contentType: string; dataBase64: string; requestId: string;
  }) => {
    if (!input?.orderId || !input?.dataBase64 || !input?.requestId) throw new Error("OS, arquivo e identificador da solicitação são obrigatórios.");
    if (!["foto_antes", "foto_depois", "assinatura"].includes(input.attachmentType)) throw new Error("Tipo de anexo inválido.");
    if (!DBS_CONTROL_ATTACHMENT_TYPES[input.contentType]) throw new Error("Formato inválido. Use JPEG, PNG ou WebP.");
    if (input.dataBase64.length > Math.ceil(DBS_CONTROL_ATTACHMENT_MAX_BYTES * 4 / 3) + 32) throw new Error("O arquivo excede o limite de 10 MB.");
    return input;
  })
  .handler(async ({ context, data }) => {
    const user = await requireDbsControlUser(context);
    const scope = await resolveDbsControlScope(user);
    let state: Record<string, unknown> | null = null;
    let order: any = null;
    let canonicalOrderId: string | null = null;
    if (DBS_CONTROL_UUID_RE.test(data.orderId)) {
      const canonical = await supabaseAdmin.from("dbs_control_work_orders")
        .select("id,protocol,assigned_employee_id,status,client_id,site_id")
        .eq("id", data.orderId).maybeSingle();
      if (canonical.error) throw new Error(canonical.error.message);
      if (canonical.data) {
        order = canonical.data;
        canonicalOrderId = String(canonical.data.id);
      }
    }
    if (!order) {
      const canonical = await supabaseAdmin.from("dbs_control_work_orders")
        .select("id,protocol,assigned_employee_id,status,client_id,site_id")
        .eq("protocol", data.orderId).limit(1).maybeSingle();
      if (canonical.error) throw new Error(canonical.error.message);
      if (canonical.data) {
        order = canonical.data;
        canonicalOrderId = String(canonical.data.id);
      }
    }
    // Compatibilidade de leitura para OS ainda não migrada: nunca grava snapshot;
    // apenas permite localizar o registro legado enquanto a administração o reconcilia.
    if (!order) {
      const { data: snapshot, error: snapshotError } = await supabaseAdmin.from("dbs_control_snapshots")
        .select("state").eq("scope_key", scope.scopeKey).maybeSingle();
      if (snapshotError) throw new Error(snapshotError.message);
      state = snapshot?.state as Record<string, unknown> | null;
      const orders = Array.isArray(state?.ordens) ? state.ordens as any[] : [];
      order = orders.find((item) => String(item?.id ?? "") === data.orderId ||
        String(item?.protocolo ?? item?.protocol ?? item?.numero ?? "") === data.orderId);
    }
    if (!order) throw new Error("OS não encontrada na base compartilhada.");
    if (user.role_key === "COLABORADOR") {
      const employee = await getCollaboratorEmployee(user.id);
      if (!employee) throw new Error("Funcionário sem acesso ativo ao DBS CONTROL.");
      const assigned = String(order?.employeeId ?? order?.assignedEmployeeId ?? order?.assigned_employee_id ?? "") === String(employee.id);
      const techs = Array.isArray(state?.tecnicos) ? state!.tecnicos as any[] : [];
      const technicianMatches = techs.some((item) => String(item?.id ?? "") === String(order?.tecnicoId ?? "") &&
        (String(item?.employeeId ?? "") === String(employee.id) ||
         String(item?.email ?? "").trim().toLowerCase() === String(employee.login_email ?? "").trim().toLowerCase()));
      if (!assigned && !technicianMatches) throw new Error("Você não tem permissão para anexar arquivos a esta OS.");
    }
    const raw = data.dataBase64.replace(/^data:[^;]+;base64,/, "");
    let bytes: Uint8Array;
    try { bytes = Uint8Array.from(atob(raw), (character) => character.charCodeAt(0)); }
    catch { throw new Error("O conteúdo do arquivo está inválido."); }
    if (!bytes.byteLength || bytes.byteLength > DBS_CONTROL_ATTACHMENT_MAX_BYTES) throw new Error("O arquivo está vazio ou excede o limite de 10 MB.");
    const extension = DBS_CONTROL_ATTACHMENT_TYPES[data.contentType];
    const path = `${data.orderId.replace(/[^a-zA-Z0-9_-]/g, "_")}/${data.attachmentType}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabaseAdmin.storage.from(DBS_CONTROL_ATTACHMENT_BUCKET)
      .upload(path, bytes, { contentType: data.contentType, cacheControl: "3600", upsert: false });
    if (uploadError) throw new Error(`Falha no upload do anexo: ${uploadError.message}`);
    const { data: signed, error: signedError } = await supabaseAdmin.storage.from(DBS_CONTROL_ATTACHMENT_BUCKET).createSignedUrl(path, 3600);
    if (signedError || !signed?.signedUrl) {
      await supabaseAdmin.storage.from(DBS_CONTROL_ATTACHMENT_BUCKET).remove([path]);
      throw new Error("O arquivo foi enviado, mas não foi possível preparar a leitura segura.");
    }
    // Registra o anexo na tabela relacional quando a OS já tem chave canônica.
    // OS legadas continuam compatíveis: a referência também é persistida no snapshot.
    let canonicalOrder: { id: string } | null = canonicalOrderId ? { id: canonicalOrderId } : null;
    const orderUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.orderId);
    if (orderUuid) {
      const found = await supabaseAdmin.from("dbs_control_work_orders").select("id").eq("id", data.orderId).maybeSingle();
      if (found.error) throw new Error("O arquivo foi enviado, mas a OS relacional não pôde ser verificada: " + found.error.message);
      canonicalOrder = found.data;
    }
    if (!canonicalOrder) {
      const protocol = String(order?.protocolo ?? order?.protocol ?? order?.numero ?? "").trim();
      if (protocol) {
        const found = await supabaseAdmin.from("dbs_control_work_orders").select("id").eq("protocol", protocol).limit(1).maybeSingle();
        if (found.error) throw new Error("O arquivo foi enviado, mas a OS relacional não pôde ser verificada: " + found.error.message);
        canonicalOrder = found.data;
      }
    }
    if (canonicalOrder) {
      const { error: attachmentError } = await supabaseAdmin.from("dbs_control_work_order_attachments").insert({
        work_order_id: canonicalOrder.id,
        uploaded_by_user_id: user.id,
        storage_path: path,
        file_name: data.fileName.slice(0, 180),
        file_type: data.contentType,
        attachment_type: data.attachmentType,
      });
      if (attachmentError) {
        await supabaseAdmin.storage.from(DBS_CONTROL_ATTACHMENT_BUCKET).remove([path]);
        throw new Error("Falha ao registrar o anexo da OS: " + attachmentError.message);
      }
    }
    return { storagePath: path, signedUrl: signed.signedUrl, fileName: data.fileName.slice(0, 180),
      contentType: data.contentType, attachmentType: data.attachmentType };
  });

export const getDbsControlDashboardSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const user = await requireDbsControlUser(context);
    const employee = user.role_key === "COLABORADOR" ? await getCollaboratorEmployee(user.id) : null;
    const { data, error } = await supabaseAdmin.rpc("dbs_control_dashboard_summary", {
      p_employee_id: employee?.id ?? null,
    });
    if (error) throw new Error(error.message);
    return data ?? {};
  });

export const getDbsControlCloudState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const user = await requireDbsControlUser(context);
    const scope = await resolveDbsControlScope(user);
    const collaboratorEmployee = user.role_key === "COLABORADOR" ? await getCollaboratorEmployee(user.id) : null;
    if (user.role_key === "COLABORADOR" && !collaboratorEmployee) {
      throw new Error("Funcionário sem acesso ativo ao DBS CONTROL.");
    }
    const collaboratorScope = collaboratorEmployee ? await getCollaboratorBaseScope(collaboratorEmployee) : null;

    const { data, error } = await supabaseAdmin
      .from("dbs_control_snapshots")
      .select("state, state_version, updated_at")
      .eq("scope_key", scope.scopeKey)
      .maybeSingle();

    if (error) throw new Error(error.message);

    // O snapshot é uma camada de cache, não a única fonte de leitura.
    // Se estiver ausente, consultar as tabelas operacionais sem gravar nem
    // recriar snapshot automaticamente. Só declarar fallback válido se houver
    // registros canônicos; isso evita substituir cache local por estado vazio.
    const snapshotState = data?.state && typeof data.state === "object" && !Array.isArray(data.state)
      ? data.state as Record<string, unknown>
      : {};
    const canonicalHydratedState = await hydrateDbsControlStateFromCanonicalDb(
      snapshotState,
      scope.companyId,
      scope.scopeKey,
      collaboratorEmployee
        ? {
            employeeId: String(collaboratorEmployee.id),
            clientIds: collaboratorScope?.clientIds ?? [],
            canIssueWorkOrders: collaboratorScope?.canIssueWorkOrders ?? false,
          }
        : undefined,
    );
    const hydratedState = await hydrateStoredAttachmentUrls(canonicalHydratedState);
    const hasCanonicalRecords = [
      hydratedState.clientes,
      hydratedState.equipamentos,
      hydratedState.tecnicos,
      hydratedState.ordens,
      hydratedState.sites,
      hydratedState.locais,
      hydratedState.servicos,
    ].some((items) => Array.isArray(items) && items.length > 0);

    if (!data && !hasCanonicalRecords) return null;

    const hydrated = data
      ? { ...data, state: hydratedState }
      : {
          state: hydratedState,
          state_version: 1,
          updated_at: new Date().toISOString(),
          fallback_source: "canonical_tables",
        };

    if (user.role_key !== "COLABORADOR") return hydrated;

    return {
      ...hydrated,
      state: filterCollaboratorState(hydratedState, collaboratorEmployee!.id, collaboratorEmployee!.login_email, collaboratorScope!),
      collaboratorScope: {
        baseId: collaboratorScope!.baseId,
        baseName: collaboratorScope!.baseName,
        canIssueWorkOrders: collaboratorScope!.canIssueWorkOrders,
        clientCount: collaboratorScope!.clientIds.length,
      },
    };
  });


const DBS_CONTROL_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DbsControlDeltaChanges = {
  clientes?: any[];
  sites?: any[];
  locais?: any[];
  equipamentos?: any[];
  servicos?: any[];
  pecas?: any[];
  compras?: any[];
  orcamentos?: any[];
  ordens?: any[];
};

type DbsControlDeltaInput = {
  requestId?: string;
  changes: DbsControlDeltaChanges;
};

async function resolveCollaboratorClientIdMap(
  scopeKey: string,
  changes: DbsControlDeltaChanges,
) {
  const rawIds = [...new Set((changes.ordens ?? [])
    .map((order: any) => String(order?.clienteId ?? order?.client_id ?? "").trim())
    .filter(Boolean))];
  const resolved = new Map<string, string>();
  const legacyIds: string[] = [];
  for (const rawId of rawIds) {
    if (DBS_CONTROL_UUID_RE.test(rawId)) resolved.set(rawId, rawId);
    else legacyIds.push(rawId);
  }
  // A collaborator cannot write client master data. This is read-only
  // canonicalization for old snapshots whose client id is still legacy.
  if (legacyIds.length && scopeKey) {
    const result = await supabaseAdmin
      .from("dbs_control_legacy_id_map")
      .select("legacy_key, canonical_id")
      .eq("scope_key", scopeKey)
      .eq("entity_type", "client")
      .in("legacy_key", legacyIds);
    if (result.error) throw new Error(result.error.message);
    for (const row of result.data ?? []) {
      const legacy = String((row as any).legacy_key ?? "").trim();
      const canonical = String((row as any).canonical_id ?? "").trim();
      if (legacy && canonical && DBS_CONTROL_UUID_RE.test(canonical)) resolved.set(legacy, canonical);
    }
  }
  return resolved;
}

function isDbsControlUuid(value: unknown) {
  return DBS_CONTROL_UUID_RE.test(String(value ?? ""));
}

function deltaRecordKey(record: any, fallback: string) {
  return String(record?.id ?? record?.codigo ?? record?.numero ?? record?.protocolo ?? fallback).trim();
}

function normalizeDbsControlDelta(input: DbsControlDeltaInput): DbsControlDeltaChanges {
  const source = input?.changes;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("Alterações do DBS CONTROL inválidas.");
  }
  const allowed: Array<keyof DbsControlDeltaChanges> = [
    "clientes", "sites", "locais", "equipamentos", "servicos", "pecas", "compras", "orcamentos", "ordens",
  ];
  const normalized: DbsControlDeltaChanges = {};
  let total = 0;
  for (const key of allowed) {
    const values = source[key];
    if (values === undefined) continue;
    if (!Array.isArray(values)) throw new Error(`Delta ${key} inválido: esperado array de registros.`);
    if (values.length > 2000) throw new Error(`Delta ${key} excede o limite seguro de 2.000 registros.`);
    total += values.length;
    normalized[key] = values.map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Delta ${key} contém um registro inválido.`);
      }
      return value;
    });
  }
  if (total > 6000) throw new Error("O lote de alterações excede o limite seguro; sincronize em lotes menores.");
  const serialized = JSON.stringify(normalized);
  if (serialized.length > 8 * 1024 * 1024) throw new Error("O lote de alterações excede 8 MB.");
  return normalized;
}

function storedDeltaRecord(record: any) {
  const normalized = stripStoredAttachmentPayloads({ ordens: [record] });
  return (normalized.ordens as any[])[0] ?? record;
}

async function persistDbsControlLegacyEntityDeltas(
  scopeKey: string,
  userId: string,
  entityType: "compra" | "orcamento",
  records: any[],
  requestId: string,
) {
  let applied = 0;
  for (const record of records) {
    const recordKey = deltaRecordKey(record, `${requestId}:${entityType}:${applied}`);
    if (!recordKey) throw new Error(`Registro de ${entityType} sem identificador estável.`);
    const idempotencyKey = `${requestId}:${entityType}:${recordKey}`.slice(0, 240);
    const existingResult = await supabaseAdmin
      .from("dbs_control_entity_records")
      .select("id,version,idempotency_key")
      .eq("scope_key", scopeKey)
      .eq("entity_type", entityType)
      .eq("record_key", recordKey)
      .maybeSingle();
    if (existingResult.error) throw new Error(existingResult.error.message);
    const existing = existingResult.data;
    if (existing?.idempotency_key === idempotencyKey) continue;
    const expectedVersion = Number(record?.version);
    if (existing && Number.isFinite(expectedVersion) && expectedVersion > 0 && expectedVersion !== Number(existing.version)) {
      throw new Error(`Conflito de versão no registro ${entityType}/${recordKey}; recarregue antes de salvar.`);
    }
    const payload = storedDeltaRecord(record) as Record<string, unknown>;
    if (!existing) {
      const inserted = await supabaseAdmin.from("dbs_control_entity_records").insert({
        scope_key: scopeKey,
        entity_type: entityType,
        record_key: recordKey,
        payload: payload as any,
        version: 1,
        idempotency_key: idempotencyKey,
        updated_by: userId,
        deleted_at: record?.deleted ? new Date().toISOString() : null,
      } as any).select("id").single();
      if (inserted.error) throw new Error(inserted.error.message);
    } else {
      const updated = await supabaseAdmin.from("dbs_control_entity_records").update({
        payload: payload as any,
        version: Number(existing.version) + 1,
        idempotency_key: idempotencyKey,
        updated_by: userId,
        deleted_at: record?.deleted ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      } as any).eq("id", existing.id).eq("version", existing.version).select("id").maybeSingle();
      if (updated.error) throw new Error(updated.error.message);
      if (!updated.data) throw new Error(`Conflito de versão no registro ${entityType}/${recordKey}; nenhum dado foi sobrescrito.`);
    }
    applied += 1;
  }
  return applied;
}

async function persistDbsControlMasterDeltas(
  changes: DbsControlDeltaChanges,
  user: DbsControlUser,
) {
  const clientMap = new Map<string, string>();
  const siteMap = new Map<string, string>();
  const equipmentMap = new Map<string, string>();
  const serviceMap = new Map<string, string>();
  const partMap = new Map<string, string>();
  const isAdmin = user.role_key !== "COLABORADOR";
  if (!isAdmin) return { clientMap, siteMap, equipmentMap, serviceMap, partMap, applied: 0 };
  let applied = 0;

  for (const client of changes.clientes ?? []) {
    const rawId = String(client?.id ?? "").trim();
    const cnpj = String(client?.cnpj ?? client?.CNPJ ?? "").replace(/\D/g, "") || null;
    const byId = isDbsControlUuid(rawId)
      ? await supabaseAdmin.from("dbs_control_clients").select("id").eq("id", rawId).maybeSingle()
      : { data: null, error: null } as any;
    if (byId.error) throw new Error(byId.error.message);
    let canonicalId = byId.data?.id ? String(byId.data.id) : "";
    if (!canonicalId && cnpj) {
      const byCnpj = await supabaseAdmin.from("dbs_control_clients").select("id").eq("cnpj", cnpj).limit(1).maybeSingle();
      if (byCnpj.error) throw new Error(byCnpj.error.message);
      canonicalId = byCnpj.data?.id ? String(byCnpj.data.id) : "";
    }
    const payload: any = {
      legal_name: String(client?.razaoSocial ?? client?.razao_social ?? client?.legal_name ?? client?.nome ?? client?.name ?? "").trim(),
      trade_name: String(client?.nomeFantasia ?? client?.nome_fantasia ?? client?.trade_name ?? client?.nome ?? client?.name ?? "").trim() || null,
      cnpj,
      phone: String(client?.telefone ?? client?.phone ?? client?.contato ?? "").trim() || null,
      email: String(client?.email ?? "").trim() || null,
      notes: String(client?.observacoes ?? client?.notes ?? "").trim() || null,
      status: String(client?.status ?? "ativo").toLowerCase() === "inativo" ? "inativo" : "ativo",
      updated_at: new Date().toISOString(),
    };
    if (!payload.legal_name) throw new Error("Cliente sem razão social/nome; o registro não foi gravado.");
    if (canonicalId) {
      const updated = await supabaseAdmin.from("dbs_control_clients").update(payload).eq("id", canonicalId).select("id").single();
      if (updated.error) throw new Error(updated.error.message);
    } else {
      if (isDbsControlUuid(rawId)) payload.id = rawId;
      const inserted = await supabaseAdmin.from("dbs_control_clients").insert(payload).select("id").single();
      if (inserted.error || !inserted.data) throw new Error(inserted.error?.message ?? "Cliente não retornado.");
      canonicalId = String(inserted.data.id);
    }
    if (rawId) clientMap.set(rawId, canonicalId);
    if (canonicalId) clientMap.set(canonicalId, canonicalId);
    applied += 1;
  }

  for (const site of [...(changes.sites ?? []), ...(changes.locais ?? [])]) {
    const rawId = String(site?.id ?? "").trim();
    const rawClientId = String(site?.clienteId ?? site?.client_id ?? "").trim();
    const clientId = clientMap.get(rawClientId) ?? (isDbsControlUuid(rawClientId) ? rawClientId : "");
    if (!clientId) throw new Error(`Local ${rawId || "sem id"} sem cliente relacional válido.`);
    const payload: any = {
      client_id: clientId,
      name: String(site?.nome ?? site?.name ?? "Local").trim() || "Local",
      address_json: site?.address_json ?? { texto: String(site?.endereco ?? "") },
      contact_name: String(site?.contato ?? site?.contact_name ?? "").trim() || null,
      contact_phone: String(site?.telefone ?? site?.contact_phone ?? "").trim() || null,
      contact_email: String(site?.email ?? site?.contact_email ?? "").trim() || null,
      notes: String(site?.observacoes ?? site?.notes ?? "").trim() || null,
      status: String(site?.status ?? "ativo"),
      updated_at: new Date().toISOString(),
    };
    if (isDbsControlUuid(rawId)) payload.id = rawId;
    const saved = await supabaseAdmin.from("dbs_control_sites").upsert(payload).select("id").single();
    if (saved.error || !saved.data) throw new Error(saved.error?.message ?? "Local não retornado.");
    if (rawId) siteMap.set(rawId, String(saved.data.id));
    siteMap.set(String(saved.data.id), String(saved.data.id));
    applied += 1;
  }

  for (const equipment of changes.equipamentos ?? []) {
    const rawId = String(equipment?.id ?? "").trim();
    const rawClientId = String(equipment?.clienteId ?? equipment?.client_id ?? "").trim();
    const clientId = clientMap.get(rawClientId) ?? (isDbsControlUuid(rawClientId) ? rawClientId : "");
    if (!clientId) throw new Error(`Equipamento ${rawId || "sem id"} sem cliente relacional válido.`);
    const rawSiteId = String(equipment?.siteId ?? equipment?.localId ?? equipment?.site_id ?? "").trim();
    const payload: any = {
      client_id: clientId,
      site_id: siteMap.get(rawSiteId) ?? (isDbsControlUuid(rawSiteId) ? rawSiteId : null),
      tag_code: String(equipment?.tag ?? equipment?.patrimonio ?? equipment?.codigo ?? equipment?.tag_code ?? "").trim() || null,
      equipment_type: String(equipment?.tipo ?? equipment?.type ?? equipment?.equipment_type ?? "").trim() || null,
      brand: String(equipment?.marca ?? equipment?.fabricante ?? equipment?.brand ?? "").trim() || null,
      model: String(equipment?.modelo ?? equipment?.model ?? "").trim() || null,
      serial_number: String(equipment?.serie ?? equipment?.numeroSerie ?? equipment?.serial_number ?? "").trim() || null,
      capacity: String(equipment?.capacidade ?? equipment?.capacity ?? "").trim() || null,
      environment: String(equipment?.ambiente ?? equipment?.localizacao ?? equipment?.environment ?? "").trim() || null,
      installation_date: equipment?.dataInstalacao ?? equipment?.installation_date ?? null,
      status: String(equipment?.status ?? "ativo"),
      technical_notes: String(equipment?.observacoes ?? equipment?.descricao ?? equipment?.technical_notes ?? "").trim() || null,
      updated_at: new Date().toISOString(),
    };
    if (isDbsControlUuid(rawId)) payload.id = rawId;
    const saved = await supabaseAdmin.from("dbs_control_equipment").upsert(payload).select("id").single();
    if (saved.error || !saved.data) throw new Error(saved.error?.message ?? "Equipamento não retornado.");
    if (rawId) equipmentMap.set(rawId, String(saved.data.id));
    equipmentMap.set(String(saved.data.id), String(saved.data.id));
    applied += 1;
  }

  for (const service of changes.servicos ?? []) {
    const rawId = String(service?.id ?? "").trim();
    const amount = Number(service?.valor ?? service?.valorTabela ?? service?.table_value_cents ?? 0);
    const payload: any = {
      name: String(service?.nome ?? service?.name ?? "Serviço").trim() || "Serviço",
      description: String(service?.descricao ?? service?.description ?? "").trim() || null,
      estimated_hours: service?.horasEstimadas ?? service?.estimated_hours ?? null,
      table_value_cents: Number.isFinite(amount) ? (service?.table_value_cents ? Math.round(amount) : Math.round(amount * 100)) : 0,
      status: String(service?.status ?? "ativo"),
      updated_at: new Date().toISOString(),
    };
    if (isDbsControlUuid(rawId)) payload.id = rawId;
    const saved = await supabaseAdmin.from("dbs_control_service_catalog").upsert(payload).select("id").single();
    if (saved.error || !saved.data) throw new Error(saved.error?.message ?? "Serviço não retornado.");
    if (rawId) serviceMap.set(rawId, String(saved.data.id));
    serviceMap.set(String(saved.data.id), String(saved.data.id));
    applied += 1;
  }

  for (const part of changes.pecas ?? []) {
    const rawId = String(part?.id ?? "").trim();
    const price = Number(part?.venda ?? part?.sale_cents ?? 0);
    const cost = Number(part?.custo ?? part?.cost_cents ?? 0);
    const payload: any = {
      name: String(part?.nome ?? part?.name ?? "Peça").trim() || "Peça",
      description: String(part?.descricao ?? part?.description ?? "").trim() || null,
      sku: String(part?.sku ?? "").trim() || null,
      sale_cents: Number.isFinite(price) ? (part?.sale_cents ? Math.round(price) : Math.round(price * 100)) : 0,
      cost_cents: Number.isFinite(cost) ? (part?.cost_cents ? Math.round(cost) : Math.round(cost * 100)) : 0,
      stock_quantity: Number(part?.qtd ?? part?.stock_quantity ?? 0) || 0,
      status: String(part?.status ?? "ativo"),
      updated_at: new Date().toISOString(),
    };
    if (isDbsControlUuid(rawId)) payload.id = rawId;
    const saved = await supabaseAdmin.from("dbs_control_parts").upsert(payload).select("id").single();
    if (saved.error || !saved.data) throw new Error(saved.error?.message ?? "Peça não retornada.");
    if (rawId) partMap.set(rawId, String(saved.data.id));
    partMap.set(String(saved.data.id), String(saved.data.id));
    applied += 1;
  }

  return { clientMap, siteMap, equipmentMap, serviceMap, partMap, applied };
}

function buildDbsControlWorkOrderPatch(order: any, maps: ReturnType<typeof persistDbsControlMasterDeltas> extends Promise<infer T> ? T : never) {
  const status = normalizeDbsStatus(order?.status).replace(/\s+/g, "_");
  const normalizedStatus = status === "concluida" || status === "concluido" ? "concluida"
    : status === "concluida_com_pendencia" || status === "pendencia" ? "concluida_com_pendencia"
    : status === "em_atendimento" || status === "andamento" ? "em_atendimento"
    : status === "aguardando_peca" ? "aguardando_peca"
    : status === "aguardando_aprovacao" ? "aguardando_aprovacao"
    : status === "retorno_necessario" ? "retorno_necessario"
    : status === "aguardando_cliente" ? "aguardando_cliente"
    : status === "cancelada" || status === "cancelado" ? "cancelada"
    : status || "aberta";
  const rawClientId = String(order?.clienteId ?? order?.client_id ?? "").trim();
  const rawSiteId = String(order?.siteId ?? order?.localId ?? order?.site_id ?? "").trim();
  const rawEmployeeId = String(order?.employeeId ?? order?.assignedEmployeeId ?? order?.tecnicoId ?? "").trim();
  const rawServiceId = String(order?.servicoId ?? order?.service_id ?? "").trim();
  const signaturePath = String(order?.assinaturaStoragePath ?? order?.assinatura_path ?? order?.signature_path ?? "").trim();
  // O formulário legado usa string vazia para campos de data não preenchidos.
  // Nunca envie "" para colunas timestamptz: o Postgres rejeita o lote inteiro.
  // Valores inválidos também viram NULL para que uma OS não fique presa na fila
  // por um campo opcional malformado.
  const normalizeOptionalTimestamp = (value: unknown) => {
    const text = String(value ?? "").trim();
    if (!text || !Number.isFinite(Date.parse(text))) return null;
    return text;
  };
  const amountRaw = String(order?.valor ?? order?.total ?? 0).trim();
  const normalizedAmount = amountRaw.includes(",") ? amountRaw.replace(/\./g, "").replace(",", ".") : amountRaw;
  const amount = Number(normalizedAmount);
  const patch: Record<string, unknown> = {
    protocol: String(order?.protocolo ?? order?.protocol ?? order?.numero ?? "").trim(),
    protocolo: String(order?.protocolo ?? order?.protocol ?? order?.numero ?? "").trim(),
    client_id: maps.clientMap.get(rawClientId) ?? (isDbsControlUuid(rawClientId) ? rawClientId : null),
    site_id: maps.siteMap.get(rawSiteId) ?? (isDbsControlUuid(rawSiteId) ? rawSiteId : null),
    assigned_employee_id: isDbsControlUuid(rawEmployeeId) ? rawEmployeeId : null,
    service_id: maps.serviceMap.get(rawServiceId) ?? (isDbsControlUuid(rawServiceId) ? rawServiceId : null),
    type: String(order?.tipo ?? order?.type ?? "corretiva").toLowerCase(),
    priority: String(order?.prioridade ?? order?.priority ?? "normal").toLowerCase(),
    status: normalizedStatus,
    scheduled_at: normalizeOptionalTimestamp(order?.scheduledAt || order?.scheduled_at),
    started_at: normalizeOptionalTimestamp(order?.startedAt || order?.started_at),
    completed_at: ["concluida", "concluida_com_pendencia"].includes(normalizedStatus)
      ? (normalizeOptionalTimestamp(order?.concluidoEm || order?.completedAt || order?.completed_at) ?? new Date().toISOString())
      : null,
    sla_deadline: normalizeOptionalTimestamp(order?.sla || order?.slaDeadline || order?.sla_deadline),
    description: String(order?.desc ?? order?.description ?? ""),
    technical_opinion: String(order?.diagnostico ?? order?.technical_opinion ?? ""),
    diagnostico: String(order?.diagnostico ?? order?.technical_opinion ?? ""),
    observation: String(order?.observacao ?? order?.observation ?? ""),
    servico_executado: String(order?.trabalhoExecutado ?? order?.servicoExecutado ?? order?.observacao ?? order?.observation ?? ""),
    latitude: order?.latitude ?? null,
    longitude: order?.longitude ?? null,
    signature_name: String(order?.signature_name ?? order?.signatureName ?? "") || null,
    signature_path: signaturePath || null,
    assinatura_path: signaturePath || null,
    signature_data: signaturePath ? null : (order?.assinatura ?? order?.signature_data ?? null),
    execution_checklist: {
      checklistTecnico: order?.checklistTecnico && typeof order.checklistTecnico === "object" ? order.checklistTecnico : {},
      checklist: Array.isArray(order?.checklist) ? order.checklist : [],
      parametrosOperacionais: order?.parametrosOperacionais && typeof order.parametrosOperacionais === "object" ? order.parametrosOperacionais : {},
    },
    completion_status_code: String(order?.completionStatusCode ?? order?.completion_status_code ?? normalizedStatus).trim() || normalizedStatus,
    geolocation_captured_at: normalizeOptionalTimestamp(order?.geolocationCapturedAt || order?.geolocation_captured_at),
    total_cents: Number.isFinite(amount) ? Math.round(amount * 100) : 0,
  };
  const deletedAt = normalizeOptionalTimestamp(order?.deleted_at || order?.excluidaEm);
  if (deletedAt) patch.deleted_at = deletedAt;
  return patch;
}

export const applyDbsControlDelta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: DbsControlDeltaInput) => {
    const requestId = String(input?.requestId ?? crypto.randomUUID()).trim().slice(0, 160);
    return { requestId, changes: normalizeDbsControlDelta(input) };
  })
  .handler(async ({ context, data }) => {
    const user = await requireDbsControlUser(context);
    const scope = await resolveDbsControlScope(user);
    const collaboratorEmployee = user.role_key === "COLABORADOR" ? await getCollaboratorEmployee(user.id) : null;
    const collaboratorScope = collaboratorEmployee ? await getCollaboratorBaseScope(collaboratorEmployee) : null;
    if (user.role_key === "COLABORADOR" && !collaboratorEmployee) {
      throw new Error("Funcionário sem acesso ativo ao DBS CONTROL.");
    }
    let changes = data.changes;
    // Apenas para compatibilidade de IDs legados: se uma OS ainda referencia um
    // cliente local não-UUID, recuperamos o cadastro legado por leitura e o
    // materializamos como uma linha relacional antes do delta da OS. Nenhum
    // snapshot é atualizado ou reenviado.
    if (user.role_key !== "COLABORADOR" && (changes.ordens?.length ?? 0) > 0) {
      const knownClientIds = new Set((changes.clientes ?? []).map((client: any) => String(client?.id ?? "")));
      const referencedLegacyIds = new Set((changes.ordens ?? [])
        .map((order: any) => String(order?.clienteId ?? order?.client_id ?? "").trim())
        .filter((id) => id && !isDbsControlUuid(id) && !knownClientIds.has(id)));
      if (referencedLegacyIds.size) {
        const snapshot = await supabaseAdmin.from("dbs_control_snapshots").select("state").eq("scope_key", scope.scopeKey).maybeSingle();
        if (snapshot.error) throw new Error(snapshot.error.message);
        const legacyClients = snapshot.data?.state && typeof snapshot.data.state === "object" && !Array.isArray(snapshot.data.state)
          ? ((snapshot.data.state as any).clientes ?? [])
          : [];
        changes = {
          ...changes,
          clientes: [...(changes.clientes ?? []), ...legacyClients.filter((client: any) => referencedLegacyIds.has(String(client?.id ?? "")))],
        };
      }
    }
    const maps = await persistDbsControlMasterDeltas(changes, user);
    if (user.role_key === "COLABORADOR" && collaboratorScope) {
      const collaboratorClientMap = await resolveCollaboratorClientIdMap(scope.scopeKey, changes);
      collaboratorClientMap.forEach((canonicalId, rawId) => maps.clientMap.set(rawId, canonicalId));
    }
    const appliedOrderIds: string[] = [];
    const appliedOrders: Array<{ id: string; protocol: string | null; version: number }> = [];
    const conflicts: Array<{ protocol: string; message: string }> = [];
    let applied = maps.applied;

    if (user.role_key === "COLABORADOR" && (changes.clientes?.length || changes.sites?.length || changes.locais?.length || changes.equipamentos?.length || changes.servicos?.length || changes.pecas?.length || changes.compras?.length || changes.orcamentos?.length)) {
      throw new Error("Colaborador só pode enviar deltas de execução das OS atribuídas.");
    }

    if (user.role_key !== "COLABORADOR") {
      applied += await persistDbsControlLegacyEntityDeltas(scope.scopeKey, user.id, "compra", changes.compras ?? [], data.requestId);
      applied += await persistDbsControlLegacyEntityDeltas(scope.scopeKey, user.id, "orcamento", changes.orcamentos ?? [], data.requestId);
    }

    for (const [index, order] of (changes.ordens ?? []).entries()) {
      const protocol = String(order?.protocolo ?? order?.protocol ?? order?.numero ?? "").trim();
      // O protocolo é uma identificação canônica gerada pelo banco para uma
      // OS nova. O formulário legado usa apenas um id local (ex.: OS-04891),
      // portanto não devemos bloquear a intenção de criação enquanto o
      // protocolo ainda não existe. Para mensagens e logs usamos o id local
      // como rótulo transitório, mas nunca o persistimos como protocolo.
      const orderLabel = protocol || String(order?.id ?? `nova-${index + 1}`).trim();
      let orderForPatch = order;
      let currentCanonicalOrder: any = null;
      if (user.role_key === "COLABORADOR") {
        const localOrderId = isDbsControlUuid(order?.id) ? String(order.id) : null;
        const currentOrder = localOrderId || protocol
          ? await supabaseAdmin.from("dbs_control_work_orders")
            .select("id, version, assigned_employee_id, observation,servico_executado")
            .eq(localOrderId ? "id" : "protocol", localOrderId ?? protocol)
            .maybeSingle()
          : { data: null, error: null };
        if (currentOrder.error) throw new Error(`Falha ao ler o histórico da OS ${orderLabel}: ${currentOrder.error.message}`);
        currentCanonicalOrder = currentOrder.data;
        if (currentOrder.data) {
          const mergedObservation = mergeAppendOnlyCollaboratorObservations(
            { observacao: currentOrder.data.observation ?? currentOrder.data.servico_executado ?? "" },
            { observacao: order?.observacao ?? order?.observation ?? "" },
          );
          if (mergedObservation.observacao) orderForPatch = { ...order, observacao: mergedObservation.observacao };
        }
      }
      const fullPatch = buildDbsControlWorkOrderPatch(orderForPatch, maps);
      const patch = user.role_key === "COLABORADOR"
        ? Object.fromEntries([
            "status", "started_at", "completed_at", "technical_opinion", "diagnostico",
            "observation", "servico_executado", "latitude", "longitude", "signature_name",
            "signature_path", "assinatura_path", "signature_data", "execution_checklist",
            "completion_status_code", "geolocation_captured_at",
          ].map((key) => [key, (fullPatch as any)[key]]))
        : fullPatch;
      const isNewCollaboratorOrder = user.role_key === "COLABORADOR" && !currentCanonicalOrder;
      if (isNewCollaboratorOrder && !collaboratorScope?.canIssueWorkOrders) {
        throw new Error("DBS_OS_ISSUE_FORBIDDEN: este colaborador não está autorizado a emitir OS.");
      }
      if (isNewCollaboratorOrder) {
        const scopedClientIds = new Set((collaboratorScope?.clientIds ?? []).map((id: string) => String(id).trim().toLocaleLowerCase()));
        const requestedClientId = String((fullPatch as any).client_id ?? "").trim().toLocaleLowerCase();
        if (!requestedClientId || !scopedClientIds.has(requestedClientId)) {
          throw new Error("DBS_OS_ISSUE_CLIENT_OUT_OF_SCOPE: cliente não está vinculado à base do colaborador.");
        }
      }
      if (user.role_key !== "COLABORADOR" && !patch.client_id) throw new Error(`A OS ${orderLabel} não possui cliente relacional válido.`);
      const idempotencyKey = `${data.requestId}:work_order:${String(order?.id ?? protocol)}:${index}`.slice(0, 240);
      const expectedVersion = Number(order?.version);
      const parts = Array.isArray(order?.pecasUsadas)
        ? order.pecasUsadas.map((part: any) => ({
            part_id: maps.partMap.get(String(part?.id ?? "")) ?? (isDbsControlUuid(part?.id) ? String(part.id) : null),
            quantity: Math.max(0, Number(part?.qtd ?? part?.quantity ?? 0)),
            unit_cents: Number.isFinite(Number(part?.unit_cents))
              ? Math.round(Number(part.unit_cents))
              : Number.isFinite(Number(part?.venda)) ? Math.round(Number(part.venda) * 100) : null,
          })).filter((part: any) => part.part_id && part.quantity > 0)
        : undefined;
      const payload = {
        idempotency_key: idempotencyKey,
        actor_user_id: user.id,
        company_id: scope.companyId,
        work_order_id: isDbsControlUuid(order?.id) ? String(order.id) : undefined,
        protocol: protocol || undefined,
        operation: "upsert",
        expected_version: Number.isFinite(expectedVersion) && expectedVersion > 0 ? expectedVersion : undefined,
        event_type: "work_order_delta",
        patch,
        parts,
      };
      const result = isNewCollaboratorOrder
        ? await (supabaseAdmin as any).rpc("dbs_control_issue_work_order", { p_payload: { ...payload, patch: fullPatch } })
        : await supabaseAdmin.rpc("dbs_control_apply_work_order_delta", { p_payload: payload as any });
      if (result.error) {
        const permanentCode = String(result.error.message).match(/DBS_OS_[A-Z_]+/)?.[0];
        if (permanentCode && ["DBS_OS_CONFLICT", "DBS_OS_COMPLETED_LOCKED", "DBS_OS_FIELD_FORBIDDEN", "DBS_OS_NOT_ASSIGNED", "DBS_OS_STOCK_INSUFFICIENT", "DBS_OS_PART_NOT_FOUND", "DBS_OS_ISSUE_FORBIDDEN", "DBS_OS_ISSUE_CLIENT_OUT_OF_SCOPE", "DBS_OS_ISSUE_CLIENT_INACTIVE", "DBS_OS_ISSUE_BASE_INACTIVE", "DBS_OS_ISSUE_SITE_INVALID", "DBS_OS_ISSUE_COMPANY_MISMATCH"].includes(permanentCode)) {
          conflicts.push({ protocol: orderLabel, message: permanentCode === "DBS_OS_COMPLETED_LOCKED"
            ? "A OS já foi concluída e seus dados assinados estão protegidos."
            : permanentCode === "DBS_OS_NOT_ASSIGNED"
              ? "A OS não está atribuída a este colaborador."
              : permanentCode === "DBS_OS_ISSUE_FORBIDDEN"
                ? "A emissão de OS não está liberada para este colaborador."
                : permanentCode === "DBS_OS_ISSUE_CLIENT_OUT_OF_SCOPE"
                  ? "O cliente selecionado não pertence à base deste colaborador."
                : permanentCode === "DBS_OS_ISSUE_CLIENT_INACTIVE"
                  ? "O cliente selecionado está inativo."
              : permanentCode === "DBS_OS_STOCK_INSUFFICIENT"
                ? "Estoque insuficiente para as peças informadas na OS."
                : permanentCode === "DBS_OS_PART_NOT_FOUND"
                  ? "Uma peça da OS não existe no catálogo relacional."
              : "A OS mudou em outro acesso; recarregue para reconciliar." });
          continue;
        }
        throw new Error(`Falha ao sincronizar a OS ${orderLabel}: ${result.error.message}`);
      }
      const row: any = Array.isArray(result.data) ? result.data[0] : result.data;
      if (!row?.ok) {
        if (row?.status === "conflict") {
          conflicts.push({ protocol: orderLabel, message: row.error_message || "Conflito de versão; recarregue para reconciliar." });
          continue;
        }
        throw new Error(`Falha ao sincronizar a OS ${orderLabel}: ${row?.error_message || "operação rejeitada"}`);
      }
      applied += 1;
      if (row.work_order_id) {
        const appliedId = String(row.work_order_id);
        appliedOrderIds.push(appliedId);
        appliedOrders.push({
          id: appliedId,
          protocol: row.protocol ? String(row.protocol) : null,
          version: Number(row.version ?? 1),
        });
      }

      const equipmentIds = Array.isArray(order?.equipamentosIds)
        ? order.equipamentosIds
        : (order?.equipamentoId ? [order.equipamentoId] : []);
      for (const rawEquipmentId of equipmentIds) {
        const equipmentId = maps.equipmentMap.get(String(rawEquipmentId)) ?? (isDbsControlUuid(rawEquipmentId) ? String(rawEquipmentId) : null);
        if (equipmentId && row.work_order_id) {
          const link = await supabaseAdmin.from("dbs_control_work_order_equipment").upsert({ work_order_id: row.work_order_id, equipment_id: equipmentId });
          if (link.error) throw new Error(`Falha ao vincular equipamento à OS ${protocol}: ${link.error.message}`);
        }
      }
    }

    return {
      ok: conflicts.length === 0,
      applied,
      appliedOrderIds,
      appliedOrders,
      conflicts,
      requestId: data.requestId,
      sourceOfTruth: "relational_delta",
    };
  });

/** 
 * Exclui uma OS da operação sem reutilizar o autosave de snapshot/delta completo.
 *
 * A exclusão é sempre lógica: o RPC relacional grava apenas \`deleted_at\`, cria o
 * evento/outbox na mesma transação e preserva a OS para auditoria administrativa.
 * Isso também evita que uma OS concluída seja interpretada como uma tentativa de
 * alterar dados assinados e abra o fluxo de reconciliação para o usuário.
 */
export const deleteDbsControlWorkOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: DeleteDbsControlWorkOrderInput) => ({
    requestId: String(input?.requestId ?? crypto.randomUUID()).trim().slice(0, 160),
    workOrderId: isDbsControlUuid(input?.workOrderId) ? String(input.workOrderId).trim() : null,
    protocol: String(input?.protocol ?? "").trim().slice(0, 160) || null,
  }))
  .handler(async ({ context, data }) => {
    const user = await requireDbsControlUser(context);
    const administrativeRoles = ["SUPER_ADMIN", "ADMIN_OPERACIONAL", "GESTOR_CONTA", "GESTOR_REGIONAL"];
    if (!administrativeRoles.includes(user.role_key)) {
      throw new Error("A exclusão de OS é restrita à administração.");
    }
    if (!data.workOrderId && !data.protocol) {
      throw new Error("Não foi possível identificar a OS para exclusão.");
    }

    const readCanonicalOrder = async () => {
      if (data.workOrderId) {
        const byId = await supabaseAdmin
          .from("dbs_control_work_orders")
          .select("id, protocol, protocolo, version, deleted_at")
          .eq("id", data.workOrderId)
          .maybeSingle();
        if (byId.error) throw new Error(byId.error.message);
        return byId.data;
      }

      const protocol = data.protocol ?? "";
      const byProtocol = await supabaseAdmin
        .from("dbs_control_work_orders")
        .select("id, protocol, protocolo, version, deleted_at")
        .eq("protocol", protocol)
        .maybeSingle();
      if (byProtocol.error) throw new Error(byProtocol.error.message);
      if (byProtocol.data) return byProtocol.data;

      // Há registros antigos em que apenas a coluna legada \`protocolo\` foi
      // preenchida. A leitura alternativa mantém a exclusão retrocompatível.
      const byLegacyProtocol = await supabaseAdmin
        .from("dbs_control_work_orders")
        .select("id, protocol, protocolo, version, deleted_at")
        .eq("protocolo", protocol)
        .maybeSingle();
      if (byLegacyProtocol.error) throw new Error(byLegacyProtocol.error.message);
      return byLegacyProtocol.data;
    };

    let canonical = await readCanonicalOrder();
    if (!canonical) {
      // A operação é idempotente: se a OS já não existe no recorte operacional,
      // não há motivo para transformar isso em alarme técnico para o usuário.
      return {
        ok: true,
        status: "already_deleted",
        already_deleted: true,
        work_order_id: null,
        protocol: data.protocol,
        requestId: data.requestId,
      };
    }
    if (canonical.deleted_at) {
      return {
        ok: true,
        status: "already_deleted",
        already_deleted: true,
        work_order_id: String(canonical.id),
        protocol: canonical.protocol ?? canonical.protocolo ?? data.protocol,
        deleted_at: canonical.deleted_at,
        requestId: data.requestId,
      };
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const deletedAt = new Date().toISOString();
      const idempotencyKey = `${data.requestId}:work_order_delete:${String(canonical.id)}:${attempt}`.slice(0, 240);
      const rpc = await supabaseAdmin.rpc("dbs_control_apply_work_order_delta", {
        p_payload: {
          idempotency_key: idempotencyKey,
          actor_user_id: user.id,
          company_id: user.company_id,
          work_order_id: String(canonical.id),
          protocol: canonical.protocol ?? canonical.protocolo ?? data.protocol,
          operation: "delete",
          expected_version: Number(canonical.version),
          event_type: "work_order_deleted",
          patch: { deleted_at: deletedAt },
        },
      });

      if (rpc.error) {
        const latest = await readCanonicalOrder();
        if (latest?.deleted_at) {
          return {
            ok: true,
            status: "already_deleted",
            already_deleted: true,
            work_order_id: String(latest.id),
            protocol: latest.protocol ?? latest.protocolo ?? data.protocol,
            deleted_at: latest.deleted_at,
            requestId: data.requestId,
          };
        }
        if (latest && /DBS_OS_CONFLICT|version|alterada|conflito/i.test(rpc.error.message) && attempt < 2) {
          canonical = latest;
          continue;
        }
        throw new Error("Não foi possível excluir a OS agora. Nenhum dado foi perdido; tente novamente.");
      }

      const row: any = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
      if (row?.ok) {
        return {
          ok: true,
          status: "deleted",
          already_deleted: false,
          work_order_id: String(row.work_order_id ?? canonical.id),
          protocol: row.protocol ?? canonical.protocol ?? canonical.protocolo ?? data.protocol,
          version: Number(row.version ?? canonical.version),
          deleted_at: deletedAt,
          requestId: data.requestId,
        };
      }

      if (row?.status === "conflict" && attempt < 2) {
        const latest = await readCanonicalOrder();
        if (latest?.deleted_at) {
          return {
            ok: true,
            status: "already_deleted",
            already_deleted: true,
            work_order_id: String(latest.id),
            protocol: latest.protocol ?? latest.protocolo ?? data.protocol,
            deleted_at: latest.deleted_at,
            requestId: data.requestId,
          };
        }
        if (latest) {
          canonical = latest;
          continue;
        }
      }

      throw new Error("Não foi possível excluir a OS agora. Nenhum dado foi perdido; tente novamente.");
    }

    throw new Error("Não foi possível excluir a OS agora. Nenhum dado foi perdido; tente novamente.");
  });

/**
 * Snapshot writes were intentionally retired. The snapshot tables remain
 * readable as a compatibility cache while all new writes go through
 * applyDbsControlDelta and the relational work-order RPC.
 */
export const saveDbsControlCloudState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    throw new Error("Gravação por snapshot desativada. Envie apenas deltas relacionais.");
  });
export const auditDbsControlDatabase = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const user = await requireDbsControlUser(context);
    if (!["SUPER_ADMIN", "ADMIN_OPERACIONAL", "GESTOR_CONTA", "GESTOR_REGIONAL"].includes(user.role_key)) {
      throw new Error("A auditoria da base do DBS CONTROL é restrita à administração.");
    }

    const [
      clientsResult, sitesResult, equipmentResult, servicesResult, employeesResult,
      ordersResult, orderEquipmentResult, refsResult, syncRunsResult, snapshotsResult,
      syncHealthResult, syncMetricsResult,
    ] = await Promise.all([
      supabaseAdmin.from("dbs_control_clients").select("id,legal_name,trade_name,cnpj,email,status"),
      supabaseAdmin.from("dbs_control_sites").select("id,client_id,name,status"),
      supabaseAdmin.from("dbs_control_equipment").select("id,client_id,site_id,tag_code,serial_number,status"),
      supabaseAdmin.from("dbs_control_service_catalog").select("id,name,status"),
      supabaseAdmin.from("rh_employees").select("id,full_name,is_active,source_system,source_key,registration_data"),
      supabaseAdmin.from("dbs_control_work_orders").select("id,protocol,assigned_employee_id,status,client_id,site_id,service_id"),
      supabaseAdmin.from("dbs_control_work_order_equipment").select("work_order_id,equipment_id"),
      supabaseAdmin.from("dbs_control_external_refs").select("id,provider,entity_type,external_id,local_id"),
      supabaseAdmin.from("dbs_control_sync_runs").select("id,mode,status,started_at,finished_at,summary,errors").order("started_at",{ascending:false}).limit(10),
      supabaseAdmin.from("dbs_control_snapshots").select("state,updated_at,scope_key").limit(20),
      (supabaseAdmin as any).rpc("dbs_control_sync_health"),
      (supabaseAdmin as any).from("dbs_control_sync_metrics").select("worker_id,metric_name,status,duration_ms,claimed_count,success_count,failure_count,retry_count,details,created_at").order("created_at",{ascending:false}).limit(20),
    ]);
    const results = [clientsResult,sitesResult,equipmentResult,servicesResult,employeesResult,ordersResult,orderEquipmentResult,refsResult,syncRunsResult,snapshotsResult,syncHealthResult,syncMetricsResult];
    const firstError = results.find((r) => r.error)?.error;
    if (firstError) throw new Error(firstError.message);

    const clients=clientsResult.data??[], sites=sitesResult.data??[], equipment=equipmentResult.data??[];
    const services=servicesResult.data??[], employees=employeesResult.data??[], orders=ordersResult.data??[];
    const orderEquipment=orderEquipmentResult.data??[], refs=refsResult.data??[], syncRuns=syncRunsResult.data??[];
    const snapshots=snapshotsResult.data??[];
    const syncHealth=syncHealthResult.data??null;
    const recentSyncMetrics=syncMetricsResult.data??[];
    const norm=(v:unknown)=>String(v??"").trim().toLocaleLowerCase("pt-BR");
    const digits=(v:unknown)=>String(v??"").replace(/\\D/g,"");
    const groups=(rows:any[],key:(x:any)=>string)=>{
      const m=new Map<string,any[]>();
      for(const row of rows){const k=key(row);if(!k)continue;const a=m.get(k)??[];a.push(row);m.set(k,a);}
      return [...m.entries()].filter(([,a])=>a.length>1);
    };
    const issue=(code:string,severity:"critical"|"warning",label:string,count:number,samples:string[]=[])=>({code,severity,label,count,samples:samples.slice(0,10)});
    const issues:any[]=[];
    const clientIds=new Set(clients.map((x:any)=>String(x.id)));
    const siteIds=new Set(sites.map((x:any)=>String(x.id)));
    const equipmentIds=new Set(equipment.map((x:any)=>String(x.id)));
    const serviceIds=new Set(services.map((x:any)=>String(x.id)));
    const employeeIds=new Set(employees.map((x:any)=>String(x.id)));
    const orderIds=new Set(orders.map((x:any)=>String(x.id)));

    const dClient=groups(clients,x=>digits(x.cnpj));
    if(dClient.length)issues.push(issue("client_document_duplicate","warning","CNPJ/CPF repetido entre clientes",dClient.length,dClient.map(([k,g])=>k+" · "+g.map((x:any)=>x.legal_name).join(" / "))));
    const dName=groups(clients,x=>norm(x.legal_name));
    if(dName.length)issues.push(issue("client_name_duplicate","warning","Nome de cliente repetido",dName.length,dName.map(([k,g])=>k+" · "+g.length+" registros")));
    const dEmail=groups(clients,x=>norm(x.email));
    if(dEmail.length)issues.push(issue("client_email_duplicate","warning","E-mail de cliente repetido",dEmail.length,dEmail.map(([k,g])=>k+" · "+g.length+" registros")));

    const orphanSites=sites.filter((x:any)=>!clientIds.has(String(x.client_id)));
    if(orphanSites.length)issues.push(issue("site_orphan","critical","Locais sem cliente válido",orphanSites.length,orphanSites.map((x:any)=>x.name)));
    const dSites=groups(sites,x=>String(x.client_id)+"|"+norm(x.name));
    if(dSites.length)issues.push(issue("site_duplicate","warning","Locais repetidos dentro do mesmo cliente",dSites.length,dSites.map(([,g])=>g[0]?.name+" · "+g.length+" registros")));

    const orphanEq=equipment.filter((x:any)=>!clientIds.has(String(x.client_id)));
    if(orphanEq.length)issues.push(issue("equipment_orphan_client","critical","Equipamentos sem cliente válido",orphanEq.length,orphanEq.map((x:any)=>x.tag_code||x.serial_number||x.id)));
    const orphanEqSite=equipment.filter((x:any)=>x.site_id&&!siteIds.has(String(x.site_id)));
    if(orphanEqSite.length)issues.push(issue("equipment_orphan_site","critical","Equipamentos com local inexistente",orphanEqSite.length,orphanEqSite.map((x:any)=>x.tag_code||x.id)));
    const dTags=groups(equipment,x=>String(x.client_id)+"|"+norm(x.tag_code));
    if(dTags.length)issues.push(issue("equipment_tag_duplicate","warning","TAG duplicada dentro do mesmo cliente",dTags.length,dTags.map(([k,g])=>k.split("|")[1]+" · "+g.length+" registros")));
    const dSerial=groups(equipment,x=>String(x.client_id)+"|"+norm(x.serial_number));
    if(dSerial.length)issues.push(issue("equipment_serial_duplicate","warning","Número de série repetido dentro do mesmo cliente",dSerial.length,dSerial.map(([k,g])=>k.split("|")[1]+" · "+g.length+" registros")));

    const dServices=groups(services,x=>norm(x.name));
    if(dServices.length)issues.push(issue("service_duplicate","warning","Serviço repetido no catálogo",dServices.length,dServices.map(([k,g])=>k+" · "+g.length+" registros")));

    const fcEmployees=employees.filter((x:any)=>x.source_system==="fieldcontrol");
    const dSource=groups(fcEmployees,x=>norm(x.source_key));
    if(dSource.length)issues.push(issue("employee_source_duplicate","critical","Funcionários FieldControl com mesmo identificador externo",dSource.length,dSource.map(([k,g])=>k+" · "+g.map((x:any)=>x.full_name).join(" / "))));
    const dEmpEmail=groups(employees,x=>norm((x.registration_data as any)?.email));
    if(dEmpEmail.length)issues.push(issue("employee_email_duplicate","warning","E-mail presente em mais de um funcionário",dEmpEmail.length,dEmpEmail.map(([k,g])=>k+" · "+g.map((x:any)=>x.full_name).join(" / "))));

    const orphanOrderClient=orders.filter((x:any)=>!clientIds.has(String(x.client_id)));
    if(orphanOrderClient.length)issues.push(issue("order_orphan_client","critical","OS sem cliente válido",orphanOrderClient.length,orphanOrderClient.map((x:any)=>x.protocol)));
    const orphanOrderSite=orders.filter((x:any)=>x.site_id&&!siteIds.has(String(x.site_id)));
    if(orphanOrderSite.length)issues.push(issue("order_orphan_site","critical","OS com local inexistente",orphanOrderSite.length,orphanOrderSite.map((x:any)=>x.protocol)));
    const orphanOrderService=orders.filter((x:any)=>x.service_id&&!serviceIds.has(String(x.service_id)));
    if(orphanOrderService.length)issues.push(issue("order_orphan_service","critical","OS com serviço inexistente",orphanOrderService.length,orphanOrderService.map((x:any)=>x.protocol)));
    const orphanOrderEmployee=orders.filter((x:any)=>x.assigned_employee_id&&!employeeIds.has(String(x.assigned_employee_id)));
    if(orphanOrderEmployee.length)issues.push(issue("order_orphan_employee","critical","OS com técnico/funcionário inexistente",orphanOrderEmployee.length,orphanOrderEmployee.map((x:any)=>x.protocol)));
    const badLinks=orderEquipment.filter((x:any)=>!orderIds.has(String(x.work_order_id))||!equipmentIds.has(String(x.equipment_id)));
    if(badLinks.length)issues.push(issue("order_equipment_orphan","critical","Vínculos OS × equipamento inválidos",badLinks.length,badLinks.slice(0,10).map((x:any)=>String(x.work_order_id))));

    const dRefs=groups(refs,x=>String(x.provider)+"|"+String(x.entity_type)+"|"+String(x.external_id));
    if(dRefs.length)issues.push(issue("external_ref_duplicate","critical","Referências externas duplicadas",dRefs.length,dRefs.map(([k,g])=>k+" · "+g.length+" registros")));
    const refLocals=new Map<string,any[]>();
    for(const ref of refs){if(!ref.local_id)continue;const k=String(ref.provider)+"|"+String(ref.entity_type)+"|"+String(ref.local_id);const a=refLocals.get(k)??[];a.push(ref);refLocals.set(k,a);}
    const localConflicts=[...refLocals.entries()].filter(([,g])=>g.length>1&&new Set(g.map((x:any)=>String(x.external_id))).size>1);
    if(localConflicts.length)issues.push(issue("external_ref_local_conflict","warning","Um registro local aponta para vários IDs externos",localConflicts.length,localConflicts.map(([k,g])=>k+" · "+g.length+" refs")));

    const snapshot=snapshots.find((x:any)=>String(x.scope_key||"").startsWith("company:"));
    const ss=snapshot?.state as any;
    const snapshotCounts=ss?{clientes:Array.isArray(ss.clientes)?ss.clientes.length:0,equipamentos:Array.isArray(ss.equipamentos)?ss.equipamentos.length:0,tecnicos:Array.isArray(ss.tecnicos)?ss.tecnicos.length:0,servicos:Array.isArray(ss.servicos)?ss.servicos.length:0,ordens:Array.isArray(ss.ordens)?ss.ordens.length:0}:null;
    const counts={clients:clients.length,sites:sites.length,equipment:equipment.length,services:services.length,employees:employees.length,fieldControlEmployees:fcEmployees.length,orders:orders.length,orderEquipmentLinks:orderEquipment.length,externalRefs:refs.length};
    const critical=issues.filter((x:any)=>x.severity==="critical").length;
    const warnings=issues.filter((x:any)=>x.severity==="warning").length;
    return {ok:critical===0,auditedAt:new Date().toISOString(),status:critical?"critical":warnings?"warning":"ok",counts,issues,latestSync:syncRuns[0]??null,snapshotCounts,syncHealth,recentSyncMetrics,policy:{destructiveActions:false,sameNameEmployeesAreNotMerged:true,automaticDeletion:false}};
  });


/**
 * Métricas de produtividade calculadas somente a partir de transições reais de status
 * registradas no histórico do DBS CONTROL. O histórico sintético de OS antigas é ignorado.
 * Valores financeiros nunca são retornados por este endpoint.
 */
export const getDbsControlProductivity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: { startDate: string; endDate: string }) => {
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!input || !datePattern.test(input.startDate) || !datePattern.test(input.endDate)) {
      throw new Error("Período de análise inválido.");
    }
    if (input.startDate > input.endDate) throw new Error("A data inicial deve ser anterior à data final.");
    return { startDate: input.startDate, endDate: input.endDate };
  })
  .handler(async ({ context, data }) => {
    const user = await requireDbsControlUser(context);
    if (!["SUPER_ADMIN", "ADMIN_OPERACIONAL", "GESTOR_CONTA", "GESTOR_REGIONAL"].includes(user.role_key)) {
      throw new Error("O painel de produtividade é restrito à administração e aos gestores autorizados.");
    }

    const scopeKey = user.company_id ? `company:${user.company_id}` : `user:${user.id}`;
    const { data: snapshot, error } = await supabaseAdmin
      .from("dbs_control_snapshots")
      .select("state, updated_at")
      .eq("scope_key", scopeKey)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!snapshot?.state) {
      return { updatedAt: null, totalTracked: 0, totalExcluded: 0, legacyUnmeasuredCount: 0, metrics: [], completed: [], excluded: [], legacySamples: [] };
    }

    const state = snapshot.state as Record<string, unknown>;
    const orders = Array.isArray(state.ordens) ? state.ordens as any[] : [];
    const history = Array.isArray(state.osHistorico) ? state.osHistorico as any[] : [];
    const technicians = Array.isArray(state.tecnicos) ? state.tecnicos as any[] : [];
    const technicianName = (id: unknown) => {
      const key = String(id ?? "");
      const technician = technicians.find((item) =>
        String(item?.id ?? "") === key || String(item?.employeeId ?? "") === key
      );
      return String(technician?.nome ?? technician?.full_name ?? "Técnico não identificado");
    };

    // O filtro é aplicado à data da conclusão, nunca à data artificial de cadastro.
    const from = new Date(`${data.startDate}T00:00:00-03:00`).getTime();
    const to = new Date(`${data.endDate}T23:59:59.999-03:00`).getTime();
    const waitingStatuses = new Set(["Aguardando peça", "Aguardando cliente"]);
    const validStatuses = new Set(["Em Atendimento", "Concluída", ...waitingStatuses]);
    const eventsByOrder = new Map<string, any[]>();

    for (const event of history) {
      if (event?.tipo !== "status" || event?.evento !== "Status alterado") continue;
      const timestamp = Date.parse(String(event.createdAt ?? ""));
      const orderId = String(event.osId ?? "");
      const parts = String(event.detalhe ?? "").split(" → ");
      if (!orderId || !Number.isFinite(timestamp) || parts.length < 2) continue;
      const previousStatus = parts[0].trim();
      const nextStatus = parts.slice(1).join(" → ").trim();
      if (!validStatuses.has(nextStatus)) continue;
      const list = eventsByOrder.get(orderId) ?? [];
      list.push({ timestamp, previousStatus, nextStatus, technicianId: event.tecnicoId ?? null });
      eventsByOrder.set(orderId, list);
    }

    const completed: any[] = [];
    const excluded: any[] = [];

    for (const [orderId, events] of eventsByOrder) {
      events.sort((a, b) => a.timestamp - b.timestamp);
      const order = orders.find((item) => String(item?.id ?? "") === orderId);
      let cycleStart: number | null = null;
      let activeStart: number | null = null;
      let cycleTechnicianId: string | null = null;
      let technicianChanged = false;
      let activeMilliseconds = 0;

      const closeActiveInterval = (timestamp: number) => {
        if (activeStart !== null) {
          const delta = timestamp - activeStart;
          if (delta >= 0) activeMilliseconds += delta;
          else technicianChanged = true;
          activeStart = null;
        }
      };

      for (const event of events) {
        if (event.nextStatus === "Em Atendimento") {
          if (cycleStart === null) {
            cycleStart = event.timestamp;
            cycleTechnicianId = event.technicianId ? String(event.technicianId) : null;
            technicianChanged = false;
            activeMilliseconds = 0;
          } else if (cycleTechnicianId && event.technicianId && cycleTechnicianId !== String(event.technicianId)) {
            technicianChanged = true;
          }
          if (activeStart === null) activeStart = event.timestamp;
          continue;
        }

        if (waitingStatuses.has(event.nextStatus)) {
          closeActiveInterval(event.timestamp);
          continue;
        }

        if (event.nextStatus === "Concluída") {
          closeActiveInterval(event.timestamp);
          const completionInPeriod = event.timestamp >= from && event.timestamp <= to;
          if (completionInPeriod) {
            const protocol = String(order?.protocolo ?? order?.numero ?? orderId);
            const completionTechnicianId = event.technicianId ? String(event.technicianId) : null;
            const finalTechnicianId = completionTechnicianId || cycleTechnicianId;
            const elapsedMinutes = cycleStart === null ? null : Math.round((event.timestamp - cycleStart) / 60000);
            const activeMinutes = Math.round(activeMilliseconds / 60000);
            let reason = "";
            if (cycleStart === null) reason = "Não há início de atendimento confiável no histórico.";
            else if (!finalTechnicianId) reason = "Não há técnico vinculado ao evento de conclusão.";
            else if (technicianChanged || (cycleTechnicianId && completionTechnicianId && cycleTechnicianId !== completionTechnicianId)) reason = "O técnico foi alterado durante o ciclo; conferir atribuição.";
            else if (activeMinutes <= 0) reason = "Duração ativa nula ou inconsistente.";
            else if (activeMinutes > 1440) reason = "Tempo ativo superior a 24 horas; conferir antes de usar.";
            const record = {
              orderId,
              protocol,
              technicianId: finalTechnicianId,
              technicianName: technicianName(finalTechnicianId),
              type: String(order?.tipo ?? order?.tipoOS ?? "Não informado"),
              startedAt: cycleStart === null ? null : new Date(cycleStart).toISOString(),
              completedAt: new Date(event.timestamp).toISOString(),
              activeMinutes,
              elapsedMinutes,
              reason,
            };
            if (reason) excluded.push(record);
            else completed.push(record);
          }
          cycleStart = null;
          activeStart = null;
          cycleTechnicianId = null;
          technicianChanged = false;
          activeMilliseconds = 0;
        }
      }
    }

    const completedEventOrderIds = new Set<string>();
    for (const [orderId, events] of eventsByOrder) {
      if (events.some((event) => event.nextStatus === "Concluída")) completedEventOrderIds.add(orderId);
    }
    const legacyOrders = orders.filter((order) =>
      String(order?.status ?? "") === "Concluída" && !completedEventOrderIds.has(String(order?.id ?? ""))
    );
    const metricMap = new Map<string, any>();
    for (const record of completed) {
      const key = `${record.technicianId}::${record.type}`;
      const item = metricMap.get(key) ?? {
        technicianId: String(record.technicianId),
        metricKey: key,
        technicianName: record.technicianName,
        type: record.type,
        completedCount: 0,
        activeMinutesTotal: 0,
        elapsedMinutesTotal: 0,
      };
      item.completedCount += 1;
      item.activeMinutesTotal += record.activeMinutes;
      item.elapsedMinutesTotal += Number(record.elapsedMinutes ?? 0);
      metricMap.set(key, item);
    }
    const metrics = [...metricMap.values()]
      .map((item) => ({
        ...item,
        averageActiveMinutes: Math.round(item.activeMinutesTotal / item.completedCount),
        averageElapsedMinutes: Math.round(item.elapsedMinutesTotal / item.completedCount),
      }))
      .sort((a, b) => b.completedCount - a.completedCount || a.technicianName.localeCompare(b.technicianName, "pt-BR"));

    return {
      updatedAt: snapshot.updated_at ?? null,
      totalTracked: completed.length,
      totalExcluded: excluded.length,
      legacyUnmeasuredCount: legacyOrders.length,
      metrics,
      completed: completed.sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt)).slice(0, 200),
      excluded: excluded.sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt)).slice(0, 100),
      legacySamples: legacyOrders.slice(0, 20).map((order) => ({
        orderId: String(order?.id ?? ""),
        protocol: String(order?.protocolo ?? order?.numero ?? order?.id ?? "OS sem protocolo"),
        technicianName: technicianName(order?.employeeId ?? order?.tecnicoId),
      })),
    };
  });
