// Server-side Supabase client with service role key - bypasses RLS.
// Use only inside trusted server handlers. Never expose the secret key to clients.
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

function createSupabaseAdminClient() {
  const SUPABASE_SECRET_KEY =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    (() => {
      try {
        const raw = process.env.SUPABASE_SECRET_KEYS
        return raw ? JSON.parse(raw)?.default : undefined
      } catch {
        return undefined
      }
    })()

  if (!SUPABASE_SECRET_KEY) {
    throw new Error('Missing Supabase server secret. Configure SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY for the canonical DBS project.')
  }

  return createClient<Database>(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    global: { fetch: createSupabaseFetch(SUPABASE_SECRET_KEY) },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  })
}

let _supabaseAdmin: ReturnType<typeof createSupabaseAdminClient> | undefined

export const supabaseAdmin = new Proxy({} as ReturnType<typeof createSupabaseAdminClient>, {
  get(_, prop, receiver) {
    if (!_supabaseAdmin) _supabaseAdmin = createSupabaseAdminClient()
    return Reflect.get(_supabaseAdmin, prop, receiver)
  },
})
