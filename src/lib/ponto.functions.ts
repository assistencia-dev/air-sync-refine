import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { distanceMeters, validatePontoGps } from "@/lib/ponto-geo";

// DBS FLEET usa tabelas privadas acessadas somente pelo cliente server-side.
const fleetDb: any = supabaseAdmin;

const TYPES = ["entrada", "almoco_saida", "almoco_retorno", "saida"] as const;
type PointType = (typeof TYPES)[number];

async function requireRh(context: { userId: string }) {
  const { data, error } = await supabaseAdmin.from("users").select("id, username, role_key, status").eq("auth_id", context.userId).maybeSingle();
  const allowed = data && (data.role_key === "SUPER_ADMIN" || data.role_key === "ADMIN_OPERACIONAL" || ["DBS123", "DBSASSISTENCIA123"].includes(data.username ?? ""));
  if (error || !allowed || data.status !== "ativo") throw new Error("Acesso restrito ao RH da DBS Air.");
  return data;
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

export const setRhPontoAccess = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).validator((input: { employee_id: string; enabled: boolean; portal_identifier?: string; base_lat?: number | null; base_lng?: number | null; radius_m?: number; entrada_prevista?: string | null; saida_prevista?: string | null; almoco_inicio_previsto?: string | null; almoco_fim_previsto?: string | null }) => {
  if (!input?.employee_id) throw new Error("Colaborador inválido.");
  if (input.enabled && !input.portal_identifier?.trim()) throw new Error("Informe o usuário, e-mail ou CPF usado no login do colaborador.");
  if (input.enabled && ((input.base_lat == null) !== (input.base_lng == null))) throw new Error("Informe latitude e longitude da base juntas.");
  if (input.enabled && (input.base_lat == null || input.base_lng == null)) throw new Error("Cadastre latitude e longitude da base para habilitar a geocerca GPS.");
  if (input.enabled && (!Number.isFinite(input.base_lat) || input.base_lat! < -90 || input.base_lat! > 90 || !Number.isFinite(input.base_lng) || input.base_lng! < -180 || input.base_lng! > 180)) throw new Error("Coordenadas da base inválidas.");
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
  const { data: employee, error } = await supabaseAdmin.from("rh_employees").update(patch as any).eq("id", data.employee_id).select("id, full_name, ponto_access_enabled, ponto_portal_user_id").single();
  if (error) throw new Error(error.message);
  await supabaseAdmin.from("rh_ponto_audit").insert({ employee_id: data.employee_id, actor_user_id: actor.id, action: data.enabled ? "ACESSO_PONTO_LIBERADO" : "ACESSO_PONTO_REVOGADO", details: { portal_identifier: data.enabled ? data.portal_identifier : null } });
  if (!data.enabled) {
    const { error: fleetStopError } = await fleetDb.from("rh_employee_location_sessions")
      .update({ ended_at: new Date().toISOString(), end_reason: "admin_stop" })
      .eq("employee_id", data.employee_id).is("ended_at", null);
    if (fleetStopError) console.error("DBS FLEET: falha ao encerrar sessão após revogação de acesso:", fleetStopError.message);
  }
  return employee;
});

export const getMyPonto = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const employee = await getEmployee(context.userId);
  const { data, error } = await supabaseAdmin.from("rh_ponto_records").select("id, work_date, punch_type, punched_at, latitude, longitude, gps_accuracy_m, distance_m, inside_radius, photo_data, note").eq("employee_id", employee.id).order("punched_at", { ascending: false });
  if (error) throw new Error(error.message);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const work_date = `${parts.find(part => part.type === "year")?.value}-${parts.find(part => part.type === "month")?.value}-${parts.find(part => part.type === "day")?.value}`;
  return { employee, records: data ?? [], work_date };
});

