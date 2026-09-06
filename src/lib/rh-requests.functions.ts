import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const BUCKET = "rh-files";
// As tabelas de solicitações são acessadas apenas pelo servidor; tipos gerados podem
// ainda não incluí-las, por isso usamos um acesso destipado controlado.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabaseAdmin as any;
const MAX_BYTES = 15 * 1024 * 1024;

export type BenefitKind = "passagem" | "alimentacao";

export const PASSAGE_FLOW = [
  "PENDENTE",
  "EM_ANALISE",
  "APROVADO",
  "EMITIDO",
  "CONCLUIDO",
] as const;
export const MEAL_FLOW = ["SOLICITADO", "EM_APROVACAO", "CREDITADO", "FINALIZADO"] as const;
export const EXCEPTION_STATUS = ["RECUSADO", "CANCELADO"] as const;

/** Tolerância da trava financeira (R2): acima disso exige justificativa. */
export const OVER_BUDGET_TOLERANCE = 1.1;

export type BenefitRequest = {
  id: string;
  kind: BenefitKind;
  employee_id: string | null;
  employee_name: string;
  cpf: string | null;
  rg: string | null;
  birth_date: string | null;
  filial: string | null;
  travel_mode: string | null;
  origin: string | null;
  destination: string | null;
  depart_at: string | null;
  return_at: string | null;
  reason: string | null;
  carrier: string | null;
  pnr: string | null;
  estimated_cents: number;
  paid_cents: number;
  over_budget_reason: string | null;
  ref_month: string | null;
  days: number | null;
  daily_cents: number | null;
  total_cents: number | null;
  meal_type: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  attachments_count: number;
};

const SELECT_COLUMNS =
  "id, kind, employee_id, employee_name, cpf, rg, birth_date, filial, travel_mode, origin, destination, depart_at, return_at, reason, carrier, pnr, estimated_cents, paid_cents, over_budget_reason, ref_month, days, daily_cents, total_cents, meal_type, status, created_at, updated_at";

function flowFor(kind: BenefitKind) {
  return kind === "passagem" ? [...PASSAGE_FLOW] : [...MEAL_FLOW];
}

function assertKind(kind: unknown): BenefitKind {
  if (kind !== "passagem" && kind !== "alimentacao") throw new Error("Tipo de benefício inválido.");
  return kind;
}

async function requireNativeOperator(context: { userId: string }) {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id, username, status")
    .eq("auth_id", context.userId)
    .maybeSingle();
  if (
    error ||
    !data ||
    data.status !== "ativo" ||
    !["DBS123", "DBSASSISTENCIA123"].includes(data.username ?? "")
  ) {
    throw new Error("Acesso restrito ao operador nativo DBS.");
  }
  return data;
}

/** R3 — grava a trilha de auditoria de qualquer alteração. */
async function writeAudit(entry: {
  request_id: string;
  user_id: string;
  action: string;
  status_from?: string | null;
  status_to?: string | null;
  details?: Record<string, Json> | null;
}) {
  await db.from("rh_request_audit").insert({
    request_id: entry.request_id,
    user_id: entry.user_id,
    action: entry.action,
    status_from: entry.status_from ?? null,
    status_to: entry.status_to ?? null,
    details: entry.details ?? null,
  });
}

async function countAttachments(requestId: string) {
  const { count } = await db
    .from("rh_request_attachments")
    .select("id", { count: "exact", head: true })
    .eq("request_id", requestId)
    .eq("is_deleted", false);
  return count ?? 0;
}

export const listBenefitRequests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { kind: BenefitKind }) => ({ kind: assertKind(input?.kind) }))
  .handler(async ({ context, data }): Promise<BenefitRequest[]> => {
    await requireNativeOperator(context);
    const { data: rows, error } = await db
      .from("rh_benefit_requests")
      .select(SELECT_COLUMNS)
      .eq("kind", data.kind)
      .eq("is_deleted", false)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const ids = (rows ?? []).map((r) => r.id);
    const counts = new Map<string, number>();
    if (ids.length) {
      const { data: atts } = await db
        .from("rh_request_attachments")
        .select("request_id")
        .in("request_id", ids)
        .eq("is_deleted", false);
      for (const a of atts ?? [])
        counts.set(a.request_id, (counts.get(a.request_id) ?? 0) + 1);
    }
    return (rows ?? []).map((r) => ({
      ...(r as unknown as Omit<BenefitRequest, "attachments_count">),
      attachments_count: counts.get(r.id) ?? 0,
    }));
  });

