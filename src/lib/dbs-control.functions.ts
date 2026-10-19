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
  };
}

async function getCollaboratorEmployee(userId: string) {
  const { data: user, error: userError } = await supabaseAdmin
    .from("users")
    .select("id, email")
    .eq("id", userId)
    .maybeSingle();
  if (userError) throw new Error(userError.message);

  const direct = await supabaseAdmin
    .from("rh_employees")
    .select("id, full_name, unit, is_active, registration_data")
    .eq("ponto_portal_user_id", userId)
    .eq("ponto_access_enabled", true)
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
        .select("id, full_name, unit, is_active, registration_data, ponto_access_enabled, dbs_control_access_enabled")
        .eq("id", access.data.employee_id)
        .eq("is_active", true)
        .maybeSingle();
      if (fallback.error) throw new Error(fallback.error.message);
      if (fallback.data?.ponto_access_enabled && fallback.data?.dbs_control_access_enabled) {
        data = fallback.data;
      }
    }
  }

  if (!data) return null;
  const registrationEmail = String((data.registration_data as Record<string, unknown> | null)?.email ?? "").trim().toLowerCase();
  return {
    ...data,
    login_email: String(user?.email ?? "").trim().toLowerCase() || registrationEmail || null,
  };
}

function filterCollaboratorState(state: Record<string, unknown>, employeeId: string, loginEmail?: string | null) {
  const normalized = normalizeState(state);
  const normalizedEmail = String(loginEmail ?? "").trim().toLowerCase();
  const employeeKeys = (value: any) => [
    value?.employeeId, value?.assignedEmployeeId, value?.assigned_employee_id, value?.employee_id,
  ].map((item) => String(item ?? "").trim()).filter(Boolean);
  const technicians = (normalized.tecnicos as any[]).filter((tech) =>
    employeeKeys(tech).includes(employeeId) ||
    String(tech?.employee_id ?? "") === employeeId ||
    (normalizedEmail && String(tech?.email ?? "").trim().toLowerCase() === normalizedEmail)
  );
  const technicianIds = new Set(technicians.flatMap((tech) => [
    tech?.id, tech?.tecnicoId, tech?.technicianId, tech?.technician_id,
  ]).map((value) => String(value ?? "").trim()).filter(Boolean));

  // RH employee ID is canonical. Accept legacy and snake_case assignment aliases
  // so an OS issued by administration is not hidden from its assigned collaborator.
  const orders = (normalized.ordens as any[])
    .filter((order) =>
      employeeKeys(order).includes(employeeId) ||
      technicianIds.has(String(order?.tecnicoId ?? "").trim()) ||
      technicianIds.has(String(order?.technicianId ?? "").trim()) ||
      technicianIds.has(String(order?.technician_id ?? "").trim())
    )
    .map((order) => ({ ...order, employeeId }));

  const clientIds = new Set(orders.map((order) => String(order?.clienteId ?? order?.client_id ?? "")).filter(Boolean));
  const equipmentIds = new Set<string>();
  for (const order of orders) {
    if (order?.equipamentoId != null) equipmentIds.add(String(order.equipamentoId));
    if (order?.equipment_id != null) equipmentIds.add(String(order.equipment_id));
    for (const equipmentId of Array.isArray(order?.equipamentosIds) ? order.equipamentosIds : []) {
      if (equipmentId != null) equipmentIds.add(String(equipmentId));
    }
  }
  const serviceIds = new Set(orders.map((order) => String(order?.servicoId ?? order?.service_id ?? "")).filter(Boolean));

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
      equipmentIds.has(String(item?.id)) || clientIds.has(String(item?.clienteId ?? item?.client_id))
    ),
    servicos: (normalized.servicos as any[]).filter((item) => serviceIds.has(String(item?.id))),
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

