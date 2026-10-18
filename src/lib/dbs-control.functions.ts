function normalizeEmployeeKey(value: unknown) {
  return String(value ?? "").trim();
}

function employeeMatchesReference(record: Record<string, unknown> | null | undefined, employeeId: string, loginEmail?: string | null) {
  if (!record) return false;
  const normalizedEmail = String(loginEmail ?? "").trim().toLowerCase();
  const candidates = [
    record.employeeId,
    record.assignedEmployeeId,
    record.assigned_employee_id,
    record.tecnicoId,
    record.tecnico_id,
    record.employee_id,
    record.id,
  ];
  if (employeeId && candidates.some((value) => normalizeEmployeeKey(value) === employeeId)) return true;
  if (normalizedEmail) {
    const emailCandidates = [record.email, record.login_email, record.emailTecnico, record.tecnicoEmail];
    if (emailCandidates.some((value) => String(value ?? "").trim().toLowerCase() === normalizedEmail)) return true;
  }
  return false;
}

function filterCollaboratorState(state: Record<string, unknown>, employeeId: string, loginEmail?: string | null) {
  const normalized = normalizeState(state);
  const normalizedEmail = String(loginEmail ?? "").trim().toLowerCase();
  const technicians = (normalized.tecnicos as any[]).filter((tech) => {
    if (employeeMatchesReference(tech, employeeId, loginEmail)) return true;
    const techEmail = String(tech?.email ?? tech?.login_email ?? tech?.tecnicoEmail ?? "").trim().toLowerCase();
    return Boolean(normalizedEmail && techEmail === normalizedEmail);
  });
  const technicianIds = new Set(technicians.map((tech) => String(
    tech?.id ?? tech?.employeeId ?? tech?.assignedEmployeeId ?? tech?.assigned_employee_id ?? tech?.tecnicoId ?? tech?.tecnico_id ?? ""
  )).filter(Boolean));

  const orders = (normalized.ordens as any[])
    .filter((order) => {
      if (employeeMatchesReference(order, employeeId, loginEmail)) return true;
      return [
        String(order?.tecnicoId ?? order?.tecnico_id ?? ""),
        String(order?.assignedEmployeeId ?? order?.assigned_employee_id ?? ""),
        String(order?.employeeId ?? ""),
      ].some((value) => technicianIds.has(value)) || (
        normalizedEmail && String(order?.tecnicoEmail ?? "").trim().toLowerCase() === normalizedEmail
      );
    })
    .map((order) => (
      String(order?.employeeId ?? order?.assignedEmployeeId ?? order?.assigned_employee_id ?? order?.tecnicoId ?? "") === employeeId
        ? order
        : { ...order, employeeId }
    ));
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
    equipamentos: (normalized.equipamentos as any[]).filter((item) => equipmentIds.has(String(item?.id))),
    servicos: (normalized.servicos as any[]).filter((item) => serviceIds.has(String(item?.id))),
    pecas: (normalized.pecas as any[]).filter((item) => partsUsed.has(String(item?.id))),
    compras: [],
  };
}

function mergeCollaboratorOrderState(currentState: Record<string, unknown>, incomingState: Record<string, unknown>, employeeId: string, loginEmail?: string | null) {
  const current = normalizeState(currentState);
  const incoming = filterCollaboratorState(incomingState, employeeId, loginEmail);
  const currentTechs = (current.tecnicos as any[]).filter((tech) => employeeMatchesReference(tech, employeeId, loginEmail));
  const technicianIds = new Set(currentTechs.map((tech) => String(
    tech?.id ?? tech?.employeeId ?? tech?.assignedEmployeeId ?? tech?.assigned_employee_id ?? tech?.tecnicoId ?? tech?.tecnico_id ?? ""
  )).filter(Boolean));
  const currentOrders = current.ordens as any[];
  const incomingOrders = incoming.ordens as any[];
  const incomingById = new Map(incomingOrders.map((order) => [String(order?.id), order]));
  const protocolKey = (order: any) => String(order?.protocolo || order?.protocol || order?.numero || "").trim().toLocaleLowerCase("pt-BR");
  const incomingByProtocol = new Map(incomingOrders
    .filter((order) => protocolKey(order))
    .map((order) => [protocolKey(order), order]));

  const isMine = (order: any) => employeeMatchesReference(order, employeeId, loginEmail) || (
    technicianIds.has(String(order?.tecnicoId ?? order?.tecnico_id ?? order?.assignedEmployeeId ?? order?.assigned_employee_id ?? ""))
  );

  const mergedOrders = currentOrders.map((currentOrder) => {
    if (!isMine(currentOrder)) return currentOrder;
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

export { filterCollaboratorState, mergeCollaboratorOrderState, employeeMatchesReference };

function ensurePersistedSnapshotWrite(result: { data?: any; error?: any; }, operation: string) {
  const error = result?.error;
  if (error) throw new Error(error.message || `Falha ao salvar o snapshot do DBS CONTROL (${operation}).`);
  const data = result?.data;
  if (!data || typeof data !== "object") {
    throw new Error(`A gravação do snapshot (${operation}) não foi confirmada pelo banco.`);
  }
  if (!data.state || typeof data.state !== "object" || Array.isArray(data.state)) {
    throw new Error(`A gravação do snapshot (${operation}) retornou estado inválido.`);
  }
  const stateVersion = Number(data.state_version ?? 0);
  const updatedAt = String(data.updated_at ?? "").trim();
  if (!Number.isFinite(stateVersion) || stateVersion <= 0) {
    throw new Error(`A gravação do snapshot (${operation}) não confirmou state_version válido.`);
  }
  if (!updatedAt) {
    throw new Error(`A gravação do snapshot (${operation}) não confirmou updated_at válido.`);
  }
  return data;
}

async function recordDbsControlSyncAttempt(input: {
  scopeKey: string;
  companyId?: string | null;
  ownerUserId?: string | null;
  userId: string;
  action: string;
  status: "success" | "error" | "retry";
  payload?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  errorMessage?: string | null;
}) {
  try {
    await supabaseAdmin.from("dbs_control_sync_runs").insert({
      scope_key: input.scopeKey,
      company_id: input.companyId ?? null,
      owner_user_id: input.ownerUserId ?? null,
      user_id: input.userId,
      action: input.action,
      status: input.status,
      payload: input.payload ?? {},
      result: input.result ?? {},
      error_message: input.errorMessage ?? null,
      created_at: new Date().toISOString(),
    });
  } catch {
    // Não bloquear o fluxo principal por falha de auditoria; a gravação principal já
    // foi validada em nível de persistência e a auditoria sem tabela não deve ocultar dados.
  }
}

export { filterCollaboratorState, mergeCollaboratorOrderState, employeeMatchesReference, ensurePersistedSnapshotWrite, recordDbsControlSyncAttempt };
