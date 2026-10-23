import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";

const BOOTSTRAP_USERNAME = "DBSASSISTENCIA123";
const BOOTSTRAP_EMAIL = "dbsassistencia123@dbsair.internal";
function normalizeDigits(v: string) {
  return v.replace(/\D+/g, "");
}

/**
 * Resolves a login identifier (username / email / CPF) to the auth e-mail.
 * If the identifier is the well-known bootstrap username and no user exists
 * yet, creates the SUPER_ADMIN user idempotently.
 */
export const resolveLogin = createServerFn({ method: "POST" })
  .inputValidator((input: { identifier: string }) => {
    if (!input || typeof input.identifier !== "string" || input.identifier.trim().length < 3) {
      throw new Error("Informe um usuário válido.");
    }
    return { identifier: input.identifier.trim() };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const BOOTSTRAP_PASSWORD = process.env.DBS_SUPER_ADMIN_BOOTSTRAP_PASSWORD;
    const raw = data.identifier;
    const digits = normalizeDigits(raw);
    const isEmail = raw.includes("@");

    let query = supabaseAdmin.from("users").select("email, username, cpf, status").limit(1);
    if (isEmail) {
      query = query.ilike("email", raw);
    } else if (digits.length === 11) {
      query = query.eq("cpf", digits);
    } else if (digits.length === 14) {
      // CNPJ: look up any user of the unit with this CNPJ (fallback: username)
      query = query.ilike("username", raw);
    } else {
      query = query.ilike("username", raw);
    }
    const { data: found } = await query.maybeSingle();

    if (found?.email) {
      if (found.status && found.status !== "ativo") {
        throw new Error("Acesso suspenso. Entre em contato com a DBS Air.");
      }
      return { email: found.email };
    }

    // Bootstrap only when an operator has configured a private server-side password.
    // Never ship a reusable administrator credential in source code.
    if (raw.toUpperCase() === BOOTSTRAP_USERNAME) {
      if (!BOOTSTRAP_PASSWORD || BOOTSTRAP_PASSWORD.length < 12) {
        throw new Error(
          "A conta inicial não existe. Configure DBS_SUPER_ADMIN_BOOTSTRAP_PASSWORD no ambiente do servidor (mínimo de 12 caracteres) antes de usar a inicialização.",
        );
      }
      const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email: BOOTSTRAP_EMAIL,
        password: BOOTSTRAP_PASSWORD,
        email_confirm: true,
        user_metadata: { username: BOOTSTRAP_USERNAME },
      });
      if (createErr && !/already/i.test(createErr.message)) {
        throw new Error("Falha ao inicializar administrador: " + createErr.message);
      }
      let authId = created?.user?.id ?? null;
      if (!authId) {
        const { data: list } = await supabaseAdmin.auth.admin.listUsers();
        authId = list.users.find((u) => u.email === BOOTSTRAP_EMAIL)?.id ?? null;
      }
      if (!authId) throw new Error("Não foi possível provisionar o administrador.");

      await supabaseAdmin.from("users").upsert(
        {
          auth_id: authId,
          username: BOOTSTRAP_USERNAME,
          email: BOOTSTRAP_EMAIL,
          full_name: "Super Administrador DBS Air",
          role_key: "SUPER_ADMIN",
        },
        { onConflict: "auth_id" },
      );
      return { email: BOOTSTRAP_EMAIL };
    }

    throw new Error("Usuário ou senha inválidos.");
  });

/** Backwards-compatible profile lookup. Related labels are optional and never gate the role. */
export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("users")
      .select("id, username, full_name, email, role_key, unit_id, company_id, is_unit_manager, status")
      .eq("auth_id", context.userId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return null;
    if (data.status && data.status !== "ativo") {
      throw new Error("Acesso suspenso. Entre em contato com a DBS Air.");
    }

    let unit: { name: string; cnpj: string | null; address_json: Json | null } | null = null;
    let company: { legal_name: string; trade_name: string | null } | null = null;
    if (data.unit_id) {
      const result = await supabaseAdmin
        .from("units")
        .select("name, cnpj, address_json")
        .eq("id", data.unit_id)
        .maybeSingle();
      if (!result.error) unit = result.data;
    }
    if (data.company_id) {
      const result = await supabaseAdmin
        .from("companies")
        .select("legal_name, trade_name")
        .eq("id", data.company_id)
        .maybeSingle();
      if (!result.error) company = result.data;
    }

    return { ...data, unit, company };
  });
