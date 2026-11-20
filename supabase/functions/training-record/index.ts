/**
 * training-record Edge Function.
 *
 * Files a per-person training-record PDF (generated in the browser) into the
 * staff member's department Google Drive folder, in a "Training Records"
 * sub-folder, named by the person. The browser has already downloaded the PDF;
 * this only archives the copy, so a Drive failure is non-fatal (driveSaved:false).
 *
 * Allowed for the admin and HR (any department), and a department/branch manager
 * for their own staff. Secrets: the GOOGLE_* Drive secrets.
 */

import { serviceClient, callerRole, bearer } from '../_shared/auth.ts'
import { cors, json } from '../_shared/http.ts'
import { getUserAccessToken, uploadToDrive, findOrCreateFolder } from '../_shared/google.ts'

const STORAGE_FOLDER_ID = '1ERAgtoCpbhCEzFYq0gxhfbXc_rM6l9LQ'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  try {
    const admin = serviceClient()
    const role = await callerRole(admin, bearer(req))
    if (!role) return json({ error: 'Sign in first.' }, 401)

    const body = await req.json().catch(() => ({}))
    const staffId = String(body.staff_id ?? '')
    const filename = String(body.filename ?? 'training-record.pdf')
    const pdfB64 = String(body.pdf ?? '')
    if (!pdfB64 || !staffId) return json({ driveSaved: false })

    const { data: staff } = await admin.from('staff').select('department_id, branch_id').eq('id', staffId).maybeSingle()
    if (!staff) return json({ error: 'That staff record no longer exists.' }, 404)

    // Admin and HR may file for anyone; a department/branch manager only for staff
    // in their own department / branch.
    if (role.kind === 'manager' && role.role === 'manager' && staff.department_id !== role.department_id) {
      return json({ error: 'You can only file records for your own department.' }, 403)
    }
    if (role.kind === 'manager' && role.role === 'branch_manager' && staff.branch_id !== role.branch_id) {
      return json({ error: 'You can only file records for your own branch.' }, 403)
    }

    const G_ID = Deno.env.get('GOOGLE_CLIENT_ID')
    const G_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')
    const G_REFRESH = Deno.env.get('GOOGLE_REFRESH_TOKEN')
    if (!G_ID || !G_SECRET || !G_REFRESH) return json({ driveSaved: false })

    const bytes = Uint8Array.from(atob(pdfB64), (c) => c.charCodeAt(0))
    const token = await getUserAccessToken(G_ID, G_SECRET, G_REFRESH)

    // Resolve the staff member's department folder authoritatively from the DB.
    let deptFolder = ''
    const { data: deptRow } = await admin.from('departments').select('name, drive_folder_id').eq('id', staff.department_id).maybeSingle()
    if (deptRow?.drive_folder_id) deptFolder = deptRow.drive_folder_id as string
    else if (deptRow?.name) deptFolder = await findOrCreateFolder(token, STORAGE_FOLDER_ID, String(deptRow.name).trim())
    if (!deptFolder) return json({ driveSaved: false })

    const recordsFolder = await findOrCreateFolder(token, deptFolder, 'Training Records')
    await uploadToDrive(token, recordsFolder, filename, 'application/pdf', bytes as unknown as ArrayBuffer)
    return json({ driveSaved: true })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Could not file the record.' }, 500)
  }
})