export const registerMyPonto = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).validator((input: { punch_type: PointType; work_date?: string; latitude?: number | null; longitude?: number | null; gps_accuracy_m?: number | null; distance_m?: number | null; inside_radius?: boolean | null; photo_data?: string | null; note?: string | null }) => {
  if (!TYPES.includes(input.punch_type)) throw new Error("Tipo de marcação inválido.");
  const hasAnyGps = input.latitude != null || input.longitude != null || input.gps_accuracy_m != null;
  const hasAllGps = input.latitude != null && input.longitude != null && input.gps_accuracy_m != null;
  if (hasAnyGps && !hasAllGps) throw new Error("Leitura GPS incompleta. Tente novamente ou registre a batida para conferência do RH.");
  if (hasAllGps && (
    !Number.isFinite(input.latitude) || input.latitude! < -90 || input.latitude! > 90 ||
    !Number.isFinite(input.longitude) || input.longitude! < -180 || input.longitude! > 180 ||
    !Number.isFinite(input.gps_accuracy_m) || input.gps_accuracy_m! < 0 || input.gps_accuracy_m! > 100_000
  )) throw new Error("Leitura GPS inválida.");
  return input;
}).handler(async ({ context, data }) => {
  const employee = await getEmployee(context.userId);
  // A data operacional é definida pelo servidor no fuso oficial da empresa.
  // O relógio do dispositivo serve apenas para exibir a hora local e capturar GPS.
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const serverWorkDate = `${dateParts.find(part => part.type === "year")?.value}-${dateParts.find(part => part.type === "month")?.value}-${dateParts.find(part => part.type === "day")?.value}`;
  // A data do dispositivo nunca decide a competência da batida. O servidor
  // usa exclusivamente America/Sao_Paulo para impedir perda por relógio/fuso incorreto.
  const { data: rows, error } = await supabaseAdmin.from("rh_ponto_records").select("punch_type, punched_at").eq("employee_id", employee.id).eq("work_date", serverWorkDate).order("punched_at", { ascending: true });
  if (error) throw new Error(error.message);
  const existingTypes = (rows ?? []).map((row) => row.punch_type as PointType);
  if (existingTypes.includes(data.punch_type)) throw new Error("Esta marcação já foi registrada hoje.");
  const last = existingTypes[existingTypes.length - 1];
  const next = TYPES[Math.min(last ? TYPES.indexOf(last) + 1 : 0, TYPES.length)];
  if (!next || data.punch_type !== next) throw new Error(`A próxima marcação deve ser ${next ?? "nenhuma"}.`);

  const hasGps = data.latitude != null && data.longitude != null && data.gps_accuracy_m != null;
  const gps = hasGps
    ? validatePontoGps(data, employee, data.punch_type)
    : { distance_m: null, inside_radius: null };
  const gpsPending = !hasGps || gps.inside_radius == null;
  const gpsNote = !hasGps
    ? "GPS pendente de conferência pelo RH: localização não capturada nesta batida."
    : gps.inside_radius == null
      ? "GPS pendente de conferência pelo RH: não foi possível validar a geocerca com segurança."
      : null;
  const note = [data.note?.trim(), gpsNote].filter(Boolean).join(" | ") || null;

  // punched_at permanece omitido intencionalmente: o DEFAULT now() do PostgreSQL
  // grava o timestamp UTC autoritativo no servidor de banco.
  const payload = {
    punch_type: data.punch_type,
    latitude: data.latitude ?? null,
    longitude: data.longitude ?? null,
    gps_accuracy_m: data.gps_accuracy_m ?? null,
    photo_data: data.photo_data ?? null,
    note,
    work_date: serverWorkDate,
    employee_id: employee.id,
    distance_m: gps.distance_m,
    inside_radius: gps.inside_radius,
  };
  const { data: record, error: insertError } = await supabaseAdmin.from("rh_ponto_records").insert(payload)
    .select("id, work_date, punch_type, punched_at, latitude, longitude, gps_accuracy_m, distance_m, inside_radius, photo_data, note").single();
  if (insertError) throw new Error(insertError.message);
  if (data.punch_type === "saida" || data.punch_type === "almoco_saida") {
    const endReason = data.punch_type === "saida" ? "punch_exit" : "lunch_break";
    const { error: fleetStopError } = await fleetDb.from("rh_employee_location_sessions")
      .update({ ended_at: new Date().toISOString(), end_reason: endReason })
      .eq("employee_id", employee.id).eq("work_date", serverWorkDate).is("ended_at", null);
    if (fleetStopError) console.error("DBS FLEET: a batida foi salva, mas a sessão GPS não foi encerrada automaticamente:", fleetStopError.message);
  }
  const { error: auditError } = await supabaseAdmin.from("rh_ponto_audit").insert({
    employee_id: employee.id,
    actor_user_id: null,
    action: "MARCACAO_PONTO",
    details: {
      record_id: record.id,
      punch_type: record.punch_type,
      work_date: record.work_date,
      distance_m: record.distance_m,
      inside_radius: record.inside_radius,
      gps_status: gpsPending ? "PENDENTE" : "VALIDADO",
      gps_accuracy_m: record.gps_accuracy_m,
    },
  });
  if (auditError) {
    // A batida já está persistida. Nunca informe falha de registro nem provoque
    // uma repetição que seria recusada como duplicada; deixe o erro no log do servidor.
    console.error("Falha ao auditar marcação de ponto já salva:", auditError.message);
  }

  return record;
});


