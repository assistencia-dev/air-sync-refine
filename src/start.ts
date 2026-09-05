import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
// Intentionally NOT the generated attachSupabaseAuth: the brokered preview session
// can resolve late, so we use a retrying bearer attacher instead.
import { attachSupabaseBearer } from "@/lib/supabase-bearer-middleware";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseBearer],
  requestMiddleware: [errorMiddleware],
}));
