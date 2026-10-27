import { createServerFn } from "@tanstack/react-start";
import { randomBytes } from "node:crypto";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type RhBenefitType = "passagem" | "alimentacao";

type RhInput = { benefit_type: RhBenefitType };

type EmployeeRecordInput = {
  full_name: string;
  unit: string;
  registration_data?: Record<string, unknown> | null;
  dbs_control_base_id?: string | null;
  dbs_control_can_issue_work_orders?: boolean;
};

function moneyToCents(value: unknown) {
  const raw = String(value ?? "").trim().replace(/[^0-9,.-]/g, "");
  if (!raw) return null;
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}
function numberValue(value: unknown) {
  const n = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function validTime(value: unknown) {
  const raw = String(value ?? "").trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(raw) ? raw : null;
}
function normalizeEmployeeRegistration(input: Record<string, unknown> | null | undefined) {
  const data = { ...(input ?? {}) } as Record<string, unknown>;
  const salaryCents = moneyToCents(data.salary_cents ?? data.salary);
  if (salaryCents != null) { data.salary_cents = salaryCents; data.salary = (salaryCents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 }); }
  const weeklyHours = numberValue(data.weekly_hours ?? data.work_hours);
  if (weeklyHours != null) { data.weekly_hours = weeklyHours; data.work_hours = weeklyHours.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + " h/semana"; }
  for (const key of ["entry_time", "exit_time", "lunch_start", "lunch_end"]) { const normalized = validTime(data[key]); if (normalized) data[key] = normalized; }
  const breakMinutes = numberValue(data.break_minutes); if (breakMinutes != null) data.break_minutes = Math.round(breakMinutes);
  const toleranceMinutes = numberValue(data.tolerance_minutes); if (toleranceMinutes != null) data.tolerance_minutes = Math.round(toleranceMinutes);
  return data;
}

async function requireNativeOperator(context: { userId: string }) {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id, username, role_key, status, company_id")
    .eq("auth_id", context.userId)
    .maybeSingle();
  if (
    error ||
    !data ||
    data.status !== "ativo" ||
    (!["SUPER_ADMIN", "ADMIN_OPERACIONAL"].includes(data.role_key ?? "") && !["DBS123", "DBSASSISTENCIA123"].includes(data.username ?? ""))
  ) {
    throw new Error("Acesso restrito ao operador nativo DBS.");
  }
  return data;
}

type DbsControlBaseInput = {
  id?: string;
  name: string;
  code?: string | null;
  address_json?: Record<string, unknown> | null;
  status?: "ativo" | "inativo";
};

async function validateDbsControlBaseForOperator(actor: { id: string; company_id?: string | null }, baseId: string | null | undefined) {
  if (!baseId) return null;
  const { data: base, error } = await (supabaseAdmin as any)
    .from("dbs_control_bases")
    .select("id, company_id, name, status")
    .eq("id", baseId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!base) throw new Error("Base operacional DBS não encontrada.");
  if (base.status !== "ativo") throw new Error("A base operacional selecionada está inativa.");
  if (base.company_id && actor.company_id && String(base.company_id) !== String(actor.company_id)) {
    throw new Error("A base operacional pertence a outra empresa.");
  }
  return base;
}

/** Bases e clientes são administrados pelo RH/operacional; colaboradores nunca
 * recebem acesso direto às tabelas de escopo. */
export const listDbsControlBases = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const actor = await requireNativeOperator(context);
    const baseQuery = (supabaseAdmin as any)
      .from("dbs_control_bases")
      .select("id, company_id, name, code, address_json, status, created_at, updated_at")
      .order("status", { ascending: true })
      .order("name", { ascending: true });
    if (actor.company_id) baseQuery.eq("company_id", actor.company_id);
    const [basesResult, linksResult, clientsResult] = await Promise.all([
      baseQuery,
      (supabaseAdmin as any).from("dbs_control_base_clients").select("base_id, client_id, created_at"),
      (supabaseAdmin as any).from("dbs_control_clients").select("id, legal_name, trade_name, cnpj, status").order("trade_name", { ascending: true }),
    ]);
    for (const result of [basesResult, linksResult, clientsResult]) {
      if (result.error) throw new Error(result.error.message);
    }
    const linksByBase = new Map<string, string[]>();
    for (const link of linksResult.data ?? []) {
      const list = linksByBase.get(String(link.base_id)) ?? [];
      list.push(String(link.client_id));
      linksByBase.set(String(link.base_id), list);
    }
    return {
      bases: (basesResult.data ?? []).map((base: any) => ({
        ...base,
        client_ids: linksByBase.get(String(base.id)) ?? [],
        client_count: (linksByBase.get(String(base.id)) ?? []).length,
      })),
      clients: clientsResult.data ?? [],
    };
  });

export const saveDbsControlBase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: DbsControlBaseInput) => {
    const name = String(input?.name ?? "").trim();
    if (!name) throw new Error("Informe o nome da base operacional.");
    if (name.length > 120) throw new Error("O nome da base deve ter no máximo 120 caracteres.");
    return {
      ...input,
      id: input?.id || undefined,
      name,
      code: input?.code ? String(input.code).trim().slice(0, 40) : null,
      status: input?.status === "inativo" ? "inativo" : "ativo",
      address_json: input?.address_json && typeof input.address_json === "object" ? input.address_json : {},
    };
  })
  .handler(async ({ context, data }) => {
    const actor = await requireNativeOperator(context);
    const existingBase = await validateDbsControlBaseForOperator(actor, data.id);
    const payload = {
      name: data.name,
      code: data.code || null,
      address_json: data.address_json || {},
      status: data.status || "ativo",
      company_id: existingBase?.company_id ?? actor.company_id ?? null,
      created_by_user_id: actor.id,
      updated_at: new Date().toISOString(),
    };
    const query = (supabaseAdmin as any).from("dbs_control_bases");
    const result = data.id
      ? await query.update(payload).eq("id", data.id).select("id, company_id, name, code, address_json, status, created_at, updated_at").single()
      : await query.insert(payload).select("id, company_id, name, code, address_json, status, created_at, updated_at").single();
    if (result.error) throw new Error(result.error.message);
    return result.data;
  });

export const setDbsControlBaseClients = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { base_id: string; client_ids: string[] }) => {
    if (!input?.base_id) throw new Error("Base operacional inválida.");
    const clientIds = [...new Set((input.client_ids ?? []).map((id) => String(id).trim()).filter(Boolean))];
    if (clientIds.length > 5000) throw new Error("Uma base não pode ter mais de 5.000 clientes em uma única operação.");
    return { base_id: input.base_id, client_ids: clientIds };
  })
  .handler(async ({ context, data }) => {
    const actor = await requireNativeOperator(context);
    await validateDbsControlBaseForOperator(actor, data.base_id);
    if (data.client_ids.length) {
      const { data: clients, error: clientsError } = await (supabaseAdmin as any)
        .from("dbs_control_clients").select("id").in("id", data.client_ids);
      if (clientsError) throw new Error(clientsError.message);
      const known = new Set((clients ?? []).map((client: any) => String(client.id)));
      const missing = data.client_ids.find((id) => !known.has(id));
      if (missing) throw new Error("Um dos clientes selecionados não existe no cadastro relacional.");
    }
    const { error: deleteError } = await (supabaseAdmin as any)
      .from("dbs_control_base_clients").delete().eq("base_id", data.base_id);
    if (deleteError) throw new Error(deleteError.message);
    if (data.client_ids.length) {
      const { error: insertError } = await (supabaseAdmin as any)
        .from("dbs_control_base_clients")
        .insert(data.client_ids.map((client_id) => ({ base_id: data.base_id, client_id, created_by_user_id: actor.id })));
      if (insertError) throw new Error(insertError.message);
    }
    return { ok: true, base_id: data.base_id, client_ids: data.client_ids };
  });

