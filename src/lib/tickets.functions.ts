import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listMyTickets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("tickets")
      .select("id, protocol_number, occurrence_type, description, status, priority, sla_deadline, created_at, unit_id, created_by_user_id")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listAllTickets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // RLS restricts non-admins to their own rows; this fetches everything for admins.
    const { data, error } = await context.supabase
      .from("tickets")
      .select("id, protocol_number, occurrence_type, description, status, priority, sla_deadline, created_at, unit_id, assigned_technician_id, created_by_user_id, users:created_by_user_id(full_name, username), unit:unit_id(name, cnpj)")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { occurrence_type: string; description: string; asset_id?: string | null }) => {
    if (!input?.occurrence_type) throw new Error("Tipo de ocorrência obrigatório.");
    if (!input?.description || input.description.trim().length < 20)
      throw new Error("Descreva o ocorrido com pelo menos 20 caracteres.");
    return {
      occurrence_type: input.occurrence_type,
      description: input.description.trim(),
      asset_id: input.asset_id || null,
    };
  })
  .handler(async ({ context, data }) => {
    const { data: me, error: meErr } = await context.supabase
      .from("users")
      .select("id, unit_id")
      .eq("auth_id", context.userId)
      .maybeSingle();
    if (meErr || !me) throw new Error("Perfil de usuário não encontrado.");

    const { data: inserted, error } = await context.supabase
      .from("tickets")
      .insert({
        occurrence_type: data.occurrence_type,
        description: data.description,
        asset_id: data.asset_id,
        unit_id: me.unit_id,
        created_by_user_id: me.id,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return inserted;
  });

export const updateTicketStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; status: string }) => {
    if (!input?.id || !input?.status) throw new Error("Dados inválidos.");
    return input;
  })
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("tickets")
      .update({ status: data.status, closed_at: data.status === "concluido" ? new Date().toISOString() : null })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