type SaveInput = {
  id?: string;
  kind: BenefitKind;
  employee_id?: string | null;
  employee_name: string;
  cpf?: string | null;
  rg?: string | null;
  birth_date?: string | null;
  filial?: string | null;
  travel_mode?: string | null;
  origin?: string | null;
  destination?: string | null;
  depart_at?: string | null;
  return_at?: string | null;
  reason?: string | null;
  carrier?: string | null;
  pnr?: string | null;
  estimated_cents?: number;
  paid_cents?: number;
  over_budget_reason?: string | null;
  ref_month?: string | null;
  days?: number | null;
  daily_cents?: number | null;
  meal_type?: string | null;
};

export const saveBenefitRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: SaveInput) => {
    const kind = assertKind(input?.kind);
    if (!input.employee_name?.trim()) throw new Error("Informe o colaborador.");
    if (!input.filial?.trim()) throw new Error("Informe a filial / centro de custo.");
    if (kind === "passagem") {
      if (!input.origin?.trim() || !input.destination?.trim())
        throw new Error("Informe origem e destino do trecho.");
      if (!input.depart_at) throw new Error("Informe a data e hora de saída.");
    } else {
      if (!input.ref_month?.trim()) throw new Error("Informe o mês de referência.");
      if (!input.days || input.days < 1) throw new Error("Informe a quantidade de dias.");
      if (!input.daily_cents || input.daily_cents <= 0)
        throw new Error("Informe o valor diário.");
    }
    return { ...input, kind };
  })
  .handler(async ({ context, data }) => {
    const operator = await requireNativeOperator(context);

    const estimated = Math.max(0, Math.round(data.estimated_cents ?? 0));
    const paid = Math.max(0, Math.round(data.paid_cents ?? 0));
    // R2 — trava financeira
    if (
      estimated > 0 &&
      paid > Math.round(estimated * OVER_BUDGET_TOLERANCE) &&
      !data.over_budget_reason?.trim()
    ) {
      throw new Error(
        "O valor pago excede o estimado em mais de 10%. Registre a justificativa do gestor.",
      );
    }

    const total =
      data.kind === "alimentacao" ? (data.days ?? 0) * (data.daily_cents ?? 0) : paid || estimated;

    const payload = {
      kind: data.kind,
      employee_id: data.employee_id || null,
      employee_name: data.employee_name.trim(),
      cpf: data.cpf?.trim() || null,
      rg: data.rg?.trim() || null,
      birth_date: data.birth_date || null,
      filial: data.filial?.trim() || null,
      travel_mode: data.travel_mode || null,
      origin: data.origin?.trim() || null,
      destination: data.destination?.trim() || null,
      depart_at: data.depart_at || null,
      return_at: data.return_at || null,
      reason: data.reason?.trim() || null,
      carrier: data.carrier?.trim() || null,
      pnr: data.pnr?.trim() || null,
      estimated_cents: estimated,
      paid_cents: paid,
      over_budget_reason: data.over_budget_reason?.trim() || null,
      ref_month: data.ref_month?.trim() || null,
      days: data.days ?? null,
      daily_cents: data.daily_cents ?? null,
      total_cents: total,
      meal_type: data.meal_type || null,
    };

    if (data.id) {
      const { data: before } = await db
        .from("rh_benefit_requests")
        .select("status")
        .eq("id", data.id)
        .maybeSingle();
      const { data: row, error } = await db
        .from("rh_benefit_requests")
        .update(payload)
        .eq("id", data.id)
        .select(SELECT_COLUMNS)
        .single();
      if (error) throw new Error(error.message);
      await writeAudit({
        request_id: row.id,
        user_id: operator.id,
        action: "EDICAO",
        status_from: before?.status ?? null,
        status_to: row.status,
        details: payload,
      });
      return row;
    }

    const { data: row, error } = await db
      .from("rh_benefit_requests")
      .insert({
        ...payload,
        status: data.kind === "passagem" ? "PENDENTE" : "SOLICITADO",
        created_by: operator.id,
      })
      .select(SELECT_COLUMNS)
      .single();
    if (error) throw new Error(error.message);
    await writeAudit({
      request_id: row.id,
      user_id: operator.id,
      action: "CRIACAO",
      status_to: row.status,
      details: payload,
    });
    return row;
  });