function validateBenefit(input: RhInput) {
  if (input.benefit_type !== "passagem" && input.benefit_type !== "alimentacao") {
    throw new Error("Tipo de benefício inválido.");
  }
  return input;
}

export const listRhEmployees = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(validateBenefit)
  .handler(async ({ context, data }) => {
    await requireNativeOperator(context);
    const { data: employees, error } = await supabaseAdmin
      .from("rh_employees")
      .select("id, registry_employee_id, benefit_type, full_name, unit, fare_cents, trips_per_day, is_active, benefit_configured, created_at, updated_at")
      .eq("is_active", true)
      .eq("benefit_configured", true)
      .eq("benefit_type", data.benefit_type)
      .order("full_name")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    const unique = new Map<string, any>();
    for (const employee of employees ?? []) {
      const key = employee.registry_employee_id ?? employee.id;
      if (!unique.has(key)) unique.set(key, employee);
    }
    return [...unique.values()];
  });

export const listRhEmployeeRegistryForBenefits = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireNativeOperator(context);
    const { data, error } = await supabaseAdmin.from("rh_employees")
      .select("id, full_name, unit, is_active, registration_data, registry_employee_id")
      .order("full_name");
    if (error) throw new Error(error.message);
    return (data ?? []).filter((row: any) => row.registry_employee_id === row.id || !row.registry_employee_id);
  });

export const configureRhEmployeeBenefit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { registry_employee_id: string; benefit_type: RhBenefitType; fare_cents: number; trips_per_day: number }) => {
    validateBenefit(input);
    if (!input.registry_employee_id) throw new Error("Selecione o funcionário no Cadastro de Funcionários.");
    if (!Number.isInteger(input.fare_cents) || input.fare_cents <= 0) throw new Error("Informe um valor diário válido.");
    if (!Number.isInteger(input.trips_per_day) || input.trips_per_day < 1 || input.trips_per_day > 12) throw new Error("Informe a quantidade de viagens por dia.");
    return input;
  })
  .handler(async ({ context, data }) => {
    await requireNativeOperator(context);
    const { data: registry, error: registryError } = await supabaseAdmin.from("rh_employees")
      .select("id, full_name, unit, is_active")
      .eq("id", data.registry_employee_id)
      .eq("registry_employee_id", data.registry_employee_id)
      .maybeSingle();
    if (registryError) throw new Error(registryError.message);
    if (!registry) throw new Error("Funcionário não encontrado no Cadastro de Funcionários.");
    if (!registry.is_active) throw new Error("O funcionário está inativo no Cadastro de Funcionários.");

    const { data: existing, error: existingError } = await supabaseAdmin.from("rh_employees").select("id")
      .eq("registry_employee_id", data.registry_employee_id).eq("benefit_type", data.benefit_type).maybeSingle();
    if (existingError) throw new Error(existingError.message);

    const payload = { full_name: registry.full_name, unit: registry.unit, fare_cents: data.fare_cents, trips_per_day: data.benefit_type === "passagem" ? data.trips_per_day : 1, is_active: true, benefit_configured: true };
    if (existing) {
      const { data: updated, error } = await supabaseAdmin.from("rh_employees").update(payload).eq("id", existing.id)
        .select("id, registry_employee_id, benefit_type, full_name, unit, fare_cents, trips_per_day, is_active, benefit_configured").single();
      if (error) throw new Error(error.message);
      return updated;
    }
    const { data: created, error } = await supabaseAdmin.from("rh_employees")
      .insert({ ...payload, benefit_type: data.benefit_type, registry_employee_id: data.registry_employee_id, registration_data: {} })
      .select("id, registry_employee_id, benefit_type, full_name, unit, fare_cents, trips_per_day, is_active, benefit_configured").single();
    if (error) throw new Error(error.message);
    return created;
  });

export const createRhEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      benefit_type: RhBenefitType;
      full_name: string;
      unit: string;
      fare_cents: number;
      trips_per_day: number;
    }) => {
      validateBenefit(input);
      if (!input.full_name?.trim() || !input.unit?.trim())
        throw new Error("Informe nome e unidade.");
      if (!Number.isInteger(input.fare_cents) || input.fare_cents <= 0)
        throw new Error("Informe um valor diário válido.");
      if (
        !Number.isInteger(input.trips_per_day) ||
        input.trips_per_day < 1 ||
        input.trips_per_day > 12
      )
        throw new Error("Informe a quantidade de viagens por dia.");
      return { ...input, full_name: input.full_name.trim(), unit: input.unit.trim() };
    },
  )
  .handler(async ({ context, data }) => {
    await requireNativeOperator(context);
    const { data: employee, error } = await supabaseAdmin
      .from("rh_employees")
      .insert({ ...data, is_active: true })
      .select(
        "id, benefit_type, full_name, unit, fare_cents, trips_per_day, is_active, created_at, updated_at",
      )
      .single();
    if (error) throw new Error(error.message);
    return employee;
  });

export const updateRhEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      id: string;
      benefit_type: RhBenefitType;
      full_name: string;
      unit: string;
      fare_cents: number;
      trips_per_day: number;
    }) => {
      validateBenefit(input);
      if (!input.id || !input.full_name?.trim() || !input.unit?.trim())
        throw new Error("Dados do colaborador inválidos.");
      if (!Number.isInteger(input.fare_cents) || input.fare_cents <= 0)
        throw new Error("Informe um valor diário válido.");
      if (
        !Number.isInteger(input.trips_per_day) ||
        input.trips_per_day < 1 ||
        input.trips_per_day > 12
      )
        throw new Error("Informe a quantidade de viagens por dia.");
      return { ...input, full_name: input.full_name.trim(), unit: input.unit.trim() };
    },
  )
  .handler(async ({ context, data }) => {
    await requireNativeOperator(context);
    const { data: employee, error } = await supabaseAdmin
      .from("rh_employees")
      .update({
        full_name: data.full_name,
        unit: data.unit,
        fare_cents: data.fare_cents,
        trips_per_day: data.trips_per_day,
      })
      .eq("id", data.id)
      .select(
        "id, benefit_type, full_name, unit, fare_cents, trips_per_day, is_active, created_at, updated_at",
      )
      .single();
    if (error) throw new Error(error.message);
    return employee;
  });

export const deleteRhEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; benefit_type: RhBenefitType }) => {
    validateBenefit(input);
    if (!input.id) throw new Error("Colaborador inválido.");
    return input;
  })
  .handler(async ({ context, data }) => {
    await requireNativeOperator(context);
    const { error } = await supabaseAdmin
      .from("rh_employees")
      .update({ is_active: false, benefit_configured: false })
      .eq("id", data.id)
      .eq("benefit_type", data.benefit_type);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const reactivateRhEmployeeRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    if (!input?.id) throw new Error("Funcionário inválido.");
    return input;
  })
  .handler(async ({ context, data }) => {
    await requireNativeOperator(context);
    const { error } = await supabaseAdmin
      .from("rh_employees")
      .update({ is_active: true })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listRhTopups = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(validateBenefit)
  .handler(async ({ context, data }) => {
    await requireNativeOperator(context);
    const { data: topups, error } = await supabaseAdmin
      .from("rh_topups")
      .select("id, benefit_type, employee_id, amount_cents, paid_at, created_at")
      .eq("benefit_type", data.benefit_type)
      .order("paid_at", { ascending: false });
    if (error) throw new Error(error.message);
    return topups ?? [];
  });

export const createRhTopup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      benefit_type: RhBenefitType;
      employee_id: string;
      amount_cents: number;
      paid_at: string;
    }) => {
      validateBenefit(input);
      if (
        !input.employee_id ||
        !Number.isInteger(input.amount_cents) ||
        input.amount_cents <= 0 ||
        !input.paid_at
      ) {
        throw new Error("Informe colaborador, valor e data da recarga.");
      }
      return input;
    },
  )
  .handler(async ({ context, data }) => {
    const operator = await requireNativeOperator(context);
    const { data: employee } = await supabaseAdmin
      .from("rh_employees")
      .select("id")
      .eq("id", data.employee_id)
      .eq("benefit_type", data.benefit_type)
      .eq("benefit_configured", true)
      .eq("is_active", true)
      .maybeSingle();
    if (!employee) throw new Error("Colaborador não encontrado ou inativo.");
    const { data: topup, error } = await supabaseAdmin
      .from("rh_topups")
      .insert({ ...data, created_by: operator.id })
      .select("id, benefit_type, employee_id, amount_cents, paid_at, created_at")
      .single();
    if (error) throw new Error(error.message);
    return topup;
  });

