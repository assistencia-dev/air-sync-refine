import { randomUUID } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin as typedSupabaseAdmin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";

const db = typedSupabaseAdmin as unknown as SupabaseClient<any, any, any>;

async function requireVtOperator(context: { userId: string }) {
  const { data, error } = await db.from("users")
    .select("id, username, role_key, status, company_id")
    .eq("auth_id", context.userId).maybeSingle();
  if (error || !data || data.status !== "ativo" ||
    (!["SUPER_ADMIN", "ADMIN_OPERACIONAL"].includes(data.role_key ?? "") &&
      !["DBS123", "DBSASSISTENCIA123"].includes(data.username ?? ""))) {
    throw new Error("Acesso restrito ao operador nativo DBS.");
  }
  return data;
}

export const listRhVtEmployees = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const actor = await requireVtOperator(context);
    let query = db.from("rh_employees")
      .select("id, full_name, unit, is_active, registry_employee_id")
      .eq("is_active", true).order("full_name");
    const { data: employees, error } = await query;
    if (error) throw new Error(error.message);
    const canonical = (employees ?? []).filter((e: any) => e.registry_employee_id === e.id);
    let configQuery = db.from("rh_vt_employee_config").select("*").eq("is_active", true);
    if (actor.company_id) configQuery = configQuery.eq("company_id", actor.company_id);
    const { data: configs, error: configError } = await configQuery;
    if (configError) throw new Error(configError.message);
    const byEmployee = new Map((configs ?? []).map((c: any) => [c.employee_id, c]));
    return canonical.map((employee: any) => ({
      ...employee,
      config: byEmployee.get(employee.id) ?? null,
    }));
  });

export const saveRhVtEmployeeConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: {
    employee_id: string; transit_lines: string[]; fare_cents: number;
    trips_per_day: number; recharge_rule: Record<string, unknown>;
    cost_center?: string | null;
  }) => {
    if (!input.employee_id) throw new Error("Selecione um funcionário do cadastro central.");
    if (!Number.isInteger(input.fare_cents) || input.fare_cents <= 0) throw new Error("Tarifa inválida.");
    if (!Number.isInteger(input.trips_per_day) || input.trips_per_day < 1 || input.trips_per_day > 12)
      throw new Error("Viagens por dia deve ficar entre 1 e 12.");
    const lines = [...new Set((input.transit_lines ?? []).map(v => String(v).trim()).filter(Boolean))];
    if (lines.length > 30) throw new Error("Informe no máximo 30 linhas.");
    return { ...input, transit_lines: lines, cost_center: input.cost_center?.trim() || null };
  })
  .handler(async ({ context, data }) => {
    const actor = await requireVtOperator(context);
    const { data: employee, error: employeeError } = await db.from("rh_employees")
      .select("id, registry_employee_id, is_active").eq("id", data.employee_id).maybeSingle();
    if (employeeError) throw new Error(employeeError.message);
    if (!employee || employee.registry_employee_id !== employee.id || !employee.is_active)
      throw new Error("Funcionário central não encontrado ou inativo.");
    const { data: config, error } = await db.from("rh_vt_employee_config").upsert({
      employee_id: data.employee_id,
      company_id: actor.company_id ?? null,
      transit_lines: data.transit_lines,
      fare_cents: data.fare_cents,
      trips_per_day: data.trips_per_day,
      recharge_rule: data.recharge_rule ?? { mode: "manual" },
      cost_center: data.cost_center,
      is_active: true,
      updated_by: actor.id,
      created_by: actor.id,
    }, { onConflict: "employee_id" }).select("*").single();
    if (error) throw new Error(error.message);
    return config;
  });

