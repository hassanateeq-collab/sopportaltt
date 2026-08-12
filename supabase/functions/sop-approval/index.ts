/**
 * sop-approval Edge Function.
 *
 * The SOP review chain, which RLS can't express on its own (a department manager
 * can't update an SOP scoped outside her own branch, and the staff notification
 * on publish needs the service_role). Everything here runs as the service_role
 * after verifying the caller.
 *
 * Chain:  draft → (manager submits) admin_review → (Admin approves) authorized
 *                                                 → (Admin sends back) rejected
 *
 * Actions (POST JSON { action, ... }):
 *   - queue                     → the SOPs awaiting the admin's review
 *   - pipeline                  → every SOP's status (for the Status overview)
 *   - submit  { sop_id }        → author sends a draft/rejected SOP to the admin
 *   - approve { sop_id, note? } → the admin authorises it (publishes to staff)
 *   - reject  { sop_id, note? } → the admin sends it back to the author
 */

import { serviceClient, callerRole, bearer } from '../_shared/auth.ts'
import { cors, json } from '../_shared/http.ts'

type Status = 'draft' | 'admin_review' | 'authorized' | 'rejected'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  try {
    const admin = serviceClient()
    const role = await callerRole(admin, bearer(req))
    if (!role) return json({ error: 'Sign in first.' }, 401)

    const body = await req.json().catch(() => ({}))
    const action = String(body.action ?? '')

    // ---- queue: the SOPs awaiting the admin's review ----
    if (action === 'queue') {
      if (role.kind !== 'admin') return json({ sops: [] }) // only the admin reviews
      const { data, error } = await admin
        .from('sops')
        .select('*')
        .eq('approval_status', 'admin_review')
        .order('updated_at', { ascending: true })
      if (error) return json({ error: error.message }, 500)
      return json({ sops: data ?? [] })
    }

    // ---- pipeline: every SOP's status, for the "Status" overview. A department
    // manager sees only their department; the admin sees all. ----
    if (action === 'pipeline') {
      let q = admin.from('sops').select('*').order('code', { ascending: true })
      if (role.kind === 'manager') q = q.eq('department_id', role.department_id)
      const { data, error } = await q
      if (error) return json({ error: error.message }, 500)
      return json({ sops: data ?? [] })
    }

    const sopId = String(body.sop_id ?? '')
    if (!sopId) return json({ error: 'Which SOP?' }, 400)
    const { data: sop } = await admin.from('sops').select('*').eq('id', sopId).maybeSingle()
    if (!sop) return json({ error: 'That SOP no longer exists.' }, 404)
    const status = sop.approval_status as Status

    const trailRole = role.kind === 'admin' ? 'admin' : 'manager'
    const priorTrail = Array.isArray(sop.approval_trail) ? sop.approval_trail : []
    const now = new Date().toISOString()

    // ---- submit: the author sends a draft/rejected SOP to the admin ----
    if (action === 'submit') {
      if (role.kind === 'manager' && sop.department_id !== role.department_id) {
        return json({ error: 'You can only submit your own department’s SOPs.' }, 403)
      }
      // draft = never reviewed (new SOP or fresh version); rejected = sent back.
      // A live SOP re-enters review only by starting a new version.
      if (status !== 'draft' && status !== 'rejected') {
        return json({ error: 'This SOP is already live or in review.' }, 409)
      }
      // A fresh submission starts a new sign-off round, so the trail resets.
      const trail = [{ role: trailRole, name: role.name, action: 'submitted', note: null, at: now }]
      const { error } = await admin
        .from('sops')
        .update({ approval_status: 'admin_review', submitted_by: role.name, approval_note: null, approval_trail: trail, updated_at: now })
        .eq('id', sopId)
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true })
    }

    // ---- approve / reject: the admin only ----
    if (action === 'approve' || action === 'reject') {
      if (role.kind !== 'admin') return json({ error: 'Only the admin reviews SOPs.' }, 403)
      if (status !== 'admin_review') return json({ error: 'This SOP isn’t awaiting review.' }, 409)
      const note = String(body.note ?? '').trim() || null

      if (action === 'reject') {
        const trail = [...priorTrail, { role: 'admin', name: role.name, action: 'rejected', note, at: now }]
        const { error } = await admin
          .from('sops')
          .update({ approval_status: 'rejected', approval_note: note, approval_trail: trail, updated_at: now })
          .eq('id', sopId)
        if (error) return json({ error: error.message }, 500)
        return json({ ok: true })
      }

      const trail = [...priorTrail, { role: 'admin', name: role.name, action: 'authorized', note, at: now }]
      const { error } = await admin
        .from('sops')
        .update({ approval_status: 'authorized', approval_note: note, approval_trail: trail, updated_at: now })
        .eq('id', sopId)
      if (error) return json({ error: error.message }, 500)

      // Authorising an SOP makes it live — notify every eligible staff member.
      try {
        const scope = sop.branch_scope as { kind: string; branch_codes?: string[] }
        const { data: staff } = await admin
          .from('staff')
          .select('id, branch_id')
          .eq('department_id', sop.department_id)
          .eq('active', true)
        const { data: branches } = await admin.from('branches').select('id, code')
        const codeById = new Map((branches ?? []).map((b: { id: string; code: string }) => [b.id, b.code]))
        const applies = (branchId: string) =>
          scope.kind === 'ALL' || (scope.branch_codes ?? []).includes(codeById.get(branchId) ?? '')
        const notes = (staff ?? [])
          .filter((s: { branch_id: string }) => applies(s.branch_id))
          .map((s: { id: string }) => ({
            staff_id: s.id,
            kind: 'sop_published',
            text: `New SOP ${sop.code} — ${sop.title} — has been published for your department.`,
            whatsapp_pending: true,
          }))
        if (notes.length) await admin.from('notifications').insert(notes)
      } catch (_) {
        // A notification failure must not fail the authorisation.
      }
      return json({ ok: true })
    }

    return json({ error: `Unknown action "${action}".` }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Approval action failed.' }, 500)
  }
})
