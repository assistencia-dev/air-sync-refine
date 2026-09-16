import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const TYPES = ["entrada", "almoco_saida", "almoco_retorno", "saida"] as const;
type PointType = (typeof TYPES)[number];

async function requireRh(context: { userId: string }) {
  const { data, error } = await supabaseAdmin.from("users").select("id, username, status").eq("auth_id", context.userId).maybeSingle();
  if (error || !data || data.status !== "ativo" || !["DBS123", "DBSASSISTENCIA123"].includes(data.username ?? "")) throw new Error("Acesso restrito ao RH da DBS Air.");
  return data;
}

async function getEmployee(contextUserId: string) {
  const { data: user } = await supabaseAdmin.from("users").select("id").eq("auth_id", contextUserId).maybeSingle();
  if (!user) throw new Error("Usuário não encontrado.");
  const { data: employee, error } = await supabaseAdmin.from("rh_employees").select("id, full_name, unit, registration_data, ponto_access_enabled, ponto_portal_user_id, ponto_base_lat, ponto_base_lng, ponto_raio_m, ponto_entrada_prevista, ponto_saida_prevista, ponto_almoco_inicio_previsto, ponto_almoco_fim_previsto, is_active").eq("ponto_portal_user_id", user.id).eq("is_active", true).maybeSingle();
  if (error) throw new Error(error.message);
  if (!employee?.ponto_access_enabled) throw new Error("Acesso à Folha de Ponto não liberado pelo RH.");
  return employee;
}

export const hasMyPontoAccess = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { data: user } = await supabaseAdmin.from("users").select("id").eq("auth_id", context.userId).maybeSingle();
  if (!user) return { enabled: false };
  const { data } = await supabaseAdmin.from("rh_employees").select("id").eq("ponto_portal_user_id", user.id).eq("ponto_access_enabled", true).eq("is_active", true).maybeSingle();
  return { enabled: Boolean(data) };
});

export const listRhPontoEmployees = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await requireRh(context);
  const { data, error } = await supabaseAdmin.from("rh_employees").select("id, full_name, unit, registration_data, ponto_access_enabled, ponto_portal_user_id, ponto_base_lat, ponto_base_lng, ponto_raio_m, ponto_entrada_prevista, ponto_saida_prevista, ponto_almoco_inicio_previsto, ponto_almoco_fim_previsto, is_active").eq("is_active", true).order("full_name");
  if (error) throw new Error(error.message);
  const ids = (data ?? []).map(e => e.ponto_portal_user_id).filter(Boolean) as string[];
  const users = ids.length ? ((await supabaseAdmin.from("users").select("id, username, email, full_name").in("id", ids)).data ?? []) : [];
  const byId = new Map(users.map(u => [u.id, u]));
  return (data ?? []).map(e => ({ ...e, portal_user: e.ponto_portal_user_id ? byId.get(e.ponto_portal_user_id) ?? null : null }));
});

export const setRhPontoAccess = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((input: { employee_id: string; enabled: boolean; portal_identifier?: string; base_lat?: number | null; base_lng?: number | null; radius_m?: number; entrada_prevista?: string | null; saida_prevista?: string | null; almoco_inicio_previsto?: string | null; almoco_fim_previsto?: string | null }) => {
  if (!input?.employee_id) throw new Error("Colaborador inválido.");
  if (input.enabled && !input.portal_identifier?.trim()) throw new Error("Informe o usuário, e-mail ou CPF usado no login do colaborador.");
  if (input.radius_m !== undefined && (!Number.isInteger(input.radius_m) || input.radius_m < 20 || input.radius_m > 5000)) throw new Error("Raio permitido: 20 a 5.000 metros.");
  return input;
}).handler(async ({ context, data }) => {
  const actor = await requireRh(context);
  const patch: Record<string, unknown> = { ponto_access_enabled: data.enabled, ponto_raio_m: data.radius_m ?? 150, ponto_base_lat: data.base_lat ?? null, ponto_base_lng: data.base_lng ?? null, ponto_entrada_prevista: data.entrada_prevista ?? null, ponto_saida_prevista: data.saida_prevista ?? null, ponto_almoco_inicio_previsto: data.almoco_inicio_previsto ?? null, ponto_almoco_fim_previsto: data.almoco_fim_previsto ?? null };
  if (data.enabled) {
    const identifier = data.portal_identifier!.trim(); const digits = identifier.replace(/\D/g, "");
    let q = supabaseAdmin.from("users").select("id, username, email, cpf, status").limit(1);
    if (identifier.includes("@")) q = q.ilike("email", identifier); else if (digits.length === 11) q = q.eq("cpf", digits); else q = q.ilike("username", identifier);
    const { data: user } = await q.maybeSingle();
    if (!user || user.status !== "ativo") throw new Error("Usuário de login não encontrado ou inativo. Cadastre primeiro o acesso no portal.");
    patch.ponto_portal_user_id = user.id;
  } else patch.ponto_portal_user_id = null;
  const { data: employee, error } = await supabaseAdmin.from("rh_employees").update(patch).eq("id", data.employee_id).select("id, full_name, ponto_access_enabled, ponto_portal_user_id").single();
  if (error) throw new Error(error.message);
  await supabaseAdmin.from("rh_ponto_audit").insert({ employee_id: data.employee_id, actor_user_id: actor.id, action: data.enabled ? "ACESSO_PONTO_LIBERADO" : "ACESSO_PONTO_REVOGADO", details: { portal_identifier: data.enabled ? data.portal_identifier : null } });
  return employee;
});

export const getMyPonto = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const employee = await getEmployee(context.userId);
  const { data, error } = await supabaseAdmin.from("rh_ponto_records").select("id, work_date, punch_type, punched_at, latitude, longitude, gps_accuracy_m, distance_m, inside_radius, photo_data, note").eq("employee_id", employee.id).order("punched_at", { ascending: false });
  if (error) throw new Error(error.message);
  return { employee, records: data ?? [] };
});

export const registerMyPonto = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((input: { punch_type: PointType; work_date: string; latitude?: number | null; longitude?: number | null; gps_accuracy_m?: number | null; distance_m?: number | null; inside_radius?: boolean | null; photo_data?: string | null; note?: string | null }) => {
  if (!TYPES.includes(input.punch_type) || !/^\d{4}-\d{2}-\d{2}$/.test(input.work_date)) throw new Error("Marcação inválida.");
  return input;
}).handler(async ({ context, data }) => {
  const employee = await getEmployee(context.userId);
  const { data: rows, error } = await supabaseAdmin.from("rh_ponto_records").select("punch_type").eq("employee_id", employee.id).eq("work_date", data.work_date).order("punched_at", { ascending: false }).limit(1);
  if (error) throw new Error(error.message);
  const last = rows?.[0]?.punch_type as PointType | undefined;
  const next = TYPES[Math.min(last ? TYPES.indexOf(last) + 1 : 0, TYPES.length)];
  if (!next || data.punch_type !== next) throw new Error(`A próxima marcação deve ser ${next ?? "nenhuma"}.`);
  if (data.punch_type === "entrada" && data.inside_radius === false) throw new Error("Marcação bloqueada: fora do raio permitido pelo RH.");
  const { data: record, error: insertError } = await supabaseAdmin.from("rh_ponto_records").insert({ ...data, employee_id: employee.id }).select("id, work_date, punch_type, punched_at, latitude, longitude, gps_accuracy_m, distance_m, inside_radius, photo_data, note").single();
  if (insertError) throw new Error(insertError.message);
  return record;
});
