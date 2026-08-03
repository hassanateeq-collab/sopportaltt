/**
 * test-report Edge Function.
 *
 * Files a test-result PDF (generated in the browser, so Urdu/Pashto render
 * correctly) into the department's Google Drive folder — named by SOP + date +
 * person. Scoped to the caller's department/branch for managers. The browser
 * has already downloaded the PDF; this only archives the copy, so a Drive
 * failure is non-fatal (returns driveSaved:false).
 *
 * Secrets: the GOOGLE_* Drive secrets. Service role is auto-injected.
 */

import { serviceClient, callerRole, bearer } from '../_shared/auth.ts'
import { cors, json } from '../_shared/http.ts'
import { getUserAccessToken, uploadToDrive, getFileParent } from '../_shared/google.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  try {
    const admin = serviceClient()
    const role = await callerRole(admin, bearer(req))
    if (!role) return json({ error: 'Sign in as a manager or admin first.' }, 401)

    const body = await req.json().catch(() => ({}))
    const testId = String(body.test_id ?? '')
    const staffId = String(body.staff_id ?? '')
    const filename = String(body.filename ?? 'test-report.pdf')
    const fallbackFolder = String(body.folder_id ?? '')
    const pdfB64 = String(body.pdf ?? '')
    if (!pdfB64) return json({ driveSaved: false })

    const { data: test } = await admin.from('tests').select('department_id, related_sop_id').eq('id', testId).maybeSingle()
    const { data: staff } = await admin.from('staff').select('department_id, branch_id').eq('id', staffId).maybeSingle()
    if (role.kind === 'manager') {
      if (!test || !staff || test.department_id !== role.department_id || staff.department_id !== role.department_id || staff.branch_id !== role.branch_id) {
        return json({ error: 'You can only file reports for your own department at your own branch.' }, 403)
      }
    }

    const G_ID = Deno.env.get('GOOGLE_CLIENT_ID')
    const G_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')
    const G_REFRESH = Deno.env.get('GOOGLE_REFRESH_TOKEN')
    if (!G_ID || !G_SECRET || !G_REFRESH) return json({ driveSaved: false })

    const bytes = Uint8Array.from(atob(pdfB64), (c) => c.charCodeAt(0))
    const token = await getUserAccessToken(G_ID, G_SECRET, G_REFRESH)

    // Prefer the related SOP's own Drive folder; else the department folder.
    let folder = fallbackFolder
    if (test?.related_sop_id) {
      const { data: sop } = await admin.from('sops').select('document_file_id').eq('id', test.related_sop_id).maybeSingle()
      if (sop?.document_file_id && !/^(https?:|data:|blob:)/.test(sop.document_file_id)) {
        folder = (await getFileParent(token, sop.document_file_id)) ?? fallbackFolder
      }
    }
    if (!folder) return json({ driveSaved: false })

    await uploadToDrive(token, folder, filename, 'application/pdf', bytes as unknown as ArrayBuffer)
    return json({ driveSaved: true })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Could not file the report.' }, 500)
  }
})