/** Parse database `time`, ISO timestamps and legacy `HH:MM` values safely. */
export function minutesFromTime(value: string | null | undefined): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  // `time without time zone` is returned by Postgres as HH:MM[:SS].
  const plain = raw.match(/^(?:[T ]?)([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/);
  if (plain) return Number(plain[1]) * 60 + Number(plain[2]);

  // Punches are timestamptz. Normalize them to the company's operating
  // timezone instead of comparing UTC text with local work schedules.
  if (/\d{4}-\d{2}-\d{2}[T ]/.test(raw)) {
    const timestamp = Date.parse(raw);
    if (Number.isFinite(timestamp)) {
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "America/Sao_Paulo",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(new Date(timestamp));
      const hour = Number(parts.find((part) => part.type === "hour")?.value);
      const minute = Number(parts.find((part) => part.type === "minute")?.value);
      if (Number.isInteger(hour) && Number.isInteger(minute)) return hour * 60 + minute;
    }
  }

  const match = raw.match(/(?:T|\s|^)([01]\d|2[0-3]):([0-5]\d)/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function durationBetween(start: string | null | undefined, end: string | null | undefined): number {
  const a = minutesFromTime(start);
  const b = minutesFromTime(end);
  if (a == null || b == null) return 0;
  return b >= a ? b - a : (b + 24 * 60) - a;
}

export function pointSummary(records: Array<{ punch_type: PointType; punched_at: string }>, employee: any, approvedAdjustmentMinutes = 0) {
  const byType = new Map(records.map((r) => [r.punch_type, r.punched_at]));
  const rawWorkedMinutes =
    durationBetween(byType.get("entrada"), byType.get("almoco_saida")) +
    durationBetween(byType.get("almoco_retorno"), byType.get("saida"));

  const expectedStart = minutesFromTime(employee?.ponto_entrada_prevista);
  const expectedEnd = minutesFromTime(employee?.ponto_saida_prevista);
  const lunchStart = minutesFromTime(employee?.ponto_almoco_inicio_previsto);
  const lunchEnd = minutesFromTime(employee?.ponto_almoco_fim_previsto);
  const configuredBreak = Number(employee?.registration_data?.break_minutes ?? 0);
  const breakMinutes = lunchStart != null && lunchEnd != null && lunchEnd >= lunchStart
    ? lunchEnd - lunchStart
    : Math.max(0, Number.isFinite(configuredBreak) ? configuredBreak : 0);
  const tolerance = Math.max(0, Number(employee?.registration_data?.tolerance_minutes ?? 5));
  const spanMinutes = expectedStart != null && expectedEnd != null
    ? (expectedEnd >= expectedStart ? expectedEnd - expectedStart : expectedEnd + 24 * 60 - expectedStart)
    : 0;
  const expectedMinutes = spanMinutes > 0 ? Math.max(0, spanMinutes - breakMinutes) : null;
  const actualStart = minutesFromTime(byType.get("entrada"));
  const actualEnd = minutesFromTime(byType.get("saida"));
  const adjustmentMinutes = Number.isFinite(Number(approvedAdjustmentMinutes)) ? Math.trunc(Number(approvedAdjustmentMinutes)) : 0;
  const workedMinutes = Math.max(0, rawWorkedMinutes + adjustmentMinutes);

  return {
    worked_minutes: workedMinutes,
    raw_worked_minutes: rawWorkedMinutes,
    adjustment_minutes: adjustmentMinutes,
    adjusted_worked_minutes: workedMinutes,
    expected_minutes: expectedMinutes,
    late_minutes: expectedStart != null && actualStart != null ? Math.max(0, actualStart - expectedStart - tolerance) : 0,
    early_leave_minutes: expectedEnd != null && actualEnd != null ? Math.max(0, expectedEnd - actualEnd - tolerance) : 0,
    overtime_minutes: expectedEnd != null && actualEnd != null ? Math.max(0, actualEnd - expectedEnd - tolerance) : 0,
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
  .validator((input: { start_date: string; end_date: string; employee_id?: string }) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(input.end_date)) throw new Error("Período inválido.");
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
  .validator((input: {
    employee_id: string;
    work_date: string;
    status: RhPontoDayStatus;
    note?: string | null;
  }) => {
    if (!input?.employee_id || !/^\d{4}-\d{2}-\d{2}$/.test(input.work_date)) throw new Error("Funcionário ou data inválidos.");
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

export const listRhPontoRecords = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).validator((input: { start_date: string; end_date: string; employee_id?: string }) => {
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

  const adjustmentsResult = await supabaseAdmin.from("rh_time_adjustments")
    .select("id, employee_id, reference_date, adjustment_type, minutes, reason, status, approved_at")
    .gte("reference_date", data.start_date)
    .lte("reference_date", data.end_date)
    .eq("status", "aprovado");
  if (adjustmentsResult.error) throw new Error(adjustmentsResult.error.message);
  const approvedAdjustments = new Map<string, any[]>();
  for (const adjustment of adjustmentsResult.data ?? []) {
    const key = `${adjustment.employee_id}|${adjustment.reference_date}`;
    const list = approvedAdjustments.get(key) ?? [];
    list.push(adjustment);
    approvedAdjustments.set(key, list);
  }

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
        (approvedAdjustments.get(key) ?? []).reduce((total, adjustment) => {
          const minutes = Math.abs(Number(adjustment.minutes ?? 0));
          return total + (adjustment.adjustment_type === "desconto" ? -minutes : minutes);
        }, 0),
      ),
      approved_adjustments: approvedAdjustments.get(key) ?? [],
    };
  });
});


// -----------------------------------------------------------------------------
// DBS FLEET · localização operacional, histórico limitado e SOS
// Todas as leituras/escritas passam por autenticação e pelo cliente server-side.
// O navegador nunca acessa diretamente as tabelas de localização.
// -----------------------------------------------------------------------------

function fleetWorkDate(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  return `${parts.find(part => part.type === "year")?.value}-${parts.find(part => part.type === "month")?.value}-${parts.find(part => part.type === "day")?.value}`;
}

async function fleetAttendance(employeeId: string, workDate = fleetWorkDate()) {
  const { data, error } = await supabaseAdmin.from("rh_ponto_records")
    .select("punch_type, punched_at")
    .eq("employee_id", employeeId)
    .eq("work_date", workDate)
    .order("punched_at", { ascending: true });
  if (error) throw new Error(error.message);
  const types = (data ?? []).map(row => row.punch_type);
  return { hasEntry: types.includes("entrada"), hasExit: types.includes("saida"), onBreak: types.includes("almoco_saida") && !types.includes("almoco_retorno"), types };
}

async function fleetCloseSession(sessionId: string, reason: "punch_exit" | "lunch_break" | "employee_stop" | "expired" | "admin_stop") {
  const { error } = await fleetDb.from("rh_employee_location_sessions")
    .update({ ended_at: new Date().toISOString(), end_reason: reason })
    .eq("id", sessionId)
    .is("ended_at", null);
  if (error) throw new Error("DBS FLEET: não foi possível encerrar a sessão: " + error.message);
}

async function fleetCleanupRetention() {
  const pointsCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const sessionsCutoff = pointsCutoff;
  const sosCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const results = await Promise.all([
    fleetDb.from("rh_employee_location_points").delete().lt("recorded_at", pointsCutoff),
    fleetDb.from("rh_employee_location_sessions").delete().lt("ended_at", sessionsCutoff),
    fleetDb.from("rh_employee_sos_alerts").delete().lt("created_at", sosCutoff).eq("status", "RESOLVED"),
  ]);
  for (const result of results) {
    if (result.error) console.error("DBS FLEET: limpeza de retenção não concluída:", result.error.message);
  }
}

export const getMyFleetStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const employee = await getEmployee(context.userId);
    const workDate = fleetWorkDate();
    const attendance = await fleetAttendance(employee.id, workDate);
    const { data: activeRows, error } = await fleetDb.from("rh_employee_location_sessions")
      .select("id, employee_id, work_date, started_at, ended_at, end_reason, consent_at, last_latitude, last_longitude, last_accuracy_m, last_position_at")
      .eq("employee_id", employee.id)
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    let activeSession = activeRows?.[0] ?? null;
    if (activeSession) {
      const ageMs = Date.now() - Date.parse(activeSession.started_at);
      const wrongWorkDate = activeSession.work_date !== workDate;
      if (attendance.hasExit || wrongWorkDate || attendance.onBreak) {
        await fleetCloseSession(activeSession.id, attendance.hasExit ? "punch_exit" : attendance.onBreak ? "lunch_break" : "expired");
        activeSession = null;
      } else if (!attendance.hasEntry || ageMs > 14 * 60 * 60 * 1000) {
        await fleetCloseSession(activeSession.id, "expired");
        activeSession = null;
      }
    }
    const { data: sosRows, error: sosError } = await fleetDb.from("rh_employee_sos_alerts")
      .select("id, created_at, status, message, latitude, longitude, accuracy_m, acknowledged_at")
      .eq("employee_id", employee.id)
      .in("status", ["OPEN", "ACKNOWLEDGED"])
      .order("created_at", { ascending: false })
      .limit(3);
    if (sosError) throw new Error(sosError.message);
    return {
      employee: { id: employee.id, full_name: employee.full_name, unit: employee.unit },
      workDate,
      eligible: attendance.hasEntry && !attendance.hasExit && !attendance.onBreak,
      sosAvailable: attendance.hasEntry && !attendance.hasExit,
      onBreak: attendance.onBreak,
      hasEntry: attendance.hasEntry,
      hasExit: attendance.hasExit,
      activeSession,
      openSos: sosRows ?? [],
      trackingMode: "foreground_only" as const,
    };
  });

