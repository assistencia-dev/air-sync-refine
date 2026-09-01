import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BUCKET = "ticket-files";
const MAX_BYTES = 15 * 1024 * 1024;

export type TicketAttachment = {
  id: string;
  ticket_id: string;
  file_name: string;
  file_type: string | null;
  file_size: number | null;
  uploader_role: string | null;
  created_at: string;
  url: string | null;
};

type Me = { id: string; role_key: string; unit_id: string | null; is_unit_manager: boolean };

async function resolveAccess(context: { supabase: any; userId: string }, ticketId: string) {
  const { data: me, error } = await context.supabase
    .from("users")
    .select("id, role_key, unit_id, is_unit_manager, status")
    .eq("auth_id", context.userId)
    .maybeSingle();
  if (error || !me) throw new Error("Perfil não encontrado.");
  if (me.status && me.status !== "ativo") throw new Error("Acesso suspenso.");

  const isStaff = me.role_key === "SUPER_ADMIN" || me.role_key === "ADMIN_OPERACIONAL";

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: ticket, error: tErr } = await supabaseAdmin
    .from("tickets")
    .select("id, created_by_user_id, unit_id, status")
    .eq("id", ticketId)
    .maybeSingle();
  if (tErr) throw new Error(tErr.message);
  if (!ticket) throw new Error("Chamado não encontrado.");

  const isOwner = ticket.created_by_user_id === me.id;
  const isUnitManager = !!me.is_unit_manager && !!me.unit_id && ticket.unit_id === me.unit_id;
  if (!isStaff && !isOwner && !isUnitManager) {
    throw new Error("Você não tem acesso a este chamado.");
  }
  return { me: me as Me, isStaff, ticket, supabaseAdmin };
}

/** Lista os anexos de um chamado com URLs assinadas temporárias. */
export const listTicketAttachments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { ticket_id: string }) => {
    if (!input?.ticket_id) throw new Error("Chamado inválido.");
    return { ticket_id: input.ticket_id };
  })
  .handler(async ({ context, data }): Promise<TicketAttachment[]> => {
    const { supabaseAdmin } = await resolveAccess(context, data.ticket_id);

    const { data: rows, error } = await supabaseAdmin
      .from("ticket_attachments")
      .select("id, ticket_id, file_name, file_type, file_size, uploader_role, created_at, file_url, storage_path")
      .eq("ticket_id", data.ticket_id)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    const out: TicketAttachment[] = [];
    for (const row of rows ?? []) {
      const path = (row as any).storage_path ?? (row as any).file_url;
      let url: string | null = null;
      if (path) {
        if (/^https?:\/\//i.test(path)) {
          url = path;
        } else {
          const signed = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, 3600);
          url = signed.data?.signedUrl ?? null;
        }
      }
      out.push({
        id: row.id,
        ticket_id: row.ticket_id,
        file_name: (row as any).file_name ?? "arquivo",
        file_type: row.file_type ?? null,
        file_size: (row as any).file_size ?? null,
        uploader_role: (row as any).uploader_role ?? null,
        created_at: row.created_at,
        url,
      });
    }
    return out;
  });

/** Envia um anexo (cliente ou administrador) para um chamado. */
export const uploadTicketAttachment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      ticket_id: string;
      file_name: string;
      file_type?: string | null;
      data_base64: string;
    }) => {
      if (!input?.ticket_id) throw new Error("Chamado inválido.");
      if (!input?.file_name) throw new Error("Arquivo inválido.");
      if (!input?.data_base64) throw new Error("Arquivo vazio.");
      return {
        ticket_id: input.ticket_id,
        file_name: input.file_name.slice(0, 160),
        file_type: input.file_type || null,
        data_base64: input.data_base64,
      };
    },
  )
  .handler(async ({ context, data }) => {
    const { me, isStaff, supabaseAdmin } = await resolveAccess(context, data.ticket_id);

    const binary = Buffer.from(data.data_base64, "base64");
    if (binary.byteLength === 0) throw new Error("Arquivo vazio.");
    if (binary.byteLength > MAX_BYTES) throw new Error("Arquivo acima do limite de 15 MB.");

    const safeName = data.file_name.replace(/[^\w.\-]+/g, "_");
    const path = `${data.ticket_id}/${Date.now()}-${safeName}`;

    const { error: upErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, binary, { contentType: data.file_type ?? "application/octet-stream" });
    if (upErr) throw new Error(upErr.message);

    const { error: insErr } = await supabaseAdmin.from("ticket_attachments").insert({
      ticket_id: data.ticket_id,
      file_url: path,
      storage_path: path,
      file_name: data.file_name,
      file_type: data.file_type,
      file_size: binary.byteLength,
      uploaded_by: me.id,
      uploader_role: isStaff ? "DBS Air" : "Cliente",
    });
    if (insErr) throw new Error(insErr.message);

    await supabaseAdmin.from("ticket_timeline").insert({
      ticket_id: data.ticket_id,
      author_user_id: me.id,
      role_label: isStaff ? "DBS Air" : "Cliente",
      note_text: `Anexo enviado: ${data.file_name}`,
    });

    return { ok: true };
  });
