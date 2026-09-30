import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type DbsControlUser = {
  id: string;
  company_id: string | null;
  role_key: string;
  status: string;
};

async function requireDbsControlUser(context: { userId: string }) {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id, company_id, role_key, status")
    .eq("auth_id", context.userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data || data.status !== "ativo") throw new Error("Usuário inativo ou não encontrado.");

  const allowed = ["SUPER_ADMIN", "ADMIN_OPERACIONAL", "GESTOR_CONTA", "GESTOR_REGIONAL", "COLABORADOR"];
  if (!allowed.includes(data.role_key)) throw new Error("Acesso ao DBS CONTROL não autorizado.");

  return data as DbsControlUser;
}

function normalizeState(state: Record<string, unknown>) {
  return {
    ...state,
    tecnicos: Array.isArray(state.tecnicos) ? state.tecnicos : [],
    clientes: Array.isArray(state.clientes) ? state.clientes : [],
    equipamentos: Array.isArray(state.equipamentos) ? state.equipamentos : [],
    pecas: Array.isArray(state.pecas) ? state.pecas : [],
    servicos: Array.isArray(state.servicos) ? state.servicos : [],
    compras: Array.isArray(state.compras) ? state.compras : [],
    ordens: Array.isArray(state.ordens) ? state.ordens : [],
  };
}

export const getDbsControlCloudState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const user = await requireDbsControlUser(context);
    const scopeKey = user.company_id ? `company:${user.company_id}` : `user:${user.id}`;

    const { data, error } = await supabaseAdmin
      .from("dbs_control_snapshots")
      .select("state, state_version, updated_at")
      .eq("scope_key", scopeKey)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data ?? null;
  });

export const saveDbsControlCloudState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { state: Record<string, unknown> }) => {
    if (!input?.state || typeof input.state !== "object" || Array.isArray(input.state)) {
      throw new Error("Estado do DBS CONTROL inválido.");
    }
    return { state: normalizeState(input.state) };
  })
  .handler(async ({ context, data }) => {
    const user = await requireDbsControlUser(context);
    const scopeKey = user.company_id ? `company:${user.company_id}` : `user:${user.id}`;

    const payload = {
      scope_key: scopeKey,
      company_id: user.company_id ?? null,
      owner_user_id: user.id,
      state: data.state,
      state_version: 2,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    };

    const { data: saved, error } = await supabaseAdmin
      .from("dbs_control_snapshots")
      .upsert(payload, { onConflict: "scope_key" })
      .select("state, state_version, updated_at")
      .single();

    if (error) throw new Error(error.message);
    return saved;
  });
