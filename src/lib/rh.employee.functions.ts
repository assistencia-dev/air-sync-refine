import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function getMyEmployee(context: { userId: string }) {
  const { data: user, error: ue } = await supabaseAdmin.from("users").select("id").eq("auth_id", context.userId).maybeSingle();
  if (ue || !user) throw new Error("Usuário não encontrado.");
  const { data: access, error: ae } = await supabaseAdmin.from("rh_employee_access").select("employee_id").eq("user_id", user.id).eq("access_enabled", true).maybeSingle();
  if (ae || !access) throw new Error("Seu acesso ainda não está vinculado a um funcionário do RH.");
  return { userId: user.id, employeeId: access.employee_id };
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
