import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type TreasuryLineInput = {
  account_code: string;
  account_name: string;
  account_type: "asset" | "liability" | "equity" | "revenue" | "expense";
  debit_cents?: number;
  credit_cents?: number;
  memo?: string | null;
  metadata?: Record<string, unknown>;
};

type TreasuryLedgerCommand = {
  idempotency_key: string;
  competence_date: string;
  document_date?: string | null;
  entry_type?: string;
  description: string;
  status?: "draft" | "posted";
  external_key?: string | null;
  metadata?: Record<string, unknown>;
  lines: TreasuryLineInput[];
};

async function requireTreasuryReader(context: { userId: string }) {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id, company_id, role_key, status")
    .eq("auth_id", context.userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data || data.status !== "ativo" || !["SUPER_ADMIN", "FINANCEIRO_LEITURA"].includes(data.role_key)) {
    throw new Error("Acesso ao Financeiro não autorizado.");
  }
  return data;
}

async function requireTreasuryAdmin(context: { userId: string }) {
  const user = await requireTreasuryReader(context);
  if (user.role_key !== "SUPER_ADMIN") {
    throw new Error("Lançamentos manuais do Treasury são restritos ao SUPER_ADMIN.");
  }
  return user;
}

async function requirePurchaseApprovalActor(context: { userId: string }) {
  const user = await requireTreasuryReader(context);
  if (!["SUPER_ADMIN", "FINANCEIRO_LEITURA"].includes(user.role_key)) {
    throw new Error("Aprovação de compras restrita ao Financeiro.");
  }
  return user;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function cloneState(value: unknown): Record<string, any> {
  const state = asObject(value);
  const cloned = JSON.parse(JSON.stringify(state)) as Record<string, any>;
  for (const key of ["passivos", "recorrencias", "recebimentos", "contasPagar", "bancos", "movimentacoes", "auditoria"]) {
    if (!Array.isArray(cloned[key])) cloned[key] = [];
  }
  if (!cloned._meta || typeof cloned._meta !== "object" || Array.isArray(cloned._meta)) cloned._meta = {};
  return cloned;
}

function mergeLedgerState(snapshotState: unknown, entries: any[]): Record<string, any> | null {
  const hasSnapshot = Boolean(snapshotState && typeof snapshotState === "object" && !Array.isArray(snapshotState));
  if (!hasSnapshot && entries.length === 0) return null;
  const state = cloneState(snapshotState);
  const movementIds = new Set((state.movimentacoes as any[]).map((item) => `${String(item?.ledgerEntryId || "")}:${String(item?.id || "")}`));

  for (const entry of entries) {
    const metadata = asObject(entry.metadata);
    const record = asObject(metadata.record);
    const recordAfter = asObject(metadata.record_after);
    const sourceKind = String(metadata.source_kind || "");
    const sourceId = String(metadata.source_id || record.id || recordAfter.id || "");

    if (sourceKind === "recebimento" && sourceId) {
      const existing = state.recebimentos.find((item: any) => String(item?.id) === sourceId);
      const next = entry.status === "posted" ? recordAfter : record;
      if (Object.keys(next).length > 0) {
        if (existing) Object.assign(existing, next);
        else state.recebimentos.push({ ...next });
      }
    }
    if (sourceKind === "conta_pagar" && sourceId) {
      const existing = state.contasPagar.find((item: any) => String(item?.id) === sourceId);
      const next = entry.status === "posted" ? recordAfter : record;
      if (Object.keys(next).length > 0) {
        if (existing) Object.assign(existing, next);
        else state.contasPagar.push({ ...next });
      }
    }
    if (sourceKind === "parcela_acordo" && sourceId) {
      const next = entry.status === "posted" ? recordAfter : record;
      for (const passivo of state.passivos as any[]) {
        const parcel = Array.isArray(passivo?.parcelas)
          ? passivo.parcelas.find((item: any) => String(item?.id) === sourceId)
          : null;
        if (parcel && Object.keys(next).length > 0) Object.assign(parcel, next);
      }
    }
    if (sourceKind === "recorrencia" && sourceId) {
      const existing = state.recorrencias.find((item: any) => String(item?.id) === sourceId);
      const next = entry.status === "posted" ? recordAfter : record;
      if (existing && Object.keys(next).length > 0) Object.assign(existing, next);
    }

    const movements = Array.isArray(metadata.movements)
      ? metadata.movements.map(asObject)
      : [asObject(metadata.movement)];
    if (entry.status === "posted") {
      movements.forEach((movement, index) => {
        if (Object.keys(movement).length === 0) return;
        const normalized = {
          ...movement,
          id: String(movement.id || `ledger_${entry.id}_${index + 1}`),
          ledgerEntryId: String(entry.id),
          idempotencyKey: String(entry.idempotency_key || ""),
        };
        const key = `${normalized.ledgerEntryId}:${normalized.id}`;
        if (!movementIds.has(key)) {
          state.movimentacoes.push(normalized);
          movementIds.add(key);
        }
      });
    }
  }

  state.movimentacoes.sort((a: any, b: any) => String(b.data || "").localeCompare(String(a.data || "")));
  state._meta = {
    ...state._meta,
    ledgerMode: "relational",
    ledgerEntryCount: entries.length,
    ledgerReadAt: new Date().toISOString(),
  };
  return state;
}

export async function readTreasuryScope(user: { id: string; company_id: string | null }) {
  const scopeKey = user.company_id ? `company:${user.company_id}` : `user:${user.id}`;
  const admin = supabaseAdmin as any;
  const [
    { data: snapshot, error: snapshotError },
    { data: entries, error: entriesError },
    { data: purchaseCommitments, error: commitmentsError },
    { data: costCenters, error: costCentersError },
    { data: pendingPurchaseApprovals, error: pendingPurchaseApprovalsError },
  ] = await Promise.all([
    supabaseAdmin
      .from("treasury_snapshots")
      .select("state, state_version, updated_at")
      .eq("scope_key", scopeKey)
      .maybeSingle(),
    admin
      .from("treasury_ledger_entries")
      .select("id, scope_key, competence_date, document_date, entry_type, status, description, idempotency_key, metadata, updated_at, created_at")
      .eq("scope_key", scopeKey)
      .in("status", ["draft", "posted"])
      .order("competence_date", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(5000),
    admin
      .from("dbs_treasury_purchase_commitments")
      .select("purchase_id,supplier_name,document_number,commitment_date,purchase_status,payment_status,total_cents,paid_cents,outstanding_cents,received_total_cents,payable_ledger_entry_id")
      .eq("scope_key", scopeKey)
      .order("commitment_date", { ascending: true })
      .limit(500),
    admin
      .from("dbs_control_cost_centers")
      .select("id,code,name,status")
      .eq("scope_key", scopeKey)
      .eq("status", "active")
      .order("code", { ascending: true })
      .limit(500),
    admin
      .from("dbs_control_purchases")
      .select("id,supplier_name,document_number,purchase_date,total_cents,approval_status,version,cost_center_id")
      .eq("scope_key", scopeKey)
      .eq("approval_status", "pending")
      .neq("status", "cancelled")
      .order("purchase_date", { ascending: false })
      .limit(100),
  ]);

  if (snapshotError) throw new Error(snapshotError.message);
  if (entriesError) throw new Error(entriesError.message);
  if (commitmentsError) throw new Error("Falha ao carregar compromissos de compras: " + commitmentsError.message);
  if (costCentersError) throw new Error("Falha ao carregar centros de custo: " + costCentersError.message);
  if (pendingPurchaseApprovalsError) throw new Error("Falha ao carregar aprovações pendentes: " + pendingPurchaseApprovalsError.message);
  const state = mergeLedgerState(snapshot?.state, entries ?? []);
  if (state) {
    state._meta = {
      ...state._meta,
      centrosCusto: (costCenters ?? []).map((center: any) => ({
        id: String(center.id), codigo: String(center.code), nome: String(center.name), ativo: center.status === "active"
      })),
    };
  }
  const lastLedgerUpdate = (entries ?? []).reduce((latest: string | null, entry: any) => {
    const current = entry.updated_at ?? null;
    if (!current) return latest;
    return !latest || current > latest ? current : latest;
  }, null);

  return {
    state,
    state_version: snapshot?.state_version ?? 5,
    updated_at: snapshot?.updated_at ?? lastLedgerUpdate,
    ledger_entry_count: entries?.length ?? 0,
    purchase_commitments: purchaseCommitments ?? [],
    pending_purchase_approvals: pendingPurchaseApprovals ?? [],
    cost_centers: costCenters ?? [],
    source: state ? "legacy_read_plus_relational_ledger" : "relational_master_data",
  };
}

export const getTreasuryCloudState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const user = await requireTreasuryReader(context);
    return readTreasuryScope(user);
  });