export const deleteRhTopup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; benefit_type: RhBenefitType }) => {
    validateBenefit(input);
    if (!input.id) throw new Error("Recarga inválida.");
    return input;
  })
  .handler(async ({ context, data }) => {
    await requireNativeOperator(context);
    const { error } = await supabaseAdmin
      .from("rh_topups")
      .delete()
      .eq("id", data.id)
      .eq("benefit_type", data.benefit_type);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Valida usuário + senha do operador para liberar o módulo RH.
 * Usa um cliente sem persistência de sessão: apenas confere as credenciais.
 */
export const unlockRhModule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { username: string; password: string }) => {
    if (!input?.username?.trim() || !input?.password) {
      throw new Error("Informe usuário e senha do RH.");
    }
    return { username: input.username.trim().toUpperCase(), password: input.password };
  })
  .handler(async ({ context, data }) => {
    const operator = await requireNativeOperator(context);
    if ((operator.username ?? "").toUpperCase() !== data.username) {
      throw new Error("Usuário ou senha do RH inválidos.");
    }
    const { data: row } = await supabaseAdmin
      .from("users")
      .select("email")
      .eq("id", operator.id)
      .maybeSingle();
    if (!row?.email) throw new Error("Operador sem e-mail de acesso configurado.");
    const { createClient } = await import("@supabase/supabase-js");
    const check = createClient(
      process.env["SUPABASE_URL"]!,
      process.env["SUPABASE_ANON_KEY"] ?? process.env["SUPABASE_PUBLISHABLE_KEY"]!,
      { auth: { persistSession: false, autoRefreshToken: false, storage: undefined } },
    );
    const { error } = await check.auth.signInWithPassword({
      email: row.email,
      password: data.password,
    });
    if (error) throw new Error("Usuário ou senha do RH inválidos.");
    return { ok: true };
  });

export const getRhEmployee360 = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { employee_id: string }) => {
    if (!input?.employee_id) throw new Error("Funcionário inválido.");
    return input;
  })
  .handler(async ({ context, data }) => {
    await requireNativeOperator(context);
    const { data: employee, error } = await supabaseAdmin
      .from("rh_employees")
      .select("id, full_name, unit, registration_data, is_active, registry_employee_id, ponto_access_enabled, ponto_portal_user_id, dbs_control_access_enabled, dbs_control_base_id, dbs_control_can_issue_work_orders, created_at, updated_at")
      .eq("id", data.employee_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!employee) throw new Error("Funcionário não encontrado.");

    const [contracts, dependents, documents, events, access, benefits, pointRecords, payrollRuns, advances, auditLog] = await Promise.all([
      supabaseAdmin.from("rh_employee_contracts").select("*").eq("employee_id", data.employee_id).order("is_current", { ascending: false }).order("created_at", { ascending: false }),
      supabaseAdmin.from("rh_employee_dependents").select("*").eq("employee_id", data.employee_id).order("full_name"),
      supabaseAdmin.from("rh_employee_documents").select("*").eq("employee_id", data.employee_id).order("expires_at"),
      supabaseAdmin.from("rh_employee_events").select("*").eq("employee_id", data.employee_id).order("event_date", { ascending: false }).order("created_at", { ascending: false }).limit(100),
      supabaseAdmin.from("rh_employee_access").select("id, employee_id, user_id, access_enabled, login_identifier, created_at, updated_at").eq("employee_id", data.employee_id).maybeSingle(),
      supabaseAdmin.from("rh_employees").select("id, benefit_type, fare_cents, trips_per_day, benefit_configured, is_active, registry_employee_id").eq("registry_employee_id", data.employee_id),
      supabaseAdmin.from("rh_ponto_records").select("id, work_date, punch_type, punched_at, inside_radius, note").eq("employee_id", data.employee_id).order("punched_at", { ascending: false }).limit(100),
      supabaseAdmin.from("rh_payroll_runs").select("id, period_id, gross_cents, discount_cents, net_cents, fgts_base_cents, status, calculated_at").eq("employee_id", data.employee_id).order("calculated_at", { ascending: false }).limit(24),
      supabaseAdmin.from("rh_employee_advances").select("id, advance_type, description, amount_cents, competence, authorized, status, created_at").eq("employee_id", data.employee_id).order("competence", { ascending: false }).order("created_at", { ascending: false }),
      supabaseAdmin.from("rh_audit_log").select("id, action, entity_type, entity_id, actor_user_id, before_data, after_data, created_at").eq("employee_id", data.employee_id).order("created_at", { ascending: false }).limit(100),
    ]);
    for (const result of [contracts, dependents, documents, events, access, benefits, pointRecords, payrollRuns, advances, auditLog]) {
      if (result.error) throw new Error(result.error.message);
    }
    const benefitIds = (benefits.data ?? []).map((item: any) => item.id).filter(Boolean);
    const topupsResult = benefitIds.length
      ? await supabaseAdmin.from("rh_topups").select("id, benefit_type, employee_id, amount_cents, paid_at, created_at").in("employee_id", benefitIds).order("paid_at", { ascending: false })
      : { data: [], error: null };
    if (topupsResult.error) throw new Error(topupsResult.error.message);
    return {
      employee,
      contracts: contracts.data ?? [],
      dependents: dependents.data ?? [],
      documents: documents.data ?? [],
      events: events.data ?? [],
      access: access.data ?? null,
      benefits: benefits.data ?? [],
      benefitTopups: topupsResult.data ?? [],
      advances: advances.data ?? [],
      pointRecords: pointRecords.data ?? [],
      payrollRuns: payrollRuns.data ?? [],
      auditLog: auditLog.data ?? [],
    };
  });

