/**
 * sop-approval Edge Function.
 *
 * Drives the SOP review chain, which RLS can't express on its own because the
 * review roles (branch_manager / hr / ceo) have no read access to in-review
 * SOPs and no write access to another department's rows. Everything here runs
 * as the service_role after verifying the caller's role, so each transition is
 * gated by exactly one authorised actor.
 *
 * Chain:  draft → branch_review → admin_review → (hr_review) → ceo_review → authorized
 * The admin's approve routes to HR (target='hr') or straight to the CEO. Any
 * reviewer may reject, sending the SOP back to its author as 'rejected'.
 *
 * Actions (POST JSON { action, ... }):
 *   - queue                          → the SOPs awaiting the caller's action
 *   - submit  { sop_id }             → author sends a draft/rejected SOP up
 *   - approve { sop_id, note?, target? } → clear the current stage
 *   - reject  { sop_id, note? }      → bounce the SOP back to its author
 */

import { serviceClient, callerRole, bearer, type CallerRole } from '../_shared/auth.ts'
import { cors, json } from '../_shared/http.ts'
import { scopeIncludes } from '../_shared/scope.ts'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

type Status =
  | 'draft' | 'branch_review' | 'branch_approved' | 'admin_review' | 'admin_approved'
  | 'hr_review' | 'ceo_review' | 'authorized' | 'rejected'

/** The branch code for a branch id (a Branch Manager reviews only their branch). */
async function branchCodeFor(admin: SupabaseClient, branchId: string | null): Promise<string | null> {
  if (!branchId) return null
  const { data } = await admin.from('branches').select('code').eq('id', branchId).maybeSingle()
  return (data?.code as string) ?? null
}

/** Which single actor may clear a given stage. */
function reviewerForStage(status: Status): 'branch_manager' | 'admin' | 'hr' | 'ceo' | null {
  switch (status) {
    case 'branch_review': return 'branch_manager'
    case 'admin_review': return 'admin'
    case 'hr_review': return 'hr'
    case 'ceo_review': return 'ceo'
    default: return null
  }
}

/** The stage the signed-in caller is responsible for (null if not a reviewer). */
function stageForCaller(role: CallerRole): Status | null {
  if (!role) return null
  if (role.kind === 'admin') return 'admin_review'
  switch (role.role) {
    case 'branch_manager': return 'branch_review'
    case 'hr': return 'hr_review'
    case 'ceo': return 'ceo_review'
    default: return null
  }
}

/**
 * Where a reviewer's APPROVE moves the SOP. Branch Manager / Admin hand it back
 * to the Manager (an *_approved hold); HR or CEO publish it.
 */
