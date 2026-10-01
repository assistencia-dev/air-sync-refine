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

  const { data, error } = await supabaseAdmin
    .from("rh_employees")
    .select("id, full_name, unit, is_active, registration_data")
    .eq("ponto_portal_user_id", userId)
    .eq("ponto_access_enabled", true)
    .eq("dbs_control_access_enabled", true)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw new Error(error.message);
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

  const orders = (normalized.ordens as any[]).filter((order) => technicianIds.has(String(order?.tecnicoId)));
  const clientIds = new Set(orders.map((order) => String(order?.clienteId)).filter(Boolean));
  const equipmentIds = new Set(orders.map((order) => String(order?.equipamentoId)).filter(Boolean));
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

  const mergedOrders = currentOrders.map((currentOrder) => {
    if (!technicianIds.has(String(currentOrder?.tecnicoId))) return currentOrder;
    const incomingOrder = incomingById.get(String(currentOrder?.id));
    if (!incomingOrder) return currentOrder;

    return {
      ...currentOrder,
      status: incomingOrder.status ?? currentOrder.status,
      assinatura: incomingOrder.assinatura ?? currentOrder.assinatura,
      pecasUsadas: Array.isArray(incomingOrder.pecasUsadas) ? incomingOrder.pecasUsadas : currentOrder.pecasUsadas,
      valor: Number.isFinite(Number(incomingOrder.valor)) ? Number(incomingOrder.valor) : currentOrder.valor,
    };
  });

  return {
    ...current,
    ordens: mergedOrders,
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

    if (user.role_key !== "COLABORADOR") return data;

    const employee = await getCollaboratorEmployee(user.id);
    if (!employee) throw new Error("Funcionário sem acesso ativo ao DBS CONTROL.");

    return {
      ...data,
      state: filterCollaboratorState(data.state as Record<string, unknown>, employee.id, employee.login_email),
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
    return user.role_key === "COLABORADOR"
      ? { ...saved, state: filterCollaboratorState(saved.state as Record<string, unknown>, (await getCollaboratorEmployee(user.id))!.id) }
      : saved;
  });
