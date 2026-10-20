// Server-side auth middleware for TanStack Start.
import { createMiddleware } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { createClient } from '@supabase/supabase-js'
import type { Database } from './types'

const SUPABASE_URL = 'https://gdglototcrehvhkvcqsq.supabase.co'

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith('sb_publishable_') || value.startsWith('sb_secret_')
}

function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined,
    )
    if (init?.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value))
    if (isNewSupabaseApiKey(supabaseKey) && headers.get('Authorization') === `Bearer ${supabaseKey}`) {
      headers.delete('Authorization')
    }
    headers.set('apikey', supabaseKey)
    return fetch(input, { ...init, headers })
  }
}

export const requireSupabaseAuth = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    const SUPABASE_ANON_KEY =
      process.env.SUPABASE_ANON_KEY ||
      process.env.SUPABASE_PUBLISHABLE_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY ||
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY

    if (!SUPABASE_ANON_KEY) {
      throw new Error('Missing Supabase public key. Configure the public key for the canonical DBS project.')
    }

    let request: ReturnType<typeof getRequest> | undefined
    try {
      request = getRequest()
    } catch (error) {
      // During preview/build inspection there may be no active request context.
      console.warn('[Supabase auth] Request context unavailable; protected operation was not executed.')
      throw new Error('Unauthorized: request context unavailable')
    }

    const authHeader = request?.headers?.get('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // Treat this as a controlled authentication failure, not an unhandled fetch/profile exception.
      throw new Error('Unauthorized: No valid authorization header provided')
    }

    const token = authHeader.slice('Bearer '.length).trim()
    if (!token || token.split('.').length !== 3) {
      throw new Error('Unauthorized: Invalid token')
    }

    const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        fetch: createSupabaseFetch(SUPABASE_ANON_KEY),
        headers: { Authorization: `Bearer ${token}` },
      },
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    })

    try {
      const { data, error } = await supabase.auth.getClaims(token)
      if (error || !data?.claims?.sub) throw new Error('Unauthorized: Invalid token')
      return await next({
        context: { supabase, userId: data.claims.sub, claims: data.claims },
      })
    } catch (error) {
      console.warn('[Supabase auth] Token validation failed; protected operation denied.')
      throw error instanceof Error ? error : new Error('Unauthorized: Invalid token')
    }
  },
)
