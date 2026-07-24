import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Lists all users (admin only). Uses admin client to bypass restrictive users RLS. */
export const listAllUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: me, error: meErr } = await context.supabase
      .from("users")
      .select("id, role_key")
      .eq("auth_id", context.userId)
      .maybeSingle();
    if (meErr || !me) throw new Error("Perfil não encontrado.");
    if (me.role_key !== "SUPER_ADMIN" && me.role_key !== "ADMIN_OPERACIONAL") {
      throw new Error("Acesso negado.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("users")
      .select("id, full_name, username, email, role_key, status, unit:unit_id(name), company:company_id(legal_name, trade_name)")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/** SUPER_ADMIN toggles user active/blocked. Records audit_log entry. */
export const setUserStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { user_id: string; status: "ativo" | "bloqueado" }) => {
    if (!input?.user_id) throw new Error("Usuário inválido.");
    if (input.status !== "ativo" && input.status !== "bloqueado") throw new Error("Status inválido.");
    return input;
  })
  .handler(async ({ context, data }) => {
    const { data: me } = await context.supabase
      .from("users")
      .select("id, role_key")
      .eq("auth_id", context.userId)
      .maybeSingle();
    if (!me || me.role_key !== "SUPER_ADMIN") {
      throw new Error("Somente SUPER_ADMIN pode alterar o status de usuários.");
    }
    if (me.id === data.user_id && data.status === "bloqueado") {
      throw new Error("Você não pode bloquear a própria conta.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: upErr } = await supabaseAdmin
      .from("users")
      .update({ status: data.status })
      .eq("id", data.user_id);
    if (upErr) throw new Error(upErr.message);

    await supabaseAdmin.from("audit_log").insert({
      actor_user_id: me.id,
      target_user_id: data.user_id,
      action: data.status === "ativo" ? "reactivated_user" : "deactivated_user",
      metadata_json: { at: new Date().toISOString() },
    });
    return { ok: true };
  });
