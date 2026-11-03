/**
 * sop-comment Edge Function (manager / branch manager / admin).
 *
 * Posts a comment / change-suggestion onto an SOP thread. Branch managers may
 * comment on any SOP (they review org-wide); a department manager only on their
 * own department's SOPs; an admin on any. The author is stamped from the caller's
 * directory row, never trusted from the body. Runs as service_role.
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
    const sopId = String(body.sop_id ?? '')
    const text = String(body.body ?? '').trim()
    if (!sopId || !text) return json({ error: 'Nothing to post.' }, 400)
    if (text.length > 4000) return json({ error: 'That comment is too long.' }, 400)

    const { data: sop } = await admin.from('sops').select('id, department_id').eq('id', sopId).maybeSingle()
    if (!sop) return json({ error: 'That SOP no longer exists.' }, 404)

    // A department manager may only comment within their own department; a branch
    // manager and an admin on anything.
    if (role.kind === 'manager' && role.role === 'manager' && sop.department_id !== role.department_id) {
      return json({ error: 'You can only comment on your own department’s SOPs.' }, 403)
    }

    const author_role = role.kind === 'admin' ? 'admin' : role.role
    const author_manager_id = role.kind === 'admin' ? null : role.id

    const { data: row, error } = await admin
      .from('sop_comments')
      .insert({ sop_id: sopId, author_manager_id, author_name: role.name, author_role, body: text })
      .select('*')
      .single()
    if (error) return json({ error: error.message }, 500)

    return json({ ok: true, comment: row })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Could not post the comment.' }, 500)
  }
})
