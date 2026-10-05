import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function requireRhOperator(context: { userId: string }) {
  const { data, error } = await supabaseAdmin.from("users").select("id, username, role_key, status").eq("auth_id", context.userId).maybeSingle();
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
  employee?: { full_name: string; unit: string; registration_data: any } | null;
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


export const approveRhEmployeeValeRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { request_id: string; authorized: boolean; note?: string }) => {
    if (!input?.request_id) throw new Error("Solicitação inválida.");
    return { ...input, note: input.note?.trim() || null };
  })
  .handler(async ({ context, data }) => {
    const actor = await requireRhOperator(context);
    const { data: request, error: requestError } = await supabaseAdmin.from("rh_employee_requests")
      .select("id, employee_id, request_type, status, payload").eq("id", data.request_id).maybeSingle();
    if (requestError) throw new Error(requestError.message);
    if (!request || request.request_type !== "vale") throw new Error("Solicitação de vale não encontrada.");
    if (["resolvida", "cancelada"].includes(request.status)) throw new Error("Esta solicitação já foi encerrada.");
    const payload = (request.payload ?? {}) as Record<string, any>;
    const amount = Number(payload.amount_cents ?? 0);
    if (!Number.isInteger(amount) || amount <= 0) throw new Error("A solicitação não possui um valor válido.");
    if (!payload.signature_data || !payload.signature_name || !payload.signed_at) throw new Error("A solicitação não possui assinatura válida.");
    if (!data.authorized) {
      const { data: rejected, error: rejectError } = await supabaseAdmin.from("rh_employee_requests")
        .update({ status: "cancelada", resolved_at: new Date().toISOString(), resolved_by: actor.id })
        .eq("id", request.id).select("*").single();
      if (rejectError) throw new Error(rejectError.message);
      await supabaseAdmin.from("rh_audit_log").insert({ actor_user_id: actor.id, employee_id: request.employee_id, action: "VALE_RECUSADO_PELO_RH", entity_type: "rh_employee_requests", entity_id: request.id, before_data: request, after_data: rejected });
      return { request: rejected, advance: null };
    }
    const requestMarker = "REQ:" + request.id;
    const { data: existingAdvance, error: existingAdvanceError } = await supabaseAdmin.from("rh_employee_advances")
      .select("*").eq("employee_id", request.employee_id).eq("notes", requestMarker).maybeSingle();
    if (existingAdvanceError) throw new Error(existingAdvanceError.message);
    if (existingAdvance) {
      const { data: resolvedExisting } = await supabaseAdmin.from("rh_employee_requests")
        .update({ status: "resolvida", resolved_at: new Date().toISOString(), resolved_by: actor.id })
        .eq("id", request.id).select("*").single();
      return { request: resolvedExisting ?? request, advance: existingAdvance };
    }
    const { data: advance, error: advanceError } = await supabaseAdmin.from("rh_employee_advances").insert({
      employee_id: request.employee_id,
      advance_type: payload.advance_type === "ADIANTAMENTO" ? "ADIANTAMENTO" : "VALE",
      description: payload.title ? String(payload.title) + " · " + String(payload.description ?? "") : "Vale solicitado pelo colaborador",
      amount_cents: amount,
      competence: String(payload.competence) + "-01",
      authorized: true,
      status: "programado",
      notes: requestMarker,
      created_by: actor.id,
    }).select("*").single();
    if (advanceError) throw new Error(advanceError.message);
    const { data: resolved, error: resolvedError } = await supabaseAdmin.from("rh_employee_requests")
      .update({ status: "resolvida", resolved_at: new Date().toISOString(), resolved_by: actor.id })
      .eq("id", request.id).select("*").single();
    if (resolvedError) throw new Error(resolvedError.message);
    await supabaseAdmin.from("rh_audit_log").insert({ actor_user_id: actor.id, employee_id: request.employee_id, action: "VALE_AUTORIZADO_E_VINCULADO_A_FOLHA", entity_type: "rh_employee_advances", entity_id: advance.id, before_data: request, after_data: advance });
    return { request: resolved, advance };
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
