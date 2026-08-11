/**
 * manage-managers Edge Function (admin only).
 *
 * The two manager writes that need the service_role because they create or
 * remove a Supabase Auth user:
 *   - create: make the Auth login (email + password, email pre-confirmed) and
 *             insert the managers row that scopes them to one department+branch.
 *             If no password is supplied one is generated and returned ONCE.
 *   - delete: remove the managers row and its Auth user.
 *
 * Renaming a manager, moving their department/branch, or toggling active are
 * plain updates an admin does directly against PostgREST under RLS — not here.
 */

import { serviceClient, callerRole, bearer } from '../_shared/auth.ts'
import { cors, json } from '../_shared/http.ts'

function randomPassword(): string {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  // URL-safe-ish base64 without padding, plus a guaranteed digit + symbol.
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '')
  return `Hs${b64}7!`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  try {
    const admin = serviceClient()
    const role = await callerRole(admin, bearer(req))
    if (!role) return json({ error: 'Sign in as an admin first.' }, 401)
    if (role.kind !== 'admin') return json({ error: 'Only an admin can manage managers.' }, 403)

    const body = await req.json().catch(() => ({}))
    const action = String(body.action ?? '')

    if (action === 'create') {
      const name = String(body.name ?? '').trim()
      const email = String(body.email ?? '').trim().toLowerCase()
      const supplied = String(body.password ?? '')
      const ROLES = ['manager', 'branch_manager', 'hr', 'ceo']
      const role = ROLES.includes(String(body.role ?? '')) ? String(body.role) : 'manager'
      // Only a department manager is tied to a department; a Branch Manager keeps
      // a branch but no department; HR and the CEO are org-wide (both null).
      const departmentId = role === 'manager' ? String(body.department_id ?? '') || null : null
      const branchId = role === 'manager' || role === 'branch_manager' ? String(body.branch_id ?? '') || null : null
      if (!name) return json({ error: 'A manager needs a name.' }, 400)
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'That email does not look right.' }, 400)
      if (role === 'manager' && !departmentId) return json({ error: 'Choose a department.' }, 400)
      if ((role === 'manager' || role === 'branch_manager') && !branchId) return json({ error: 'Choose a branch.' }, 400)

      const { data: existing } = await admin.from('managers').select('id').eq('email', email).maybeSingle()
      if (existing) return json({ error: 'A manager with that email already exists.' }, 409)

      const password = supplied.length >= 8 ? supplied : randomPassword()
      const { data: created, error: authErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })
      if (authErr || !created?.user) {
        return json({ error: authErr?.message ?? 'Could not create the login.' }, 500)
      }

      const { data: manager, error: rowErr } = await admin
        .from('managers')
        .insert({
          auth_user_id: created.user.id,
          name,
          email,
          department_id: departmentId,
          branch_id: branchId,
          active: true,
          role,
        })
        .select('*')
        .single()
      if (rowErr) {
        // Roll back the orphaned Auth user so a retry can reuse the email.
        await admin.auth.admin.deleteUser(created.user.id)
        return json({ error: rowErr.message }, 500)
      }

      return json({ manager, password: supplied.length >= 8 ? null : password })
    }

    if (action === 'update') {
      const managerId = String(body.manager_id ?? '')
      if (!managerId) return json({ error: 'Which manager?' }, 400)
      const email = body.email !== undefined ? String(body.email).trim().toLowerCase() : undefined
      const password = body.password !== undefined ? String(body.password) : undefined
      if (email !== undefined && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return json({ error: 'That email does not look right.' }, 400)
      }
      if (password !== undefined && password.length < 6) {
        return json({ error: 'Password must be at least 6 characters.' }, 400)
      }
      if (email === undefined && password === undefined) return json({ ok: true })

      const { data: mgr } = await admin.from('managers').select('id, auth_user_id').eq('id', managerId).maybeSingle()
      if (!mgr) return json({ error: 'That manager no longer exists.' }, 404)
      if (!mgr.auth_user_id) return json({ error: 'This manager has no login yet — delete and re-add them.' }, 400)

      // Reject a duplicate email held by a different manager.
      if (email !== undefined) {
        const { data: clash } = await admin.from('managers').select('id').eq('email', email).neq('id', managerId).maybeSingle()
        if (clash) return json({ error: 'Another manager already uses that email.' }, 409)
      }

      const attrs: Record<string, unknown> = {}
      if (email !== undefined) { attrs.email = email; attrs.email_confirm = true }
      if (password !== undefined) attrs.password = password
      const { error: authErr } = await admin.auth.admin.updateUserById(mgr.auth_user_id as string, attrs)
      if (authErr) return json({ error: authErr.message }, 500)

      if (email !== undefined) {
        const { error: rowErr } = await admin.from('managers').update({ email }).eq('id', managerId)
        if (rowErr) return json({ error: rowErr.message }, 500)
      }
      return json({ ok: true })
    }

    if (action === 'delete') {
      const managerId = String(body.manager_id ?? '')
      if (!managerId) return json({ error: 'Which manager?' }, 400)
      const { data: mgr } = await admin.from('managers').select('id, auth_user_id').eq('id', managerId).maybeSingle()
      if (!mgr) return json({ error: 'That manager no longer exists.' }, 404)

      const { error: delErr } = await admin.from('managers').delete().eq('id', managerId)
      if (delErr) return json({ error: delErr.message }, 500)
      if (mgr.auth_user_id) {
        await admin.auth.admin.deleteUser(mgr.auth_user_id as string).catch(() => {})
      }
      return json({ ok: true })
    }

    return json({ error: `Unknown action "${action}".` }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Manager management failed.' }, 500)
  }
})
