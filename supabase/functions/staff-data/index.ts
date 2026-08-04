/**
 * staff-data Edge Function.
 *
 * Returns everything the signed-in staff member's portal needs, in one payload,
 * computed with the service_role and the SAME derived-eligibility rule the RLS
 * policies use: SOPs and tests are their department's rows whose branch scope
 * includes their branch; assignments/attempts/certs/acks/grants/notifications
 * are their own. Staff have no Supabase Auth account, so this can't rely on RLS —
 * it enforces the same scoping here in code, gated by a valid session token.
 */

import { serviceClient, staffFromToken, bearer, STAFF_COLUMNS } from '../_shared/auth.ts'
import { scopeIncludes } from '../_shared/scope.ts'
import { cors, json } from '../_shared/http.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  try {
    const admin = serviceClient()
    const body = await req.json().catch(() => ({}))
    const token = String(body.token ?? '') || bearer(req)
    const staff = await staffFromToken(admin, token)
    if (!staff) return json({ error: 'Your session has ended. Please sign in again.' }, 401)

    // The notification bell marks everything read as it opens.
    if (body.mark_read === true) {
      await admin.from('notifications').update({ read: true }).eq('staff_id', staff.id).eq('read', false)
    }

    const { data: branchRow } = await admin.from('branches').select('code').eq('id', staff.branch_id).maybeSingle()
    const branchCode = branchRow?.code as string | undefined

    const [{ data: branches }, { data: departments }, { data: deptSops }, { data: deptTests }, { data: assignments }] =
      await Promise.all([
        admin.from('branches').select('*'),
        admin.from('departments').select('*'),
        admin.from('sops').select('*').eq('department_id', staff.department_id),
        admin.from('tests').select('*').eq('department_id', staff.department_id).eq('status', 'published'),
        admin.from('test_assignments').select('*').eq('staff_id', staff.id),
      ])

    let sops = (deptSops ?? []).filter((s) => scopeIncludes(s.branch_scope, branchCode))

    // The tests this person can see: their department's published tests in
    // their branch scope, PLUS any test explicitly assigned to them — even one
    // built in another department (a cross-department assignment). Assignment is
    // the authority; the department/branch scope only seeds the default pool.
    const byId = new Map<string, Record<string, unknown>>()
    for (const t of (deptTests ?? []).filter((t) => scopeIncludes(t.branch_scope, branchCode))) byId.set(t.id as string, t)
    const missingAssigned = [...new Set((assignments ?? []).map((a) => a.test_id as string))].filter((id) => !byId.has(id))
    if (missingAssigned.length) {
      const { data: extraTests } = await admin.from('tests').select('*').in('id', missingAssigned).eq('status', 'published')
      for (const t of extraTests ?? []) byId.set(t.id as string, t)
    }
    const tests = [...byId.values()]
    const testIds = tests.map((t) => t.id as string)

    // Related SOPs of these tests, so "Review SOP" works even for a test assigned
    // from another department (these don't enter the staff's own sign-off list).
    const haveSop = new Set(sops.map((s) => s.id as string))
    const relSopIds = [...new Set(tests.map((t) => t.related_sop_id as string | null).filter((id): id is string => !!id && !haveSop.has(id)))]
    if (relSopIds.length) {
      const { data: extraSops } = await admin.from('sops').select('*').in('id', relSopIds)
      sops = [...sops, ...(extraSops ?? [])]
    }

    const [
      { data: questions },
      { data: acknowledgments },
      { data: attempts },
      { data: certifications },
      { data: grants },
      { data: notifications },
    ] = await Promise.all([
      testIds.length
        ? admin.from('questions').select('*').in('test_id', testIds)
        : Promise.resolve({ data: [] as unknown[] }),
      admin.from('acknowledgments').select('*').eq('staff_id', staff.id),
      admin.from('attempts').select('*').eq('staff_id', staff.id),
      admin.from('certifications').select('*').eq('staff_id', staff.id),
      admin.from('retest_grants').select('*').eq('staff_id', staff.id),
      admin.from('notifications').select('*').eq('staff_id', staff.id),
    ])

    // Re-select the staff row through the non-secret column list, defensively.
    const { data: selfRow } = await admin.from('staff').select(STAFF_COLUMNS).eq('id', staff.id).maybeSingle()

    return json({
      staff: selfRow ?? staff,
      branches: branches ?? [],
      departments: departments ?? [],
      sops,
      tests,
      questions: questions ?? [],
      acknowledgments: acknowledgments ?? [],
      assignments: assignments ?? [],
      attempts: attempts ?? [],
      certifications: certifications ?? [],
      grants: grants ?? [],
      notifications: notifications ?? [],
    })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Could not load your portal.' }, 500)
  }
})
