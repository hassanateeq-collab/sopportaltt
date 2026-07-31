/**
 * drive-folders Edge Function.
 *
 *   GET  → list the sub-folders of the Hamsun_SOP storage folder.
 *   POST { name } → create a new sub-folder and return it.
 *
 * Used by the Add-SOP form's folder picker. Verifies the caller is an admin or a
 * department manager. Same Google OAuth secrets as upload-sop.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getUserAccessToken, listFolders, createFolder } from '../_shared/google.ts'

const STORAGE_FOLDER_ID = '1ERAgtoCpbhCEzFYq0gxhfbXc_rM6l9LQ'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

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
      : await admin.from('managers').select('id').eq('auth_user_id', user.id).eq('active', true).maybeSingle()
    if (!adminRow && !mgrRow) return json({ error: 'Not an admin or department manager.' }, 403)

    if (!G_CLIENT_ID || !G_CLIENT_SECRET || !G_REFRESH) {
      return json({ error: 'Drive is not configured.' }, 500)
    }
    const token = await getUserAccessToken(G_CLIENT_ID, G_CLIENT_SECRET, G_REFRESH)

    if (req.method === 'POST') {
      const { name } = await req.json()
      const clean = String(name ?? '').trim()
      if (!clean) return json({ error: 'Give the folder a name.' }, 400)
      const existing = await listFolders(token, STORAGE_FOLDER_ID)
      const dupe = existing.find((f) => f.name.toLowerCase() === clean.toLowerCase())
      if (dupe) return json({ folder: dupe }) // already there — just return it
      const folder = await createFolder(token, STORAGE_FOLDER_ID, clean)
      return json({ folder })
    }

    const folders = await listFolders(token, STORAGE_FOLDER_ID)
    return json({ folders })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Folder operation failed.' }, 500)
  }
})