export const startMyFleetTracking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { consent: boolean }) => {
    if (input?.consent !== true) throw new Error("Confirme a autorização para iniciar o acompanhamento durante o expediente.");
    return input;
  })
  .handler(async ({ context }) => {
    const employee = await getEmployee(context.userId);
    const workDate = fleetWorkDate();
    const attendance = await fleetAttendance(employee.id, workDate);
    if (!attendance.hasEntry || attendance.hasExit || attendance.onBreak) {
      throw new Error(attendance.onBreak ? "O acompanhamento é pausado durante o intervalo. Inicie novamente após registrar o retorno do almoço." : "O acompanhamento só pode ser iniciado depois da batida de entrada e antes da batida de saída.");
    }
    const { data: activeRows, error: activeError } = await fleetDb.from("rh_employee_location_sessions")
      .select("id, employee_id, work_date, started_at, consent_at, last_latitude, last_longitude, last_accuracy_m, last_position_at")
      .eq("employee_id", employee.id).is("ended_at", null)
      .order("started_at", { ascending: false }).limit(1);
    if (activeError) throw new Error(activeError.message);
    const active = activeRows?.[0] ?? null;
    if (active && active.work_date === workDate && Date.now() - Date.parse(active.started_at) <= 14 * 60 * 60 * 1000 && !attendance.onBreak) {
      return { session: active, alreadyActive: true };
    }
    if (active) await fleetCloseSession(active.id, attendance.onBreak ? "lunch_break" : "expired");
    await fleetCleanupRetention();
    const { data: user, error: userError } = await supabaseAdmin.from("users").select("id")
      .eq("auth_id", context.userId).eq("status", "ativo").maybeSingle();
    if (userError || !user) throw new Error("Não foi possível validar sua sessão de usuário.");
    const { data: session, error } = await fleetDb.from("rh_employee_location_sessions").insert({
      employee_id: employee.id,
      work_date: workDate,
      consent_at: new Date().toISOString(),
      consent_policy_version: "fleet-2026-11-v1",
      created_by_user_id: user.id,
    }).select("id, employee_id, work_date, started_at, consent_at, last_latitude, last_longitude, last_accuracy_m, last_position_at").single();
    if (error) {
      // Trata concorrência entre abas/dispositivos sem abrir duas sessões para a mesma pessoa.
      const { data: current } = await fleetDb.from("rh_employee_location_sessions")
        .select("id, employee_id, work_date, started_at, consent_at, last_latitude, last_longitude, last_accuracy_m, last_position_at")
        .eq("employee_id", employee.id).is("ended_at", null)
        .order("started_at", { ascending: false }).limit(1);
      if (current?.[0]) return { session: current[0], alreadyActive: true };
      throw new Error(error.message);
    }
    const { error: auditError } = await supabaseAdmin.from("rh_ponto_audit").insert({
      employee_id: employee.id,
      actor_user_id: user.id,
      action: "DBS_FLEET_TRACKING_STARTED",
      details: { session_id: session.id, work_date: workDate, consent_at: session.consent_at, consent_policy_version: "fleet-2026-11-v1", foreground_only: true },
    });
    if (auditError) console.error("DBS FLEET: sessão iniciada, mas a auditoria de consentimento falhou:", auditError.message);
    return { session, alreadyActive: false };
  });