export const saveRhEmployeeContract = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    id?: string;
    employee_id: string;
    contract_type?: string;
    admission_date?: string | null;
    termination_date?: string | null;
    department_id?: string | null;
    position_id?: string | null;
    salary_cents?: number | null;
    salary_effective_from?: string | null;
    work_regime?: string | null;
    weekly_hours?: number | null;
    work_shift?: string | null;
    notes?: string | null;
  }) => {
    if (!input?.employee_id) throw new Error("Funcionário inválido.");
    if (input.salary_cents != null && (!Number.isInteger(input.salary_cents) || input.salary_cents < 0)) {
      throw new Error("Salário inválido.");
    }
    return input;
  })
  .handler(async ({ context, data }) => {
    const operator = await requireNativeOperator(context);
    const { data: employee, error: employeeError } = await supabaseAdmin
      .from("rh_employees").select("id, is_active").eq("id", data.employee_id).maybeSingle();
    if (employeeError) throw new Error(employeeError.message);
    if (!employee) throw new Error("Funcionário não encontrado.");
    if (!employee.is_active) throw new Error("Não é possível criar contrato para funcionário inativo.");

    const payload = {
      employee_id: data.employee_id,
      contract_type: data.contract_type?.trim() || "CLT",
      admission_date: data.admission_date || null,
      termination_date: data.termination_date || null,
      department_id: data.department_id || null,
      position_id: data.position_id || null,
      salary_cents: data.salary_cents ?? null,
      salary_effective_from: data.salary_effective_from || null,
      work_regime: data.work_regime || null,
      weekly_hours: data.weekly_hours ?? null,
      work_shift: data.work_shift || null,
      notes: data.notes || null,
      is_current: true,
    };

    if (data.id) {
      const { data: current, error } = await supabaseAdmin.from("rh_employee_contracts")
        .select("*").eq("id", data.id).eq("employee_id", data.employee_id).maybeSingle();
      if (error) throw new Error(error.message);
      if (!current) throw new Error("Contrato não encontrado.");
      const { data: updated, error: updateError } = await supabaseAdmin.from("rh_employee_contracts")
        .update(payload).eq("id", data.id).select("*").single();
      if (updateError) throw new Error(updateError.message);
      await supabaseAdmin.from("rh_audit_log").insert({
        employee_id: data.employee_id, actor_user_id: operator.id, action: "CONTRATO_ATUALIZADO",
        entity_type: "rh_employee_contracts", entity_id: data.id, before_data: current, after_data: updated,
      });
      return updated;
    }

    await supabaseAdmin.from("rh_employee_contracts").update({ is_current: false }).eq("employee_id", data.employee_id).eq("is_current", true);
    const { data: created, error: createError } = await supabaseAdmin.from("rh_employee_contracts")
      .insert(payload).select("*").single();
    if (createError) throw new Error(createError.message);
    await supabaseAdmin.from("rh_audit_log").insert({
      employee_id: data.employee_id, actor_user_id: operator.id, action: "CONTRATO_CRIADO",
      entity_type: "rh_employee_contracts", entity_id: created.id, before_data: null, after_data: created,
    });
    return created;
  });

export const listRhEmployeeRegistry = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireNativeOperator(context);
    const { data, error } = await supabaseAdmin.from("rh_employees")
      .select("id, full_name, unit, registration_data, ficha_file_name, ficha_storage_path, ponto_portal_user_id, ponto_access_enabled, dbs_control_access_enabled, dbs_control_base_id, dbs_control_can_issue_work_orders, created_at, updated_at, is_active, registry_employee_id, benefit_configured, benefit_type")
      .order("full_name");
    if (error) throw new Error(error.message);
    const registry = (data ?? []).filter((employee: any) =>
      (employee.registry_employee_id === employee.id || (!employee.registry_employee_id && !employee.benefit_configured)) &&
      !Boolean(employee.registration_data && (employee.registration_data as any).__deleted_at)
    );
    const userIds = [...new Set(registry.map((e: any) => e.ponto_portal_user_id).filter(Boolean))];
    const users = userIds.length ? (((await supabaseAdmin.from("users").select("id, username, email, cpf, full_name, status, role_key").in("id", userIds)).data ?? []) as any[]) : [];
    const usersById = new Map(users.map((u) => [u.id, u]));
    const accessByEmployee = new Map(registry.filter((e: any) => e.ponto_portal_user_id).map((e: any) => [e.id, {
      employee_id: e.id, user_id: e.ponto_portal_user_id, access_enabled: Boolean(e.ponto_access_enabled), dbs_control_access_enabled: Boolean(e.dbs_control_access_enabled),
      login_identifier: usersById.get(e.ponto_portal_user_id)?.username ?? usersById.get(e.ponto_portal_user_id)?.email ?? null,
      user: usersById.get(e.ponto_portal_user_id) ?? null,
    }]));
    return registry.map((employee: any) => ({ ...employee, access: accessByEmployee.get(employee.id) ?? null }));
  });

export const saveRhEmployeeRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: EmployeeRecordInput & { id?: string }) => {
    if (!input?.full_name?.trim() || !input?.unit?.trim()) throw new Error("Informe nome e unidade do funcionário.");
    if (input.dbs_control_can_issue_work_orders && !input.dbs_control_base_id) {
      throw new Error("Para permitir emissão de OS, vincule primeiro uma base operacional DBS.");
    }
    return { ...input, id: input.id || undefined, full_name: input.full_name.trim(), unit: input.unit.trim(), registration_data: normalizeEmployeeRegistration(input.registration_data) };
  })
  .handler(async ({ context, data }) => {
    const actor = await requireNativeOperator(context);
    const base = await validateDbsControlBaseForOperator(actor, data.dbs_control_base_id);
    const registration = normalizeEmployeeRegistration(data.registration_data);
    const salaryCents = moneyToCents(registration.salary_cents ?? registration.salary);
    const weeklyHours = numberValue(registration.weekly_hours);
    const admissionDate = /^\d{4}-\d{2}-\d{2}$/.test(String(registration.admission_date ?? "")) ? String(registration.admission_date) : null;
    const entryTime = validTime(registration.entry_time);
    const exitTime = validTime(registration.exit_time);
    const lunchStart = validTime(registration.lunch_start);
    const lunchEnd = validTime(registration.lunch_end);
    if (data.id) {
      const { data: current, error: currentError } = await supabaseAdmin.from("rh_employees").select("*").eq("id", data.id).maybeSingle();
      if (currentError) throw new Error(currentError.message);
      if (!current) throw new Error("Funcionário não encontrado no Cadastro de Funcionários.");
      const { data: employee, error } = await supabaseAdmin.from("rh_employees").update({
        full_name: data.full_name, unit: data.unit, registration_data: registration as any, is_active: current.is_active,
        ponto_entrada_prevista: entryTime, ponto_saida_prevista: exitTime, ponto_almoco_inicio_previsto: lunchStart, ponto_almoco_fim_previsto: lunchEnd,
        dbs_control_base_id: base?.id ?? null,
        dbs_control_can_issue_work_orders: Boolean(data.dbs_control_can_issue_work_orders),
      } as any).eq("id", data.id).select("id, full_name, unit, registration_data, ficha_file_name, ficha_storage_path, created_at, updated_at, is_active, registry_employee_id, dbs_control_base_id, dbs_control_can_issue_work_orders").single();
      if (error) throw new Error(error.message);
      const { data: currentContract } = await supabaseAdmin.from("rh_employee_contracts").select("id").eq("employee_id", data.id).eq("is_current", true).order("created_at", { ascending: false }).limit(1).maybeSingle();
      const contractPayload = { employee_id: data.id, contract_type: String(registration.contract_type ?? "CLT"), admission_date: admissionDate, salary_cents: salaryCents, salary_effective_from: admissionDate, work_regime: String(registration.work_regime ?? "presencial"), weekly_hours: weeklyHours, work_shift: String(registration.work_shift ?? ""), notes: String(registration.notes ?? ""), is_current: true, updated_at: new Date().toISOString() };
      if (currentContract?.id) { const { error: contractError } = await supabaseAdmin.from("rh_employee_contracts").update(contractPayload).eq("id", currentContract.id); if (contractError) throw new Error(contractError.message); }
      else { const { error: contractError } = await supabaseAdmin.from("rh_employee_contracts").insert(contractPayload); if (contractError) throw new Error(contractError.message); }
      await supabaseAdmin.from("rh_audit_log").insert({ employee_id: data.id, actor_user_id: actor.id, action: "CADASTRO_FUNCIONARIO_ATUALIZADO", entity_type: "rh_employees", entity_id: data.id, before_data: current, after_data: employee });
      return employee;
    }
    const payload = { full_name: data.full_name, unit: data.unit, registration_data: registration ?? {}, is_active: true, registry_employee_id: null, ponto_entrada_prevista: entryTime, ponto_saida_prevista: exitTime, ponto_almoco_inicio_previsto: lunchStart, ponto_almoco_fim_previsto: lunchEnd, dbs_control_base_id: base?.id ?? null, dbs_control_can_issue_work_orders: Boolean(data.dbs_control_can_issue_work_orders) };
    const { data: created, error: createError } = await supabaseAdmin.from("rh_employees").insert({ ...payload, benefit_type: "alimentacao", fare_cents: 1, trips_per_day: 1, benefit_configured: false } as any).select("id, full_name, unit, registration_data, ficha_file_name, ficha_storage_path, created_at, updated_at, is_active, dbs_control_base_id, dbs_control_can_issue_work_orders").single();
    if (createError) throw new Error(createError.message);
    const { data: employee, error: linkError } = await supabaseAdmin.from("rh_employees").update({ registry_employee_id: created.id } as any).eq("id", created.id).select("id, full_name, unit, registration_data, ficha_file_name, ficha_storage_path, created_at, updated_at, is_active, registry_employee_id, dbs_control_base_id, dbs_control_can_issue_work_orders").single();
    if (linkError) throw new Error(linkError.message);
    const { error: contractError } = await supabaseAdmin.from("rh_employee_contracts").insert({ employee_id: employee.id, contract_type: String(registration.contract_type ?? "CLT"), admission_date: admissionDate, salary_cents: salaryCents, salary_effective_from: admissionDate, work_regime: String(registration.work_regime ?? "presencial"), weekly_hours: weeklyHours, work_shift: String(registration.work_shift ?? ""), notes: String(registration.notes ?? ""), is_current: true });
    if (contractError) throw new Error(contractError.message);
    await supabaseAdmin.from("rh_audit_log").insert({ employee_id: employee.id, actor_user_id: actor.id, action: "CADASTRO_FUNCIONARIO_CRIADO", entity_type: "rh_employees", entity_id: employee.id, before_data: null, after_data: employee });
    return employee;
  });
