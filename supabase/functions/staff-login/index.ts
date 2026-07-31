/**
 * staff-login Edge Function.
 *
 * Verifies a staff member's numeric employee code against the bcrypt hash and
 * counts failures SERVER-SIDE: three wrong codes lock the record for fifteen
 * minutes. The lockout is counted in staff_lockouts, in the same place that
 * issues the session, because a counter the browser keeps is one an attacker
 * deletes. On success it mints an opaque session token (its SHA-256 is stored in
 * staff_sessions) and returns it with the staff row — no employee-code hash ever
 * reaches the browser.
 *
 * Called with the public anon key (the staff member has no token yet).
 */

import { serviceClient, sha256Hex, randomToken, STAFF_COLUMNS } from '../_shared/auth.ts'
import { cors, json } from '../_shared/http.ts'

const LOCKOUT_THRESHOLD = 3
const LOCKOUT_MINUTES = 15
const SESSION_HOURS = 9 // roughly one shift

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  try {
    const admin = serviceClient()
    const body = await req.json().catch(() => ({}))
    const staffId = String(body.staff_id ?? '')
    const code = String(body.code ?? '')
    if (!staffId) return json({ error: 'Select your name first.' }, 400)

    const { data: staff } = await admin
      .from('staff')
      .select(STAFF_COLUMNS)
      .eq('id', staffId)
      .maybeSingle()
    if (!staff || !staff.active) {
      return json({ error: 'That staff record is not active. Speak to your manager.' }, 403)
    }

    // Server-side lockout gate.
    const { data: lock } = await admin
      .from('staff_lockouts')
      .select('failures, locked_until')
      .eq('staff_id', staffId)
      .maybeSingle()
    if (lock?.locked_until && new Date(lock.locked_until as string).getTime() > Date.now()) {
      const mins = Math.ceil((new Date(lock.locked_until as string).getTime() - Date.now()) / 60_000)
      return json({ error: `Too many wrong codes. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` }, 429)
    }

    const { data: ok } = await admin.rpc('verify_staff_code', { p_staff: staffId, p_code: code })
    if (!ok) {
      const failures = (Number(lock?.failures) || 0) + 1
      const locked_until =
        failures >= LOCKOUT_THRESHOLD
          ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString()
          : null
      await admin.from('staff_lockouts').upsert({ staff_id: staffId, failures, locked_until })
      if (locked_until) {
        return json({ error: `Too many wrong codes. This record is locked for ${LOCKOUT_MINUTES} minutes.` }, 429)
      }
      const left = LOCKOUT_THRESHOLD - failures
      return json({ error: `Wrong code. ${left} attempt${left === 1 ? '' : 's'} left before this record locks.` }, 401)
    }

    // Success — clear the counter and mint a session.
    await admin.from('staff_lockouts').delete().eq('staff_id', staffId)
    const token = randomToken()
    const expires = new Date(Date.now() + SESSION_HOURS * 3_600_000)
    const { error: sessErr } = await admin.from('staff_sessions').insert({
      staff_id: staffId,
      token_hash: await sha256Hex(token),
      expires_at: expires.toISOString(),
    })
    if (sessErr) return json({ error: sessErr.message }, 500)

    return json({ token, staff, expires_at: expires.toISOString() })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Sign-in failed.' }, 500)
  }
})
