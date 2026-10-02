import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function requireRhOperator(context: { userId: string }) {
  const { data, error } = await supabaseAdmin.from("users").select("id,role_key,status").eq("auth_id", context.userId).maybeSingle();
  if (error || !data || data.status !== "ativo" || !["SUPER_ADMIN","ADMIN_OPERACIONAL"].includes(data.role_key ?? "")) throw new Error("Acesso restrito ao RH.");
  return data;
}

export const listRhEmployeeRequestsDetailed = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireRhOperator(context);
    const { data, error } = await supabaseAdmin.from("rh_employee_requests")
      .select("id,employee_id,request_type,status,payload,requested_at,resolved_at")
      .order("requested_at",{ascending:false}).limit(100);
    if(error) throw new Error(error.message);
    return data ?? [];
  });
