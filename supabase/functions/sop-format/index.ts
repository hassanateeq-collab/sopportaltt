/**
 * sop-format Edge Function.
 *
 * A single org-wide "SOP format" template document that admins publish so
 * managers know which layout to write their SOPs in. Drive is the source of
 * truth — the file lives in a dedicated "SOP Format" folder under the Hamsun_SOP
 * root; there is no database row to keep in sync.
 *
 *   action 'get'   (admin or manager) → the current format file {id,name} or null
 *   action 'set'   (admin only, multipart with `file`) → replace the format:
 *                   removes any existing file, uploads the new one, shares it as
 *                   reader-for-anyone so managers can view and download it.
 *   action 'clear' (admin only) → delete the format file(s).
 *
 * Same Google OAuth secrets as upload-sop.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getUserAccessToken, findOrCreateFolder, uploadToDrive, deleteFromDrive, listFiles, shareReadable } from '../_shared/google.ts'
// The shared CORS allows the `apikey` header the get/clear calls send through
// callAdminFn — an inline CORS without it fails the browser preflight.
import { cors, json } from '../_shared/http.ts'

// The Hamsun_SOP root storage folder (same id the folder picker uses).
const STORAGE_FOLDER_ID = '1ERAgtoCpbhCEzFYq0gxhfbXc_rM6l9LQ'
const FORMAT_FOLDER = 'SOP Format'

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
      : await admin.from('managers').select('id').eq('auth_user_id', user.id).eq('active', true).maybeSingle()
    if (!adminRow && !mgrRow) return json({ error: 'Not an admin or department manager.' }, 403)
    const isAdmin = !!adminRow

    if (!G_ID || !G_SECRET || !G_REFRESH) return json({ error: 'Drive is not configured.' }, 500)

    // 'set' arrives as multipart (it carries the file); 'get'/'clear' as JSON.
    let action = 'get'
    let file: File | null = null
    const ct = req.headers.get('content-type') ?? ''
    if (ct.includes('multipart/form-data')) {
      const form = await req.formData()
      action = String(form.get('action') ?? 'set')
      const f = form.get('file')
      if (f instanceof File) file = f
    } else {
      const body = await req.json().catch(() => ({}))
      action = String(body.action ?? 'get')
    }

    const token = await getUserAccessToken(G_ID, G_SECRET, G_REFRESH)
    const folderId = await findOrCreateFolder(token, STORAGE_FOLDER_ID, FORMAT_FOLDER)

    if (action === 'get') {
      const files = await listFiles(token, folderId)
      const f = files[0] ?? null
      return json({ format: f ? { id: f.id, name: f.name } : null })
    }

    // Mutations are admin-only.
    if (!isAdmin) return json({ error: 'Only an admin can change the SOP format.' }, 403)

    if (action === 'clear') {
      const files = await listFiles(token, folderId)
      for (const f of files) await deleteFromDrive(token, f.id)
      return json({ format: null })
    }

    if (action === 'set') {
      if (!file || file.size === 0) return json({ error: 'Choose a format file to upload.' }, 400)
      // Keep just one format: drop any existing files first.
      const existing = await listFiles(token, folderId)
      for (const f of existing) await deleteFromDrive(token, f.id)
      const id = await uploadToDrive(token, folderId, file.name, file.type || 'application/octet-stream', await file.arrayBuffer())
      await shareReadable(token, id)
      return json({ format: { id, name: file.name } })
    }

    return json({ error: `Unknown action "${action}".` }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'SOP format operation failed.' }, 500)
  }
})