export const listRhVtTopups = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: { employee_id?: string; competence_year?: number; competence_month?: number }) => input ?? {})
  .handler(async ({ context, data }) => {
    const actor = await requireVtOperator(context);
    let query = db.from("rh_vt_topups").select("*").order("paid_at", { ascending: false });
    if (data.employee_id) query = query.eq("employee_id", data.employee_id);
    if (data.competence_year && data.competence_month) {
      const month = String(data.competence_month).padStart(2, "0");
      const start = `${data.competence_year}-${month}-01`;
      const endDate = new Date(data.competence_year, data.competence_month, 1);
      const end = `${endDate.getFullYear()}-${String(endDate.getMonth()+1).padStart(2,"0")}-01`;
      query = query.gte("competence_month", start).lt("competence_month", end);
    }
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    const ids = [...new Set((rows ?? []).map((r: any) => r.employee_id))];
    const { data: employees, error: employeeError } = ids.length
      ? await db.from("rh_employees").select("id, full_name, unit").in("id", ids)
      : { data: [], error: null };
    if (employeeError) throw new Error(employeeError.message);
    const names = new Map((employees ?? []).map((e: any) => [e.id, e]));
    return (rows ?? []).map((row: any) => ({ ...row, employee: names.get(row.employee_id) ?? null }));
  });

export const createRhVtTopupsBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { rows: Array<{
    employee_id: string; paid_at: string; amount_cents: number;
    cost_center?: string | null; receipt_storage_path?: string | null;
    idempotency_key?: string;
  }> }) => {
    if (!Array.isArray(input.rows) || input.rows.length < 1 || input.rows.length > 500)
      throw new Error("O lote deve conter de 1 a 500 recargas.");
    for (const row of input.rows) {
      if (!row.employee_id || !/^\d{4}-\d{2}-\d{2}$/.test(row.paid_at) ||
        !Number.isInteger(row.amount_cents) || row.amount_cents <= 0)
        throw new Error("Cada recarga precisa de funcionário, data e valor válidos.");
    }
    return input;
  })
  .handler(async ({ context, data }) => {
    const actor = await requireVtOperator(context);
    const rows = data.rows.map(row => {
      const key = row.idempotency_key || randomUUID();
      return { ...row, company_id: actor.company_id ?? null, idempotency_key: key, treasury_idempotency_key: `rh-vt:${key}` };
    });
    const { data: created, error } = await db.rpc("rh_vt_create_topups_batch", {
      p_rows: rows, p_actor: actor.id,
    });
    if (error) throw new Error(error.message);
    return created ?? [];
  });

export const updateRhVtTopup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: {
    id: string; amount_cents: number; paid_at: string; cost_center?: string | null;
    receipt_storage_path?: string | null; reason: string;
  }) => {
    if (!input.id || !Number.isInteger(input.amount_cents) || input.amount_cents <= 0 ||
      !input.paid_at || !input.reason?.trim()) throw new Error("Valor, data e motivo são obrigatórios.");
    return input;
  })
  .handler(async ({ context, data }) => {
    const actor = await requireVtOperator(context);
    const { data: updated, error } = await db.rpc("rh_vt_update_topup", {
      p_topup_id: data.id, p_amount_cents: data.amount_cents, p_paid_at: data.paid_at,
      p_cost_center: data.cost_center ?? null, p_receipt_storage_path: data.receipt_storage_path ?? null,
      p_reason: data.reason.trim(), p_actor: actor.id,
    });
    if (error) throw new Error(error.message);
    return updated;
  });

export const cancelRhVtTopup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { id: string; reason: string }) => {
    if (!input.id || !input.reason?.trim()) throw new Error("Justificativa obrigatória.");
    return input;
  })
  .handler(async ({ context, data }) => {
    const actor = await requireVtOperator(context);
    const { data: cancelled, error } = await db.rpc("rh_vt_cancel_topup", {
      p_topup_id: data.id, p_reason: data.reason.trim(), p_actor: actor.id,
    });
    if (error) throw new Error(error.message);
    return cancelled;
  });

export const listRhVtTopupAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: { topup_id: string }) => {
    if (!input.topup_id) throw new Error("Recarga inválida.");
    return input;
  })
  .handler(async ({ context, data }) => {
    await requireVtOperator(context);
    const { data: rows, error } = await db.from("rh_vt_topup_audit")
      .select("*").eq("topup_id", data.topup_id).order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
