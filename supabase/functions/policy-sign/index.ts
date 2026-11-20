/**
 * policy-sign Edge Function (staff, token-gated).
 *
 * Records that the signed-in staff member has read & acknowledged a published
 * policy. Pinned to the policy's current version, idempotent. Mirrors sign-sop.
 * Runs as service_role.
 */

import { serviceClient, staffFromToken, bearer } from '../_shared/auth.ts'
import { cors, json } from '../_shared/http.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  try {
    const admin = serviceClient()
    const body = await req.json().catch(() => ({}))
    const token = String(body.token ?? bearer(req) ?? '')
    const policyId = String(body.policy_id ?? '')
    const staff = await staffFromToken(admin, token)
    if (!staff) return json({ error: 'Your session has expired — sign in again.' }, 401)
    if (!policyId) return json({ error: 'Which policy?' }, 400)

    const { data: policy } = await admin
      .from('policies')
      .select('id, version, status, department_id')
      .eq('id', policyId)
      .maybeSingle()
    if (!policy) return json({ error: 'That policy no longer exists.' }, 404)
    if (policy.status !== 'published') return json({ error: 'That policy isn’t published.' }, 409)
    if (policy.department_id !== staff.department_id) {
      return json({ error: 'That policy isn’t for your department.' }, 403)
    }

    const version = policy.version as number
    const { data: existing } = await admin
      .from('policy_acknowledgments')
      .select('id')
      .eq('policy_id', policyId)
      .eq('version', version)
      .eq('staff_id', staff.id)
      .maybeSingle()
    if (existing) return json({ ok: true, already: true })

    const { data: row, error } = await admin
      .from('policy_acknowledgments')
      .insert({ policy_id: policyId, staff_id: staff.id, name: staff.name, role: 'staff', version })
      .select('*')
      .single()
    if (error) return json({ error: error.message }, 500)

    return json({ ok: true, acknowledgment: row })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Could not record the acknowledgment.' }, 500)
  }
})