function mergeCollaboratorOrderState(currentState: Record<string, unknown>, incomingState: Record<string, unknown>, employeeId: string, loginEmail?: string | null) {
  const current = normalizeState(currentState);
  const incoming = filterCollaboratorState(incomingState, employeeId, loginEmail);
  const normalizedEmail = String(loginEmail ?? "").trim().toLowerCase();
  const currentTechs = (current.tecnicos as any[]).filter((tech) =>
    String(tech?.employeeId ?? "") === employeeId ||
    (normalizedEmail && String(tech?.email ?? "").trim().toLowerCase() === normalizedEmail)
  );
  const technicianIds = new Set(currentTechs.map((tech) => String(tech.id)));
  const currentOrders = current.ordens as any[];
  const incomingOrders = incoming.ordens as any[];
  const incomingById = new Map(incomingOrders.map((order) => [String(order?.id), order]));
  const protocolKey = (order: any) => String(order?.protocolo || order?.protocol || order?.numero || "").trim().toLocaleLowerCase("pt-BR");
  const incomingByProtocol = new Map(incomingOrders
    .filter((order) => protocolKey(order))
    .map((order) => [protocolKey(order), order]));

  const isMine = (order: any) =>
    String(order?.employeeId ?? "") === employeeId ||
    technicianIds.has(String(order?.tecnicoId));

  const mergedOrders = currentOrders.map((currentOrder) => {
    if (!isMine(currentOrder)) return currentOrder;
    // O protocolo também reconcilia OS legadas com IDs diferentes no snapshot.
    const incomingOrder =
      incomingById.get(String(currentOrder?.id)) ??
      incomingByProtocol.get(protocolKey(currentOrder));
    if (!incomingOrder) return currentOrder;

    const oldParts = Array.isArray(currentOrder?.pecasUsadas) ? currentOrder.pecasUsadas : [];
    const newParts = Array.isArray(incomingOrder?.pecasUsadas) ? incomingOrder.pecasUsadas : oldParts;
    const oldQty = new Map<string, number>();
    const newQty = new Map<string, number>();
    for (const part of oldParts) {
      const id = String(part?.id ?? "");
      if (id) oldQty.set(id, (oldQty.get(id) ?? 0) + Math.max(0, Number(part?.qtd ?? 0)));
    }
    for (const part of newParts) {
      const id = String(part?.id ?? "");
      if (id) newQty.set(id, (newQty.get(id) ?? 0) + Math.max(0, Number(part?.qtd ?? 0)));
    }
    const parts = current.pecas as any[];
    const partById = new Map(parts.map((part) => [String(part?.id), part]));
    const allPartIds = new Set([...oldQty.keys(), ...newQty.keys()]);
    for (const partId of allPartIds) {
      const delta = (newQty.get(partId) ?? 0) - (oldQty.get(partId) ?? 0);
      if (delta <= 0) continue;
      const stock = partById.get(partId);
      if (!stock) throw new Error("Uma peça utilizada na OS não existe mais no estoque.");
      if (Number(stock.qtd ?? 0) < delta) {
        throw new Error(`Estoque insuficiente para a peça ${stock.nome ?? partId}.`);
      }
    }
    for (const partId of allPartIds) {
      const delta = (newQty.get(partId) ?? 0) - (oldQty.get(partId) ?? 0);
      if (!delta) continue;
      const stock = partById.get(partId);
      if (stock) {
        stock.qtd = Math.max(0, Number(stock.qtd ?? 0) - delta);
      }
    }

    const incomingStatus = String(incomingOrder.status ?? "").trim();
    const allowedEmployeeStatuses = new Set([
      "em atendimento",
      "aguardando peca",
      "aguardando cliente",
      "concluida",
    ].map(normalizeDbsStatus));
    // Uma OS já concluída nunca pode voltar a um status anterior por autosave
    // atrasado ou por um snapshot antigo do dispositivo do colaborador.
    const currentIsCompleted = normalizeDbsStatus(currentOrder?.status) === "concluida";
    const safeStatus = currentIsCompleted ? currentOrder.status : (allowedEmployeeStatuses.has(normalizeDbsStatus(incomingStatus)) ? incomingStatus : currentOrder.status);

    const preserveCompletedValue = (field: string, fallback: unknown) => {
      const existing = currentOrder?.[field];
      if (currentIsCompleted && existing !== null && existing !== undefined && String(existing).trim() !== "") return existing;
      const submitted = incomingOrder?.[field];
      return submitted !== null && submitted !== undefined && String(submitted).trim() !== "" ? submitted : fallback;
    };

    return {
      ...currentOrder,
      ...mergeAppendOnlyCollaboratorObservations(currentOrder, incomingOrder),
      // O colaborador só pode atualizar a execução da própria OS.
      // Dados administrativos/originais (inclusive valor) permanecem intactos.
      // Em OS concluída, conteúdo já preenchido não pode ser apagado por autosave antigo.
      status: safeStatus,
      diagnostico: preserveCompletedValue("diagnostico", currentOrder.diagnostico ?? ""),
      trabalhoExecutado: preserveCompletedValue("trabalhoExecutado", currentOrder.trabalhoExecutado ?? ""),
      fotoAntes: preserveCompletedValue("fotoAntes", currentOrder.fotoAntes ?? null),
      fotoDepois: preserveCompletedValue("fotoDepois", currentOrder.fotoDepois ?? null),
      assinatura: preserveCompletedValue("assinatura", currentOrder.assinatura ?? null),
      assinaturaEm: preserveCompletedValue("assinaturaEm", currentOrder.assinaturaEm ?? null),
      concluidoEm: preserveCompletedValue("concluidoEm", currentOrder.concluidoEm ?? null),
      concluidoPorEmployeeId: preserveCompletedValue("concluidoPorEmployeeId", currentOrder.concluidoPorEmployeeId ?? null),
      pecasUsadas: newParts,
    };
  });

  return {
    ...current,
    ordens: mergedOrders,
  };
}


