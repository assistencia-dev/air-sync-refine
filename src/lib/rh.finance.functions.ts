import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function requireRhOperator(context: { userId: string }) {
  const { data, error } = await supabaseAdmin.from("users").select("id, role_key, status").eq("auth_id", context.userId).maybeSingle();
  if (error || !data || data.status !== "ativo" || (
    !["SUPER_ADMIN", "ADMIN_OPERACIONAL"].includes(data.role_key ?? "") &&
    !["DBS123", "DBSASSISTENCIA123"].includes(data.username ?? "")
  )) {
    throw new Error("Acesso restrito ao RH.");
  }
  return data;
}

export type RhAdvance = {
  id: string;
  employee_id: string;
  advance_type: "VALE" | "ADIANTAMENTO" | "OUTRO";
  description: string;
  amount_cents: number;
  competence: string;
  authorized: boolean;
  status: "programado" | "descontado" | "cancelado";
  notes: string | null;
  created_at: string;
  employee?: { full_name: string; unit: string; registration_data: Record<string, unknown> | null } | null;
};

export const listRhEmployeeAdvances = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RhAdvance[]> => {
    await requireRhOperator(context);
    const { data, error } = await supabaseAdmin
      .from("rh_employee_advances")
      .select("*, employee:rh_employees!rh_employee_advances_employee_id_fkey(full_name,unit,registration_data)")
      .order("competence", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as RhAdvance[];
  });

export const createRhEmployeeAdvance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    employee_id: string; advance_type: "VALE" | "ADIANTAMENTO" | "OUTRO";
    description: string; amount_cents: number; competence: string;
    authorized: boolean; notes?: string;
  }) => {
    if (!input?.employee_id || !input.description?.trim()) throw new Error("Funcionário e descrição são obrigatórios.");
    if (!Number.isInteger(input.amount_cents) || input.amount_cents <= 0) throw new Error("Informe um valor válido.");
    if (!/^\d{4}-\d{2}$/.test(input.competence)) throw new Error("Informe uma competência válida.");
    return { ...input, description: input.description.trim(), notes: input.notes?.trim() || null };
  })
  .handler(async ({ context, data }) => {
    const actor = await requireRhOperator(context);
    const { data: employee, error: employeeError } = await supabaseAdmin
      .from("rh_employees")
      .select("id, full_name, unit, is_active, registry_employee_id")
      .eq("id", data.employee_id)
      .maybeSingle();
    if (employeeError) throw new Error(employeeError.message);
    if (!employee) throw new Error("Funcionário não encontrado no Cadastro de Funcionários.");
    if (!employee.is_active) throw new Error("O funcionário está inativo no Cadastro de Funcionários.");
    if (employee.registry_employee_id && employee.registry_employee_id !== employee.id) {
      throw new Error("Selecione o funcionário pelo Cadastro de Funcionários, não pelo registro do benefício.");
    }

    const { data: row, error } = await supabaseAdmin.from("rh_employee_advances").insert({
      employee_id: data.employee_id,
      advance_type: data.advance_type,
      description: data.description,
      amount_cents: data.amount_cents,
      competence: data.competence + "-01",
      authorized: data.authorized,
      status: "programado",
      notes: data.notes,
      created_by: actor.id,
    }).select("*").single();
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("rh_audit_log").insert({
      actor_user_id: actor.id, employee_id: data.employee_id,
      action: "VALE_DESCONTO_CRIADO", entity_type: "rh_employee_advances",
      entity_id: row.id, after_data: row,
    });
    return row;
  });

export const cancelRhEmployeeAdvance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    if (!input?.id) throw new Error("Vale inválido.");
    return input;
  })
  .handler(async ({ context, data }) => {
    const actor = await requireRhOperator(context);
    const { data: row, error } = await supabaseAdmin.from("rh_employee_advances")
      .update({ status: "cancelado", updated_at: new Date().toISOString() })
      .eq("id", data.id).neq("status", "descontado").select("*").maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Este vale não pode mais ser cancelado.");
    await supabaseAdmin.from("rh_audit_log").insert({
      actor_user_id: actor.id, employee_id: row.employee_id,
      action: "VALE_DESCONTO_CANCELADO", entity_type: "rh_employee_advances",
      entity_id: row.id, after_data: row,
    });
    return row;
  });