export const recordMyFleetPosition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { session_id: string; latitude: number; longitude: number; accuracy_m: number }) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input?.session_id ?? "")) throw new Error("Sessão de localização inválida.");
    if (!Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90
      || !Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180
      || !Number.isFinite(input.accuracy_m) || input.accuracy_m < 0 || input.accuracy_m > 250) {
      throw new Error("Leitura GPS inválida ou imprecisa. A posição não foi compartilhada.");
    }
    return input;
  })
  .handler(async ({ context, data }) => {
    const employee = await getEmployee(context.userId);
    const { data: session, error: sessionError } = await fleetDb.from("rh_employee_location_sessions")
      .select("id, employee_id, work_date, started_at, ended_at, last_position_at")
      .eq("id", data.session_id).eq("employee_id", employee.id).maybeSingle();
    if (sessionError || !session || session.ended_at) throw new Error("O acompanhamento não está mais ativo. Atualize o portal.");
    const now = new Date();
    const ageMs = now.getTime() - Date.parse(session.started_at);
    const workDate = fleetWorkDate();
    if (session.work_date !== workDate || ageMs > 14 * 60 * 60 * 1000) {
      await fleetCloseSession(session.id, "expired");
      throw new Error("O limite de acompanhamento desta jornada foi atingido.");
    }
    const attendance = await fleetAttendance(employee.id, workDate);
    if (!attendance.hasEntry || attendance.hasExit || attendance.onBreak) {
      await fleetCloseSession(session.id, attendance.hasExit ? "punch_exit" : attendance.onBreak ? "lunch_break" : "expired");
      throw new Error(attendance.onBreak ? "O intervalo foi iniciado. O acompanhamento GPS foi pausado até o registro do retorno." : "A jornada foi encerrada. O acompanhamento GPS foi interrompido.");
    }
    const { data: lastRows, error: lastError } = await fleetDb.from("rh_employee_location_points")
      .select("recorded_at, latitude, longitude")
      .eq("session_id", session.id)
      .order("recorded_at", { ascending: false })
      .limit(1);
    if (lastError) throw new Error(lastError.message);
    const last = lastRows?.[0] ?? null;
    const elapsed = last ? now.getTime() - Date.parse(last.recorded_at) : Number.POSITIVE_INFINITY;
    const movedMeters = last
      ? distanceMeters(Number(last.latitude), Number(last.longitude), data.latitude, data.longitude)
      : Number.POSITIVE_INFINITY;
    if (session.last_position_at && now.getTime() - Date.parse(session.last_position_at) < 20_000) {
      return { accepted: true, stored: false, throttled: true, recorded_at: session.last_position_at };
    }
    const shouldStorePoint = !last || elapsed >= 60_000 || movedMeters >= 50;
    const update = {
      last_latitude: data.latitude,
      last_longitude: data.longitude,
      last_accuracy_m: data.accuracy_m,
      last_position_at: now.toISOString(),
    };
    const { error: sessionUpdateError } = await fleetDb.from("rh_employee_location_sessions")
      .update(update).eq("id", session.id).is("ended_at", null);
    if (sessionUpdateError) throw new Error(sessionUpdateError.message);
    if (!shouldStorePoint) {
      return { accepted: true, stored: false, throttled: false, recorded_at: now.toISOString() };
    }
    const { error: pointError } = await fleetDb.from("rh_employee_location_points").insert({
      session_id: session.id,
      employee_id: employee.id,
      latitude: data.latitude,
      longitude: data.longitude,
      accuracy_m: data.accuracy_m,
      source: "browser",
    });
    if (pointError) throw new Error(pointError.message);
    return { accepted: true, stored: true, throttled: false, recorded_at: now.toISOString() };
  });