function isTransientTreasuryError(error: unknown) {
  const message = String((error as any)?.message || error || "").toLowerCase();
  const status = Number((error as any)?.status || (error as any)?.code || 0);
  return [408, 425, 429, 500, 502, 503, 504].includes(status)
    || /timeout|timed out|warp|fetch failed|network|temporar|connection reset|gateway/.test(message);
}

async function postLedgerWithRetry(payload: Record<string, unknown>) {
  const delays = [0, 250, 750, 1500];
  let lastError: unknown;
  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt] > 0) await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    const { data, error } = await (supabaseAdmin as any).rpc("post_treasury_ledger_entry", payload);
    if (!error) return data;
    lastError = error;
    if (!isTransientTreasuryError(error) || attempt === delays.length - 1) break;
  }
  throw new Error(String((lastError as any)?.message || "Falha ao gravar o lançamento relacional."));
}

export const postTreasuryLedgerEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: TreasuryLedgerCommand) => {
    if (!input?.idempotency_key || input.idempotency_key.length < 8 || input.idempotency_key.length > 200) {
      throw new Error("Chave de idempotência financeira inválida.");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.competence_date)) throw new Error("Competência financeira inválida.");
    if (!input.description?.trim()) throw new Error("Descrição do lançamento obrigatória.");
    if (!Array.isArray(input.lines) || input.lines.length < 2 || input.lines.length > 50) {
      throw new Error("O lançamento precisa de pelo menos duas partidas.");
    }
    for (const line of input.lines) {
      if (!line.account_code?.trim() || !line.account_name?.trim()) throw new Error("Conta contábil inválida.");
      const debit = Number(line.debit_cents || 0);
      const credit = Number(line.credit_cents || 0);
      if (!Number.isInteger(debit) || !Number.isInteger(credit) || debit < 0 || credit < 0 || (debit === 0) === (credit === 0)) {
        throw new Error("Valor de partida contábil inválido.");
      }
    }
    return input;
  })
  .handler(async ({ context, data }) => {
    const user = await requireTreasuryAdmin(context);
    const scopeKey = user.company_id ? `company:${user.company_id}` : `user:${user.id}`;
    const result = await postLedgerWithRetry({
      p_scope_key: scopeKey,
      p_company_id: user.company_id ?? null,
      p_competence_date: data.competence_date,
      p_document_date: data.document_date ?? null,
      p_entry_type: data.entry_type ?? "manual",
      p_description: data.description.trim(),
      p_idempotency_key: data.idempotency_key,
      p_external_key: data.external_key ?? null,
      p_created_by: user.id,
      p_status: data.status ?? "posted",
      p_metadata: data.metadata ?? {},
      p_lines: data.lines,
    });
    return { ...(asObject(result) as any), scope_key: scopeKey };
  });


