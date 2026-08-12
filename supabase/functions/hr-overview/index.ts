/**
 * hr-overview Edge Function (HR + admin only).
 *
 * HR sits across the whole organisation, so — unlike a department manager — it
 * needs to see every department's staff (including their plaintext employee
 * codes) and their test results. RLS confines a department manager to their own
 * patch and gives the review roles no staff access at all, so this read runs as
 * the service_role after verifying the caller is HR (or an admin).
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
    const allowed = role.kind === 'admin' || (role.kind === 'manager' && role.role === 'hr')
    if (!allowed) return json({ error: 'HR or admin only.' }, 403)

    const [staff, departments, branches, tests, attempts, certifications, assignments] = await Promise.all([
      admin.from('staff').select('id,name,department_id,branch_id,job_title,active,employee_code').eq('active', true),
      admin.from('departments').select('*'),
      admin.from('branches').select('*'),
      admin.from('tests').select('*'),
      admin.from('attempts').select('*'),
      admin.from('certifications').select('*'),
      admin.from('test_assignments').select('*'),
    ])

    return json({
      staff: staff.data ?? [],
      departments: departments.data ?? [],
      branches: branches.data ?? [],
      tests: tests.data ?? [],
      attempts: attempts.data ?? [],
      certifications: certifications.data ?? [],
      assignments: assignments.data ?? [],
    })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Could not load the overview.' }, 500)
  }
})
