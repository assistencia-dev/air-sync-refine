import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listMyTickets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("tickets")
      .select(
        "id, protocol_number, occurrence_type, description, status, priority, sla_deadline, created_at, closed_at, cancel_reason, unit_id, created_by_user_id",
      )
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
      .select(
        "id, protocol_number, occurrence_type, description, status, priority, sla_deadline, created_at, closed_at, cancel_reason, assumed_by, assumed_at, asset_id, unit_id, assigned_technician_id, created_by_user_id, users:created_by_user_id(full_name, username), assumed:assumed_by(full_name, username), unit:unit_id(name, cnpj)",
      )
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

async function requireStaff(context: { supabase: any; userId: string }) {
  const { data: me, error } = await context.supabase
    .from("users")
    .select("id, role_key")
    .eq("auth_id", context.userId)
    .maybeSingle();
  if (error || !me) throw new Error("Perfil não encontrado.");
  if (me.role_key !== "SUPER_ADMIN" && me.role_key !== "ADMIN_OPERACIONAL") {
    throw new Error("Apenas administradores podem alterar chamados.");
  }
  return me as { id: string; role_key: string };
}

/** Admin assume o chamado (somente se ainda estiver aberto). */
export const assumeTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    if (!input?.id) throw new Error("Chamado inválido.");
    return input;
  })
  .handler(async ({ context, data }) => {
    const me = await requireStaff(context);
    const { data: updated, error } = await context.supabase
      .from("tickets")
      .update({ status: "em_atendimento", assumed_by: me.id, assumed_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("status", "aberto")
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!updated) throw new Error("Este chamado já foi assumido ou não está mais aberto.");

    await context.supabase.from("ticket_timeline").insert({
      ticket_id: data.id,
      author_user_id: me.id,
      role_label: "Sistema",
      note_text: "Chamado assumido pelo administrador.",
      status_change: "em_atendimento",
    });
    return { ok: true };
  });

/** Admin conclui o chamado e atualiza a última manutenção do ativo. */
export const completeTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; asset_id?: string | null }) => {
    if (!input?.id) throw new Error("Chamado inválido.");
    return { id: input.id, asset_id: input.asset_id || null };
  })
  .handler(async ({ context, data }) => {
    const me = await requireStaff(context);
    const { count: pdfCount, error: attachmentErr } = await context.supabase
      .from("ticket_attachments")
      .select("id", { count: "exact", head: true })
      .eq("ticket_id", data.id)
      .eq("file_type", "application/pdf");
    if (attachmentErr) throw new Error(attachmentErr.message);
    if (!pdfCount)
      throw new Error("Anexe a Ordem de Serviço em PDF antes de concluir este chamado.");

    const now = new Date().toISOString();
    const { error } = await context.supabase
      .from("tickets")
      .update({ status: "concluido", closed_at: now })
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    await context.supabase.from("ticket_timeline").insert({
      ticket_id: data.id,
      author_user_id: me.id,
      role_label: "Sistema",
      note_text: "Chamado concluído pelo administrador.",
      status_change: "concluido",
    });

    if (data.asset_id) {
      await context.supabase
        .from("assets")
        .update({ last_maintenance_date: now })
        .eq("id", data.asset_id);
    }
    return { ok: true };
  });

/** Admin cancela o chamado com justificativa obrigatória. */
export const cancelTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; reason: string }) => {
    if (!input?.id) throw new Error("Chamado inválido.");
    if (!input?.reason || input.reason.trim().length < 10) {
      throw new Error("Informe uma justificativa de cancelamento com pelo menos 10 caracteres.");
    }
    return { id: input.id, reason: input.reason.trim() };
  })
  .handler(async ({ context, data }) => {
    const me = await requireStaff(context);
    const { error } = await context.supabase
      .from("tickets")
      .update({
        status: "cancelado",
        cancel_reason: data.reason,
        closed_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    await context.supabase.from("ticket_timeline").insert({
      ticket_id: data.id,
      author_user_id: me.id,
      role_label: "Sistema",
      note_text: "Chamado cancelado. Motivo: " + data.reason,
      status_change: "cancelado",
    });
    return { ok: true };
  });

export const createTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { occurrence_type: string; description: string; asset_id?: string | null }) => {
      if (!input?.occurrence_type) throw new Error("Tipo de ocorrência obrigatório.");
      if (!input?.description || input.description.trim().length < 20)
        throw new Error("Descreva o ocorrido com pelo menos 20 caracteres.");
      return {
        occurrence_type: input.occurrence_type,
        description: input.description.trim(),
        asset_id: input.asset_id || null,
      };
    },
  )
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
      .update({
        status: data.status,
        closed_at: data.status === "concluido" ? new Date().toISOString() : null,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Cliente reabre um chamado encerrado, mantendo o mesmo protocolo e o histórico. */
export const reopenTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    if (!input?.id) throw new Error("Chamado inválido.");
    return input;
  })
  .handler(async ({ context, data }) => {
    const { data: me, error: meErr } = await context.supabase
      .from("users")
      .select("id")
      .eq("auth_id", context.userId)
      .maybeSingle();
    if (meErr || !me) throw new Error("Perfil de usuário não encontrado.");

    const { data: current, error: currentErr } = await context.supabase
      .from("tickets")
      .select("id, status, protocol_number, created_by_user_id")
      .eq("id", data.id)
      .maybeSingle();
    if (currentErr) throw new Error(currentErr.message);
    if (!current || current.created_by_user_id !== me.id) {
      throw new Error("Você não tem permissão para reabrir este chamado.");
    }
    if (current.status !== "concluido" && current.status !== "cancelado") {
      throw new Error("Somente chamados concluídos ou cancelados podem ser reabertos.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: updateErr } = await supabaseAdmin
      .from("tickets")
      .update({ status: "aberto", closed_at: null, cancel_reason: null })
      .eq("id", data.id)
      .eq("created_by_user_id", me.id)
      .in("status", ["concluido", "cancelado"]);
    if (updateErr) throw new Error(updateErr.message);

    const { error: timelineErr } = await supabaseAdmin.from("ticket_timeline").insert({
      ticket_id: data.id,
      author_user_id: me.id,
      role_label: "Cliente",
      note_text: "Chamado reaberto pelo cliente.",
      status_change: "aberto",
    });
    if (timelineErr) throw new Error(timelineErr.message);
    return { ok: true, protocol_number: current.protocol_number };
  });
