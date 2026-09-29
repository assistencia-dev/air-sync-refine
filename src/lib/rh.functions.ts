import { createServerFn } from "@tanstack/react-start";
import { randomBytes } from "node:crypto";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type RhBenefitType = "passagem" | "alimentacao";

type RhInput = { benefit_type: RhBenefitType };

async function requireNativeOperator(context: { userId: string }) {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id, username, status")
    .eq("auth_id", context.userId)
    .maybeSingle();
  if (
    error ||
    !data ||
    data.status !== "ativo" ||
    !["DBS123", "DBSASSISTENCIA123"].includes(data.username ?? "")
  ) {
    throw new Error("Acesso restrito ao operador nativo DBS.");
  }
  return data;
}

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
      .order("full_name");
    if (error) throw new Error(error.message);
    return employees ?? [];
  });

export const listRhEmployeeRegistry = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireNativeOperator(context);
    const { data, error } = await supabaseAdmin
      .from("rh_employees")
      .select("id, full_name, unit, registration_data, ficha_file_name, ficha_storage_path, ponto_portal_user_id, ponto_access_enabled, created_at, updated_at, is_active, registry_employee_id")
      .order("full_name");
    if (error) throw new Error(error.message);

    const registry = (data ?? []).filter((employee: any) => employee.registry_employee_id === employee.id);
    const userIds = [...new Set(registry.map((e: any) => e.ponto_portal_user_id).filter(Boolean))];
    const users = userIds.length
      ? (((await supabaseAdmin.from("users").select("id, username, email, cpf, full_name, status, role_key").in("id", userIds)).data ?? []) as any[])
      : [];
    const usersById = new Map(users.map((u) => [u.id, u]));
    const accessByEmployee = new Map(registry.filter((e: any) => e.ponto_portal_user_id).map((e: any) => [e.id, {
      employee_id: e.id,
      user_id: e.ponto_portal_user_id,
      access_enabled: Boolean(e.ponto_access_enabled),
      login_identifier: usersById.get(e.ponto_portal_user_id)?.username ?? usersById.get(e.ponto_portal_user_id)?.email ?? null,
      user: usersById.get(e.ponto_portal_user_id) ?? null,
    }]));

    return registry.map((employee: any) => ({
      ...employee,
      access: accessByEmployee.get(employee.id) ?? null,
    }));
  });

export const saveRhEmployeeRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: EmployeeRecordInput & { id?: string }) => {
    if (!input?.full_name?.trim() || !input?.unit?.trim())
      throw new Error("Informe nome e unidade do funcionário.");
    return {
      ...input,
      id: input.id || undefined,
      full_name: input.full_name.trim(),
      unit: input.unit.trim(),
    };
  })
  .handler(async ({ context, data }) => {
    await requireNativeOperator(context);
    const payload = {
      full_name: data.full_name,
      unit: data.unit,
      registration_data: data.registration_data,
      is_active: true,
    };
    if (data.id) {
      const { data: employee, error } = await supabaseAdmin
        .from("rh_employees")
        .update(payload)
        .eq("id", data.id)
        .select("id, full_name, unit, registration_data, ficha_file_name, ficha_storage_path, created_at, updated_at, is_active, registry_employee_id")
        .single();
      if (error) throw new Error(error.message);
      return employee;
    }

    const { data: created, error: createError } = await supabaseAdmin
      .from("rh_employees")
      .insert({ ...payload, benefit_type: "alimentacao", fare_cents: 1, trips_per_day: 1, benefit_configured: false })
      .select("id, full_name, unit, registration_data, ficha_file_name, ficha_storage_path, created_at, updated_at, is_active")
      .single();
    if (createError) throw new Error(createError.message);

    const { data: employee, error: linkError } = await supabaseAdmin
      .from("rh_employees")
      .update({ registry_employee_id: created.id })
      .eq("id", created.id)
      .select("id, full_name, unit, registration_data, ficha_file_name, ficha_storage_path, created_at, updated_at, is_active, registry_employee_id")
      .single();
    if (linkError) throw new Error(linkError.message);
    return employee;  });