export const stopMyFleetTracking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { session_id: string }) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input?.session_id ?? "")) throw new Error("Sessão de localização inválida.");
    return input;
  })
  .handler(async ({ context, data }) => {
    const employee = await getEmployee(context.userId);
    const { data: session, error: sessionError } = await fleetDb.from("rh_employee_location_sessions")
      .select("id, work_date, started_at, ended_at").eq("id", data.session_id).eq("employee_id", employee.id).maybeSingle();
    if (sessionError || !session) throw new Error("Sessão de localização não encontrada.");
    if (!session.ended_at) await fleetCloseSession(session.id, "employee_stop");
    const { data: user } = await supabaseAdmin.from("users").select("id").eq("auth_id", context.userId).maybeSingle();
    const { error: auditError } = await supabaseAdmin.from("rh_ponto_audit").insert({
      employee_id: employee.id,
      actor_user_id: user?.id ?? null,
      action: "DBS_FLEET_TRACKING_STOPPED",
      details: { session_id: session.id, work_date: session.work_date, started_at: session.started_at, ended_at: new Date().toISOString(), reason: "employee_stop" },
    });
    if (auditError) console.error("DBS FLEET: sessão encerrada, mas a auditoria falhou:", auditError.message);
    return { ok: true };
  });

export const sendMyFleetSos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { latitude?: number | null; longitude?: number | null; accuracy_m?: number | null; message?: string | null }) => {
    const hasCoordinates = input.latitude != null || input.longitude != null || input.accuracy_m != null;
    if (hasCoordinates && (input.latitude == null || input.longitude == null || !Number.isFinite(input.latitude)
      || !Number.isFinite(input.longitude) || input.latitude < -90 || input.latitude > 90
      || input.longitude < -180 || input.longitude > 180
      || (input.accuracy_m != null && (!Number.isFinite(input.accuracy_m) || input.accuracy_m < 0 || input.accuracy_m > 500)))) {
      throw new Error("Localização do SOS inválida.");
    }
    const message = String(input.message ?? "Preciso de ajuda.").trim().slice(0, 500) || "Preciso de ajuda.";
    return { ...input, message };
  })
  .handler(async ({ context, data }) => {
    const employee = await getEmployee(context.userId);
    const workDate = fleetWorkDate();
    const attendance = await fleetAttendance(employee.id, workDate);
    if (!attendance.hasEntry || attendance.hasExit) throw new Error("O SOS pelo portal está disponível durante a jornada registrada, após a entrada e antes da saída.");
    const { data: sessionRows, error: sessionError } = await fleetDb.from("rh_employee_location_sessions")
      .select("id, last_latitude, last_longitude, last_accuracy_m, last_position_at")
      .eq("employee_id", employee.id).eq("work_date", workDate)
      .order("started_at", { ascending: false }).limit(1);
    if (sessionError) throw new Error(sessionError.message);
    const session = sessionRows?.[0] ?? null;
    const latitude = data.latitude ?? session?.last_latitude ?? null;
    const longitude = data.longitude ?? session?.last_longitude ?? null;
    const accuracy = data.accuracy_m ?? session?.last_accuracy_m ?? null;
    const hasCurrentSosLocation = data.latitude != null && data.longitude != null;
    const locationRecordedAt = hasCurrentSosLocation ? new Date().toISOString() : session?.last_position_at ?? null;
    const locationSource = hasCurrentSosLocation ? "current_sos" : latitude != null && longitude != null ? "last_known_session" : null;
    const { data: existingAlerts, error: existingError } = await fleetDb.from("rh_employee_sos_alerts")
      .select("id, created_at, status, message").eq("employee_id", employee.id)
      .in("status", ["OPEN", "ACKNOWLEDGED"])
      .gte("created_at", new Date(Date.now() - 90_000).toISOString())
      .order("created_at", { ascending: false }).limit(1);
    if (existingError) throw new Error(existingError.message);
    if (existingAlerts?.[0]) return { ...existingAlerts[0], alreadyOpen: true };
    await fleetCleanupRetention();
    const { data: alert, error } = await fleetDb.from("rh_employee_sos_alerts").insert({
      employee_id: employee.id,
      session_id: session?.id ?? null,
      message: data.message,
      latitude,
      longitude,
      accuracy_m: accuracy,
      location_recorded_at: locationRecordedAt,
      location_source: locationSource,
      status: "OPEN",
    }).select("id, created_at, status, message").single();
    if (error) throw new Error(error.message);
    const { data: user } = await supabaseAdmin.from("users").select("id").eq("auth_id", context.userId).maybeSingle();
    const { error: auditError } = await supabaseAdmin.from("rh_ponto_audit").insert({
      employee_id: employee.id,
      actor_user_id: user?.id ?? null,
      action: "DBS_FLEET_SOS_SENT",
      details: {
        sos_alert_id: alert.id,
        session_id: session?.id ?? null,
        message: data.message,
        location_source: locationSource,
        location_recorded_at: locationRecordedAt,
      },
    });
    if (auditError) console.error("DBS FLEET: SOS enviado, mas a auditoria falhou:", auditError.message);
    return alert;
  });