function approveNext(status: Status): Status | null {
  switch (status) {
    case 'branch_review': return 'branch_approved'
    case 'admin_review': return 'admin_approved'
    case 'hr_review': return 'authorized'
    case 'ceo_review': return 'authorized'
    default: return null
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  try {
    const admin = serviceClient()
    const role = await callerRole(admin, bearer(req))
    if (!role) return json({ error: 'Sign in first.' }, 401)

    const body = await req.json().catch(() => ({}))
    const action = String(body.action ?? '')

    // ---- queue: the SOPs awaiting this caller's action ----
    if (action === 'queue') {
      const stage = stageForCaller(role)
      if (!stage) return json({ sops: [] }) // a department manager has no review queue
      const { data, error } = await admin
        .from('sops')
        .select('*')
        .eq('approval_status', stage)
        .order('updated_at', { ascending: true })
      if (error) return json({ error: error.message }, 500)
      let sops = data ?? []
      // A Branch Manager reviews only SOPs whose branch scope includes THEIR
      // branch; HR and the CEO are org-wide and see every SOP at their stage.
      if (role.kind === 'manager' && role.role === 'branch_manager') {
        const code = await branchCodeFor(admin, role.branch_id)
        sops = sops.filter((s) => scopeIncludes(s.branch_scope, code))
      }
      return json({ sops })
    }

    const sopId = String(body.sop_id ?? '')
    if (!sopId) return json({ error: 'Which SOP?' }, 400)
    const { data: sop } = await admin.from('sops').select('*').eq('id', sopId).maybeSingle()
    if (!sop) return json({ error: 'That SOP no longer exists.' }, 404)
    const status = sop.approval_status as Status

    // ---- submit: the author sends a draft/rejected SOP into review ----
    if (action === 'submit') {
      if (role.kind === 'manager') {
        if (role.role !== 'manager') return json({ error: 'Only the author submits an SOP for review.' }, 403)
        if (sop.department_id !== role.department_id) return json({ error: 'You can only submit your own department’s SOPs.' }, 403)
      }
      // draft = never reviewed; rejected = sent back; authorized = a live SOP the
      // author wants re-approved. Anything else is already mid-chain.
      if (status !== 'draft' && status !== 'rejected' && status !== 'authorized') {
        return json({ error: 'This SOP is already in review.' }, 409)
      }
      const trailRole = role.kind === 'admin' ? 'admin' : role.role
      // A fresh submission starts a new sign-off round, so the trail resets.
      const trail = [{ role: trailRole, name: role.name, action: 'submitted', note: null, at: new Date().toISOString() }]
      const { error } = await admin
        .from('sops')
        .update({ approval_status: 'branch_review', submitted_by: role.name, approval_note: null, approval_trail: trail, updated_at: new Date().toISOString() })
        .eq('id', sopId)
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true })
    }

    // ---- forward: the Manager sends an approved SOP on to the next reviewer ----
    if (action === 'forward') {
      if (role.kind === 'manager') {
        if (role.role !== 'manager') return json({ error: 'Only the author forwards an SOP.' }, 403)
        if (sop.department_id !== role.department_id) return json({ error: 'You can only forward your own department’s SOPs.' }, 403)
      }
      const target = String(body.target ?? '')
      let next: Status | null = null
      if (status === 'branch_approved') next = 'admin_review'
      else if (status === 'admin_approved') next = target === 'hr' ? 'hr_review' : target === 'ceo' ? 'ceo_review' : null
      if (!next) return json({ error: 'This SOP is not waiting to be forwarded.' }, 409)
      const { error } = await admin
        .from('sops')
        .update({ approval_status: next, updated_at: new Date().toISOString() })
        .eq('id', sopId)
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true })
    }

    // ---- approve / reject: only the reviewer who owns the current stage ----
    if (action === 'approve' || action === 'reject') {
      const owner = reviewerForStage(status)
      if (!owner) return json({ error: 'This SOP isn’t awaiting review.' }, 409)
      const callerKind = role.kind === 'admin' ? 'admin' : role.role
      if (callerKind !== owner) return json({ error: 'This SOP is waiting on a different reviewer.' }, 403)
      // A Branch Manager may only act on SOPs that include their own branch.
      if (role.kind === 'manager' && role.role === 'branch_manager') {
        const code = await branchCodeFor(admin, role.branch_id)
        if (!scopeIncludes(sop.branch_scope, code)) return json({ error: 'This SOP is for a different branch.' }, 403)
      }

      const note = String(body.note ?? '').trim() || null
      const trailRole = role.kind === 'admin' ? 'admin' : role.role
      const priorTrail = Array.isArray(sop.approval_trail) ? sop.approval_trail : []
      const now = new Date().toISOString()

      if (action === 'reject') {
        const trail = [...priorTrail, { role: trailRole, name: role.name, action: 'rejected', note, at: now }]
        const { error } = await admin
          .from('sops')
          .update({ approval_status: 'rejected', approval_note: note, approval_trail: trail, updated_at: now })
          .eq('id', sopId)
        if (error) return json({ error: error.message }, 500)
        return json({ ok: true })
      }

      const next = approveNext(status)
      if (!next) return json({ error: 'There is nothing to approve at this stage.' }, 409)
      const trail = [...priorTrail, { role: trailRole, name: role.name, action: next === 'authorized' ? 'authorized' : 'approved', note, at: now }]
      const { error } = await admin
        .from('sops')
        .update({ approval_status: next, approval_note: note, approval_trail: trail, updated_at: now })
        .eq('id', sopId)
      if (error) return json({ error: error.message }, 500)

      // Authorising an SOP makes it live — notify every eligible staff member,
      // exactly as a fresh publish would.
      if (next === 'authorized') {
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
      }
      return json({ ok: true })
    }

    return json({ error: `Unknown action "${action}".` }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Approval action failed.' }, 500)
  }
})
