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
import { getUserAccessToken, uploadToDrive, findOrCreateFolder } from '../_shared/google.ts'

// The Hamsun_SOP root storage folder that holds the per-department folders.
const STORAGE_FOLDER_ID = '1ERAgtoCpbhCEzFYq0gxhfbXc_rM6l9LQ'

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

    const { data: test } = await admin.from('tests').select('department_id').eq('id', testId).maybeSingle()
    const { data: staff } = await admin.from('staff').select('department_id').eq('id', staffId).maybeSingle()
    // A manager runs her whole department across branches; only the department
    // has to match. An admin may file any report.
    if (role.kind === 'manager') {
      if (!test || !staff || test.department_id !== role.department_id || staff.department_id !== role.department_id) {
        return json({ error: 'You can only file reports for your own department.' }, 403)
      }
    }

    const G_ID = Deno.env.get('GOOGLE_CLIENT_ID')
    const G_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')
    const G_REFRESH = Deno.env.get('GOOGLE_REFRESH_TOKEN')
    if (!G_ID || !G_SECRET || !G_REFRESH) return json({ driveSaved: false })

    const bytes = Uint8Array.from(atob(pdfB64), (c) => c.charCodeAt(0))
    const token = await getUserAccessToken(G_ID, G_SECRET, G_REFRESH)

    // Resolve the TEST'S OWN department folder by its name from the database —
    // authoritative, so a Housekeeping report always lands in the Housekeeping
    // folder, never wherever the client guessed. The client-passed folder id is
    // only a last-resort fallback. Reports go into a "Tests" sub-folder there,
    // kept separate from the SOP documents.
    let deptFolder = fallbackFolder
    if (test?.department_id) {
      const { data: deptRow } = await admin.from('departments').select('name, drive_folder_id').eq('id', test.department_id).maybeSingle()
      // Prefer the admin-set folder (Settings → Drive folders); else match by name.
      if (deptRow?.drive_folder_id) deptFolder = deptRow.drive_folder_id as string
      else if (deptRow?.name) deptFolder = await findOrCreateFolder(token, STORAGE_FOLDER_ID, String(deptRow.name).trim())
    }
    if (!deptFolder) return json({ driveSaved: false })

    const testsFolder = await findOrCreateFolder(token, deptFolder, 'Tests')
    await uploadToDrive(token, testsFolder, filename, 'application/pdf', bytes as unknown as ArrayBuffer)
    return json({ driveSaved: true })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Could not file the report.' }, 500)
  }
})
