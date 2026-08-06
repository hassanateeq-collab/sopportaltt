/**
 * grant-retest Edge Function (manager / admin).
 *
 * Approves exactly one retest for a staff member on a test after a failure, and
 * writes the staff notification in the same step. RLS deliberately exposes no
 * INSERT on retest_grants to managers/admins so this stays the single, audited
 * path (grant + notification, atomically, as the service_role). A manager may
 * approve a retest for any staff member — any department, any branch — as long
 * as it is a test she owns (built in her own department), mirroring assign-test.
 */

import { serviceClient, callerRole, bearer } from '../_shared/auth.ts'
import { cors, json } from '../_shared/http.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  try {
    const admin = serviceClient()
    const role = await callerRole(admin, bearer(req))
    if (!role) return json({ error: 'Sign in as a manager or admin first.' }, 401)

    const body = await req.json().catch(() => ({}))
    const testId = String(body.test_id ?? '')
    const staffId = String(body.staff_id ?? '')
    if (!testId || !staffId) return json({ error: 'Missing test or staff.' }, 400)

    const { data: staff } = await admin
      .from('staff')
      .select('id, name, department_id, branch_id')
      .eq('id', staffId)
      .maybeSingle()
    if (!staff) return json({ error: 'That staff record no longer exists.' }, 404)

    const { data: test } = await admin.from('tests').select('id, title, department_id').eq('id', testId).maybeSingle()
    if (!test) return json({ error: 'That test no longer exists.' }, 404)

    // A manager owns the test she built, so she may approve its retests for
    // anyone she assigned it to — across departments and branches. An admin may
    // approve any retest.
    if (role.kind === 'manager' && test.department_id !== role.department_id) {
      return json({ error: 'You can only approve retests for tests you created in your own department.' }, 403)
    }

    // Idempotent: an existing open grant is returned as-is.
    const { data: open } = await admin
      .from('retest_grants')
      .select('*')
      .eq('staff_id', staffId)
      .eq('test_id', testId)
      .eq('used', false)
      .maybeSingle()
    if (open) return json({ grant: open })

    const { data: grant, error } = await admin
      .from('retest_grants')
      .insert({
        test_id: testId,
        staff_id: staffId,
        granted_by: role.id,
        granted_by_name: role.name,
        used: false,
      })
      .select('*')
      .single()
    if (error) return json({ error: error.message }, 500)

    await admin.from('notifications').insert({
      staff_id: staffId,
      kind: 'retest_approved',
      text: `${role.name} approved one retest of ${test.title}. Review the SOP before you start — this unlocks a single attempt.`,
    })

    return json({ grant })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Could not approve the retest.' }, 500)
  }
})
