/**
 * staff-directory Edge Function.
 *
 * The staff sign-in funnel needs to list the names at a branch so a member can
 * pick their own — but the staff table has no anon read access (RLS), so the
 * browser can't query it directly. This returns just {id, name, department_id}
 * for the active staff at one branch, using the service_role. No employee codes,
 * no hashes — only the first names already printed on the schedule.
 *
 * Called with the public anon key (before the staff member has any token).
 */

import { serviceClient } from '../_shared/auth.ts'
import { cors, json } from '../_shared/http.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  try {
    const admin = serviceClient()
    const body = await req.json().catch(() => ({}))
    const branchCode = String(body.branch_code ?? '').trim().toUpperCase()
    if (!branchCode) return json({ staff: [] })

    const { data: branch } = await admin.from('branches').select('id').eq('code', branchCode).maybeSingle()
    if (!branch) return json({ staff: [] })

    const { data, error } = await admin
      .from('staff')
      .select('id, name, department_id')
      .eq('branch_id', branch.id as string)
      .eq('active', true)
      .order('name')
    if (error) return json({ error: error.message }, 500)

    return json({ staff: data ?? [] })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Directory lookup failed.' }, 500)
  }
})