export const getMyEmployeePortalAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: user, error: userError } = await supabaseAdmin.from("users")
      .select("id, role_key, status").eq("auth_id", context.userId).maybeSingle();
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
    const { data, error } = await supabaseAdmin
      .from("users")
      .select("id, username, email, cpf, full_name, status, role_key")
      .eq("role_key", "COLABORADOR")
      .eq("status", "ativo")
      .order("full_name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const saveRhEmployeeAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { employee_id: string; enabled: boolean; login_identifier?: string }) => {
    if (!input?.employee_id) throw new Error("Funcionário inválido.");
    if (input.enabled && !input.login_identifier?.trim()) throw new Error("Informe o login criado no menu Usuários vinculados.");
    return { ...input, login_identifier: input.login_identifier?.trim() || undefined };
  })
  .handler(async ({ context, data }) => {
    const operator = await requireNativeOperator(context);
    const { data: employee, error: employeeError } = await supabaseAdmin.from("rh_employees")
      .select("id, full_name, unit, is_active, registry_employee_id").eq("id", data.employee_id).eq("registry_employee_id", data.employee_id).eq("is_active", true).maybeSingle();
    if (employeeError) throw new Error(employeeError.message);
    if (!employee) throw new Error("Funcionário não encontrado ou inativo.");
    if (!data.enabled) {
      const { error } = await supabaseAdmin.from("rh_employees").update({ ponto_access_enabled: false, ponto_portal_user_id: null }).eq("id", data.employee_id);
      if (error) throw new Error(error.message);
      await supabaseAdmin.from("rh_ponto_audit").insert({ employee_id: data.employee_id, actor_user_id: operator.id, action: "ACESSO_FUNCIONARIO_REVOGADO", details: {} });
      return { ok: true, enabled: false, user: null, initial_password: null };
    }
    const identifier = data.login_identifier!;
    const digits = identifier.replace(/\\D/g, "");
    const isEmail = identifier.includes("@");
    let query = supabaseAdmin.from("users").select("id, username, email, cpf, full_name, role_key, status").limit(1);
    if (isEmail) query = query.ilike("email", identifier);
    else if (digits.length === 11) query = query.eq("cpf", digits);
    else query = query.ilike("username", identifier);
    const { data: appUser, error: userError } = await query.maybeSingle();
    if (userError) throw new Error(userError.message);
    if (!appUser) throw new Error("Usuário não encontrado. Crie primeiro o acesso em Usuários vinculados.");
    if (appUser.status !== "ativo") throw new Error("O usuário encontrado está inativo.");
    if (["SUPER_ADMIN", "ADMIN_OPERACIONAL"].includes(appUser.role_key)) throw new Error("Este login pertence a um administrador e não pode ser vinculado ao funcionário.");
    if (appUser.role_key !== "COLABORADOR") throw new Error("O usuário precisa estar classificado como COLABORADOR em Usuários vinculados.");
    const { data: currentLink } = await supabaseAdmin.from("rh_employees").select("id")
      .eq("ponto_portal_user_id", appUser.id).eq("ponto_access_enabled", true).neq("registry_employee_id", data.employee_id).limit(1);
    if (currentLink?.length) throw new Error("Este usuário já está vinculado a outro funcionário.");
    const { error: updateError } = await supabaseAdmin.from("rh_employees")
      .update({ ponto_access_enabled: true, ponto_portal_user_id: appUser.id }).eq("id", data.employee_id);
    if (updateError) throw new Error(updateError.message);
    await supabaseAdmin.from("rh_ponto_audit").insert({ employee_id: data.employee_id, actor_user_id: operator.id, action: "ACESSO_FUNCIONARIO_LIBERADO", details: { login_identifier: identifier, user_id: appUser.id } });
    return { ok: true, enabled: true, user: { id: appUser.id, username: appUser.username, email: appUser.email }, initial_password: null };
  });

export const listRhEmployeeAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireNativeOperator(context);
    const { data, error } = await supabaseAdmin.from("rh_employees")
      .select("id, ponto_portal_user_id, ponto_access_enabled").eq("is_active", true).eq("ponto_access_enabled", true);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => ({ id: row.id, employee_id: row.id, user_id: row.ponto_portal_user_id, access_enabled: row.ponto_access_enabled }));
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

export const deactivateRhEmployeeRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    if (!input?.id) throw new Error("Funcionário inválido.");
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
