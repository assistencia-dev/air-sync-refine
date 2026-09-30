import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const TYPES = ["entrada", "almoco_saida", "almoco_retorno", "saida"] as const;
type PointType = (typeof TYPES)[number];

async function requireRh(context: { userId: string }) {
  const { data, error } = await supabaseAdmin.from("users").select("id, username, role_key, status").eq("auth_id", context.userId).maybeSingle();
  const allowed = data && (data.role_key === "SUPER_ADMIN" || data.role_key === "ADMIN_OPERACIONAL" || ["DBS123", "DBSASSISTENCIA123"].includes(data.username ?? ""));
  if (error || !allowed || data.status !== "ativo") throw new Error("Acesso restrito ao RH da DBS Air.");
  return data;
}

function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const rad = (v: number) => (v * Math.PI) / 180;
  const earth = 6371000;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * earth * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function getEmployee(contextUserId: string) {
  const { data: user } = await supabaseAdmin.from("users").select("id").eq("auth_id", contextUserId).maybeSingle();
  if (!user) throw new Error("Usuário não encontrado.");
  const { data: employees, error } = await supabaseAdmin.from("rh_employees")
    .select("id, full_name, unit, registration_data, ponto_access_enabled, ponto_portal_user_id, ponto_base_lat, ponto_base_lng, ponto_raio_m, ponto_entrada_prevista, ponto_saida_prevista, ponto_almoco_inicio_previsto, ponto_almoco_fim_previsto, is_active")
    .eq("ponto_portal_user_id", user.id).eq("ponto_access_enabled", true).eq("is_active", true)
    .order("updated_at", { ascending: false }).limit(20);
  if (error) throw new Error(error.message);
  const employee = employees?.[0] ?? null;
  if (!employee) throw new Error("Acesso à Folha de Ponto não liberado pelo RH.");
  return employee;
}

export const hasMyPontoAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: user } = await supabaseAdmin.from("users").select("id").eq("auth_id", context.userId).maybeSingle();
    if (!user) return { enabled: false };
    const { data, error } = await supabaseAdmin.from("rh_employees").select("id")
      .eq("ponto_portal_user_id", user.id).eq("ponto_access_enabled", true).eq("is_active", true).limit(1);
    if (error) throw new Error(error.message);
    return { enabled: Boolean(data?.length) };
  });

export const listRhPontoEmployees = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await requireRh(context);
  const { data, error } = await supabaseAdmin.from("rh_employees").select("id, full_name, unit, registration_data, registry_employee_id, ponto_access_enabled, ponto_portal_user_id, ponto_base_lat, ponto_base_lng, ponto_raio_m, ponto_entrada_prevista, ponto_saida_prevista, ponto_almoco_inicio_previsto, ponto_almoco_fim_previsto, is_active").eq("is_active", true).order("full_name");
  if (error) throw new Error(error.message);
  const canonical = (data ?? []).filter((employee: any) => employee.registry_employee_id === employee.id || !employee.registry_employee_id);
  const ids = canonical.map(e => e.ponto_portal_user_id).filter(Boolean) as string[];
  const users = ids.length ? ((await supabaseAdmin.from("users").select("id, username, email, full_name").in("id", ids)).data ?? []) : [];
  const byId = new Map(users.map(u => [u.id, u]));
  return canonical.map(e => ({ ...e, portal_user: e.ponto_portal_user_id ? byId.get(e.ponto_portal_user_id) ?? null : null }));
});

