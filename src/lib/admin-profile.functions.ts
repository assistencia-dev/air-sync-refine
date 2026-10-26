import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Reads the authenticated application's own user profile for admin navigation.
 * Read through the verified user's client and self-select RLS policy. Loading
 * a personal profile must not require a privileged deployment secret.
 */
export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
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
      const result = await supabase
        .from("units")
        .select("name, cnpj, address_json")
        .eq("id", data.unit_id)
        .maybeSingle();
      if (!result.error) unit = result.data;
    }
    if (data.company_id) {
      const result = await supabase
        .from("companies")
        .select("legal_name, trade_name")
        .eq("id", data.company_id)
        .maybeSingle();
      if (!result.error) company = result.data;
    }

    return { ...data, unit, company };
  });
