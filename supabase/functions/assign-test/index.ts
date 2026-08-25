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
    const action = body.action === 'unassign' ? 'unassign' : 'assign'
    // Accept a single staff_id or a bulk staff_ids array (assign everyone).
    const staffIds = [
      ...new Set(
        (Array.isArray(body.staff_ids) ? body.staff_ids.map(String) : []).concat(body.staff_id ? [String(body.staff_id)] : []),
      ),
    ].filter(Boolean)
    if (!testId || staffIds.length === 0) return json({ error: 'Missing test or staff.' }, 400)

    const { data: test } = await admin.from('tests').select('id, title, department_id').eq('id', testId).maybeSingle()
    if (!test) return json({ error: 'That test no longer exists.' }, 404)
    if (role.kind === 'manager' && test.department_id !== role.department_id) {
      return json({ error: 'You can only assign tests you created in your own department.' }, 403)
    }

    // A manager may only assign/unassign to staff in their OWN department; an
    // admin may act on anyone. Confine the target set here, server-side.
    const { data: staffRows } = await admin.from('staff').select('id, department_id, active').in('id', staffIds)
    const allowed = (staffRows ?? []).filter((s) => role.kind === 'admin' || s.department_id === role.department_id)
    const allowedIds = allowed.map((s) => s.id as string)
    if (allowedIds.length === 0) {
      return json({ error: 'You can only assign to staff in your own department.' }, 403)
    }

    if (action === 'unassign') {
      const { error } = await admin.from('test_assignments').delete().eq('test_id', testId).in('staff_id', allowedIds)
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true })
    }

    // Assign only active staff; ignore anyone already assigned.
    const ids = allowed.filter((s) => s.active).map((s) => s.id as string)
    if (ids.length === 0) return json({ ok: true, assigned: 0 })

    const { data: existing } = await admin.from('test_assignments').select('staff_id').eq('test_id', testId).in('staff_id', ids)
    const already = new Set((existing ?? []).map((r) => r.staff_id as string))
    const fresh = ids.filter((id) => !already.has(id))

    const { error } = await admin
      .from('test_assignments')
      .upsert(ids.map((sid) => ({ test_id: testId, staff_id: sid, assigned_by: role.name })), {
        onConflict: 'test_id,staff_id',
        ignoreDuplicates: true,
      })
    if (error) return json({ error: error.message }, 500)

    // Notify only the newly assigned (don't re-ping people already assigned).
    if (fresh.length) {
      await admin.from('notifications').insert(
        fresh.map((sid) => ({ staff_id: sid, kind: 'test_assigned', text: `${test.title} has been assigned to you by ${role.name}.` })),
      )
    }
    return json({ ok: true, assigned: fresh.length })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Assignment failed.' }, 500)
  }
})
