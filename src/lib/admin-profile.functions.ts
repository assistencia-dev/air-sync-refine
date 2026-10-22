import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Reads the authenticated application's own user profile for admin navigation.
 * The role lookup uses the server-only client so restrictive users-table RLS
 * cannot cause a false "view-only" state in the admin menu.
 */
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

    // Optional descriptive relations are fetched separately so a missing
    // unit/company relation cannot suppress the user's administrative role.
    let unit = null;
    let company = null;
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