export const listRhFleetOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: { work_date: string }) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input?.work_date ?? "")) throw new Error("Data de consulta inválida.");
    const date = Date.parse(input.work_date + "T12:00:00");
    if (!Number.isFinite(date) || date > Date.now() + 86_400_000 || date < Date.now() - 30 * 86_400_000) {
      throw new Error("O histórico de deslocamento fica disponível por até 30 dias.");
    }
    return input;
  })
  .handler(async ({ context, data }) => {
    await requireRh(context);
    const { data: sessions, error } = await fleetDb.from("rh_employee_location_sessions")
      .select("id, employee_id, work_date, started_at, ended_at, end_reason, consent_at, last_latitude, last_longitude, last_accuracy_m, last_position_at")
      .eq("work_date", data.work_date).order("started_at", { ascending: false }).limit(300);
    if (error) throw new Error(error.message);
    const staleCutoff = Date.now() - 14 * 60 * 60 * 1000;
    const staleSessions = (sessions ?? []).filter((session: any) => !session.ended_at && Date.parse(session.started_at) < staleCutoff);
    for (const session of staleSessions) await fleetCloseSession(session.id, "expired");
    const visibleSessions = (sessions ?? []).map((session: any) => staleSessions.some((stale: any) => stale.id === session.id)
      ? { ...session, ended_at: new Date().toISOString(), end_reason: "expired" }
      : session);
    const employeeIds: string[] = [...new Set<string>(visibleSessions.map((session: any) => String(session.employee_id)))];
    const employees = employeeIds.length
      ? ((await supabaseAdmin.from("rh_employees").select("id, full_name, unit").in("id", employeeIds)).data ?? [])
      : [];
    const employeeById = new Map(employees.map(employee => [employee.id, employee]));
    const enrichedSessions = visibleSessions.map((session: any) => ({
      ...session,
      employee: employeeById.get(session.employee_id) ?? null,
    }));
    const { data: sosAlerts, error: sosError } = await fleetDb.from("rh_employee_sos_alerts")
      .select("id, employee_id, session_id, created_at, status, message, latitude, longitude, accuracy_m, location_recorded_at, location_source, acknowledged_by, acknowledged_at")
      .in("status", ["OPEN", "ACKNOWLEDGED"])
      .order("created_at", { ascending: false }).limit(100);
    if (sosError) throw new Error(sosError.message);
    const sosEmployeeIds: string[] = [...new Set<string>((sosAlerts ?? []).map((alert: any) => String(alert.employee_id)))];
    const sosEmployees = sosEmployeeIds.length
      ? ((await supabaseAdmin.from("rh_employees").select("id, full_name, unit").in("id", sosEmployeeIds)).data ?? [])
      : [];
    const sosEmployeeById = new Map(sosEmployees.map(employee => [employee.id, employee]));
    return {
      sessions: enrichedSessions,
      sosAlerts: (sosAlerts ?? []).map((alert: any) => ({
        ...alert,
        employee: sosEmployeeById.get(alert.employee_id) ?? null,
      })),
    };
  });

export const listRhFleetSessionRoute = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: { session_id: string }) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input?.session_id ?? "")) throw new Error("Sessão de deslocamento inválida.");
    return input;
  })
  .handler(async ({ context, data }) => {
    await requireRh(context);
    const { data: session, error: sessionError } = await fleetDb.from("rh_employee_location_sessions")
      .select("id, employee_id, work_date, started_at, ended_at, end_reason, last_latitude, last_longitude, last_accuracy_m, last_position_at")
      .eq("id", data.session_id).maybeSingle();
    if (sessionError || !session) throw new Error("Sessão de deslocamento não encontrada.");
    const { data: points, error } = await fleetDb.from("rh_employee_location_points")
      .select("id, recorded_at, latitude, longitude, accuracy_m")
      .eq("session_id", session.id)
      .order("recorded_at", { ascending: true }).limit(1_000);
    if (error) throw new Error(error.message);
    const { data: employee } = await supabaseAdmin.from("rh_employees").select("id, full_name, unit")
      .eq("id", session.employee_id).maybeSingle();
    return { session, employee, points: points ?? [] };
  });