export const getRhDashboardAlerts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireNativeOperator(context);

    const [employeesResult, accessResult, requestsResult, advancesResult, documentsResult, contractsResult, pointResult] = await Promise.all([
      supabaseAdmin.from("rh_employees")
        .select("id, full_name, unit, is_active, registration_data, ponto_access_enabled, ponto_portal_user_id, registry_employee_id")
        .order("full_name"),
      supabaseAdmin.from("rh_employee_access").select("employee_id, access_enabled"),
      supabaseAdmin.from("rh_employee_requests").select("id, employee_id, request_type, status, requested_at, payload")
        .in("status", ["aberta", "em_analise"]).order("requested_at", { ascending: false }).limit(100),
      supabaseAdmin.from("rh_employee_advances").select("id, employee_id, amount_cents, competence, status, authorized")
        .eq("status", "programado").eq("authorized", true).order("competence", { ascending: true }),
      supabaseAdmin.from("rh_employee_documents").select("id, employee_id, document_type, expires_at, status")
        .not("expires_at", "is", null).order("expires_at", { ascending: true }).limit(100),
      supabaseAdmin.from("rh_employee_contracts").select("employee_id, is_current, salary_cents, weekly_hours")
        .eq("is_current", true),
      supabaseAdmin.from("rh_ponto_records").select("id, employee_id, work_date, punch_type")
        .order("work_date", { ascending: false }).limit(500),
    ]);
    for (const result of [employeesResult, accessResult, requestsResult, advancesResult, documentsResult, contractsResult, pointResult]) {
      if (result.error) throw new Error(result.error.message);
    }

    const employees = (employeesResult.data ?? []).filter((e: any) => !e.registry_employee_id || e.registry_employee_id === e.id);
    const activeEmployees = employees.filter((e: any) => e.is_active);
    const employeeById = new Map(employees.map((e: any) => [e.id, e]));
    const linkedIds = new Set((accessResult.data ?? []).filter((a: any) => a.access_enabled).map((a: any) => a.employee_id));
    const requests = requestsResult.data ?? [];
    const advances = advancesResult.data ?? [];
    const documents = documentsResult.data ?? [];
    const contracts = contractsResult.data ?? [];
    const point = pointResult.data ?? [];
    const today = new Date();
    const inDays = (value: string, days: number) => {
      const d = new Date(value + "T12:00:00");
      const target = new Date(today);
      target.setHours(12, 0, 0, 0);
      return d.getTime() <= target.getTime() + days * 86400000;
    };

    const noAccess = activeEmployees.filter((e: any) => !linkedIds.has(e.id) && !e.ponto_access_enabled);
    const incompleteRegistration = activeEmployees.filter((e: any) => {
      const r = (e.registration_data ?? {}) as Record<string, any>;
      return !r.cpf || !r.job_title || !r.admission_date || !r.salary_cents;
    });
    const incompleteContract = activeEmployees.filter((e: any) => !contracts.some((c: any) => c.employee_id === e.id && c.salary_cents != null && c.weekly_hours != null));
    const documentAlerts = documents.filter((d: any) => d.expires_at && inDays(String(d.expires_at), 30) && d.status !== "cancelado");
    return {
      totals: {
        activeEmployees: activeEmployees.length,
        inactiveEmployees: employees.filter((e: any) => !e.is_active).length,
        linkedAccess: activeEmployees.filter((e: any) => linkedIds.has(e.id) || e.ponto_access_enabled).length,
        openRequests: requests.length,
        pendingAdvances: advances.length,
        expiringDocuments: documentAlerts.length,
        incompleteRegistration: incompleteRegistration.length,
        incompleteContract: incompleteContract.length,
      },
      alerts: {
        noAccess: noAccess.slice(0, 8).map((e: any) => ({ id: e.id, name: e.full_name, unit: e.unit })),
        incompleteRegistration: incompleteRegistration.slice(0, 8).map((e: any) => ({ id: e.id, name: e.full_name, unit: e.unit })),
        incompleteContract: incompleteContract.slice(0, 8).map((e: any) => ({ id: e.id, name: e.full_name, unit: e.unit })),
        requests: requests.slice(0, 8).map((r: any) => ({ id: r.id, employee_id: r.employee_id, name: employeeById.get(r.employee_id)?.full_name ?? "Funcionário", type: r.request_type, requested_at: r.requested_at, payload: r.payload })),
        advances: advances.slice(0, 8).map((a: any) => ({ id: a.id, employee_id: a.employee_id, name: employeeById.get(a.employee_id)?.full_name ?? "Funcionário", amount_cents: a.amount_cents, competence: a.competence, status: a.status })),
        documents: documentAlerts.slice(0, 8).map((d: any) => ({ id: d.id, employee_id: d.employee_id, name: employeeById.get(d.employee_id)?.full_name ?? "Funcionário", document_type: d.document_type, expires_at: d.expires_at })),
      },
    };
  });

export const getMyEmployeePortalAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: user, error: userError } = await supabaseAdmin.from("users")
      .select("id, role_key, status, email").eq("auth_id", context.userId).maybeSingle();
    if (userError) throw new Error(userError.message);
    if (!user || user.status !== "ativo") return { enabled: false, employee: null };
    if (user.role_key === "SUPER_ADMIN" || user.role_key === "ADMIN_OPERACIONAL") return { enabled: false, employee: null };
    const { data: employee, error } = await supabaseAdmin.from("rh_employees")
      .select("id, full_name, unit, is_active").eq("ponto_portal_user_id", user.id)
      .eq("ponto_access_enabled", true).eq("is_active", true).maybeSingle();
    if (error) throw new Error(error.message);
    return { enabled: Boolean(employee), employee: employee ? { id: employee.id, full_name: employee.full_name, unit: employee.unit } : null };
  });

