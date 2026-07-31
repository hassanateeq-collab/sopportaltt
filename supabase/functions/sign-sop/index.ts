/**
 * sign-sop Edge Function.
 *
 * Records a staff member's acknowledgment of the CURRENT version of an SOP.
 * Re-signing an already-signed version is a no-op (returns the existing row).
 * The eligibility rule is re-checked here, not trusted from the UI: an SOP that
 * doesn't apply to the member's department/branch can't be signed.
 */

import { serviceClient, staffFromToken, bearer } from '../_shared/auth.ts'
import { scopeIncludes } from '../_shared/scope.ts'
import { cors, json } from '../_shared/http.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  try {
    const admin = serviceClient()
    const body = await req.json().catch(() => ({}))
    const token = String(body.token ?? '') || bearer(req)
    const sopId = String(body.sop_id ?? '')

    const staff = await staffFromToken(admin, token)
    if (!staff) return json({ error: 'Your session has ended. Please sign in again.' }, 401)

    const { data: sop } = await admin
      .from('sops')
      .select('id, version, department_id, branch_scope, code')
      .eq('id', sopId)
      .maybeSingle()
    if (!sop) return json({ error: 'That SOP no longer exists.' }, 404)

    const { data: branchRow } = await admin.from('branches').select('code').eq('id', staff.branch_id).maybeSingle()
    const branchCode = branchRow?.code as string | undefined
    if (sop.department_id !== staff.department_id || !scopeIncludes(sop.branch_scope, branchCode)) {
      return json({ error: 'This SOP does not apply to your department or branch.' }, 403)
    }

    const { data: existing } = await admin
      .from('acknowledgments')
      .select('*')
      .eq('staff_id', staff.id)
      .eq('sop_id', sop.id)
      .eq('version', sop.version)
      .maybeSingle()
    if (existing) return json({ acknowledgment: existing })

    const { data: ack, error } = await admin
      .from('acknowledgments')
      .insert({ staff_id: staff.id, sop_id: sop.id, version: sop.version })
      .select('*')
      .single()
    if (error) return json({ error: error.message }, 500)

    return json({ acknowledgment: ack })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Could not record your sign-off.' }, 500)
  }
})