export const updateRhFleetSos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { alert_id: string; status: "ACKNOWLEDGED" | "RESOLVED" }) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input?.alert_id ?? "")) throw new Error("Alerta SOS inválido.");
    if (input.status !== "ACKNOWLEDGED" && input.status !== "RESOLVED") throw new Error("Ação SOS inválida.");
    return input;
  })
  .handler(async ({ context, data }) => {
    const actor = await requireRh(context);
    const { data: current, error: currentError } = await fleetDb.from("rh_employee_sos_alerts")
      .select("id, employee_id, status, acknowledged_at").eq("id", data.alert_id).maybeSingle();
    if (currentError || !current) throw new Error("Alerta SOS não encontrado.");
    if (current.status === "RESOLVED") return current;
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { status: data.status };
    if (data.status === "ACKNOWLEDGED") {
      patch.acknowledged_by = actor.id;
      patch.acknowledged_at = now;
    } else {
      patch.resolved_by = actor.id;
      patch.resolved_at = now;
      if (!current.acknowledged_at) {
        patch.acknowledged_by = actor.id;
        patch.acknowledged_at = now;
      }
    }
    const { data: updated, error } = await fleetDb.from("rh_employee_sos_alerts")
      .update(patch).eq("id", data.alert_id)
      .select("id, status, acknowledged_at, resolved_at").single();
    if (error) throw new Error(error.message);
    const { error: auditError } = await supabaseAdmin.from("rh_ponto_audit").insert({
      employee_id: current.employee_id,
      actor_user_id: actor.id,
      action: data.status === "ACKNOWLEDGED" ? "DBS_FLEET_SOS_ACKNOWLEDGED" : "DBS_FLEET_SOS_RESOLVED",
      details: { sos_alert_id: data.alert_id, previous_status: current.status, status: data.status },
    });
    if (auditError) console.error("DBS FLEET: status do SOS atualizado, mas a auditoria falhou:", auditError.message);
    return updated;
  });

/**
 * Última posição compartilhada de um colaborador do RH.
 * A consulta é exclusiva do servidor e exige papel administrativo de RH.
 * Retorna também a idade do ponto para a tela nunca apresentar posição antiga
 * como se fosse localização ao vivo.
 */
export const listRhFleetTechnicianLocations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input?: { employee_id?: string | null }) => {
    const employeeId = String(input?.employee_id ?? "").trim();
    if (employeeId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(employeeId)) {
      throw new Error("Colaborador inválido para consultar a localização.");
    }
    return { employee_id: employeeId || null };
  })
  .handler(async ({ context, data }) => {
    await requireRh(context);
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    let query = fleetDb.from("rh_employee_location_sessions")
      .select("id, employee_id, work_date, started_at, ended_at, last_latitude, last_longitude, last_accuracy_m, last_position_at")
      .gte("started_at", cutoff)
      .order("last_position_at", { ascending: false, nullsFirst: false })
      .order("started_at", { ascending: false })
      .limit(1000);
    if (data.employee_id) query = query.eq("employee_id", data.employee_id);
    const { data: sessions, error } = await query;
    if (error) throw new Error(error.message);
    const latestByEmployee = new Map<string, any>();
    for (const session of sessions ?? []) {
      const employeeId = String(session.employee_id ?? "");
      if (employeeId && !latestByEmployee.has(employeeId)) latestByEmployee.set(employeeId, session);
    }
    const employeeIds = data.employee_id ? [data.employee_id] : [...latestByEmployee.keys()];
    const employeeResult = employeeIds.length
      ? await supabaseAdmin.from("rh_employees").select("id, full_name, unit").eq("is_active", true).in("id", employeeIds)
      : { data: [], error: null };
    if (employeeResult.error) throw new Error(employeeResult.error.message);
    const employees = employeeResult.data ?? [];
    const employeeById = new Map(employees.map((employee: any) => [String(employee.id), employee]));
    const now = Date.now();
    return {
      employee_found: data.employee_id ? employeeById.has(data.employee_id) : undefined,
      locations: [...latestByEmployee.values()].map((session: any) => {
        const employee = employeeById.get(String(session.employee_id));
        const hasCoordinates = session.last_latitude != null && session.last_longitude != null;
        const positionAgeMs = session.last_position_at ? Math.max(0, now - Date.parse(session.last_position_at)) : null;
        const isLive = Boolean(!session.ended_at && positionAgeMs != null && positionAgeMs <= 120_000 && hasCoordinates);
        return {
          session_id: session.id,
          employee_id: session.employee_id,
          full_name: employee?.full_name ?? "Colaborador",
          unit: employee?.unit ?? null,
          work_date: session.work_date,
          started_at: session.started_at,
          ended_at: session.ended_at,
          latitude: hasCoordinates ? Number(session.last_latitude) : null,
          longitude: hasCoordinates ? Number(session.last_longitude) : null,
          accuracy_m: session.last_accuracy_m == null ? null : Number(session.last_accuracy_m),
          last_position_at: session.last_position_at,
          position_age_ms: positionAgeMs,
          is_live: isLive,
          location_status: !hasCoordinates ? "unavailable" : isLive ? "live" : "last_known",
        };
      }),
    };
  });