export const listRhCollaboratorUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireNativeOperator(context);
    const { data, error } = await supabaseAdmin.from("users").select("id, auth_id, username, email, cpf, full_name, status, role_key")
      .eq("role_key", "COLABORADOR").eq("status", "ativo").order("full_name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const saveRhEmployeeAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { employee_id: string; enabled: boolean; login_identifier?: string; user_id?: string; dbs_control_enabled?: boolean }) => {
    if (!input?.employee_id) throw new Error("Funcionário inválido.");
    if ((input.enabled || input.dbs_control_enabled) && !input.login_identifier?.trim()) throw new Error("Informe o login criado no menu Usuários vinculados.");
    if ((input.enabled || input.dbs_control_enabled) && !input.user_id?.trim()) throw new Error("Selecione o usuário exato criado em Usuários vinculados.");
    if (input.dbs_control_enabled && !input.enabled) throw new Error("O DBS CONTROL exige acesso à Folha de Ponto no mesmo login.");
    return { ...input, login_identifier: input.login_identifier?.trim() || undefined, user_id: input.user_id?.trim() || undefined, dbs_control_enabled: Boolean(input.dbs_control_enabled) };
  })
  .handler(async ({ context, data }) => {
    const operator = await requireNativeOperator(context);
    const { data: employee, error: employeeError } = await supabaseAdmin.from("rh_employees")
      .select("id, full_name, unit, is_active, registry_employee_id, ponto_access_enabled, ponto_portal_user_id").eq("id", data.employee_id).eq("is_active", true).maybeSingle();
    if (employeeError) throw new Error(employeeError.message);
    if (!employee) throw new Error("Funcionário não encontrado ou inativo.");
    if (!data.enabled) {
      const { data: linked, error: linkedError } = await supabaseAdmin
        .from("rh_employees")
        .select("ponto_portal_user_id, dbs_control_access_enabled")
        .eq("id", data.employee_id)
        .maybeSingle();
      if (linkedError) throw new Error(linkedError.message);

      const { error } = await supabaseAdmin.from("rh_employees")
        .update({ ponto_access_enabled: false, dbs_control_access_enabled: data.dbs_control_enabled })
        .eq("id", data.employee_id);
      if (error) throw new Error(error.message);

      // Mantém a tabela de acesso dedicada sincronizada com o cadastro central.
      const { data: existingAccessRows, error: existingAccessError } = await supabaseAdmin
        .from("rh_employee_access")
        .select("id")
        .eq("employee_id", data.employee_id)
        .limit(50);
      if (existingAccessError) throw new Error(existingAccessError.message);
      if (existingAccessRows?.length) {
        const { error: accessUpdateError } = await supabaseAdmin.from("rh_employee_access")
          .update({ access_enabled: false })
          .eq("employee_id", data.employee_id);
        if (accessUpdateError) throw new Error(accessUpdateError.message);
      }

      await supabaseAdmin.from("rh_ponto_audit").insert({
        employee_id: data.employee_id,
        actor_user_id: operator.id,
        action: "ACESSO_FUNCIONARIO_REVOGADO",
        details: { user_id: linked?.ponto_portal_user_id ?? null },
      });
      await supabaseAdmin.from("rh_audit_log").insert({
        employee_id: data.employee_id,
        actor_user_id: operator.id,
        action: "ACESSO_FUNCIONARIO_REVOGADO",
        entity_type: "rh_employee_access",
        entity_id: existingAccessRows?.[0]?.id ?? data.employee_id,
        after_data: { access_enabled: false, login_identifier_preserved: true, user_id: linked?.ponto_portal_user_id ?? null },
      });
      return { ok: true, enabled: false, user: null, initial_password: null };
    }
    const identifier = data.login_identifier!;
    let appUser: any = null;
    let userError: any = null;

    // O vínculo deve usar o ID interno do usuário, não um texto (username/e-mail)
    // que pode mudar ou até coincidir com outro cadastro.
    if (data.user_id) {
      const result = await supabaseAdmin
        .from("users")
        .select("id, auth_id, username, email, cpf, full_name, role_key, status")
        .eq("id", data.user_id)
        .maybeSingle();
      appUser = result.data;
      userError = result.error;
    } else {
      const digits = identifier.replace(/\D/g, "");
      const isEmail = identifier.includes("@");
      let query = supabaseAdmin.from("users").select("id, auth_id, username, email, cpf, full_name, role_key, status").limit(1);
      if (isEmail) query = query.ilike("email", identifier);
      else if (digits.length === 11) query = query.eq("cpf", digits);
      else query = query.ilike("username", identifier);
      const result = await query.maybeSingle();
      appUser = result.data;
      userError = result.error;
    }
    if (userError) throw new Error(userError.message);
    if (!appUser) throw new Error("Usuário não encontrado. Crie primeiro o acesso em Usuários vinculados.");
    if (appUser.status !== "ativo") throw new Error("O usuário encontrado está inativo.");
    if (!appUser.auth_id) throw new Error("Este usuário ainda não possui uma conta de login autenticável. Recrie/complete o acesso em Usuários vinculados antes de vincular ao RH.");
    if (["SUPER_ADMIN", "ADMIN_OPERACIONAL"].includes(appUser.role_key)) throw new Error("Este login pertence a um administrador e não pode ser vinculado ao funcionário.");
    if (appUser.role_key !== "COLABORADOR") throw new Error("O usuário precisa estar classificado como COLABORADOR em Usuários vinculados.");
    const { data: currentLink, error: currentLinkError } = await supabaseAdmin
      .from("rh_employees")
      .select("id, full_name")
      .eq("ponto_portal_user_id", appUser.id)
      .eq("ponto_access_enabled", true)
      .neq("id", data.employee_id)
      .limit(1);
    if (currentLinkError) throw new Error(currentLinkError.message);
    if (currentLink?.length) {
      throw new Error(`Este usuário já está vinculado ao funcionário ${currentLink[0].full_name}.`);
    }
    const { data: accessUserLink, error: accessUserLinkError } = await supabaseAdmin
      .from("rh_employee_access")
      .select("employee_id")
      .eq("user_id", appUser.id)
      .eq("access_enabled", true)
      .neq("employee_id", data.employee_id)
      .limit(1);
    if (accessUserLinkError) throw new Error(accessUserLinkError.message);
    if (accessUserLink?.length) {
      throw new Error("Este login já está vinculado a outro funcionário do RH.");
    }

    const { error: updateError } = await supabaseAdmin.from("rh_employees")
      .update({ ponto_access_enabled: true, ponto_portal_user_id: appUser.id, dbs_control_access_enabled: data.dbs_control_enabled }).eq("id", data.employee_id);
    if (updateError) throw new Error(updateError.message);

    // O portal do colaborador consulta esta relação. Sem ela, o botão pode
    // parecer salvo no cadastro, mas o colaborador continua sem vínculo.
    const { data: accessRows, error: accessRowsError } = await supabaseAdmin
      .from("rh_employee_access")
      .select("id, employee_id, user_id, access_enabled, login_identifier, updated_at, created_at")
      .eq("employee_id", data.employee_id)
      .order("updated_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(20);
    if (accessRowsError) throw new Error(accessRowsError.message);

    const currentAccess = accessRows?.[0] ?? null;
    const sameActiveLink = Boolean(
      currentAccess?.access_enabled &&
      currentAccess.user_id === appUser.id &&
      currentAccess.employee_id === data.employee_id &&
      employee.ponto_access_enabled &&
      employee.ponto_portal_user_id === appUser.id
    );

    if (sameActiveLink) {
      return {
        ok: true,
        enabled: true,
        already_linked: true,
        dbs_control_enabled: data.dbs_control_enabled,
        user: { id: appUser.id, username: appUser.username, email: appUser.email },
        initial_password: null,
      };
    }

    // Mantém somente um vínculo ativo para este funcionário. Registros antigos,
    // se existirem por versões anteriores do sistema, são preservados como inativos.
    const { error: deactivateOldAccessError } = await supabaseAdmin
      .from("rh_employee_access")
      .update({ access_enabled: false })
      .eq("employee_id", data.employee_id)
      .eq("access_enabled", true);
    if (deactivateOldAccessError) throw new Error(deactivateOldAccessError.message);

    const accessPayload = {
      employee_id: data.employee_id,
      user_id: appUser.id,
      access_enabled: true,
      login_identifier: identifier,
    };

    if (currentAccess?.id) {
      const { error: accessUpdateError } = await supabaseAdmin.from("rh_employee_access")
        .update(accessPayload)
        .eq("id", currentAccess.id);
      if (accessUpdateError) throw new Error(accessUpdateError.message);
    } else {
      const { error: accessInsertError } = await supabaseAdmin.from("rh_employee_access")
        .insert(accessPayload);
      if (accessInsertError) throw new Error(accessInsertError.message);
    }

    await supabaseAdmin.from("rh_ponto_audit").insert({ employee_id: data.employee_id, actor_user_id: operator.id, action: "ACESSO_FUNCIONARIO_LIBERADO", details: { login_identifier: identifier, user_id: appUser.id } });
    await supabaseAdmin.from("rh_audit_log").insert({
      employee_id: data.employee_id,
      actor_user_id: operator.id,
      action: "ACESSO_FUNCIONARIO_LIBERADO",
      entity_type: "rh_employee_access",
      entity_id: accessRows?.[0]?.id ?? data.employee_id,
      after_data: { access_enabled: true, login_identifier: identifier, user_id: appUser.id, dbs_control_access_enabled: data.dbs_control_enabled },
    });
    return { ok: true, enabled: true, dbs_control_enabled: data.dbs_control_enabled, user: { id: appUser.id, username: appUser.username, email: appUser.email }, initial_password: null };
  });

export const hasMyDbsControlAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: user, error } = await supabaseAdmin.from("users")
      .select("id, role_key, status, email").eq("auth_id", context.userId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!user || user.status !== "ativo") return { enabled: false, employee: null };
    if (user.role_key === "SUPER_ADMIN" || user.role_key === "ADMIN_OPERACIONAL") {
      return { enabled: true, employee: null, administrative: true };
    }
    const { data: employee, error: employeeError } = await supabaseAdmin.from("rh_employees")
      .select("id, full_name, unit, dbs_control_access_enabled, dbs_control_base_id, dbs_control_can_issue_work_orders, is_active")
      .eq("ponto_portal_user_id", user.id)
      .eq("dbs_control_access_enabled", true)
      .eq("is_active", true)
      .maybeSingle();
    if (employeeError) throw new Error(employeeError.message);
    let resolvedEmployee: any = employee;
    if (!resolvedEmployee) {
      const { data: access, error: accessError } = await supabaseAdmin.from("rh_employee_access")
        .select("employee_id")
        .eq("user_id", user.id)
        .eq("access_enabled", true)
        .maybeSingle();
      if (accessError) throw new Error(accessError.message);
      if (access?.employee_id) {
        const fallback = await supabaseAdmin.from("rh_employees")
          .select("id, full_name, unit, dbs_control_access_enabled, dbs_control_base_id, dbs_control_can_issue_work_orders, is_active")
          .eq("id", access.employee_id)
          .eq("dbs_control_access_enabled", true)
          .eq("is_active", true)
          .maybeSingle();
        if (fallback.error) throw new Error(fallback.error.message);
        resolvedEmployee = fallback.data;
      }
    }
    let baseName: string | null = null;
    let baseActive = false;
    if (resolvedEmployee?.dbs_control_base_id) {
      const { data: base, error: baseError } = await (supabaseAdmin as any).from("dbs_control_bases")
        .select("id, name, status")
        .eq("id", resolvedEmployee.dbs_control_base_id)
        .maybeSingle();
      if (baseError) throw new Error(baseError.message);
      const baseStatus = String(base?.status ?? "").trim().toLocaleLowerCase("pt-BR");
      baseActive = baseStatus === "ativo";
      // O nome é somente apresentação. A autorização depende do ID vinculado,
      // da existência da base e do seu estado ativo; uma base sem nome não
      // pode esconder a ferramenta nem interromper o fluxo autorizado.
      baseName = baseActive ? String(base?.name ?? "").trim() : null;
    }
    return {
      enabled: Boolean(resolvedEmployee),
      employee: resolvedEmployee ? {
        id: resolvedEmployee.id,
        full_name: resolvedEmployee.full_name,
        unit: resolvedEmployee.unit,
        email: user.email ?? null,
        base_id: resolvedEmployee.dbs_control_base_id ?? null,
        base_name: baseName,
        base_active: baseActive,
        can_issue_work_orders: Boolean(resolvedEmployee.dbs_control_can_issue_work_orders && baseActive),
      } : null,
      administrative: false,
    };
  });