export const changeRequestStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; status: string; note?: string | null }) => {
    if (!input?.id || !input?.status) throw new Error("Solicitação inválida.");
    return { id: input.id, status: input.status, note: input.note?.trim() || null };
  })
  .handler(async ({ context, data }) => {
    const operator = await requireNativeOperator(context);
    const { data: row, error } = await db
      .from("rh_benefit_requests")
      .select("id, kind, status, pnr")
      .eq("id", data.id)
      .eq("is_deleted", false)
      .maybeSingle();
    if (error || !row) throw new Error("Solicitação não encontrada.");

    const kind = assertKind(row.kind);
    const flow = flowFor(kind);
    const isException = (EXCEPTION_STATUS as readonly string[]).includes(data.status);
    if (!isException && !flow.includes(data.status)) throw new Error("Situação inválida.");

    if (!isException) {
      const from = flow.indexOf(row.status);
      const to = flow.indexOf(data.status);
      if (from < 0) throw new Error("Esta solicitação está encerrada e não pode ser reaberta.");
      if (to !== from + 1) throw new Error("Avance a solicitação uma etapa por vez.");
    } else if ((EXCEPTION_STATUS as readonly string[]).includes(row.status)) {
      throw new Error("Esta solicitação já está encerrada.");
    }

    if (isException && !data.note) throw new Error("Registre o motivo da recusa ou cancelamento.");

    // R1 — vínculo de anexo obrigatório
    if (data.status === "EMITIDO") {
      if (!row.pnr) throw new Error("Informe o código localizador (PNR) antes de emitir.");
      if ((await countAttachments(row.id)) === 0)
        throw new Error("Anexe o bilhete emitido (PDF ou imagem) antes de marcar como EMITIDO.");
    }
    if (data.status === "CREDITADO" && (await countAttachments(row.id)) === 0) {
      throw new Error("Anexe o comprovante de carga/Pix antes de marcar como CREDITADO.");
    }

    const { error: upErr } = await db
      .from("rh_benefit_requests")
      .update({ status: data.status })
      .eq("id", row.id);
    if (upErr) throw new Error(upErr.message);

    await writeAudit({
      request_id: row.id,
      user_id: operator.id,
      action: "MUDANCA_STATUS",
      status_from: row.status,
      status_to: data.status,
      details: data.note ? { note: data.note } : null,
    });
    return { ok: true };
  });

/** R4 — exclusão apenas lógica, o histórico financeiro é preservado. */
export const softDeleteRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; reason?: string | null }) => {
    if (!input?.id) throw new Error("Solicitação inválida.");
    return { id: input.id, reason: input.reason?.trim() || null };
  })
  .handler(async ({ context, data }) => {
    const operator = await requireNativeOperator(context);
    const { data: row, error } = await db
      .from("rh_benefit_requests")
      .select("id, status")
      .eq("id", data.id)
      .maybeSingle();
    if (error || !row) throw new Error("Solicitação não encontrada.");
    const { error: upErr } = await db
      .from("rh_benefit_requests")
      .update({ is_deleted: true })
      .eq("id", row.id);
    if (upErr) throw new Error(upErr.message);
    await writeAudit({
      request_id: row.id,
      user_id: operator.id,
      action: "EXCLUSAO_LOGICA",
      status_from: row.status,
      status_to: row.status,
      details: data.reason ? { reason: data.reason } : null,
    });
    return { ok: true };
  });

export type RequestAttachment = {
  id: string;
  file_name: string;
  file_type: string | null;
  file_size: number | null;
  created_at: string;
  url: string | null;
};

