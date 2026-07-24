import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BOOTSTRAP_USERNAME = "DBSASSISTENCIA123";
const BOOTSTRAP_EMAIL = "dbsassistencia123@dbsair.internal";
const BOOTSTRAP_PASSWORD = "123456DBS";

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

    // Bootstrap SUPER_ADMIN idempotently on first attempt with the well-known username
    if (raw.toUpperCase() === BOOTSTRAP_USERNAME) {
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

/** Returns the current app-user profile row for the authenticated caller. */
export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("users")
      .select("id, username, full_name, email, role_key, unit_id, company_id, is_unit_manager")
      .eq("auth_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  });
