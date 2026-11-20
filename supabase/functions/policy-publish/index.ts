/**
 * policy-publish Edge Function (HR only).
 *
 * Publishes (or re-issues) a policy and notifies EVERYONE using the portal:
 * every active staff member gets a notification, and the admin and managers see
 * it waiting in their Policies board. Runs as service_role.
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
    if (!(role.kind === 'manager' && role.role === 'hr')) {
      return json({ error: 'Only HR can publish policies.' }, 403)
    }

    const body = await req.json().catch(() => ({}))
    const policyId = String(body.policy_id ?? '')
    const action = body.action === 'reissue' ? 'reissue' : 'publish'
    if (!policyId) return json({ error: 'Which policy?' }, 400)

    const { data: current } = await admin.from('policies').select('id, title, version').eq('id', policyId).maybeSingle()
    if (!current) return json({ error: 'That policy no longer exists.' }, 404)

    const patch =
      action === 'reissue'
        ? { status: 'published', version: (current.version as number) + 1, updated_at: new Date().toISOString() }
        : { status: 'published', published_by: role.name, updated_at: new Date().toISOString() }

    const { data: policy, error } = await admin.from('policies').update(patch).eq('id', policyId).select('*').single()
    if (error) return json({ error: error.message }, 500)

    // Notify every active staff member.
    const { data: staff } = await admin.from('staff').select('id').eq('active', true)
    const text = `New company policy ${policy.code} — ${policy.title} — has been published. Please read and acknowledge it.`
    const notes = (staff ?? []).map((s) => ({ staff_id: s.id as string, kind: 'policy_published', text, whatsapp_pending: true }))
    if (notes.length) await admin.from('notifications').insert(notes)

    return json({ ok: true, policy, notified: notes.length })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Could not publish the policy.' }, 500)
  }
})
