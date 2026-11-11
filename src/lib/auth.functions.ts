import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";

function normalizeDigits(v: string) {
  return v.replace(/\D+/g, "");
}

/**
 * Resolves a login identifier (username / email / CPF) to the auth e-mail.
 * If the identifier is the well-known bootstrap username and no user exists
 * yet, creates the SUPER_ADMIN user idempotently.
 */
export const resolveLogin = createServerFn({ method: "POST" })
  .validator((input: { identifier: string }) => {
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

    // Administrator accounts are never auto-provisioned from a public login request.
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
