/**
 * policy-ack Edge Function (admin / department manager / branch manager).
 *
 * Records that the caller has read & acknowledged a PUBLISHED policy. The
 * acknowledger is stamped from the caller's directory row, never trusted from the
 * body; the ack is pinned to the policy's current version, and is idempotent
 * (acknowledging twice is a no-op). HR publishes policies and does not acknowledge
 * their own. Runs as service_role.
 */

import { serviceClient, callerRole, bearer } from '../_shared/auth.ts'
import { cors, json } from '../_shared/http.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  try {
    const admin = serviceClient()
    const role = await callerRole(admin, bearer(req))
    if (!role) return json({ error: 'Sign in first.' }, 401)
    if (role.kind === 'manager' && role.role === 'hr') {
      return json({ error: 'HR publishes policies — there’s nothing to acknowledge.' }, 403)
    }

    const body = await req.json().catch(() => ({}))
    const policyId = String(body.policy_id ?? '')
    if (!policyId) return json({ error: 'Which policy?' }, 400)

    const { data: policy } = await admin
      .from('policies')
      .select('id, version, status')
      .eq('id', policyId)
      .maybeSingle()
    if (!policy) return json({ error: 'That policy no longer exists.' }, 404)
    if (policy.status !== 'published') return json({ error: 'That policy isn’t published yet.' }, 409)

    const ackRole = role.kind === 'admin' ? 'admin' : role.role
    const managerId = role.kind === 'admin' ? null : role.id
    const version = policy.version as number

    // Idempotent: if this acknowledger has already signed this version, do nothing.
    let existing = admin
      .from('policy_acknowledgments')
      .select('id')
      .eq('policy_id', policyId)
      .eq('version', version)
    existing = managerId ? existing.eq('manager_id', managerId) : existing.is('manager_id', null)
    const { data: already } = await existing.maybeSingle()
    if (already) return json({ ok: true, already: true })

    const { data: row, error } = await admin
      .from('policy_acknowledgments')
      .insert({ policy_id: policyId, manager_id: managerId, name: role.name, role: ackRole, version })
      .select('*')
      .single()
    if (error) return json({ error: error.message }, 500)

    return json({ ok: true, acknowledgment: row })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Could not record the acknowledgment.' }, 500)
  }
})
