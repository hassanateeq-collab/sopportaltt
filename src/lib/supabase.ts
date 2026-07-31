/**
 * Supabase client.
 *
 * The portal runs in one of two modes, chosen entirely by whether these two
 * public env vars are present at build time:
 *
 *   - VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY set  → Supabase mode (live).
 *   - either missing                                    → demo mode (localStorage).
 *
 * This is deliberate: the live Vercel site with no env vars keeps running the
 * self-contained demo, and the moment those two vars are added in Vercel and the
 * site is redeployed, the same code talks to the real database. Nothing else
 * flips a switch.
 *
 * Only the ANON key ever lives here. It is designed to be public — row-level
 * security is what protects the data. The service_role key never appears in the
 * frontend; it lives only inside Edge Functions.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

// An explicit VITE_USE_SUPABASE=false can force demo mode even when the keys are
// present (handy for local testing); otherwise presence of the keys enables it.
const forced = import.meta.env.VITE_USE_SUPABASE
const explicitlyOff = String(forced).toLowerCase() === 'false'

export const isSupabaseEnabled = Boolean(url && anonKey && !explicitlyOff)

/**
 * The shared client, or null in demo mode. Session persistence is on so a
 * manager/admin stays signed in across reloads; the staff JWT (minted by the
 * staff-login Edge Function) is set on this same client as its access token.
 */
export const supabase: SupabaseClient | null = isSupabaseEnabled
  ? createClient(url!, anonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey: 'hamsun-sop-portal/auth',
      },
    })
  : null

/** Base URL for invoking Edge Functions, e.g. `${functionsBase}/staff-login`. */
export const functionsBase = url ? `${url.replace(/\/$/, '')}/functions/v1` : ''

/**
 * The public anon key, used as the gateway credential when invoking Edge
 * Functions that a not-yet-signed-in staff member calls (staff-login,
 * staff-directory) or that carry their own opaque staff token in the body
 * (staff-data, sign-sop, submit-attempt). It's public by design.
 */
export const anonPublicKey = anonKey ?? ''

export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error('Supabase is not configured in this build.')
  }
  return supabase
}
