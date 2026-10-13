import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function getCaller(context: { userId: string }) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.from("users")
    .select("id, auth_id, username, full_name, email, role_key, company_id, status, created_by")
    .eq("auth_id", context.userId).maybeSingle();
  if (error || !data || data.status !== "ativo") throw new Error("Acesso não autorizado.");
  return { admin: supabaseAdmin, user: data };
}

export const createTreasuryViewer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { full_name: string; email: string; username: string; password: string }) => {
    if (!input?.full_name?.trim()) throw new Error("Informe o nome completo.");
    if (!input.email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) throw new Error("E-mail inválido.");
    if (!input.username?.trim() || !/^[a-zA-Z0-9._-]{3,40}$/.test(input.username)) throw new Error("Usuário deve ter de 3 a 40 caracteres (letras, números, ponto, hífen ou sublinhado).");
    if (!input.password || input.password.length < 12) throw new Error("Use uma senha com pelo menos 12 caracteres.");
    return { full_name: input.full_name.trim(), email: input.email.trim().toLowerCase(), username: input.username.trim(), password: input.password };
  })
  .handler(async ({ context, data }) => {
    const { admin, user } = await getCaller(context);
    if (user.role_key !== "SUPER_ADMIN") throw new Error("Somente o administrador principal pode criar esse acesso.");
    const { data: existing } = await admin.from("users").select("id").or(`email.eq.${data.email},username.eq.${data.username}`).limit(1);
    if (existing?.length) throw new Error("Já existe um usuário com esse e-mail ou nome de acesso.");
    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email: data.email, password: data.password, email_confirm: true,
      user_metadata: { full_name: data.full_name, username: data.username }
    });
    if (authError || !authData.user) throw new Error(authError?.message || "Não foi possível criar a autenticação.");
    const { data: viewerProfile, error: profileError } = await admin.from("users").insert({
      auth_id: authData.user.id, username: data.username, full_name: data.full_name,
      email: data.email, role_key: "FINANCEIRO_LEITURA" as any, status: "ativo", created_by: user.id,
      company_id: user.company_id ?? null
    }).select("id").single();
    if (profileError || !viewerProfile) {
      await admin.auth.admin.deleteUser(authData.user.id);
      throw new Error("Não foi possível gravar o perfil: " + (profileError?.message || "perfil não retornado"));
    }
    const { error: accessError } = await admin.from("treasury_viewer_access").insert({
      viewer_user_id: viewerProfile.id, owner_user_id: user.id, enabled: true, created_by: user.id
    });
    if (accessError) {
      await admin.from("users").delete().eq("id", viewerProfile.id);
      await admin.auth.admin.deleteUser(authData.user.id);
      throw new Error("Não foi possível vincular o acesso ao financeiro: " + accessError.message);
    }
    await admin.from("audit_log").insert({
      actor_user_id: user.id, action: "created_treasury_viewer",
      metadata_json: { username: data.username, email: data.email, role_key: "FINANCEIRO_LEITURA" }
    });
    return { ok: true, username: data.username, email: data.email };
  });

