import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BOOTSTRAP_USERNAME = "DBSASSISTENCIA123";
const BOOTSTRAP_EMAIL = "dbsassistencia123@dbsair.internal";
// Recovery credential is supplied only as a server-side secret.
const BOOTSTRAP_PASSWORD = process.env.DBS_BOOTSTRAP_ADMIN_PASSWORD;

function normalizeDigits(v: string) {
  return v.replace(/\D+/g, "");
}

/** Resolves username/email/CPF to the Auth email and securely bootstraps the designated administrator. */
export const resolveLogin = createServerFn({ method: "POST" })
  .inputValidator((input: { identifier: string }) => {
    if (!input || typeof input.identifier !== "string" || input.identifier.trim().length < 3) {
      throw new Error("Informe um usuário válido.");
    }
    return { identifier: input.identifier.trim() };
  })
  .handler(async ({ data }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const raw = data.identifier;
      const digits = normalizeDigits(raw);
      const isEmail = raw.includes("@");
      let query = supabaseAdmin.from("users").select("email, username, cpf, status").limit(1);
      if (isEmail) query = query.ilike("email", raw);
      else if (digits.length === 11) query = query.eq("cpf", digits);
      else query = query.ilike("username", raw);

      const { data: found, error: lookupError } = await query.maybeSingle();
      if (lookupError) throw new Error("Não foi possível consultar o cadastro de acesso no Supabase.");
      if (found?.email) {
        if (found.status && found.status !== "ativo") throw new Error("Acesso suspenso. Entre em contato com a DBS Air.");
        return { email: found.email };
      }

      if (raw.toUpperCase() === BOOTSTRAP_USERNAME) {
        const { data: listed, error: listError } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        if (listError) throw new Error("Não foi possível verificar a conta administrativa existente.");
        let authUser = listed.users.find(user => user.email?.toLowerCase() === BOOTSTRAP_EMAIL.toLowerCase()) ?? null;
        if (!authUser) {
          if (!BOOTSTRAP_PASSWORD || BOOTSTRAP_PASSWORD.length < 16) {
            throw new Error("A conta administrativa ainda não existe no Auth. Configure DBS_BOOTSTRAP_ADMIN_PASSWORD como segredo do servidor.");
          }
          const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
            email: BOOTSTRAP_EMAIL, password: BOOTSTRAP_PASSWORD, email_confirm: true,
            user_metadata: { username: BOOTSTRAP_USERNAME },
          });
          if (createErr) throw new Error("Falha ao inicializar o administrador. Verifique os logs seguros do servidor.");
          authUser = created.user;
        }
        if (!authUser?.id) throw new Error("Não foi possível localizar a conta de autenticação do administrador.");
        const { error: profileError } = await supabaseAdmin.from("users").upsert({
          auth_id: authUser.id, username: BOOTSTRAP_USERNAME, email: BOOTSTRAP_EMAIL,
          full_name: "Super Administrador DBS Air", role_key: "SUPER_ADMIN", status: "ativo",
        }, { onConflict: "auth_id" });
        if (profileError) throw new Error("A conta Auth existe, mas o perfil SUPER_ADMIN não pôde ser recuperado.");
        return { email: BOOTSTRAP_EMAIL };
      }
      throw new Error("Usuário ou senha inválidos.");
    } catch (error) {
      // Preserve expected, user-safe messages while preventing raw backend exceptions from escaping.
      if (error instanceof Error) throw error;
      throw new Error("Falha controlada ao validar o acesso. Tente novamente.");
    }
  });

/** Returns the current app-user profile row; unauthenticated preview calls fail in a controlled way. */
export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const { data, error } = await context.supabase
        .from("users")
        .select("id, username, full_name, email, role_key, unit_id, company_id, is_unit_manager, status, unit:unit_id(name, cnpj, address_json), company:company_id(legal_name, trade_name)")
        .eq("auth_id", context.userId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (data && data.status && data.status !== "ativo") {
        throw new Error("Acesso suspenso. Entre em contato com a DBS Air.");
      }
      return data;
    } catch (error) {
      console.warn("[auth] Perfil não pôde ser carregado; a rota deve tratar o estado de sessão.");
      if (error instanceof Error && error.message === "Acesso suspenso. Entre em contato com a DBS Air.") throw error;
      throw new Error("Não foi possível carregar o perfil autenticado.");
    }
  });
