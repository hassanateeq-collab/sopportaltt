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
import { getUserAccessToken, uploadToDrive, makeViewOnly } from '../_shared/google.ts'

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
    const title = String(form.get('title') ?? '').trim()
    const providedCode = String(form.get('code') ?? '').trim().toUpperCase()
    const departmentId = String(form.get('department_id') ?? '')
    const folderId = String(form.get('folder_id') ?? '')
    const branchScope = JSON.parse(String(form.get('branch_scope') ?? '{"kind":"ALL"}'))
    const document = form.get('document')
    const video = form.get('video')

    if (!title) return json({ error: 'Give the SOP a title.' }, 400)
    if (!(document instanceof File)) return json({ error: 'Upload the SOP document (PDF).' }, 400)
    if (!folderId) return json({ error: 'Choose a destination folder.' }, 400)
    if (!G_CLIENT_ID || !G_CLIENT_SECRET || !G_REFRESH) {
      return json({ error: 'Drive is not configured — set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN.' }, 500)
    }

    // ---- authorisation: a manager runs her whole department across all
    // branches, so she may publish to any branch scope (a single branch or all
    // branches) — only the department has to be hers. ----
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
    const token = await getUserAccessToken(G_CLIENT_ID, G_CLIENT_SECRET, G_REFRESH)
    const docId = await uploadToDrive(token, folderId, `${code} — ${title}.pdf`, 'application/pdf', await document.arrayBuffer())
    await makeViewOnly(token, docId)

    let videoId: string | null = null
    if (video instanceof File && video.size > 0) {
      videoId = await uploadToDrive(token, folderId, `${code} — ${title} (video)`, video.type || 'video/mp4', await video.arrayBuffer())
      await makeViewOnly(token, videoId)
    }

    // ---- insert the SOP ----
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
        updated_at: new Date().toISOString(),
        published_by: actorName,
      })
      .select('*')
      .single()
    if (insErr) return json({ error: `Could not save the SOP: ${insErr.message}` }, 500)

    // ---- notify eligible staff (best-effort) ----
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
