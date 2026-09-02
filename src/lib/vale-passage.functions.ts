import { createHmac, randomUUID } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function base64Url(value: string) {
  return Buffer.from(value).toString("base64url");
}

export const createValePassageSsoUrl = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: profile, error } = await context.supabase
      .from("users")
      .select("username, role_key, status")
      .eq("auth_id", context.userId)
      .maybeSingle();
    if (error || !profile) throw new Error("Perfil administrativo não encontrado.");
    if (
      profile.status !== "ativo" ||
      !["DBS123", "DBSASSISTENCIA123"].includes(profile.username ?? "")
    ) {
      throw new Error(
        "O módulo de Controle de Passagem está disponível somente para operadores nativos.",
      );
    }

    const baseUrl = process.env.VALE_PASSAGEM_URL ?? "https://valepassagem-d8edi3fl.manus.space";
    // O módulo original valida este mesmo nome de segredo no servidor.
    const secret = process.env.DBS_SSO_SHARED_SECRET ?? process.env.VALE_PASSAGEM_SSO_SECRET;
    if (!baseUrl || !secret) {
      throw new Error("O módulo de Controle de Passagem ainda não foi configurado no ambiente.");
    }
    const payload = {
      username: "DBSASSISTENCIA123",
      exp: Math.floor(Date.now() / 1000) + 60,
      nonce: randomUUID(),
    };
    const encodedPayload = base64Url(JSON.stringify(payload));
    const signature = createHmac("sha256", secret).update(encodedPayload).digest("base64url");
    return { url: `${baseUrl.replace(/\/$/, "")}/auth/sso?token=${encodedPayload}.${signature}` };
  });