export const listRhEmployeeAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireNativeOperator(context);
    const { data, error } = await supabaseAdmin.from("rh_employees")
      .select("id, ponto_portal_user_id, ponto_access_enabled, dbs_control_access_enabled").eq("is_active", true).eq("ponto_access_enabled", true);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => ({ id: row.id, employee_id: row.id, user_id: row.ponto_portal_user_id, access_enabled: row.ponto_access_enabled, dbs_control_access_enabled: Boolean(row.dbs_control_access_enabled) }));
  });

export const uploadRhEmployeeFicha = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { employee_id: string; file_name: string; data_base64: string }) => {
    if (!input?.employee_id || !input.file_name || !input.data_base64)
      throw new Error("Ficha inválida.");
    if (!input.file_name.toLowerCase().endsWith(".pdf"))
      throw new Error("A ficha deve estar no formato PDF.");
    return input;
  })
  .handler(async ({ context, data }) => {
    await requireNativeOperator(context);
    const binary = Buffer.from(data.data_base64, "base64");
    if (!binary.length || binary.length > 15 * 1024 * 1024)
      throw new Error("A ficha deve ter entre 1 byte e 15 MB.");
    const safeName = data.file_name.replace(/[^\w.\-]+/g, "_");
    const path = `rh-employees/${data.employee_id}/${Date.now()}-${safeName}`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from("rh-files")
      .upload(path, binary, { contentType: "application/pdf", upsert: false });
    if (uploadError) throw new Error(uploadError.message);
    const { error } = await supabaseAdmin
      .from("rh_employees")
      .update({ ficha_file_name: data.file_name, ficha_storage_path: path })
      .eq("id", data.employee_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getRhEmployeeFichaUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { employee_id: string }) => {
    if (!input?.employee_id) throw new Error("Funcionário inválido.");
    return input;
  })
  .handler(async ({ context, data }) => {
    await requireNativeOperator(context);
    const { data: employee, error } = await supabaseAdmin
      .from("rh_employees")
      .select("ficha_storage_path, ficha_file_name")
      .eq("id", data.employee_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!employee?.ficha_storage_path) throw new Error("Nenhuma ficha anexada.");
    const signed = await supabaseAdmin.storage
      .from("rh-files")
      .createSignedUrl(employee.ficha_storage_path, 3600);
    if (!signed.data?.signedUrl)
      throw new Error(signed.error?.message ?? "Não foi possível gerar o download.");
    return { url: signed.data.signedUrl, file_name: employee.ficha_file_name };
  });

export const permanentlyRemoveRhEmployeeRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; confirmation: string }) => {
    if (!input?.id || input.confirmation !== "EXCLUIR CADASTRO") throw new Error("Confirmação de exclusão inválida.");
    return input;
  })
  .handler(async ({ context, data }) => {
    const actor = await requireNativeOperator(context);
    const { data: employee, error } = await supabaseAdmin.from("rh_employees")
      .select("id, full_name, is_active, registration_data, registry_employee_id, ponto_portal_user_id")
      .eq("id", data.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!employee) throw new Error("Funcionário não encontrado.");
    if (employee.registry_employee_id && employee.registry_employee_id !== employee.id) {
      throw new Error("Este registro é um vínculo auxiliar de benefício. Exclua-o pela área do benefício para preservar o cadastro mestre.");
    }
    const registration = employee.registration_data && typeof employee.registration_data === "object"
      ? employee.registration_data as Record<string, unknown> : {};
    const linkedUserId = String(employee.ponto_portal_user_id ?? "").trim();
    let linkedUser: { id: string; auth_id: string | null; role_key: string | null } | null = null;
    if (linkedUserId) {
      const { data: user, error: userError } = await supabaseAdmin.from("users")
        .select("id, auth_id, role_key")
        .eq("id", linkedUserId).maybeSingle();
      if (userError) throw new Error("Não foi possível localizar o login vinculado: " + userError.message);
      linkedUser = user;
    }
    if (linkedUser?.role_key === "COLABORADOR") {
      const { error: userBlockError } = await supabaseAdmin.from("users").update({ status: "bloqueado" }).eq("id", linkedUser.id);
      if (userBlockError) throw new Error("O login não pôde ser bloqueado antes da remoção: " + userBlockError.message);
    }
    const nextRegistration = { ...registration, __deleted_at: new Date().toISOString(), __deleted_by: actor.id };
    const { error: updateError } = await supabaseAdmin.from("rh_employees").update({
      is_active: false, ponto_access_enabled: false, dbs_control_access_enabled: false,
      ponto_portal_user_id: null, registration_data: nextRegistration,
    }).eq("id", employee.id);
    if (updateError) throw new Error(updateError.message);
    const { error: accessError } = await supabaseAdmin.from("rh_employee_access")
      .update({ access_enabled: false })
      .eq("employee_id", employee.id);
    if (accessError) throw new Error("Cadastro removido, mas não foi possível revogar o vínculo de acesso: " + accessError.message);
    if (linkedUser?.role_key === "COLABORADOR") {
      if (linkedUser.auth_id) {
        const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(linkedUser.auth_id);
        if (authError && !/not found|user.*does not exist|already.*removed/i.test(authError.message)) {
          throw new Error("Cadastro removido e login bloqueado, mas a identidade Auth não pôde ser removida: " + authError.message);
        }
      }
    }
    await supabaseAdmin.from("rh_ponto_audit").insert({
      employee_id: employee.id, actor_user_id: actor.id, action: "CADASTRO_FUNCIONARIO_EXCLUIDO_DA_LISTA",
      details: { full_name: employee.full_name, linked_user_id: linkedUser?.id ?? null, preserved_as_history: true },
    });
    return { ok: true };
  });