function dbsValue(value: unknown) {
  return value === null || value === undefined || String(value).trim() === "" ? undefined : value;
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

async function fetchAllDbsControlWorkOrders() {
  const rows: any[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabaseAdmin
      .from("dbs_control_work_orders")
      .select("id,protocol,client_id,site_id,assigned_employee_id,service_id,type,priority,status,scheduled_at,started_at,completed_at,sla_deadline,description,technical_opinion,diagnostico,observation,servico_executado,signature_name,signature_data,signature_path,assinatura_path,total_cents,version,created_at,updated_at")
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) return { data: null, error };
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return { data: rows, error: null };
}

async function hydrateDbsControlStateFromCanonicalDb(
  state: Record<string, unknown>,
  companyId: string | null,
) {
  if (!companyId) return normalizeState(state);

  const [
    clientsResult,
    sitesResult,
    equipmentResult,
    servicesResult,
    employeesResult,
    ordersResult,
    orderEquipmentResult,
  ] = await Promise.all([
    supabaseAdmin.from("dbs_control_clients")
      .select("id,legal_name,trade_name,cnpj,phone,email,notes,status,updated_at"),
    supabaseAdmin.from("dbs_control_sites")
      .select("id,client_id,name,address_json,contact_name,contact_phone,contact_email,notes,status,updated_at"),
    supabaseAdmin.from("dbs_control_equipment")
      .select("id,client_id,site_id,tag_code,equipment_type,brand,model,serial_number,capacity,environment,installation_date,status,technical_notes,updated_at"),
    supabaseAdmin.from("dbs_control_service_catalog")
      .select("id,name,description,estimated_hours,table_value_cents,status,updated_at"),
    supabaseAdmin.from("rh_employees")
      .select("id,full_name,is_active,registration_data,updated_at"),
    fetchAllDbsControlWorkOrders(),
    supabaseAdmin.from("dbs_control_work_order_equipment")
      .select("work_order_id,equipment_id"),
  ]);

  const results = [
    clientsResult,
    sitesResult,
    equipmentResult,
    servicesResult,
    employeesResult,
    ordersResult,
    orderEquipmentResult,
  ];
  const firstError = results.find((result) => result.error)?.error;
  if (firstError) throw new Error(firstError.message);

  const current = normalizeState(state);
  const byId = (items: unknown[]) => new Map(items.map((item: any) => [String(item?.id ?? ""), item]).filter(([id]) => id));
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
        sourceSystem: row.source_system || registration.source_system || "",
        fieldControlId: row.source_key || registration.source_key || registration.fieldControlId || "",
      };
    });

  const statusMap: Record<string, string> = {
    aberta: "Em Atendimento",
    em_atendimento: "Em Atendimento",
    andamento: "Em Atendimento",
    concluida: "Concluída",
    concluída: "Concluída",
    concluido: "Concluída",
    concluído: "Concluída",
    cancelada: "Cancelada",
    cancelado: "Cancelada",
    aguardando_peca: "Aguardando peça",
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

  const canonicalOrders = (ordersResult.data ?? []).map((row: any) => {
    const equipmentIds = equipmentLinks.get(String(row.id)) ?? [];
    const assignedEmployeeId = row.assigned_employee_id ? String(row.assigned_employee_id) : null;
    const mappedStatus = statusMap[String(row.status || "").trim().toLowerCase()] || row.status || "Em Atendimento";
    return {
      id: String(row.id),
      protocolo: row.protocol || "",
      data: row.created_at ? new Date(row.created_at).toLocaleDateString("pt-BR") : "",
      dataCriacao: row.created_at || "",
      clienteId: String(row.client_id),
      siteId: row.site_id ? String(row.site_id) : null,
      localId: row.site_id ? String(row.site_id) : null,
      equipamentoId: equipmentIds[0] || null,
      equipamentosIds: equipmentIds,
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
      signature_name: row.signature_name || null,
      assinaturaStoragePath: row.assinatura_path || row.signature_path || null,
      assinatura: row.assinatura_path || row.signature_path ? null : (row.signature_data || null),
      version: Number(row.version || 1),
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

  return {
    ...current,
    clientes: mergeArray(current.clientes as unknown[], canonicalClients),
    equipamentos: mergeArray(current.equipamentos as unknown[], canonicalEquipment),
    servicos: mergeArray(current.servicos as unknown[], canonicalServices),
    tecnicos: mergeArray(current.tecnicos as unknown[], canonicalTechnicians),
    ordens: mergedOrders,
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
  .inputValidator((input: {
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
    const { data: snapshot, error: snapshotError } = await supabaseAdmin.from("dbs_control_snapshots")
      .select("state").eq("scope_key", scope.scopeKey).maybeSingle();
    if (snapshotError) throw new Error(snapshotError.message);
    const state = snapshot?.state as Record<string, unknown> | null;
    const orders = Array.isArray(state?.ordens) ? state.ordens as any[] : [];
    const order = orders.find((item) => String(item?.id ?? "") === data.orderId ||
      String(item?.protocolo ?? item?.protocol ?? item?.numero ?? "") === data.orderId);
    if (!order) throw new Error("OS não encontrada na base compartilhada.");
    if (user.role_key === "COLABORADOR") {
      const employee = await getCollaboratorEmployee(user.id);
      if (!employee) throw new Error("Funcionário sem acesso ativo ao DBS CONTROL.");
      const assigned = String(order?.employeeId ?? order?.assignedEmployeeId ?? "") === String(employee.id);
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
    let canonicalOrder: { id: string } | null = null;
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

export const getDbsControlCloudState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const user = await requireDbsControlUser(context);
    const scope = await resolveDbsControlScope(user);

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

    const employee = await getCollaboratorEmployee(user.id);
    if (!employee) throw new Error("Funcionário sem acesso ativo ao DBS CONTROL.");

    return {
      ...hydrated,
      state: filterCollaboratorState(hydratedState, employee.id, employee.login_email),
    };
  });


const DBS_CONTROL_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function syncAdminOrdersToCanonical(orders: any[], userId: string, snapshotClients: any[] = []) {
  const isUuid = (value: unknown) => DBS_CONTROL_UUID_RE.test(String(value ?? ""));
  const completed = (value: unknown) => normalizeDbsStatus(value) === "concluida";
  const clientIdCache = new Map<string, string>();
  const resolveCanonicalClient = async (rawClientId: string, protocol: string): Promise<string> => {
    const cacheKey = rawClientId.trim();
    if (clientIdCache.has(cacheKey)) return clientIdCache.get(cacheKey)!;
    const source = snapshotClients.find((client) => String(client?.id ?? "").trim() === cacheKey);
    let canonicalId = isUuid(cacheKey) ? cacheKey : "";
    if (canonicalId) {
      const existing = await supabaseAdmin.from("dbs_control_clients").select("id").eq("id", canonicalId).maybeSingle();
      if (existing.error) throw new Error("Falha ao validar o cliente da OS " + protocol + ": " + existing.error.message);
      if (existing.data) {
        clientIdCache.set(cacheKey, String(existing.data.id));
        return String(existing.data.id);
      }
    }

    const cnpj = String(source?.cnpj ?? source?.CNPJ ?? "").replace(/\D/g, "");
    if (cnpj) {
      const byCnpj = await supabaseAdmin.from("dbs_control_clients").select("id").eq("cnpj", cnpj).limit(1).maybeSingle();
      if (byCnpj.error) throw new Error("Falha ao localizar cliente por CNPJ na OS " + protocol + ": " + byCnpj.error.message);
      if (byCnpj.data) {
        clientIdCache.set(cacheKey, String(byCnpj.data.id));
        return String(byCnpj.data.id);
      }
    }
    const legalName = String(source?.razaoSocial ?? source?.razao_social ?? source?.legal_name ?? source?.nome ?? source?.name ?? "").trim();
    const tradeName = String(source?.nomeFantasia ?? source?.nome_fantasia ?? source?.trade_name ?? source?.nome ?? source?.name ?? "").trim();
    if (!source || !legalName) {
      throw new Error("Não foi possível despachar a OS " + protocol + ": o cliente vinculado não existe na base relacional e não há cadastro completo no snapshot. Nenhum dado foi descartado.");
    }
    const clientPayload: Record<string, unknown> = {
      legal_name: legalName,
      trade_name: tradeName || legalName,
      cnpj: cnpj || null,
      phone: String(source?.telefone ?? source?.phone ?? source?.contato ?? "").trim() || null,
      email: String(source?.email ?? "").trim() || null,
      notes: String(source?.observacoes ?? source?.notes ?? "").trim() || null,
      status: String(source?.status ?? "ativo").toLowerCase() === "inativo" ? "inativo" : "ativo",
    };
    if (canonicalId) clientPayload.id = canonicalId;
    const inserted = await supabaseAdmin.from("dbs_control_clients").insert(clientPayload).select("id").single();
    if (inserted.error || !inserted.data) {
      if (cnpj) {
        const retry = await supabaseAdmin.from("dbs_control_clients").select("id").eq("cnpj", cnpj).limit(1).maybeSingle();
        if (!retry.error && retry.data) {
          clientIdCache.set(cacheKey, String(retry.data.id));
          return String(retry.data.id);
        }
      }
      throw new Error("Não foi possível preparar o cadastro relacional do cliente da OS " + protocol + ": " + (inserted.error?.message ?? "cliente não retornado"));
    }
    clientIdCache.set(cacheKey, String(inserted.data.id));
    return String(inserted.data.id);
  };

  for (const order of orders) {
    const protocol = String(order?.protocolo ?? order?.protocol ?? order?.numero ?? "").trim();
    const orderId = String(order?.id ?? "").trim();
    const rawClientId = String(order?.clienteId ?? order?.client_id ?? "").trim();
    if (!protocol) throw new Error("Não foi possível despachar uma OS sem protocolo. Corrija o cadastro antes de continuar.");
    if (!rawClientId) throw new Error("Não foi possível despachar a OS " + protocol + ": cliente não vinculado.");
    const clientId = await resolveCanonicalClient(rawClientId, protocol);
    let query = supabaseAdmin.from("dbs_control_work_orders")
      .select("id,protocol,client_id,site_id,assigned_employee_id,status,technical_opinion,diagnostico,observation,servico_executado,started_at,completed_at,signature_data,signature_path,assinatura_path,signature_name,version")
      .eq("protocol", protocol).limit(1);
    if (isUuid(orderId)) {
      const byId = await supabaseAdmin.from("dbs_control_work_orders")
        .select("id,protocol,client_id,site_id,assigned_employee_id,status,technical_opinion,diagnostico,observation,servico_executado,started_at,completed_at,signature_data,signature_path,assinatura_path,signature_name,version")
        .eq("id", orderId).maybeSingle();
      if (byId.error) throw new Error("Falha ao ler OS relacional " + protocol + ": " + byId.error.message);
      if (byId.data) query = supabaseAdmin.from("dbs_control_work_orders")
        .select("id,protocol,client_id,site_id,assigned_employee_id,status,technical_opinion,diagnostico,observation,servico_executado,started_at,completed_at,signature_data,signature_path,assinatura_path,signature_name,version")
        .eq("id", orderId);
    }
    const { data: existing, error: lookupError } = await query.maybeSingle();
    if (lookupError) throw new Error("Falha ao localizar OS " + protocol + ": " + lookupError.message);
    const normalizedStatus = normalizeDbsStatus(order?.status).replace(/\s+/g, "_");
    const status = normalizedStatus === "concluido" ? "concluida"
      : normalizedStatus === "em_atendimento" || normalizedStatus === "andamento" ? "em_atendimento"
      : normalizedStatus === "aguardando_peca" ? "aguardando_peca"
      : normalizedStatus === "aguardando_cliente" ? "aguardando_cliente"
      : normalizedStatus === "cancelada" ? "cancelada"
      : normalizedStatus || "aberta";
    const assignedId = String(order?.employeeId ?? order?.assignedEmployeeId ?? order?.tecnicoId ?? "").trim();
    const siteId = String(order?.siteId ?? order?.localId ?? "").trim();
    const signaturePath = String(order?.assinaturaStoragePath ?? order?.assinatura_path ?? order?.signature_path ?? "").trim();
    const fields: Record<string, unknown> = {
      protocol, protocolo: protocol, client_id: clientId,
      site_id: isUuid(siteId) ? siteId : null,
      assigned_employee_id: isUuid(assignedId) ? assignedId : null,
      created_by_user_id: userId,
      type: String(order?.tipo ?? order?.type ?? "corretiva").toLowerCase(),
      priority: String(order?.prioridade ?? order?.priority ?? "normal").toLowerCase(),
      status,
      scheduled_at: order?.scheduledAt ?? order?.scheduled_at ?? null,
      started_at: order?.startedAt ?? order?.started_at ?? null,
      completed_at: completed(status) ? (order?.concluidoEm ?? order?.completedAt ?? order?.completed_at ?? new Date().toISOString()) : null,
      description: String(order?.desc ?? order?.description ?? ""),
      technical_opinion: String(order?.diagnostico ?? order?.technical_opinion ?? ""),
      diagnostico: String(order?.diagnostico ?? order?.technical_opinion ?? ""),
      observation: String(order?.observacao ?? order?.observation ?? ""),
      servico_executado: String(order?.trabalhoExecutado ?? order?.servicoExecutado ?? order?.observacao ?? order?.observation ?? ""),
      signature_name: String(order?.signature_name ?? order?.signatureName ?? ""),
      signature_path: signaturePath || null, assinatura_path: signaturePath || null,
      signature_data: signaturePath ? null : (order?.assinatura ?? order?.signature_data ?? null),
      total_cents: Math.round((() => {
        const raw = String(order?.valor ?? order?.total ?? 0).trim();
        const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
        const amount = Number(normalized);
        return Number.isFinite(amount) ? amount * 100 : 0;
      })()),
      updated_at: new Date().toISOString(),
    };
    if (!existing) {
      // IDs legados que não são UUID usam o UUID gerado pelo banco; o protocolo
      // permanece como identidade estável para futuras reconciliações.
      const insertPayload = isUuid(orderId) ? { id: orderId, ...fields } : fields;
      const { error } = await supabaseAdmin.from("dbs_control_work_orders").insert(insertPayload);
      if (error) throw new Error("Falha ao registrar OS " + protocol + " na tabela relacional: " + error.message);
      continue;
    }
    if (completed(existing.status)) continue;
    const expectedVersion = Number(order?.version);
    const currentVersion = Number(existing.version || 1);
    const staleVersion = Number.isFinite(expectedVersion) && expectedVersion > 0 && expectedVersion !== currentVersion;
    if (staleVersion) {
      const preserveWhenIncomingEmpty: Array<[string, string]> = [
        ["technical_opinion", "technical_opinion"], ["diagnostico", "diagnostico"],
        ["observation", "observation"], ["servico_executado", "servico_executado"],
        ["signature_data", "signature_data"], ["signature_name", "signature_name"],
        ["signature_path", "signature_path"], ["assinatura_path", "assinatura_path"],
        ["started_at", "started_at"], ["completed_at", "completed_at"],
      ];
      for (const [target, source] of preserveWhenIncomingEmpty) {
        const currentValue = (existing as Record<string, unknown>)[source];
        const incomingValue = fields[target];
        if (currentValue !== null && currentValue !== undefined && String(currentValue).trim() !== ""
            && (incomingValue === null || incomingValue === undefined || String(incomingValue).trim() === "")) {
          fields[target] = currentValue;
        }
      }
      const statusRank: Record<string, number> = {
        aberta: 0, atribuida: 1, atribuída: 1, em_rota: 2, em_atendimento: 3,
        "em atendimento": 3, aguardando_peca: 4, aguardando_cliente: 4, concluida: 5, concluída: 5,
      };
      const currentStatus = String(existing.status ?? "").trim().toLocaleLowerCase("pt-BR");
      const incomingStatus = String(fields.status ?? "").trim().toLocaleLowerCase("pt-BR");
      if ((statusRank[currentStatus] ?? 0) > (statusRank[incomingStatus] ?? 0)) fields.status = existing.status;
      if (!fields.started_at && existing.started_at) fields.started_at = existing.started_at;
      if (!fields.completed_at && existing.completed_at) fields.completed_at = existing.completed_at;
    }
    for (const key of ["protocol","protocolo","created_by_user_id"]) delete fields[key];
    if (!signaturePath && !String(order?.assinatura ?? order?.signature_data ?? "").trim()) {
      delete fields.signature_data;
      delete fields.signature_path;
      delete fields.assinatura_path;
      delete fields.signature_name;
    }
    const { data: updated, error } = await supabaseAdmin.from("dbs_control_work_orders")
      .update({ ...fields, version: currentVersion }).eq("id", existing.id).eq("version", currentVersion)
      .select("id,version").maybeSingle();
    if (error) throw new Error("Falha ao salvar OS relacional " + protocol + ": " + error.message);
    if (!updated) throw new Error("A OS " + protocol + " mudou durante o salvamento; recarregue e tente novamente.");
  }
}

export const saveDbsControlCloudState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { state: Record<string, unknown>; baseUpdatedAt?: string | null }) => {
    if (!input?.state || typeof input.state !== "object" || Array.isArray(input.state)) {
      throw new Error("Estado do DBS CONTROL inválido.");
    }
    return {
      state: stripStoredAttachmentPayloads(input.state),
      baseUpdatedAt: input.baseUpdatedAt ?? null,
    };
  })
  .handler(async ({ context, data }) => {
    const user = await requireDbsControlUser(context);
    const scope = await resolveDbsControlScope(user);

    let stateToSave = data.state;
    let ownerUserId = scope.ownerUserId;
    let adminOrdersToSync: any[] = [];

    // Reconcile complete snapshots against the latest shared snapshot before an
    // administrative save, preventing delayed autosaves from dropping existing OS.
    if (user.role_key !== "COLABORADOR") {
      const { data: latestSnapshot, error: latestError } = await supabaseAdmin
        .from("dbs_control_snapshots")
        .select("state, owner_user_id, company_id")
        .eq("scope_key", scope.scopeKey)
        .maybeSingle();
      if (latestError) throw new Error(latestError.message);
      if (latestSnapshot?.state && typeof latestSnapshot.state === "object") {
        const latestState = normalizeState(latestSnapshot.state as Record<string, unknown>);
        const incomingState = normalizeState(data.state);
        const latestOrders = latestState.ordens as any[];
        const incomingOrders = incomingState.ordens as any[];
        const orderId = (order: any) => String(order?.id ?? "").trim();
        const orderProtocol = (order: any) => String(order?.protocolo || order?.protocol || order?.numero || "").trim().toLocaleLowerCase("pt-BR");
        const isCompleted = (order: any) => normalizeDbsStatus(order?.status) === "concluida";
        const latestById = new Map(latestOrders.map((order) => [orderId(order), order]).filter(([id]) => Boolean(id)));
        const latestByProtocol = new Map(latestOrders.map((order) => [orderProtocol(order), order]).filter(([protocol]) => Boolean(protocol)));
        const incomingIds = new Set(incomingOrders.map(orderId).filter(Boolean));
        const incomingProtocols = new Set(incomingOrders.map(orderProtocol).filter(Boolean));
        const changedFields = ["status", "employeeId", "assignedEmployeeId", "tecnicoId", "clienteId", "client_id", "siteId", "localId", "diagnostico", "technical_opinion", "trabalhoExecutado", "servicoExecutado", "observacao", "observation", "prioridade", "tipo", "scheduledAt", "scheduled_at", "assinaturaStoragePath", "assinatura", "signature_name", "concluidoEm", "completedAt"];
        adminOrdersToSync = incomingOrders.filter((incoming) => {
          const id = orderId(incoming);
          const protocol = orderProtocol(incoming);
          const latest = (id ? latestById.get(id) : undefined) ?? (protocol ? latestByProtocol.get(protocol) : undefined);
          if (!latest) return true;
          return changedFields.some((field) => JSON.stringify((incoming as any)?.[field] ?? null) !== JSON.stringify((latest as any)?.[field] ?? null));
        });
        const seenIds = new Set<string>();
        const seenProtocols = new Set<string>();
        const protectedCompletedFields = [
          "tecnicoId", "employeeId", "assignedEmployeeId", "concluidoPorEmployeeId",
          "assinatura", "assinaturaCliente", "signature_data", "signature_name",
          "assinaturaEm", "concluidoEm", "completedAt", "completed_at",
          "diagnostico", "laudo", "technical_opinion", "trabalhoExecutado",
          "observacao", "observation", "observacaoTecnico", "observacaoComplementarTecnico",
          "fotoAntes", "fotoDepois",
        ];
        const reconciledOrders = incomingOrders.flatMap((incoming) => {
          const id = orderId(incoming);
          const protocol = orderProtocol(incoming);
          // One business protocol is one OS even if legacy clients generated different IDs.
          if ((id && seenIds.has(id)) || (protocol && seenProtocols.has(protocol))) return [];
          const latest = (id ? latestById.get(id) : undefined) ??
            (protocol ? latestByProtocol.get(protocol) : undefined);
          let reconciled = incoming;
          if (latest && isCompleted(latest)) {
            const protectedValues: Record<string, unknown> = {};
            for (const field of protectedCompletedFields) {
              const value = latest[field];
              if (value !== null && value !== undefined && String(value).trim() !== "") {
                protectedValues[field] = value;
              }
            }
            reconciled = {
              ...incoming,
              id: latest.id ?? incoming.id,
              protocolo: latest.protocolo || latest.protocol || latest.numero || incoming.protocolo,
              status: latest.status,
              ...protectedValues,
            };
          }
          if (id) seenIds.add(id);
          if (protocol) seenProtocols.add(protocol);
          const canonicalId = orderId(latest);
          const canonicalProtocol = orderProtocol(latest);
          if (canonicalId) seenIds.add(canonicalId);
          if (canonicalProtocol) seenProtocols.add(canonicalProtocol);
          return [reconciled];
        });
        const missingLatestOrders = latestOrders.filter((order) => {
          const id = orderId(order);
          const protocol = orderProtocol(order);
          return !((id && (incomingIds.has(id) || seenIds.has(id))) ||
            (protocol && (incomingProtocols.has(protocol) || seenProtocols.has(protocol))));
        });
        stateToSave = { ...incomingState, ordens: [...reconciledOrders, ...missingLatestOrders] };
        ownerUserId = latestSnapshot.owner_user_id ?? ownerUserId;
      }
    }

    if (user.role_key === "COLABORADOR") {
      const employee = await getCollaboratorEmployee(user.id);
      if (!employee) throw new Error("Funcionário sem acesso ativo ao DBS CONTROL.");

      const { data: current, error: currentError } = await supabaseAdmin
        .from("dbs_control_snapshots")
        .select("state, owner_user_id, company_id")
        .eq("scope_key", scope.scopeKey)
        .maybeSingle();

      if (currentError) throw new Error(currentError.message);
      if (!current?.state) throw new Error("O DBS CONTROL ainda não possui uma base operacional compartilhada.");

      const currentState = current.state as Record<string, unknown>;
      stateToSave = mergeCollaboratorOrderState(
        currentState,
        data.state,
        employee.id,
        employee.login_email,
      );

      // Persiste execução/conclusão também na tabela operacional canônica.
      // Apenas OS atribuídas a este funcionário podem ser atualizadas; dados
      // administrativos e financeiros não são enviados neste UPDATE.
      const incomingForEmployee = filterCollaboratorState(data.state, employee.id, employee.login_email).ordens as any[];
      const protocolKey = (order: any) => String(order?.protocolo || order?.protocol || order?.numero || "").trim().toLocaleLowerCase("pt-BR");
      if (incomingForEmployee.length) {
        const { data: assignedOrders, error: assignedError } = await supabaseAdmin
          .from("dbs_control_work_orders")
          .select("id,protocol,assigned_employee_id,status,technical_opinion,observation,completed_at,signature_data,signature_name,diagnostico,servico_executado,signature_path,assinatura_path,version")
          .eq("assigned_employee_id", employee.id);
        if (assignedError) throw new Error(assignedError.message);

        const currentOrders = normalizeState(currentState).ordens as any[];
        const ignoradas: Array<{ protocolo: string; motivo: string }> = [];
        for (const incomingOrder of incomingForEmployee) {
          const submittedStatus = String(incomingOrder?.status ?? "").trim();
          const submittedCompleted = normalizeDbsStatus(submittedStatus) === "concluida";
          const protocolo = String(incomingOrder?.protocolo ?? incomingOrder?.protocol ?? incomingOrder?.numero ?? incomingOrder?.id ?? "sem protocolo").trim();
          const incomingProtocol = protocolKey(incomingOrder);
          const currentOrder = currentOrders.find((order) =>
            String(order?.id ?? "") === String(incomingOrder?.id ?? "") ||
            (incomingProtocol && protocolKey(order) === incomingProtocol)
          );
          const canonicalProtocol = protocolKey(currentOrder ?? incomingOrder);
          const canonicalOrder = (assignedOrders ?? []).find((order: any) =>
            String(order.id) === String(currentOrder?.id ?? incomingOrder?.id ?? "") ||
            (canonicalProtocol && String(order.protocol ?? "").trim().toLocaleLowerCase("pt-BR") === canonicalProtocol)
          );
          if (!canonicalOrder || String(canonicalOrder.assigned_employee_id) !== String(employee.id)) {
            if (submittedCompleted) ignoradas.push({ protocolo, motivo: "OS não localizada na base operacional ou não atribuída a este técnico." });
            continue;
          }
          const allowedStatuses: Record<string, string> = {
            "em atendimento": "em_atendimento",
            "aguardando peca": "aguardando_peca",
            "aguardando cliente": "aguardando_cliente",
            "concluida": "concluida",
          };
          const dbStatus = allowedStatuses[normalizeDbsStatus(submittedStatus)];
          if (!dbStatus) {
            if (submittedCompleted) ignoradas.push({ protocolo, motivo: "O status enviado não foi reconhecido como válido para gravação." });
            continue;
          }

          const wasCompleted = normalizeDbsStatus(canonicalOrder.status) === "concluida";
          const isStatusTransition = normalizeDbsStatus(canonicalOrder.status) !== normalizeDbsStatus(dbStatus);
          const submittedVersion = Number(incomingOrder?.version);
          const canonicalVersion = Number(canonicalOrder.version || 1);
          // A versão local pode estar atrasada quando o despacho/atendimento foi
          // atualizado noutro dispositivo. Reconciliamos contra a versão canônica
          // recém-lida, preservando os relatórios existentes em vez de rejeitar a OS.
          const staleVersion = Number.isFinite(submittedVersion) && submittedVersion > 0 && submittedVersion !== canonicalVersion;

          // OS concluída é imutável contra autosaves antigos: nunca reabrir nem
          // substituir observação, diagnóstico, assinatura ou data por conteúdo vazio/antigo.
          // Se o registro canônico ainda não tiver um campo de conclusão, só preenchemos
          // o campo ausente com conteúdo válido recebido do técnico.
          if (wasCompleted && !submittedCompleted) continue;

          const incomingDiagnosis = String(incomingOrder?.diagnostico ?? currentOrder?.diagnostico ?? "").trim();
          const incomingObservation = String(incomingOrder?.observacao ?? currentOrder?.observacao ?? "").trim();
          const incomingSignature = String(incomingOrder?.assinatura ?? "").trim();
          const incomingSignatureName = String(incomingOrder?.signature_name ?? "").trim();
          const update: Record<string, unknown> = {
            updated_at: new Date().toISOString(),
          };

          if (!wasCompleted) {
            update.status = dbStatus;
            update.technical_opinion = staleVersion && String(canonicalOrder.technical_opinion ?? "").trim()
              ? canonicalOrder.technical_opinion : incomingDiagnosis;
            update.diagnostico = staleVersion && String(canonicalOrder.diagnostico ?? canonicalOrder.technical_opinion ?? "").trim()
              ? (canonicalOrder.diagnostico ?? canonicalOrder.technical_opinion) : incomingDiagnosis;
            update.observation = staleVersion && String(canonicalOrder.observation ?? "").trim()
              ? canonicalOrder.observation : incomingObservation;
            const incomingWork = String(incomingOrder?.trabalhoExecutado ?? incomingOrder?.servicoExecutado ?? incomingObservation).trim();
            update.servico_executado = staleVersion && String(canonicalOrder.servico_executado ?? "").trim()
              ? canonicalOrder.servico_executado : incomingWork;
          }

          if (submittedCompleted) {
            if (!wasCompleted || !canonicalOrder.completed_at) {
              update.completed_at = incomingOrder?.concluidoEm ?? incomingOrder?.completedAt ?? new Date().toISOString();
            }
            if (incomingSignature && (!wasCompleted || !String(canonicalOrder.signature_data ?? "").trim()) && !incomingOrder?.assinaturaStoragePath) {
              update.signature_data = incomingSignature;
            }
            const signaturePath = String(incomingOrder?.assinaturaStoragePath ?? "").trim();
            if (signaturePath && (!wasCompleted || !String(canonicalOrder.assinatura_path ?? canonicalOrder.signature_path ?? "").trim())) {
              update.assinatura_path = signaturePath;
              update.signature_path = signaturePath;
              update.signature_data = null;
            }
            if (incomingSignatureName && (!wasCompleted || !String(canonicalOrder.signature_name ?? "").trim())) {
              update.signature_name = incomingSignatureName;
            }
          }

          let updateQuery = supabaseAdmin
            .from("dbs_control_work_orders")
            .update(update)
            .eq("id", canonicalOrder.id)
            .eq("assigned_employee_id", employee.id);
          if (Number.isFinite(submittedVersion) && submittedVersion > 0) {
            updateQuery = updateQuery.eq("version", canonicalVersion);
          } else {
            updateQuery = updateQuery.eq("version", canonicalVersion);
          }
          const { data: updatedOrder, error: updateError } = await updateQuery.select("id,version").maybeSingle();
          if (updateError) throw new Error(updateError.message);
          if (!updatedOrder) throw new Error("Conflito de versão: a OS " + protocolo + " mudou durante o salvamento. Recarregue a versão mais recente e despache novamente.");
          incomingOrder.version = Number(updatedOrder.version || canonicalVersion + 1);

          // Histórico append-only de cada transição real de status para auditoria.
          // Falha ao registrar o evento é reportada; nunca é ocultada como sucesso.
          if (isStatusTransition && !wasCompleted) {
            const { error: eventError } = await supabaseAdmin
              .from("dbs_control_work_order_events")
              .insert({
                work_order_id: canonicalOrder.id,
                actor_user_id: user.id,
                event_type: "status_changed",
                old_status: String(canonicalOrder.status ?? ""),
                new_status: dbStatus,
                details: {
                  protocol: String(canonicalOrder.protocol ?? incomingOrder?.protocolo ?? ""),
                  source: "collaborator_save",
                  employee_id: employee.id,
                  recorded_at: new Date().toISOString(),
                },
              });
            if (eventError) throw new Error(`A OS foi salva, mas o histórico de auditoria não foi registrado: ${eventError.message}`);
          }
        }
        if (ignoradas.length) {
          throw new Error("Não foi possível confirmar a conclusão de uma ou mais OS: " + ignoradas.map((item) => `${item.protocolo} — ${item.motivo}`).join("; "));
        }
      }

      ownerUserId = current.owner_user_id ?? user.id;
    }

    if (user.role_key !== "COLABORADOR" && adminOrdersToSync.length) {
      await syncAdminOrdersToCanonical(adminOrdersToSync, user.id, Array.isArray((stateToSave as any).clientes) ? (stateToSave as any).clientes : []);
    }

    const payload = {
      scope_key: scope.scopeKey,
      company_id: scope.companyId,
      owner_user_id: ownerUserId,
      state: stateToSave,
      state_version: 2,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
      base_updated_at: data.baseUpdatedAt,
    };

    // A função SQL bloqueia a linha do escopo e reconcilia OS dentro da mesma
    // transação. Em conflito de base_updated_at, relê a nuvem e tenta uma única
    // reconciliação adicional, sem mudar o escopo da empresa nem descartar anexos.
    const mergeRetryState = (
      latestInput: Record<string, unknown>,
      pendingInput: Record<string, unknown>,
    ): Record<string, unknown> => {
      const latest = normalizeState(latestInput);
      const pending = normalizeState(pendingInput);
      const latestOrders = Array.isArray(latest.ordens) ? latest.ordens as any[] : [];
      const pendingOrders = Array.isArray(pending.ordens) ? pending.ordens as any[] : [];
      const protocolKey = (order: any) => String(order?.protocolo ?? order?.protocol ?? order?.numero ?? "").trim().toLocaleLowerCase("pt-BR");
      const rank: Record<string, number> = { aberta: 0, atribuida: 1, atribuída: 1, em_rota: 2, em_atendimento: 3, "em atendimento": 3, aguardando_peca: 4, aguardando_cliente: 4, concluida: 5, concluída: 5 };
      const protectedFields = ["assinatura", "assinaturaCliente", "signature_data", "signature_name", "assinaturaStoragePath", "signature_path", "assinatura_path", "fotoAntes", "fotoDepois", "fotos", "anexos", "attachments", "relatorio", "laudo", "technical_opinion", "diagnostico", "trabalhoExecutado", "servicoExecutado", "observacaoTecnico"];
      const latestById = new Map<string, any>(
        latestOrders
          .map((order): [string, any] => [String(order?.id ?? "").trim(), order])
          .filter(([key]) => Boolean(key)),
      );
      const latestByProtocol = new Map<string, any>(
        latestOrders
          .map((order): [string, any] => [protocolKey(order), order])
          .filter(([key]) => Boolean(key)),
      );
      const mergedOrders = pendingOrders.map((incoming) => {
        const id = String(incoming?.id ?? "").trim();
        const protocol = protocolKey(incoming);
        const current = (id ? latestById.get(id) : undefined) ??
          (protocol ? latestByProtocol.get(protocol) : undefined);
        if (!current) return incoming;
        const merged: Record<string, unknown> = { ...current, ...incoming };
        const currentStatus = String(current.status ?? "").trim().toLocaleLowerCase("pt-BR");
        const incomingStatus = String(incoming.status ?? "").trim().toLocaleLowerCase("pt-BR");
        if ((rank[currentStatus] ?? 0) > (rank[incomingStatus] ?? 0)) merged.status = current.status;
        for (const field of protectedFields) {
          const oldValue = current[field];
          const newValue = incoming[field];
          if (Array.isArray(oldValue) || Array.isArray(newValue)) {
            const combined = [...(Array.isArray(oldValue) ? oldValue : []), ...(Array.isArray(newValue) ? newValue : [])];
            const seen = new Set<string>();
            merged[field] = combined.filter(item => {
              const itemKey = typeof item === "string" ? item : JSON.stringify(item);
              if (seen.has(itemKey)) return false;
              seen.add(itemKey);
              return true;
            });
          } else if ((newValue === null || newValue === undefined || String(newValue).trim() === "") && oldValue !== null && oldValue !== undefined && String(oldValue).trim() !== "") {
            merged[field] = oldValue;
          }
        }
        if (normalizeDbsStatus(current.status) === "concluida") {
          merged.status = current.status;
          for (const field of ["completedAt", "concluidoEm", "completed_at", "assinaturaEm", "assinatura", "assinaturaCliente", "signature_data", "signature_name", "assinaturaStoragePath", "signature_path", "assinatura_path", "fotoAntes", "fotoDepois", "fotos", "anexos", "attachments", "relatorio", "laudo", "technical_opinion", "diagnostico", "trabalhoExecutado", "servicoExecutado", "observacaoTecnico"]) {
            if (current[field] !== null && current[field] !== undefined && String(current[field]).trim() !== "") merged[field] = current[field];
          }
        }
        return merged;
      });
      const pendingIds = new Set(mergedOrders.map(order => String(order?.id ?? "").trim()).filter(Boolean));
      const pendingProtocols = new Set(mergedOrders.map(protocolKey).filter(Boolean));
      const missingLatest = latestOrders.filter(order => {
        const id = String(order?.id ?? "").trim();
        const protocol = protocolKey(order);
        return !((id && pendingIds.has(id)) || (protocol && pendingProtocols.has(protocol)));
      });
      return { ...latest, ...pending, ordens: [...mergedOrders, ...missingLatest] };
    };

    let saveResult = await supabaseAdmin
      .rpc("dbs_control_save_snapshot_safe_v2", { p_payload: payload })
      .single();
    if (saveResult.error && /DBS_SNAPSHOT_STALE_VERSION|stale version|base_updated_at|base compartilhada|conflito|concurrent|serialization|40001|vers[aã]o|updated_at/i.test(saveResult.error.message)) {
      const { data: latestSnapshot, error: latestError } = await supabaseAdmin
        .from("dbs_control_snapshots")
        .select("state, updated_at, owner_user_id, company_id")
        .eq("scope_key", scope.scopeKey)
        .maybeSingle();
      if (latestError) throw new Error("Conflito de salvamento; não foi possível recarregar a versão mais recente: " + latestError.message);
      if (!latestSnapshot?.state || !latestSnapshot.updated_at) {
        throw new Error("Conflito de salvamento; a versão mais recente da base não pôde ser confirmada. Nenhum sucesso foi informado.");
      }
      const retryPayload = {
        ...payload,
        owner_user_id: latestSnapshot.owner_user_id ?? payload.owner_user_id,
        company_id: scope.companyId,
        state: mergeRetryState(latestSnapshot.state as Record<string, unknown>, stateToSave),
        base_updated_at: latestSnapshot.updated_at,
        updated_at: new Date().toISOString(),
      };
      saveResult = await supabaseAdmin
        .rpc("dbs_control_save_snapshot_safe_v2", { p_payload: retryPayload })
        .single();
    }

    const saved = saveResult.data;
    const error = saveResult.error;
    if (error) throw new Error(error.message);
    if (user.role_key === "COLABORADOR") {
      const employee = await getCollaboratorEmployee(user.id);
      if (!employee) throw new Error("Funcionário sem acesso ativo ao DBS CONTROL.");
      return {
        ...saved,
        state: filterCollaboratorState(saved.state as Record<string, unknown>, employee.id, employee.login_email),
      };
    }
    return saved;
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
    ] = await Promise.all([
      supabaseAdmin.from("dbs_control_clients").select("id,legal_name,trade_name,cnpj,email,status"),
      supabaseAdmin.from("dbs_control_sites").select("id,client_id,name,status"),
      supabaseAdmin.from("dbs_control_equipment").select("id,client_id,site_id,tag_code,serial_number,status"),
      supabaseAdmin.from("dbs_control_service_catalog").select("id,name,status"),
      supabaseAdmin.from("rh_employees").select("id,full_name,is_active,source_system,source_key,registration_data"),
      fetchAllDbsControlWorkOrders(),
      supabaseAdmin.from("dbs_control_work_order_equipment").select("work_order_id,equipment_id"),
      supabaseAdmin.from("dbs_control_external_refs").select("id,provider,entity_type,external_id,local_id"),
      supabaseAdmin.from("dbs_control_sync_runs").select("id,mode,status,started_at,finished_at,summary,errors").order("started_at",{ascending:false}).limit(10),
      supabaseAdmin.from("dbs_control_snapshots").select("state,updated_at,scope_key").limit(20),
    ]);
    const results = [clientsResult,sitesResult,equipmentResult,servicesResult,employeesResult,ordersResult,orderEquipmentResult,refsResult,syncRunsResult,snapshotsResult];
    const firstError = results.find((r) => r.error)?.error;
    if (firstError) throw new Error(firstError.message);

    const clients=clientsResult.data??[], sites=sitesResult.data??[], equipment=equipmentResult.data??[];
    const services=servicesResult.data??[], employees=employeesResult.data??[], orders=ordersResult.data??[];
    const orderEquipment=orderEquipmentResult.data??[], refs=refsResult.data??[], syncRuns=syncRunsResult.data??[];
    const snapshots=snapshotsResult.data??[];
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
    return {ok:critical===0,auditedAt:new Date().toISOString(),status:critical?"critical":warnings?"warning":"ok",counts,issues,latestSync:syncRuns[0]??null,snapshotCounts,policy:{destructiveActions:false,sameNameEmployeesAreNotMerged:true,automaticDeletion:false}};
  });


/**
 * Métricas de produtividade calculadas somente a partir de transições reais de status
 * registradas no histórico do DBS CONTROL. O histórico sintético de OS antigas é ignorado.
 * Valores financeiros nunca são retornados por este endpoint.
 */
export const getDbsControlProductivity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { startDate: string; endDate: string }) => {
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