export const setRhPontoAccess = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((input: { employee_id: string; enabled: boolean; portal_identifier?: string; base_lat?: number | null; base_lng?: number | null; radius_m?: number; entrada_prevista?: string | null; saida_prevista?: string | null; almoco_inicio_previsto?: string | null; almoco_fim_previsto?: string | null }) => {
  if (!input?.employee_id) throw new Error("Colaborador inválido.");
  if (input.enabled && !input.portal_identifier?.trim()) throw new Error("Informe o usuário, e-mail ou CPF usado no login do colaborador.");
  if (input.enabled && ((input.base_lat == null) !== (input.base_lng == null))) throw new Error("Informe latitude e longitude da base juntas.");
  if (input.radius_m !== undefined && (!Number.isInteger(input.radius_m) || input.radius_m < 20 || input.radius_m > 5000)) throw new Error("Raio permitido: 20 a 5.000 metros.");
  return input;
}).handler(async ({ context, data }) => {
  const actor = await requireRh(context);
  const patch: Record<string, unknown> = { ponto_access_enabled: data.enabled, ponto_raio_m: data.radius_m ?? 150, ponto_base_lat: data.base_lat ?? null, ponto_base_lng: data.base_lng ?? null, ponto_entrada_prevista: data.entrada_prevista ?? null, ponto_saida_prevista: data.saida_prevista ?? null, ponto_almoco_inicio_previsto: data.almoco_inicio_previsto ?? null, ponto_almoco_fim_previsto: data.almoco_fim_previsto ?? null };
  if (data.enabled) {
    const identifier = data.portal_identifier!.trim(); const digits = identifier.replace(/\D/g, "");
    let q = supabaseAdmin.from("users").select("id, username, email, cpf, status, role_key").limit(1);
    if (identifier.includes("@")) q = q.ilike("email", identifier); else if (digits.length === 11) q = q.eq("cpf", digits); else q = q.ilike("username", identifier);
    const { data: user } = await q.maybeSingle();
    if (!user || user.status !== "ativo") throw new Error("Usuário de login não encontrado ou inativo. Cadastre primeiro o acesso em Usuários vinculados.");
    if (user.role_key && user.role_key !== "COLABORADOR") throw new Error("O login precisa estar classificado como COLABORADOR em Usuários vinculados.");
    const { data: currentLink, error: currentLinkError } = await supabaseAdmin
      .from("rh_employees")
      .select("id, full_name")
      .eq("ponto_portal_user_id", user.id)
      .eq("ponto_access_enabled", true)
      .neq("id", data.employee_id)
      .limit(1);
    if (currentLinkError) throw new Error(currentLinkError.message);
    if (currentLink?.length) {
      throw new Error(`Este login já está vinculado ao funcionário ${currentLink[0].full_name}.`);
    }
    patch.ponto_portal_user_id = user.id;
  } else patch.ponto_portal_user_id = null;
  const { data: employeeRecord } = await supabaseAdmin.from("rh_employees").select("id, registry_employee_id, is_active").eq("id", data.employee_id).maybeSingle();
  if (!employeeRecord || !employeeRecord.is_active) throw new Error("Funcionário não encontrado no Cadastro de Funcionários.");
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
  if (input.latitude != null && (input.latitude < -90 || input.latitude > 90)) throw new Error("Latitude inválida.");
  if (input.longitude != null && (input.longitude < -180 || input.longitude > 180)) throw new Error("Longitude inválida.");
  return input;
}).handler(async ({ context, data }) => {
  const employee = await getEmployee(context.userId);
  const { data: rows, error } = await supabaseAdmin.from("rh_ponto_records").select("punch_type").eq("employee_id", employee.id).eq("work_date", data.work_date).order("punched_at", { ascending: false }).limit(1);
  if (error) throw new Error(error.message);
  const last = rows?.[0]?.punch_type as PointType | undefined;
  const next = TYPES[Math.min(last ? TYPES.indexOf(last) + 1 : 0, TYPES.length)];
  if (!next || data.punch_type !== next) throw new Error(`A próxima marcação deve ser ${next ?? "nenhuma"}.`);

  let distance = data.distance_m ?? null;
  let inside = data.inside_radius ?? null;
  if (data.latitude != null && data.longitude != null && employee.ponto_base_lat != null && employee.ponto_base_lng != null) {
    distance = distanceMeters(Number(employee.ponto_base_lat), Number(employee.ponto_base_lng), data.latitude, data.longitude);
    inside = distance <= Number(employee.ponto_raio_m ?? 150);
  }
  if (data.punch_type === "entrada" && (inside !== true)) throw new Error("Marcação bloqueada: é necessário estar dentro do raio permitido pelo RH.");

  const payload = { ...data, employee_id: employee.id, distance_m: distance, inside_radius: inside };
  const { data: record, error: insertError } = await supabaseAdmin.from("rh_ponto_records").insert(payload).select("id, work_date, punch_type, punched_at, latitude, longitude, gps_accuracy_m, distance_m, inside_radius, photo_data, note").single();
  if (insertError) throw new Error(insertError.message);
  await supabaseAdmin.from("rh_ponto_audit").insert({ employee_id: employee.id, actor_user_id: null, action: "MARCACAO_PONTO", details: { record_id: record.id, punch_type: record.punch_type, work_date: record.work_date, distance_m: record.distance_m, inside_radius: record.inside_radius } });
  return record;
});


function minutesFromTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.match(/(?:T| )([01]\d|2[0-3]):([0-5]\d)/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function durationBetween(start: string | null | undefined, end: string | null | undefined): number {
  const a = minutesFromTime(start);
  const b = minutesFromTime(end);
  if (a == null || b == null || b < a) return 0;
  return b - a;
}

function pointSummary(records: Array<{ punch_type: PointType; punched_at: string }>, employee: any) {
  const byType = new Map(records.map((r) => [r.punch_type, r.punched_at]));
  const workedMinutes =
    durationBetween(byType.get("entrada"), byType.get("almoco_saida")) +
    durationBetween(byType.get("almoco_retorno"), byType.get("saida"));

  const expectedStart = minutesFromTime(employee?.ponto_entrada_prevista);
  const expectedEnd = minutesFromTime(employee?.ponto_saida_prevista);
  const actualStart = minutesFromTime(byType.get("entrada"));
  const actualEnd = minutesFromTime(byType.get("saida"));

  return {
    worked_minutes: workedMinutes,
    expected_minutes: expectedStart != null && expectedEnd != null && expectedEnd >= expectedStart
      ? expectedEnd - expectedStart
      : null,
    late_minutes: expectedStart != null && actualStart != null ? Math.max(0, actualStart - expectedStart) : 0,
    early_leave_minutes: expectedEnd != null && actualEnd != null ? Math.max(0, expectedEnd - actualEnd) : 0,
    overtime_minutes: expectedEnd != null && actualEnd != null ? Math.max(0, actualEnd - expectedEnd) : 0,
    missing_punches: (["entrada", "almoco_saida", "almoco_retorno", "saida"] as PointType[])
      .filter((type) => !byType.has(type)),
  };
}

export const RH_PONTO_DAY_STATUSES = [
  "PRESENCA",
  "ATRASO",
  "SAIDA_ANTECIPADA",
  "FALTA",
  "FALTA_JUSTIFICADA",
  "ATESTADO",
  "FOLGA",
  "FERIAS",
  "COMPENSACAO",
  "HOME_OFFICE",
  "ABONO",
  "SEM_MARCACAO",
] as const;
export type RhPontoDayStatus = (typeof RH_PONTO_DAY_STATUSES)[number];

export const listRhPontoDayManagement = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { start_date: string; end_date: string; employee_id?: string }) => {
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(input.start_date) || !/^\\d{4}-\\d{2}-\\d{2}$/.test(input.end_date)) throw new Error("Período inválido.");
    if (input.start_date > input.end_date) throw new Error("Data inicial maior que a final.");
    return input;
  })
  .handler(async ({ context, data }) => {
    await requireRh(context);
    let query = supabaseAdmin.from("rh_ponto_audit")
      .select("employee_id, action, details, created_at")
      .gte("details->>work_date", data.start_date)
      .lte("details->>work_date", data.end_date);
    if (data.employee_id) query = query.eq("employee_id", data.employee_id);
    const { data: rows, error } = await query.order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (rows ?? []).filter((row: any) => row.action === "GESTAO_DIA_PONTO");
  });

export const setRhPontoDayManagement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    employee_id: string;
    work_date: string;
    status: RhPontoDayStatus;
    note?: string | null;
  }) => {
    if (!input?.employee_id || !/^\\d{4}-\\d{2}-\\d{2}$/.test(input.work_date)) throw new Error("Funcionário ou data inválidos.");
    if (!RH_PONTO_DAY_STATUSES.includes(input.status)) throw new Error("Situação do dia inválida.");
    return { ...input, note: input.note?.trim() || null };
  })
  .handler(async ({ context, data }) => {
    const actor = await requireRh(context);
    const { data: employee } = await supabaseAdmin.from("rh_employees")
      .select("id, full_name, is_active")
      .eq("id", data.employee_id)
      .maybeSingle();
    if (!employee) throw new Error("Funcionário não encontrado.");
    const { data: row, error } = await supabaseAdmin.from("rh_ponto_audit").insert({
      employee_id: data.employee_id,
      actor_user_id: actor.id,
      action: "GESTAO_DIA_PONTO",
      details: {
        work_date: data.work_date,
        status: data.status,
        note: data.note ?? null,
        employee_name: employee.full_name,
      },
    }).select("employee_id, action, details, created_at").single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listRhPontoRecords = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).inputValidator((input: { start_date: string; end_date: string; employee_id?: string }) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(input.end_date)) throw new Error("Período inválido.");
  if (input.start_date > input.end_date) throw new Error("Data inicial maior que a final.");
  return input;
}).handler(async ({ context, data }) => {
  await requireRh(context);
  let query = supabaseAdmin.from("rh_ponto_records").select("id, employee_id, work_date, punch_type, punched_at, latitude, longitude, gps_accuracy_m, distance_m, inside_radius, note").gte("work_date", data.start_date).lte("work_date", data.end_date).order("work_date").order("punched_at");
  if (data.employee_id) query = query.eq("employee_id", data.employee_id);
  const { data: records, error } = await query;
  if (error) throw new Error(error.message);
  const ids = [...new Set((records ?? []).map(r => r.employee_id))];
  const employees = ids.length ? ((await supabaseAdmin.from("rh_employees").select("id, full_name, unit, ponto_entrada_prevista, ponto_saida_prevista, ponto_almoco_inicio_previsto, ponto_almoco_fim_previsto").in("id", ids)).data ?? []) : [];
  const byId = new Map(employees.map(e => [e.id, e]));
  const enriched = (records ?? []).map(r => ({ ...r, employee: byId.get(r.employee_id) ?? null }));

  // Mantém os registros originais e acrescenta um resumo diário calculado,
  // permitindo que a tela mostre horas, atrasos e marcações faltantes sem alterar dados.
  const grouped = new Map<string, typeof enriched>();
  for (const row of enriched) {
    const key = `${row.employee_id}|${row.work_date}`;
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  }

  return enriched.map((row) => {
    const key = `${row.employee_id}|${row.work_date}`;
    const group = grouped.get(key) ?? [];
    return {
      ...row,
      day_summary: pointSummary(
        group.map((item) => ({ punch_type: item.punch_type as PointType, punched_at: item.punched_at })),
        row.employee,
      ),
    };
  });
});
