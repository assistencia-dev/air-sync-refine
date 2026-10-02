import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function requireTreasuryUser(context: { userId: string }) {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id, company_id, role_key, status")
    .eq("auth_id", context.userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data || data.status !== "ativo" || data.role_key !== "SUPER_ADMIN") {
    throw new Error("Acesso ao Financeiro restrito ao SUPER_ADMIN.");
  }
  return data;
}

export const getTreasuryCloudState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const user = await requireTreasuryUser(context);
    const scopeKey = user.company_id ? `company:${user.company_id}` : `user:${user.id}`;

    const { data, error } = await supabaseAdmin
      .from("treasury_snapshots")
      .select("state, state_version, updated_at")
      .eq("scope_key", scopeKey)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data ?? null;
  });

export const saveTreasuryCloudState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { state: Record<string, unknown> }) => {
    if (!input?.state || typeof input.state !== "object" || Array.isArray(input.state)) {
      throw new Error("Estado financeiro inválido.");
    }
    return input;
  })
  .handler(async ({ context, data }) => {
    const user = await requireTreasuryUser(context);
    const scopeKey = user.company_id ? `company:${user.company_id}` : `user:${user.id}`;
    const payload = {
      scope_key: scopeKey,
      company_id: user.company_id ?? null,
      owner_user_id: user.id,
      state: data.state,
      state_version: Number((data.state as any)?._meta?.version) || 5,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    };

    const { data: saved, error } = await supabaseAdmin
      .from("treasury_snapshots")
      .upsert(payload as any, { onConflict: "scope_key" })
      .select("state, state_version, updated_at")
      .single();

    if (error) throw new Error(error.message);
    return saved;
  });
