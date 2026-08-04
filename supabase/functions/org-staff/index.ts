/**
 * org-staff Edge Function (manager / admin).
 *
 * Returns every active staff member's id, name, department and branch — never
 * their employee code — so a manager can pick people from OTHER departments when
 * assigning a test across departments. (Regular staff reads stay confined to a
 * manager's own department via RLS; this function is the deliberate, code-free
 * exception for the cross-department assign picker.)
 */

import { serviceClient, callerRole, bearer } from '../_shared/auth.ts'
import { cors, json } from '../_shared/http.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST' && req.method !== 'GET') return json({ error: 'GET or POST only' }, 405)

  try {
    const admin = serviceClient()
    const role = await callerRole(admin, bearer(req))
    if (!role) return json({ error: 'Sign in as a manager or admin first.' }, 401)

    const { data, error } = await admin
      .from('staff')
      .select('id, name, department_id, branch_id')
      .eq('active', true)
      .order('name')
    if (error) return json({ error: error.message }, 500)

    return json({ staff: data ?? [] })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Directory lookup failed.' }, 500)
  }
})
