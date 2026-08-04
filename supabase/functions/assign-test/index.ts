/**
 * assign-test Edge Function (manager / admin).
 *
 * Assigns or unassigns a test to any staff member — including staff in another
 * department or branch — so a manager can run their department's test across the
 * whole org (e.g. an HR/compliance test). A manager may only act on tests in
 * their OWN department (the test they built); an admin on any test. Assignment
 * writes the "test assigned" notification too. Runs as service_role.
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
    const action = body.action === 'unassign' ? 'unassign' : 'assign'
    if (!testId || !staffId) return json({ error: 'Missing test or staff.' }, 400)

    const { data: test } = await admin.from('tests').select('id, title, department_id').eq('id', testId).maybeSingle()
    if (!test) return json({ error: 'That test no longer exists.' }, 404)
    if (role.kind === 'manager' && test.department_id !== role.department_id) {
      return json({ error: 'You can only assign tests you created in your own department.' }, 403)
    }

    const { data: staff } = await admin.from('staff').select('id, active').eq('id', staffId).maybeSingle()
    if (!staff || !staff.active) return json({ error: 'That staff member is not active.' }, 400)

    if (action === 'unassign') {
      const { error } = await admin.from('test_assignments').delete().eq('test_id', testId).eq('staff_id', staffId)
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true })
    }

    const { error } = await admin
      .from('test_assignments')
      .insert({ test_id: testId, staff_id: staffId, assigned_by: role.name })
    // 23505 = already assigned; treat as success (idempotent).
    if (error && error.code !== '23505') return json({ error: error.message }, 500)
    if (!error) {
      await admin.from('notifications').insert({
        staff_id: staffId,
        kind: 'test_assigned',
        text: `${test.title} has been assigned to you by ${role.name}.`,
      })
    }
    return json({ ok: true })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Assignment failed.' }, 500)
  }
})