export const listRequestAttachments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { request_id: string }) => {
    if (!input?.request_id) throw new Error("Solicitação inválida.");
    return { request_id: input.request_id };
  })
  .handler(async ({ context, data }): Promise<RequestAttachment[]> => {
    await requireNativeOperator(context);
    const { data: rows, error } = await db
      .from("rh_request_attachments")
      .select("id, file_name, file_type, file_size, storage_path, created_at")
      .eq("request_id", data.request_id)
      .eq("is_deleted", false)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    const out: RequestAttachment[] = [];
    for (const row of rows ?? []) {
      const signed = await supabaseAdmin.storage
        .from(BUCKET)
        .createSignedUrl(row.storage_path, 3600);
      out.push({
        id: row.id,
        file_name: row.file_name,
        file_type: row.file_type,
        file_size: row.file_size,
        created_at: row.created_at,
        url: signed.data?.signedUrl ?? null,
      });
    }
    return out;
  });

export const uploadRequestAttachment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      request_id: string;
      file_name: string;
      file_type?: string | null;
      data_base64: string;
    }) => {
      if (!input?.request_id) throw new Error("Solicitação inválida.");
      if (!input?.file_name) throw new Error("Arquivo inválido.");
      if (!input?.data_base64) throw new Error("Arquivo vazio.");
      return {
        request_id: input.request_id,
        file_name: input.file_name.slice(0, 160),
        file_type: input.file_type || null,
        data_base64: input.data_base64,
      };
    },
  )
  .handler(async ({ context, data }) => {
    const operator = await requireNativeOperator(context);
    const binary = Buffer.from(data.data_base64, "base64");
    if (binary.byteLength === 0) throw new Error("Arquivo vazio.");
    if (binary.byteLength > MAX_BYTES) throw new Error("Arquivo acima do limite de 15 MB.");

    const safeName = data.file_name.replace(/[^\w.\-]+/g, "_");
    const path = `benefit-requests/${data.request_id}/${Date.now()}-${safeName}`;
    const { error: upErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, binary, { contentType: data.file_type ?? "application/octet-stream" });
    if (upErr) throw new Error(upErr.message);

    const { error: insErr } = await db.from("rh_request_attachments").insert({
      request_id: data.request_id,
      file_name: data.file_name,
      file_type: data.file_type,
      file_size: binary.byteLength,
      storage_path: path,
      uploaded_by: operator.id,
    });
    if (insErr) throw new Error(insErr.message);

    await writeAudit({
      request_id: data.request_id,
      user_id: operator.id,
      action: "ANEXO",
      details: { file_name: data.file_name, file_size: binary.byteLength },
    });
    return { ok: true };
  });

export type RequestAuditEntry = {
  id: string;
  action: string;
  status_from: string | null;
  status_to: string | null;
  details: Record<string, Json> | null;
  created_at: string;
  user_name: string | null;
};

export const listRequestAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { request_id: string }) => {
    if (!input?.request_id) throw new Error("Solicitação inválida.");
    return { request_id: input.request_id };
  })
  .handler(async ({ context, data }): Promise<RequestAuditEntry[]> => {
    await requireNativeOperator(context);
    const { data: rows, error } = await db
      .from("rh_request_audit")
      .select("id, action, status_from, status_to, details, created_at, user_id")
      .eq("request_id", data.request_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const userIds = [...new Set((rows ?? []).map((r) => r.user_id).filter(Boolean))] as string[];
    const names = new Map<string, string>();
    if (userIds.length) {
      const { data: users } = await supabaseAdmin
        .from("users")
        .select("id, full_name, username")
        .in("id", userIds);
      for (const u of users ?? []) names.set(u.id, u.full_name ?? u.username ?? "Operador");
    }
    return (rows ?? []).map((r) => ({
      id: r.id,
      action: r.action,
      status_from: r.status_from,
      status_to: r.status_to,
      details: (r.details as Record<string, Json> | null) ?? null,
      created_at: r.created_at,
      user_name: r.user_id ? (names.get(r.user_id) ?? null) : null,
    }));
  });
