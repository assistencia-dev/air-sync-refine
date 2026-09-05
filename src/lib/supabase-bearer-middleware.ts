import { createMiddleware } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";

/**
 * Client middleware that attaches the Supabase bearer token to every serverFn call.
 *
 * Replaces the generated `attachSupabaseAuth` because on Lovable preview surfaces the
 * auth session is brokered asynchronously over postMessage: right after load
 * `getSession()` can still resolve to `null`, which made protected server functions
 * fail with "Unauthorized: No authorization header provided". We retry briefly and
 * fall back to a refresh before giving up.
 */
async function getAccessToken(): Promise<string | undefined> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) return token;
    if (attempt === 2) {
      const { data: refreshed } = await supabase.auth.refreshSession();
      if (refreshed.session?.access_token) return refreshed.session.access_token;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return undefined;
}

export const attachSupabaseBearer = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    const token = await getAccessToken();
    return next({ headers: token ? { Authorization: `Bearer ${token}` } : {} });
  },
);
