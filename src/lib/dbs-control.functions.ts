async function recordDbsControlSyncAttempt(input: {
  scopeKey: string; companyId?: string | null; ownerUserId?: string | null; userId: string;
  action: string; status: "success" | "error" | "retry";
  payload?: Record<string, unknown> | null; result?: Record<string, unknown> | null; errorMessage?: string | null;
}) {
  try {
    const startedAt = new Date();
    const { error } = await supabaseAdmin.from("dbs_control_sync_runs").insert({
      scope_key: input.scopeKey,
      company_id: input.companyId ?? null,
      owner_user_id: input.ownerUserId ?? null,
      user_id: input.userId,
      mode: input.action,
      action: input.action,
      status: input.status,
      summary: input.status === "success" ? "snapshot saved successfully" : input.errorMessage ?? input.action,
      payload: input.payload ?? {},
      result: input.result ?? {},
      errors: input.errorMessage ? [input.errorMessage] : [],
      error_message: input.errorMessage ?? null,
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      created_at: startedAt.toISOString(),
    });
    if (error) console.error("DBS CONTROL: falha ao gravar auditoria de sincronização.", error.message);
  } catch (error) {
    console.error("DBS CONTROL: falha ao gravar auditoria de sincronização.", error);
  }
}
