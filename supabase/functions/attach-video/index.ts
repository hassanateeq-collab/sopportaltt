/**
 * attach-video Edge Function.
 *
 * Adds, replaces, or removes the training video on an EXISTING SOP without
 * touching the document or bumping the version (a video change isn't a new
 * revision, so it doesn't reopen everyone's sign-off). The video lands in the
 * same Drive folder as the SOP's document, view-only; replacing or removing
 * deletes the old Drive file. A manager may only do this for her own
 * department + branch.
 *
 * Reuses the GOOGLE_* Drive secrets. Form fields: sop_id, optional video file,
 * optional remove=true.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getUserAccessToken, uploadToDrive, makeViewOnly, deleteFromDrive, getFileParent } from '../_shared/google.ts'
import { cors, json } from '../_shared/http.ts'
import { scopeIncludes } from '../_shared/scope.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
  const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const G_ID = Deno.env.get('GOOGLE_CLIENT_ID')
  const G_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')
  const G_REFRESH = Deno.env.get('GOOGLE_REFRESH_TOKEN')

  try {
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    if (!jwt) return json({ error: 'Sign in first.' }, 401)
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: `Bearer ${jwt}` } } })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'Your session has expired — sign in again.' }, 401)

    const admin = createClient(SUPABASE_URL, SERVICE)
    const { data: adminRow } = await admin.from('admins').select('id').eq('auth_user_id', user.id).maybeSingle()
    const { data: mgrRow } = adminRow
      ? { data: null }
      : await admin.from('managers').select('department_id, branch_id').eq('auth_user_id', user.id).eq('active', true).maybeSingle()
    if (!adminRow && !mgrRow) return json({ error: 'Not an admin or department manager.' }, 403)

    const form = await req.formData()
    const sopId = String(form.get('sop_id') ?? '')
    const fallbackFolder = String(form.get('folder_id') ?? '')
    const remove = String(form.get('remove') ?? '') === 'true'
    const video = form.get('video')
    if (!sopId) return json({ error: 'Which SOP?' }, 400)

    const { data: sop } = await admin
      .from('sops')
      .select('id, code, title, department_id, branch_scope, document_file_id, video_file_id')
      .eq('id', sopId)
      .maybeSingle()
    if (!sop) return json({ error: 'That SOP no longer exists.' }, 404)

    // Managers are pinned to their own department + branch.
    if (!adminRow) {
      const { data: br } = await admin.from('branches').select('code').eq('id', mgrRow!.branch_id).single()
      if (sop.department_id !== mgrRow!.department_id || !scopeIncludes(sop.branch_scope, br?.code)) {
        return json({ error: 'You can only manage SOPs in your own department at your own branch.' }, 403)
      }
    }

    if (!G_ID || !G_SECRET || !G_REFRESH) {
      return json({ error: 'Drive is not configured — set the GOOGLE_* secrets.' }, 500)
    }
    const token = await getUserAccessToken(G_ID, G_SECRET, G_REFRESH)

    // Remove: delete the Drive file (best-effort) and clear the id.
    if (remove && !(video instanceof File && video.size > 0)) {
      if (sop.video_file_id && !/^(https?:|data:|blob:)/.test(sop.video_file_id)) {
        await deleteFromDrive(token, sop.video_file_id).catch(() => {})
      }
      const { data: updated, error } = await admin.from('sops').update({ video_file_id: null }).eq('id', sopId).select('*').single()
      if (error) return json({ error: error.message }, 500)
      return json({ sop: updated })
    }

    if (!(video instanceof File) || video.size === 0) return json({ error: 'Choose a video file.' }, 400)

    // Put the new video in the same folder as the document; fall back to the
    // folder the form supplied if the parent can't be resolved.
    let folderId = fallbackFolder
    if (sop.document_file_id && !/^(https?:|data:|blob:)/.test(sop.document_file_id)) {
      folderId = (await getFileParent(token, sop.document_file_id)) ?? fallbackFolder
    }
    if (!folderId) return json({ error: 'Could not find a folder for the video.' }, 400)

    const newId = await uploadToDrive(token, folderId, `${sop.code} — ${sop.title} (video)`, video.type || 'video/mp4', await video.arrayBuffer())
    await makeViewOnly(token, newId)

    // Replacing? remove the old Drive file (best-effort, after the new one is up).
    if (sop.video_file_id && sop.video_file_id !== newId && !/^(https?:|data:|blob:)/.test(sop.video_file_id)) {
      await deleteFromDrive(token, sop.video_file_id).catch(() => {})
    }

    const { data: updated, error } = await admin.from('sops').update({ video_file_id: newId }).eq('id', sopId).select('*').single()
    if (error) return json({ error: error.message }, 500)
    return json({ sop: updated })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Could not update the video.' }, 500)
  }
})
