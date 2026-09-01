import { createServerFn } from "@tanstack/react-start";
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
      .select(
        "id, benefit_type, full_name, unit, fare_cents, trips_per_day, is_active, created_at, updated_at",
      )
      .eq("benefit_type", data.benefit_type)
      .order("full_name");
    if (error) throw new Error(error.message);
    return employees ?? [];
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
      .eq("benefit_type", data.benefit_type)
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
      .update({ is_active: false })
      .eq("id", data.id)
      .eq("benefit_type", data.benefit_type);
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
