/**
 * manage-staff Edge Function (admin only).
 *
 * The staff writes that need the service_role because they touch the bcrypt
 * hash the browser can never see:
 *   - create:     add a staff member; the numeric code is generated here, hashed
 *                 in Postgres (create_staff), and returned ONCE for the admin to
 *                 share privately. The plaintext is never stored. (Admin only.)
 *   - regenerate: issue a fresh random code for an existing member, clear lockout.
 *   - set:        set a specific chosen code (4–8 digits) for an existing member.
 *
 * create is admin-only. A manager may regenerate/set a code, but only for staff
 * in her own department; an admin for anyone. Deactivating a staff member and
 * reading the roster don't need this function — done directly under RLS.
 */

import { serviceClient, callerRole, bearer, generateEmployeeCode, STAFF_COLUMNS } from '../_shared/auth.ts'
import { cors, json } from '../_shared/http.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  try {
    const admin = serviceClient()
    const role = await callerRole(admin, bearer(req))
    if (!role) return json({ error: 'Sign in as a manager or admin first.' }, 401)

    const body = await req.json().catch(() => ({}))
    const action = String(body.action ?? '')

    if (action === 'create') {
      if (role.kind !== 'admin') return json({ error: 'Only an admin can add staff.' }, 403)
      const name = String(body.name ?? '').trim()
      const departmentId = String(body.department_id ?? '')
      const branchId = String(body.branch_id ?? '')
      const jobTitle = String(body.job_title ?? '').trim()
      if (!name) return json({ error: 'A staff member needs a name.' }, 400)
      if (!departmentId || !branchId) return json({ error: 'Choose a department and branch.' }, 400)

      const code = generateEmployeeCode()
      const { data: staff, error } = await admin.rpc('create_staff', {
        p_name: name,
        p_department: departmentId,
        p_branch: branchId,
        p_job: jobTitle,
        p_code: code,
      })
      if (error) return json({ error: error.message }, 500)

      // Return the row through the non-secret column list (drop the hash).
      const { data: safe } = await admin.from('staff').select(STAFF_COLUMNS).eq('id', staff.id).maybeSingle()
      return json({ staff: safe, code })
    }

    if (action === 'regenerate' || action === 'set') {
      const staffId = String(body.staff_id ?? '')
      if (!staffId) return json({ error: 'Which staff member?' }, 400)
      const { data: staff } = await admin.from('staff').select('id, department_id').eq('id', staffId).maybeSingle()
      if (!staff) return json({ error: 'That staff record no longer exists.' }, 404)
      // A manager may only change codes for staff in her own department.
      if (role.kind === 'manager' && staff.department_id !== role.department_id) {
        return json({ error: 'You can only change codes for staff in your own department.' }, 403)
      }

      let code: string
      if (action === 'set') {
        code = String(body.code ?? '').trim()
        if (!/^\d{4,8}$/.test(code)) return json({ error: 'A code must be 4 to 8 digits.' }, 400)
      } else {
        code = generateEmployeeCode()
      }
      const { error } = await admin.rpc('set_staff_code', { p_staff: staffId, p_code: code })
      if (error) return json({ error: error.message }, 500)
      await admin.from('staff_lockouts').delete().eq('staff_id', staffId)
      return json({ code })
    }

    return json({ error: `Unknown action "${action}".` }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Staff management failed.' }, 500)
  }
})