export const saveTreasuryCostCenter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { code: string; name: string }) => {
    const code=String(input?.code ?? "").trim().toUpperCase();
    const name=String(input?.name ?? "").trim();
    if(!/^[A-Z0-9._-]{1,40}$/.test(code)) throw new Error("Informe um código válido para o centro de custo.");
    if(name.length<2||name.length>180) throw new Error("Informe o nome do centro de custo.");
    return {code,name};
  })
  .handler(async ({context,data})=>{
    const user=await requireTreasuryAdmin(context);
    const scopeKey=user.company_id? `company:${user.company_id}` : `user:${user.id}`;
    const admin=supabaseAdmin as any;
    const saved=await admin.from("dbs_control_cost_centers").upsert({
      company_id:user.company_id,
      scope_key:scopeKey,
      code:data.code,
      name:data.name,
      status:"active",
      created_by:user.id,
      updated_by:user.id,
      updated_at:new Date().toISOString(),
    },{onConflict:"scope_key,normalized_code"}).select("id,code,name,status").single();
    if(saved.error) throw new Error(saved.error.message);
    return {id:String(saved.data.id),code:String(saved.data.code),name:String(saved.data.name),ativo:saved.data.status==="active"};
  });


export const decideDbsPurchaseApprovalFromTreasury = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: {
    purchaseId: string;
    decision: "approved" | "rejected";
    reason?: string;
    expectedVersion: number;
  }) => {
    const purchaseId = String(input?.purchaseId ?? "").trim();
    const decision = input?.decision;
    const reason = String(input?.reason ?? "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(purchaseId)) {
      throw new Error("Compra inválida.");
    }
    if (decision !== "approved" && decision !== "rejected") {
      throw new Error("Decisão de aprovação inválida.");
    }
    if (decision === "rejected" && (reason.length < 5 || reason.length > 1000)) {
      throw new Error("Informe o motivo da rejeição (mínimo 5 caracteres).");
    }
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new Error("Versão da compra inválida. Atualize a fila.");
    }
    return { purchaseId, decision, reason: reason || null, expectedVersion: input.expectedVersion };
  })
  .handler(async ({ context, data }) => {
    const user = await requirePurchaseApprovalActor(context);
    const { data: result, error } = await (supabaseAdmin as any).rpc("dbs_control_decide_purchase_approval", {
      p_purchase_id: data.purchaseId,
      p_actor_user_id: user.id,
      p_decision: data.decision,
      p_reason: data.reason,
      p_expected_version: data.expectedVersion,
    });
    if (error) throw new Error(error.message);
    return result;
  });
