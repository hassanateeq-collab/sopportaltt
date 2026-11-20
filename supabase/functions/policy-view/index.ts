/**
 * policy-view Edge Function.
 *
 * Streams a policy's uploaded document THROUGH the portal, so the browser can
 * render it inline without ever touching a google.com URL. The Drive file id and
 * the Google credentials stay on the server; the browser only ever sees the raw
 * bytes (which it turns into a `blob:` URL for an in-portal viewer).
 *
 * Who may read a policy's document:
 *   - staff (opaque token): any PUBLISHED policy;
 *   - admin / HR (Auth JWT): any policy;
 *   - any other manager (Auth JWT): any PUBLISHED policy.
 *
 * Secrets: the GOOGLE_* Drive secrets. Supabase injects SUPABASE_URL /
 * SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY.
 */

import { serviceClient, callerRole, bearer, staffFromToken } from '../_shared/auth.ts'
import { getUserAccessToken, downloadFromDriveTyped } from '../_shared/google.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function err(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return err('POST only', 405)

  try {
    const admin = serviceClient()
    const body = await req.json().catch(() => ({}))
    const policyId = String(body.id ?? '')
    const token = String(body.token ?? '')
    if (!policyId) return err('Which policy?', 400)

    const { data: policy } = await admin
      .from('policies')
      .select('id, status, document_file_id')
      .eq('id', policyId)
      .maybeSingle()
    if (!policy) return err('That policy no longer exists.', 404)

    // ---- authorize ----
    let allowed = false
    if (token) {
      const staff = await staffFromToken(admin, token)
      if (staff && policy.status === 'published') allowed = true
    } else {
      const role = await callerRole(admin, bearer(req))
      if (role) {
        if (role.kind === 'admin') allowed = true
        else if (role.kind === 'manager' && role.role === 'hr') allowed = true
        else if (role.kind === 'manager' && policy.status === 'published') allowed = true
      }
    }
    if (!allowed) return err('You are not allowed to view this policy.', 403)
    if (!policy.document_file_id) return err('This policy has no uploaded document.', 404)

    const gid = Deno.env.get('GOOGLE_CLIENT_ID')
    const gsecret = Deno.env.get('GOOGLE_CLIENT_SECRET')
    const grefresh = Deno.env.get('GOOGLE_REFRESH_TOKEN')
    if (!gid || !gsecret || !grefresh) return err('Drive is not configured on the portal.', 500)

    const gtoken = await getUserAccessToken(gid, gsecret, grefresh)
    const { bytes, contentType } = await downloadFromDriveTyped(gtoken, policy.document_file_id as string)

    return new Response(bytes, {
      status: 200,
      headers: {
        ...cors,
        'Content-Type': contentType,
        'Content-Disposition': 'inline',
        'Cache-Control': 'private, max-age=60',
      },
    })
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Could not load the document.', 500)
  }
})
