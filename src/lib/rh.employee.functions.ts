import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function getMyEmployee(context: { userId: string }) {
  const { data: user, error: ue } = await supabaseAdmin.from("users").select("id").eq("auth_id", context.userId).maybeSingle();
  if (ue || !user) throw new Error("Usuário não encontrado.");
  const { data: access, error: ae } = await supabaseAdmin.from("rh_employee_access").select("employee_id").eq("user_id", user.id).eq("access_enabled", true).maybeSingle();
  if (ae) throw new Error(ae.message);
  if (access) return { userId: user.id, employeeId: access.employee_id };

  // Compatibilidade com vínculos já gravados no cadastro central antes da tabela
  // de acesso ter sido sincronizada.
  const { data: canonical, error: canonicalError } = await supabaseAdmin
    .from("rh_employees")
    .select("id")
    .eq("ponto_portal_user_id", user.id)
    .eq("ponto_access_enabled", true)
    .eq("is_active", true)
    .maybeSingle();
  if (canonicalError) throw new Error(canonicalError.message);
  if (!canonical) throw new Error("Seu acesso ainda não está vinculado a um funcionário do RH.");
  return { userId: user.id, employeeId: canonical.id };
}

export const createMyRhEmployeeRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { request_type: string; title: string; description: string; reference_date?: string; priority?: string }) => {
    if (!input?.request_type || !input.title?.trim() || !input.description?.trim()) throw new Error("Tipo, título e descrição são obrigatórios.");
    if (input.description.trim().length < 10) throw new Error("Descreva a solicitação com pelo menos 10 caracteres.");
    return { ...input, title: input.title.trim(), description: input.description.trim(), priority: input.priority ?? "normal" };
  })
  .handler(async ({ context, data }) => {
    const { userId, employeeId } = await getMyEmployee(context);
    const payload = {
      title: data.title,
      description: data.description,
      reference_date: data.reference_date || null,
      priority: data.priority,
      requested_by_user_id: userId,
    };
    const { data: row, error } = await supabaseAdmin.from("rh_employee_requests")
      .insert({ employee_id: employeeId, request_type: data.request_type, payload, status: "aberta" })
      .select("*").single();
    if (error) throw new Error(error.message);
    return row;
  });


export const createMyRhEmployeeValeRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    advance_type: "VALE" | "ADIANTAMENTO";
    amount_cents: number;
    competence: string;
    reason?: string;
    signature_name: string;
    signature_data: string;
  }) => {
    if (!input?.amount_cents || !Number.isInteger(input.amount_cents) || input.amount_cents <= 0) throw new Error("Informe um valor válido.");
    if (!/^\d{4}-\d{2}$/.test(input.competence)) throw new Error("Informe uma competência válida.");
    if (!input.signature_name?.trim()) throw new Error("Informe o nome para assinatura.");
    if (!input.signature_data?.startsWith("data:image/")) throw new Error("Assine a solicitação antes de enviar.");
    if (input.signature_data.length > 700000) throw new Error("A assinatura ficou muito grande. Assine novamente com traço mais simples.");
    return { ...input, reason: input.reason?.trim() || "", signature_name: input.signature_name.trim() };
  })
  .handler(async ({ context, data }) => {
    const { userId, employeeId } = await getMyEmployee(context);
    const { data: employee, error: employeeError } = await supabaseAdmin.from("rh_employees")
      .select("id, full_name, unit, is_active, registration_data").eq("id", employeeId).maybeSingle();
    if (employeeError) throw new Error(employeeError.message);
    if (!employee?.is_active) throw new Error("Seu cadastro de funcionário está inativo.");
    const payload = {
      title: data.advance_type === "VALE" ? "Solicitação de vale" : "Solicitação de adiantamento salarial",
      description: data.reason,
      reference_date: data.competence + "-01",
      priority: "normal",
      amount_cents: data.amount_cents,
      competence: data.competence,
      advance_type: data.advance_type,
      signature_name: data.signature_name,
      signature_data: data.signature_data,
      signed_at: new Date().toISOString(),
      signed_by_user_id: userId,
      employee_name: employee.full_name,
      employee_unit: employee.unit,
    };
    const { data: row, error } = await supabaseAdmin.from("rh_employee_requests")
      .insert({ employee_id: employeeId, request_type: "vale", payload, status: "aberta" })
      .select("*").single();
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("rh_audit_log").insert({
      actor_user_id: userId, employee_id: employeeId, action: "VALE_SOLICITADO_PELO_COLABORADOR",
      entity_type: "rh_employee_requests", entity_id: row.id, after_data: row,
    });
    return row;
  });

export const listMyRhEmployeeRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { employeeId } = await getMyEmployee(context);
    const { data, error } = await supabaseAdmin.from("rh_employee_requests")
      .select("id,employee_id,request_type,status,payload,requested_at,resolved_at")
      .eq("employee_id", employeeId)
      .order("requested_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });
