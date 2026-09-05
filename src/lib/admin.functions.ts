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
      .select(
        "id, auth_id, full_name, username, email, cpf, role_key, status, unit_id, company_id, is_unit_manager, unit:unit_id(name), company:company_id(legal_name, trade_name)",
      )
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/** SUPER_ADMIN toggles user active/blocked. Records audit_log entry. */
export const setUserStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { user_id: string; status: "ativo" | "bloqueado" }) => {
    if (!input?.user_id) throw new Error("Usuário inválido.");
    if (input.status !== "ativo" && input.status !== "bloqueado")
      throw new Error("Status inválido.");
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

/** SUPER_ADMIN edits a linked user without deleting historical tickets or attachments. */
export const updateClientUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      user_id: string;
      full_name: string;
      email: string;
      cpf?: string | null;
      role_key: "GESTOR_CONTA" | "GESTOR_REGIONAL" | "CLIENTE_PF";
      company_id?: string | null;
      unit_id?: string | null;
      is_unit_manager?: boolean;
    }) => {
      if (!input?.user_id) throw new Error("Usuário inválido.");
      if (!input.full_name?.trim()) throw new Error("Informe o nome completo.");
      if (!input.email?.trim() || !input.email.includes("@")) throw new Error("E-mail inválido.");
      if (!["GESTOR_CONTA", "GESTOR_REGIONAL", "CLIENTE_PF"].includes(input.role_key)) {
        throw new Error("Papel inválido.");
      }
      return {
        ...input,
        full_name: input.full_name.trim(),
        email: input.email.trim().toLowerCase(),
        cpf: input.cpf?.replace(/\D+/g, "") || null,
        company_id: input.company_id || null,
        unit_id: input.unit_id || null,
        is_unit_manager: !!input.is_unit_manager,
      };
    },
  )
  .handler(async ({ context, data }) => {
    const { data: me } = await context.supabase
      .from("users")
      .select("id, role_key")
      .eq("auth_id", context.userId)
      .maybeSingle();
    if (!me || me.role_key !== "SUPER_ADMIN") {
      throw new Error("Somente SUPER_ADMIN pode editar acessos.");
    }
    if (me.id === data.user_id)
      throw new Error("Edite sua própria conta pela configuração de perfil.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: target, error: targetErr } = await supabaseAdmin
      .from("users")
      .select("id, auth_id, email, full_name, role_key, company_id, unit_id")
      .eq("id", data.user_id)
      .maybeSingle();
    if (targetErr || !target) throw new Error("Usuário não encontrado.");

    const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(target.auth_id, {
      email: data.email,
      user_metadata: { full_name: data.full_name },
    });
    if (authErr) throw new Error(authErr.message);

    const { error: updateErr } = await supabaseAdmin
      .from("users")
      .update({
        full_name: data.full_name,
        email: data.email,
        cpf: data.cpf,
        role_key: data.role_key,
        company_id: data.company_id,
        unit_id: data.unit_id,
        is_unit_manager: data.is_unit_manager,
      })
      .eq("id", data.user_id);
    if (updateErr) throw new Error(updateErr.message);

    await supabaseAdmin.from("audit_log").insert({
      actor_user_id: me.id,
      target_user_id: data.user_id,
      action: "updated_user",
      metadata_json: {
        previous: {
          email: target.email,
          full_name: target.full_name,
          role_key: target.role_key,
          company_id: target.company_id,
          unit_id: target.unit_id,
        },
        next: {
          email: data.email,
          full_name: data.full_name,
          role_key: data.role_key,
          company_id: data.company_id,
          unit_id: data.unit_id,
        },
        at: new Date().toISOString(),
      },
    });
    return { ok: true };
  });

/** Lists companies and units for admin selection when creating accesses. */
export const listCompaniesUnits = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: me } = await context.supabase
      .from("users")
      .select("role_key")
      .eq("auth_id", context.userId)
      .maybeSingle();
    if (!me || (me.role_key !== "SUPER_ADMIN" && me.role_key !== "ADMIN_OPERACIONAL")) {
      throw new Error("Acesso negado.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [companies, units] = await Promise.all([
      supabaseAdmin.from("companies").select("id, legal_name, trade_name").order("legal_name"),
      supabaseAdmin.from("units").select("id, name, company_id").order("name"),
    ]);
    if (companies.error) throw new Error(companies.error.message);
    if (units.error) throw new Error(units.error.message);
    return { companies: companies.data ?? [], units: units.data ?? [] };
  });

/** SUPER_ADMIN creates a client access (Auth user + public.users profile).
 *  Mode A: vincula a empresa/unidade existentes (company_id/unit_id).
 *  Mode B: cliente novo — cria empresa + unidade na hora. */
export const createClientUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      full_name: string;
      email: string;
      cpf?: string;
      role_key: "GESTOR_CONTA" | "GESTOR_REGIONAL" | "CLIENTE_PF";
      unit_id?: string | null;
      company_id?: string | null;
      password: string;
      is_unit_manager?: boolean;
      new_company_name?: string | null;
      new_company_cnpj?: string | null;
      new_unit_name?: string | null;
    }) => {
      if (!input?.full_name?.trim()) throw new Error("Informe o nome completo.");
      if (!input?.email?.trim() || !input.email.includes("@")) throw new Error("E-mail inválido.");
      if (!["GESTOR_CONTA", "GESTOR_REGIONAL", "CLIENTE_PF"].includes(input.role_key)) {
        throw new Error("Papel inválido.");
      }
      if (!input?.password || input.password.length < 8)
        throw new Error("Senha temporária muito curta.");
      const company_id = input.company_id || null;
      const new_company_name = input.new_company_name?.trim() || null;
      const new_company_cnpj = input.new_company_cnpj?.trim() || null;
      if (!company_id && (!new_company_name || !new_company_cnpj)) {
        throw new Error("Para cliente novo, informe Nome da Empresa e CNPJ.");
      }
      return {
        full_name: input.full_name.trim(),
        email: input.email.trim().toLowerCase(),
        cpf: input.cpf?.replace(/\D+/g, "") || null,
        role_key: input.role_key,
        unit_id: input.unit_id || null,
        company_id,
        password: input.password,
        is_unit_manager: !!input.is_unit_manager,
        new_company_name,
        new_company_cnpj,
        new_unit_name: input.new_unit_name?.trim() || null,
      };
    },
  )
  .handler(async ({ context, data }) => {
    const { data: me } = await context.supabase
      .from("users")
      .select("id, role_key")
      .eq("auth_id", context.userId)
      .maybeSingle();
    if (!me || me.role_key !== "SUPER_ADMIN") {
      throw new Error("Somente SUPER_ADMIN pode criar acessos.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let finalCompanyId = data.company_id;
    let finalUnitId = data.unit_id;
    let isUnitManager = data.is_unit_manager;

    // Cliente novo: cria empresa + unidade automaticamente
    if (!finalCompanyId) {
      const { data: newCompany, error: companyErr } = await supabaseAdmin
        .from("companies")
        .insert({
          legal_name: data.new_company_name!,
          trade_name: data.new_company_name!,
          cnpj_matriz: data.new_company_cnpj!,
          account_type: "avulso",
        })
        .select()
        .single();
      if (companyErr) throw new Error("Erro ao criar empresa: " + companyErr.message);
      finalCompanyId = newCompany.id;

      const { data: newUnit, error: unitErr } = await supabaseAdmin
        .from("units")
        .insert({
          company_id: finalCompanyId,
          name: data.new_unit_name || data.new_company_name!,
          cnpj: data.new_company_cnpj!,
        })
        .select()
        .single();
      if (unitErr) throw new Error("Erro ao criar unidade: " + unitErr.message);
      finalUnitId = newUnit.id;
      isUnitManager = true; // única unidade do cliente
    }

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.full_name },
    });
    if (createErr || !created?.user?.id) {
      throw new Error(createErr?.message || "Falha ao criar usuário no Auth.");
    }
    const authId = created.user.id;

    const { error: insErr } = await supabaseAdmin.from("users").insert({
      auth_id: authId,
      full_name: data.full_name,
      email: data.email,
      cpf: data.cpf,
      role_key: data.role_key,
      unit_id: finalUnitId,
      company_id: finalCompanyId,
      is_unit_manager: isUnitManager,
      status: "ativo",
      created_by: me.id,
    });
    if (insErr) {
      await supabaseAdmin.auth.admin.deleteUser(authId);
      throw new Error(insErr.message);
    }

    await supabaseAdmin.from("audit_log").insert({
      actor_user_id: me.id,
      action: "created_user",
      metadata_json: {
        email: data.email,
        role_key: data.role_key,
        company_id: finalCompanyId,
        unit_id: finalUnitId,
        created_company: !data.company_id,
        at: new Date().toISOString(),
      },
    });

    return { ok: true, email: data.email };
  });
