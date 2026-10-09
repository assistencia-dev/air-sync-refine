import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type DbsControlUser = {
  id: string;
  company_id: string | null;
  role_key: string;
  status: string;
};

async function requireDbsControlUser(context: { userId: string }) {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id, company_id, role_key, status")
    .eq("auth_id", context.userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data || data.status !== "ativo") throw new Error("Usuário inativo ou não encontrado.");

  const allowed = ["SUPER_ADMIN", "ADMIN_OPERACIONAL", "GESTOR_CONTA", "GESTOR_REGIONAL", "COLABORADOR"];
  if (!allowed.includes(data.role_key)) throw new Error("Acesso ao DBS CONTROL não autorizado.");

  return data as DbsControlUser;
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
  const technicians = (normalized.tecnicos as any[]).filter((tech) =>
    String(tech?.employeeId ?? "") === employeeId ||
    (normalizedEmail && String(tech?.email ?? "").trim().toLowerCase() === normalizedEmail)
  );
  const technicianIds = new Set(technicians.map((tech) => String(tech.id)));

  // employeeId é a referência canônica. tecnicoId continua sendo aceito para
  // preservar OS antigas que ainda não receberam o vínculo central do RH.
  const orders = (normalized.ordens as any[])
    .filter((order) =>
      String(order?.employeeId ?? "") === employeeId ||
      technicianIds.has(String(order?.tecnicoId))
    )
    .map((order) => (
      String(order?.employeeId ?? "") === employeeId
        ? order
        : { ...order, employeeId }
    ));
  const clientIds = new Set(orders.map((order) => String(order?.clienteId)).filter(Boolean));
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
    equipamentos: (normalized.equipamentos as any[]).filter((item) => equipmentIds.has(String(item?.id))),
    servicos: (normalized.servicos as any[]).filter((item) => serviceIds.has(String(item?.id))),
    pecas: (normalized.pecas as any[]).filter((item) => partsUsed.has(String(item?.id))),
    compras: [],
  };
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

  const isMine = (order: any) =>
    String(order?.employeeId ?? "") === employeeId ||
    technicianIds.has(String(order?.tecnicoId));

  const mergedOrders = currentOrders.map((currentOrder) => {
    if (!isMine(currentOrder)) return currentOrder;
    const incomingOrder = incomingById.get(String(currentOrder?.id));
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
      "Em Atendimento",
      "Aguardando peça",
      "Aguardando cliente",
      "Concluída",
    ]);

    return {
      ...currentOrder,
      // O colaborador só pode atualizar a execução da própria OS.
      // Dados administrativos/originais (inclusive valor) permanecem intactos.
      status: allowedEmployeeStatuses.has(incomingStatus) ? incomingStatus : currentOrder.status,
      diagnostico: incomingOrder.diagnostico ?? currentOrder.diagnostico ?? "",
      trabalhoExecutado: incomingOrder.trabalhoExecutado ?? currentOrder.trabalhoExecutado ?? "",
      fotoAntes: incomingOrder.fotoAntes ?? currentOrder.fotoAntes ?? null,
      fotoDepois: incomingOrder.fotoDepois ?? currentOrder.fotoDepois ?? null,
      assinatura: incomingOrder.assinatura ?? currentOrder.assinatura ?? null,
      assinaturaEm: incomingOrder.assinaturaEm ?? currentOrder.assinaturaEm ?? null,
      concluidoEm: incomingOrder.concluidoEm ?? currentOrder.concluidoEm ?? null,
      concluidoPorEmployeeId: incomingOrder.concluidoPorEmployeeId ?? currentOrder.concluidoPorEmployeeId ?? null,
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
  const merged: Record<string, unknown> = { ...canonical };
  for (const [key, value] of Object.entries(current)) {
    if (value !== null && value !== undefined && !(typeof value === "string" && value.trim() === "")) {
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
      .select("id,protocol,client_id,site_id,assigned_employee_id,service_id,type,priority,status,scheduled_at,started_at,completed_at,sla_deadline,description,technical_opinion,observation,signature_name,signature_data,total_cents,created_at,updated_at")
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
      .select("id,full_name,is_active,source_system,source_key,registration_data,updated_at"),
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
  const mergeArray = (currentItems: unknown[], incomingItems: unknown[]) => {
    const incomingById = byId(incomingItems);
    const result = (currentItems as any[]).map((item) => mergeDbsRecord(
      incomingById.get(String(item?.id ?? "")) ?? {},
      item,
    ));
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
        sourceSystem: row.source_system || "",
        fieldControlId: row.source_key || "",
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
      diagnostico: row.technical_opinion || "",
      observacao: row.observation || "",
      signature_name: row.signature_name || null,
      assinatura: row.signature_data || null,
      valor: Number(row.total_cents || 0) / 100,
    };
  });

  const sites = mergeArray(Array.isArray((current as any).sites) ? (current as any).sites : [], canonicalSites);
  const locais = mergeArray(Array.isArray((current as any).locais) ? (current as any).locais : [], canonicalSites);

  return {
    ...current,
    clientes: mergeArray(current.clientes as unknown[], canonicalClients),
    equipamentos: mergeArray(current.equipamentos as unknown[], canonicalEquipment),
    servicos: mergeArray(current.servicos as unknown[], canonicalServices),
    tecnicos: mergeArray(current.tecnicos as unknown[], canonicalTechnicians),
    ordens: mergeArray(current.ordens as unknown[], canonicalOrders),
    sites,
    locais,
  };
}

