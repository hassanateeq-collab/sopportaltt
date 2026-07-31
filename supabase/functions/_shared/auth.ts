/**
 * Shared auth helpers for the Edge Functions.
 *
 * Two kinds of caller sign in here:
 *   - staff, who have no Supabase Auth account. staff-login mints an OPAQUE
 *     random token, stores its SHA-256 in staff_sessions, and hands the raw
 *     token to the browser. Every staff call carries that token; staffFromToken
 *     validates it with the service_role and returns the staff row. No JWT is
 *     minted, so this works regardless of the project's JWT signing setup.
 *   - managers/admins, who ARE Supabase Auth users. callerRole resolves their
 *     Auth JWT to an admins/managers row so the management functions can gate on
 *     "is the caller an admin".
 *
 * The service_role key is read from the auto-injected secret and never leaves
 * the function.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

/** The non-secret staff columns — never selects employee_code_hash. */
export const STAFF_COLUMNS = 'id,name,department_id,branch_id,job_title,active,created_at'

export interface StaffRow {
  id: string
  name: string
  department_id: string
  branch_id: string
  job_title: string
  active: boolean
  created_at: string
}

/** A service-role client that bypasses RLS. For server-side use only. */
export function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')!
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  return createClient(url, key, { auth: { persistSession: false } })
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** A 256-bit opaque session token as hex. */
export function randomToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Six-digit employee code from the CSPRNG (never a sequence, never leading 0). */
export function generateEmployeeCode(): string {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return String(100000 + (buf[0] % 900000))
}

/**
 * Validate an opaque staff session token and return the staff row, or null if
 * the token is unknown, expired, or the staff record is inactive. An expired
 * token is deleted as a side effect.
 */
export async function staffFromToken(admin: SupabaseClient, token: string): Promise<StaffRow | null> {
  if (!token) return null
  const hash = await sha256Hex(token)
  const { data: sess } = await admin
    .from('staff_sessions')
    .select('staff_id, expires_at')
    .eq('token_hash', hash)
    .maybeSingle()
  if (!sess) return null
  if (new Date(sess.expires_at as string).getTime() < Date.now()) {
    await admin.from('staff_sessions').delete().eq('token_hash', hash)
    return null
  }
  const { data: staff } = await admin
    .from('staff')
    .select(STAFF_COLUMNS)
    .eq('id', sess.staff_id as string)
    .eq('active', true)
    .maybeSingle()
  return (staff as StaffRow | null) ?? null
}

export type CallerRole =
  | { kind: 'admin'; id: string; name: string }
  | { kind: 'manager'; id: string; name: string; department_id: string; branch_id: string }
  | null

/** Resolve a manager/admin's Supabase Auth JWT to their directory row, or null. */
export async function callerRole(admin: SupabaseClient, jwt: string): Promise<CallerRole> {
  if (!jwt) return null
  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return null

  const { data: a } = await admin.from('admins').select('id, name').eq('auth_user_id', user.id).maybeSingle()
  if (a) return { kind: 'admin', id: a.id as string, name: a.name as string }

  const { data: m } = await admin
    .from('managers')
    .select('id, name, department_id, branch_id')
    .eq('auth_user_id', user.id)
    .eq('active', true)
    .maybeSingle()
  if (m) {
    return {
      kind: 'manager',
      id: m.id as string,
      name: m.name as string,
      department_id: m.department_id as string,
      branch_id: m.branch_id as string,
    }
  }
  return null
}

/** Read the Bearer token from the Authorization header. */
export function bearer(req: Request): string {
  return (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim()
}
