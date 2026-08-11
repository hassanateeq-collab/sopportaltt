/**
 * upload-sop Edge Function.
 *
 * Called by the Add-SOP form. Receives the document (PDF) and optional training
 * video plus the SOP metadata and a destination Drive folder id, then:
 *   1. verifies the caller is an admin or the owning department manager;
 *   2. uploads the files into the chosen folder (view-only) via a Google service
 *      account — the Drive credential lives only here, never in the browser;
 *   3. inserts the SOP row with the returned Drive file ids;
 *   4. notifies every eligible staff member.
 *
 * Secrets used (set with `supabase secrets set`): GOOGLE_SERVICE_ACCOUNT.
 * Supabase injects SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getUserAccessToken, uploadToDrive, makeViewOnly, getFileParent, deleteFromDrive } from '../_shared/google.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
  const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const G_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID')
  const G_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')
  const G_REFRESH = Deno.env.get('GOOGLE_REFRESH_TOKEN')

  try {
    // ---- who is calling? ----
    const authHeader = req.headers.get('Authorization') ?? ''
    const jwt = authHeader.replace('Bearer ', '')
    if (!jwt) return json({ error: 'Sign in first.' }, 401)

    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'Your session has expired — sign in again.' }, 401)

    const admin = createClient(SUPABASE_URL, SERVICE)
    const { data: adminRow } = await admin.from('admins').select('*').eq('auth_user_id', user.id).maybeSingle()
    const { data: mgrRow } = adminRow
      ? { data: null }
      : await admin.from('managers').select('*').eq('auth_user_id', user.id).eq('active', true).maybeSingle()
    if (!adminRow && !mgrRow) return json({ error: 'Not an admin or department manager.' }, 403)
    const isAdmin = !!adminRow
    const actorName = (adminRow?.name ?? mgrRow?.name) as string

    // ---- inputs ----
    const form = await req.formData()
    const sopId = String(form.get('sop_id') ?? '').trim() // present = edit an existing SOP
    const title = String(form.get('title') ?? '').trim()
    const providedCode = String(form.get('code') ?? '').trim().toUpperCase()
    const departmentId = String(form.get('department_id') ?? '')
    const folderId = String(form.get('folder_id') ?? '')
    const branchScope = JSON.parse(String(form.get('branch_scope') ?? '{"kind":"ALL"}'))
    const document = form.get('document')
    const video = form.get('video')
    const documentHtml = form.get('document_html') ? String(form.get('document_html')) : null
    const sopDocRaw = form.get('sop_doc') ? String(form.get('sop_doc')) : null
    const sopDoc = sopDocRaw ? JSON.parse(sopDocRaw) : null

    if (!title) return json({ error: 'Give the SOP a title.' }, 400)
    if (!(document instanceof File)) return json({ error: 'Provide the SOP document.' }, 400)
    if (!G_CLIENT_ID || !G_CLIENT_SECRET || !G_REFRESH) {
      return json({ error: 'Drive is not configured — set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN.' }, 500)
    }

    // A manager-authored Word file (in-app editor) or a PDF — name/type it by
    // what was actually uploaded.
    const token = await getUserAccessToken(G_CLIENT_ID, G_CLIENT_SECRET, G_REFRESH)
    const isDocx = (document.type || '').includes('word') || document.name.toLowerCase().endsWith('.docx')
    const ext = isDocx ? 'docx' : 'pdf'
    const mime = isDocx ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf'

    // ===== EDIT an existing SOP: replace the Drive doc + update the row =====
    if (sopId) {
      const { data: cur } = await admin
        .from('sops')
        .select('id, code, title, department_id, document_file_id')
        .eq('id', sopId)
        .maybeSingle()
      if (!cur) return json({ error: 'That SOP no longer exists.' }, 404)
      if (!isAdmin && cur.department_id !== mgrRow!.department_id) {
        return json({ error: 'You can only edit your own department’s SOPs.' }, 403)
      }
      const parent = (cur.document_file_id ? await getFileParent(token, cur.document_file_id) : null) ?? folderId
      if (!parent) return json({ error: 'Could not locate the SOP’s Drive folder.' }, 500)

      const newDocId = await uploadToDrive(token, parent, `${cur.code} — ${title}.${ext}`, mime, await document.arrayBuffer())
      await makeViewOnly(token, newDocId)

      const patch: Record<string, unknown> = {
        title,
        document_file_id: newDocId,
        sop_doc: sopDoc,
        updated_at: new Date().toISOString(),
      }
      if (video instanceof File && video.size > 0) {
        const vId = await uploadToDrive(token, parent, `${cur.code} — ${title} (video)`, video.type || 'video/mp4', await video.arrayBuffer())
        await makeViewOnly(token, vId)
        patch.video_file_id = vId
      }
      const { data: updated, error: updErr } = await admin.from('sops').update(patch).eq('id', sopId).select('*').single()
      if (updErr) return json({ error: `Could not update the SOP: ${updErr.message}` }, 500)
      if (cur.document_file_id && cur.document_file_id !== newDocId) await deleteFromDrive(token, cur.document_file_id).catch(() => {})
      return json({ sop: updated })
    }

    // ===== INSERT a new SOP =====
    if (!folderId) return json({ error: 'Choose a destination folder.' }, 400)
    // A manager runs her whole department across all branches, so she may publish
    // to any branch scope — only the department has to be hers.
    if (!isAdmin) {
      if (departmentId !== mgrRow!.department_id) return json({ error: 'You can only publish for your own department.' }, 403)
    }

    // ---- document-control code ----
    const { data: deptRow } = await admin.from('departments').select('code').eq('id', departmentId).single()
    if (!deptRow) return json({ error: 'Unknown department.' }, 400)
    const { data: existing } = await admin.from('sops').select('code')
    const codes = (existing ?? []).map((r: { code: string }) => r.code)
    let code = providedCode
    if (!code) {
      const prefix = deptRow.code
      let highest = 0
      for (const c of codes) {
        const m = /^([A-Z]{2,4})-(\d{3,})$/.exec(c)
        if (m && m[1] === prefix && Number(m[2]) > highest) highest = Number(m[2])
      }
      code = `${prefix}-${String(highest + 1).padStart(3, '0')}`
    }
    if (codes.some((c) => c.toUpperCase() === code)) return json({ error: `Code ${code} is already in use.` }, 400)

    // ---- push files to Drive (view-only), as the Hamsun Google account ----
    const docId = await uploadToDrive(token, folderId, `${code} — ${title}.${ext}`, mime, await document.arrayBuffer())
    await makeViewOnly(token, docId)

    let videoId: string | null = null
    if (video instanceof File && video.size > 0) {
      videoId = await uploadToDrive(token, folderId, `${code} — ${title} (video)`, video.type || 'video/mp4', await video.arrayBuffer())
      await makeViewOnly(token, videoId)
    }

    // ---- insert the SOP ----
    // An admin publishes live; a department manager's SOP enters the review
    // chain as a draft and stays invisible to staff until the CEO authorises it.
    const approvalStatus = isAdmin ? 'authorized' : 'draft'
    const { data: sop, error: insErr } = await admin
      .from('sops')
      .insert({
        code,
        title,
        summary: '',
        department_id: departmentId,
        branch_scope: branchScope,
        version: 1,
        document_file_id: docId,
        video_file_id: videoId,
        approval_status: approvalStatus,
        updated_at: new Date().toISOString(),
        published_by: actorName,
      })
      .select('*')
      .single()
    if (insErr) return json({ error: `Could not save the SOP: ${insErr.message}` }, 500)

    // ---- notify eligible staff (best-effort) ----
    // Only an admin's live publish reaches staff now; a manager's draft notifies
    // them only once the CEO authorises it (handled in sop-approval).
    if (!isAdmin) return json({ sop })
    try {
      const { data: staff } = await admin
        .from('staff')
        .select('id, branch_id')
        .eq('department_id', departmentId)
        .eq('active', true)
      const { data: branches } = await admin.from('branches').select('id, code')
      const codeById = new Map((branches ?? []).map((b: { id: string; code: string }) => [b.id, b.code]))
      const applies = (branchId: string) =>
        branchScope.kind === 'ALL' || branchScope.branch_codes.includes(codeById.get(branchId))
      const notes = (staff ?? [])
        .filter((s: { branch_id: string }) => applies(s.branch_id))
        .map((s: { id: string }) => ({
          staff_id: s.id,
          kind: 'sop_published',
          text: `New SOP ${code} — ${title} — has been published for your department.`,
          whatsapp_pending: true,
        }))
      if (notes.length) await admin.from('notifications').insert(notes)
    } catch (_) {
      // A notification failure must not fail the publish.
    }

    return json({ sop })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Upload failed.' }, 500)
  }
})