export const getDbsControlCloudState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const user = await requireDbsControlUser(context);
    const scopeKey = user.company_id ? `company:${user.company_id}` : `user:${user.id}`;

    const { data, error } = await supabaseAdmin
      .from("dbs_control_snapshots")
      .select("state, state_version, updated_at")
      .eq("scope_key", scopeKey)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return null;

    const hydratedState = await hydrateDbsControlStateFromCanonicalDb(
      data.state as Record<string, unknown>,
      user.company_id,
    );
    const hydrated = { ...data, state: hydratedState };

    if (user.role_key !== "COLABORADOR") return hydrated;

    const employee = await getCollaboratorEmployee(user.id);
    if (!employee) throw new Error("Funcionário sem acesso ativo ao DBS CONTROL.");

    return {
      ...data,
      state: filterCollaboratorState(hydratedState, employee.id, employee.login_email),
    };
  });

export const saveDbsControlCloudState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { state: Record<string, unknown> }) => {
    if (!input?.state || typeof input.state !== "object" || Array.isArray(input.state)) {
      throw new Error("Estado do DBS CONTROL inválido.");
    }
    return { state: normalizeState(input.state) };
  })
  .handler(async ({ context, data }) => {
    const user = await requireDbsControlUser(context);
    const scopeKey = user.company_id ? `company:${user.company_id}` : `user:${user.id}`;

    let stateToSave = data.state;
    let ownerUserId = user.id;

    if (user.role_key === "COLABORADOR") {
      const employee = await getCollaboratorEmployee(user.id);
      if (!employee) throw new Error("Funcionário sem acesso ativo ao DBS CONTROL.");

      const { data: current, error: currentError } = await supabaseAdmin
        .from("dbs_control_snapshots")
        .select("state, owner_user_id, company_id")
        .eq("scope_key", scopeKey)
        .maybeSingle();

      if (currentError) throw new Error(currentError.message);
      if (!current?.state) throw new Error("O DBS CONTROL ainda não possui uma base operacional compartilhada.");

      stateToSave = mergeCollaboratorOrderState(
        current.state as Record<string, unknown>,
        data.state,
        employee.id,
        employee.login_email,
      );
      ownerUserId = current.owner_user_id ?? user.id;
    }

    const payload = {
      scope_key: scopeKey,
      company_id: user.company_id ?? null,
      owner_user_id: ownerUserId,
      state: stateToSave,
      state_version: 2,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    };

    const { data: saved, error } = await supabaseAdmin
      .from("dbs_control_snapshots")
      .upsert(payload, { onConflict: "scope_key" })
      .select("state, state_version, updated_at")
      .single();

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
