/**
 * delete-sop Edge Function.
 *
 * Deletes an SOP everywhere: removes its document/video from Drive (via the same
 * Hamsun Google account used for upload) and deletes the SOP row (its
 * acknowledgments cascade). Verifies the caller is an admin or the owning
 * department manager. Same secrets as upload-sop.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getUserAccessToken, deleteFromDrive } from '../_shared/google.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

function isDriveId(ref: string | null): ref is string {
  return !!ref && !ref.startsWith('http') && !ref.startsWith('data:') && !ref.startsWith('blob:')
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
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    if (!jwt) return json({ error: 'Sign in first.' }, 401)

    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: `Bearer ${jwt}` } } })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'Your session has expired — sign in again.' }, 401)

    const admin = createClient(SUPABASE_URL, SERVICE)
    const { data: adminRow } = await admin.from('admins').select('id').eq('auth_user_id', user.id).maybeSingle()
    const { data: mgrRow } = adminRow
      ? { data: null }
      : await admin.from('managers').select('department_id').eq('auth_user_id', user.id).eq('active', true).maybeSingle()
    if (!adminRow && !mgrRow) return json({ error: 'Not an admin or department manager.' }, 403)

    const { sop_id } = await req.json()
    if (!sop_id) return json({ error: 'Missing sop_id.' }, 400)

    const { data: sop } = await admin
      .from('sops')
      .select('id, department_id, document_file_id, video_file_id')
      .eq('id', sop_id)
      .maybeSingle()
    if (!sop) return json({ error: 'That SOP no longer exists.' }, 404)
    if (!adminRow && sop.department_id !== mgrRow!.department_id) {
      return json({ error: 'You can only delete your own department’s SOPs.' }, 403)
    }

    // Remove the Drive files (best-effort; a failed Drive delete shouldn't strand
    // the record). Skip inline/demo references that aren't Drive ids.
    if (G_CLIENT_ID && G_CLIENT_SECRET && G_REFRESH) {
      try {
        const token = await getUserAccessToken(G_CLIENT_ID, G_CLIENT_SECRET, G_REFRESH)
        if (isDriveId(sop.document_file_id)) await deleteFromDrive(token, sop.document_file_id)
        if (isDriveId(sop.video_file_id)) await deleteFromDrive(token, sop.video_file_id)
      } catch (_) {
        // Leave the record deletion to proceed; the Drive file can be cleaned manually.
      }
    }

    const { error: delErr } = await admin.from('sops').delete().eq('id', sop_id)
    if (delErr) return json({ error: `Could not delete the SOP: ${delErr.message}` }, 500)

    return json({ ok: true })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Delete failed.' }, 500)
  }
})