export const removeRhEmployeeFromRegistry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; confirmation: string }) => {
    if (!input?.id || input.confirmation !== "EXCLUIR CADASTRO") throw new Error("Confirmação de exclusão inválida.");
    return input;
  })
  .handler(async ({ context, data }) => {
    const actor = await requireNativeOperator(context);
    const { data: employee, error } = await supabaseAdmin.from("rh_employees")
      .select("id, full_name, registration_data, registry_employee_id, ponto_portal_user_id")
      .eq("id", data.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!employee) throw new Error("Funcionário não encontrado.");
    if (employee.registry_employee_id && employee.registry_employee_id !== employee.id) {
      throw new Error("Este registro é auxiliar de benefício. Remova-o pela área do benefício.");
    }
    const linkedUserId = String(employee.ponto_portal_user_id ?? "").trim();
    let linkedUser: { id: string; auth_id: string | null; role_key: string | null; status: string | null } | null = null;
    if (linkedUserId) {
      const { data: user, error: userError } = await supabaseAdmin.from("users")
        .select("id, auth_id, role_key, status")
        .eq("id", linkedUserId).maybeSingle();
      if (userError) throw new Error("Não foi possível localizar o login vinculado: " + userError.message);
      linkedUser = user;
    }
    if (linkedUser && linkedUser.role_key === "COLABORADOR") {
      const { error: userBlockError } = await supabaseAdmin.from("users")
        .update({ status: "bloqueado" })
        .eq("id", linkedUser.id);
      if (userBlockError) throw new Error("O login não pôde ser bloqueado antes da remoção: " + userBlockError.message);
    }
    const registration = employee.registration_data && typeof employee.registration_data === "object"
      ? employee.registration_data as Record<string, unknown> : {};
    const { error: updateError } = await supabaseAdmin.from("rh_employees").update({
      is_active: false,
      ponto_access_enabled: false,
      dbs_control_access_enabled: false,
      ponto_portal_user_id: null,
      registration_data: { ...registration, __deleted_at: new Date().toISOString(), __deleted_by: actor.id },
    }).eq("id", employee.id);
    if (updateError) throw new Error(updateError.message);

    // Um colaborador removido do cadastro não pode continuar entrando pelo
    // portal geral. Revogamos também o vínculo dedicado e o perfil de login,
    // mas preservamos todas as linhas históricas de RH/OS/auditoria.
    const { error: accessError } = await supabaseAdmin.from("rh_employee_access")
      .update({ access_enabled: false })
      .eq("employee_id", employee.id);
    if (accessError) throw new Error("Cadastro removido, mas não foi possível revogar o vínculo de acesso: " + accessError.message);
    if (linkedUser && linkedUser.role_key === "COLABORADOR") {
      if (linkedUser.auth_id) {
        const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(linkedUser.auth_id);
        if (authError && !/not found|user.*does not exist|already.*removed/i.test(authError.message)) {
          throw new Error("Cadastro removido e login bloqueado, mas a identidade Auth não pôde ser removida: " + authError.message);
        }
      }
      const { error: userAuditError } = await supabaseAdmin.from("audit_log").insert({
        actor_user_id: actor.id,
        target_user_id: linkedUser.id,
        action: "permanently_removed_user_access",
        metadata_json: { previous_role: linkedUser.role_key, linked_employee_id: employee.id, preserved_history: true, at: new Date().toISOString() },
      });
      if (userAuditError) throw new Error("Acesso removido, mas a auditoria do login falhou: " + userAuditError.message);
    }
    await supabaseAdmin.from("rh_ponto_audit").insert({
      employee_id: employee.id, actor_user_id: actor.id,
      action: "CADASTRO_FUNCIONARIO_REMOVIDO_DA_LISTA",
      details: { full_name: employee.full_name, linked_user_id: linkedUser?.id ?? null, history_preserved: true },
    });
    return { ok: true, linked_user_id: linkedUser?.id ?? null };
  });

export const deactivateRhEmployeeRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    if (!input?.id) throw new Error("Funcionário inválido.");
    return input;
  })
  .handler(async ({ context, data }) => {
    await requireNativeOperator(context);
    const { data: employee, error: currentError } = await supabaseAdmin
      .from("rh_employees")
      .select("id, full_name, is_active, ponto_portal_user_id")
      .eq("id", data.id)
      .maybeSingle();
    if (currentError) throw new Error(currentError.message);
    if (!employee) throw new Error("Funcionário não encontrado no Cadastro de Funcionários.");

    const { error } = await supabaseAdmin.from("rh_employees")
      .update({ is_active: false, ponto_access_enabled: false, dbs_control_access_enabled: false })
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("rh_ponto_audit").insert({
      employee_id: data.id,
      actor_user_id: null,
      action: "FUNCIONARIO_INATIVADO",
      details: { full_name: employee.full_name, user_id: employee.ponto_portal_user_id ?? null },
    });
    return { ok: true };
  });