export const getTreasuryViewerData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { admin, user } = await getCaller(context);
    if (user.role_key !== "FINANCEIRO_LEITURA" && user.role_key !== "SUPER_ADMIN") {
      throw new Error("Este painel é exclusivo para acompanhamento financeiro.");
    }
    let ownerId = user.id;
    if (user.role_key === "FINANCEIRO_LEITURA") {
      const { data: access, error: accessError } = await admin.from("treasury_viewer_access")
        .select("owner_user_id, enabled").eq("viewer_user_id", user.id).maybeSingle();
      if (accessError || !access || access.enabled !== true) {
        throw new Error("Este acesso de acompanhamento está desativado ou não possui vínculo financeiro.");
      }
      ownerId = access.owner_user_id;
    }
    const { data: owner, error: ownerError } = await admin.from("users").select("id, company_id, status").eq("id", ownerId).maybeSingle();
    if (ownerError || !owner || owner.status !== "ativo") throw new Error("O responsável pelo financeiro não está ativo.");
    const scopeKey = owner.company_id ? "company:" + owner.company_id : "user:" + owner.id;
    const { data: snapshot, error } = await admin.from("treasury_snapshots").select("state, updated_at").eq("scope_key", scopeKey).maybeSingle();
    if (error) throw new Error("Falha ao consultar o financeiro: " + error.message);
    const state = snapshot?.state && typeof snapshot.state === "object" && !Array.isArray(snapshot.state)
      ? snapshot.state as Record<string, any> : {};
    // Use a data local do servidor, sem converter meia-noite local para UTC
    // (o que pode deslocar o dia em fusos como o de Brasília).
    const dateKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    const today = new Date(); today.setHours(0,0,0,0);
    const isoToday = dateKey(today);
    const addDays = (n: number) => { const d = new Date(today); d.setDate(d.getDate()+n); return dateKey(d); };
    const isPaid = (status: unknown) => ["pago","paga","quitado","quitada","baixado","baixada"].includes(String(status || "").trim().toLowerCase());
    const pending = (state.contasPagar || []).filter((x: any) => !isPaid(x.status))
      .map((x: any) => ({ id: String(x.id || ""), fornecedor: String(x.fornecedor || "Fornecedor não informado"),
        descricao: String(x.descricao || "—"), valor: Number(x.valor) || 0, vencimento: String(x.vencimento || ""),
        status: String(x.status || "Pendente"), categoria: String(x.categoria || "") }));
    const installments = (state.passivos || []).filter((x: any) => !x.arquivado).flatMap((p: any) =>
      (p.parcelas || []).filter((x: any) => !isPaid(x.status))
        .map((x: any) => ({ id: String(x.id || ""), fornecedor: String(p.credor || "Credor não informado"),
          descricao: `Parcela ${x.num || ""} · ${String(p.doc || p.documento || "Acordo")}`,
          valor: Number(x.valor) || 0, vencimento: String(x.vencimento || ""), status: String(x.status || "Pendente"), categoria: "Passivo" })));
    const dues = [...pending, ...installments].filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x.vencimento))
      .sort((a,b) => a.vencimento.localeCompare(b.vencimento));
    const sum = (items: any[]) => items.reduce((total, x) => total + (Number(x.valor) || 0), 0);
    const banks = (state.bancos || []).filter((b: any) => String(b.status || "Ativa").toLowerCase() !== "inativa");
    const cash = banks.reduce((total: number, b: any) => total + (Number(b.saldoAtual ?? b.saldo ?? b.saldoInicial) || 0), 0);
    const recurrences = (state.recorrencias || []).filter((x: any) => !x.arquivado);
    const recurringMonthly = recurrences.reduce((total: number, x: any) => {
      const v = Number(x.valor) || 0;
      return total + (x.frequencia === "Anual" ? v/12 : x.frequencia === "Trimestral" ? v/3 : v);
    }, 0);
    const incoming = (state.recebimentos || []).filter((x: any) => !["recebido","recebida","pago","paga","quitado","quitada","baixado","baixada"].includes(String(x.status || "").trim().toLowerCase()));
    return {
      updatedAt: snapshot?.updated_at ?? null,
      today: isoToday,
      summary: {
        cash, overdue: sum(dues.filter(x => x.vencimento < isoToday)),
        dueToday: sum(dues.filter(x => x.vencimento === isoToday)),
        next7: sum(dues.filter(x => x.vencimento >= isoToday && x.vencimento <= addDays(7))),
        next30: sum(dues.filter(x => x.vencimento >= isoToday && x.vencimento <= addDays(30))),
        pendingPayables: sum(pending), passives: sum(installments),
        expectedReceipts: sum(incoming), recurringMonthly
      },
      dues: dues.slice(0, 250),
      source: "DBS TREASURY",
    };
  });
