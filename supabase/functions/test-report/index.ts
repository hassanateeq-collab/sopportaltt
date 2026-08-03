/**
 * test-report Edge Function.
 *
 * Generates a proper PDF report of one staff member's result on one test — their
 * details, the test, the latest result, the full attempt history and any
 * certificate — for an admin or the owning department manager to download. A
 * copy is also filed in the department's Google Drive folder, named by the SOP,
 * the attempt date and the person.
 *
 * Secrets: the GOOGLE_* Drive secrets (to file the copy). Service role is
 * auto-injected. If Drive isn't configured the download still works.
 */

import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1'
import { serviceClient, callerRole, bearer } from '../_shared/auth.ts'
import { cors, json } from '../_shared/http.ts'
import { getUserAccessToken, uploadToDrive, getFileParent } from '../_shared/google.ts'

const LANG_NAMES: Record<string, string> = { en: 'English', ur: 'Urdu', ps: 'Pashto' }

/** Strip characters the standard PDF font (WinAnsi) can't encode. */
function clean(s: unknown): string {
  return String(s ?? '').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}
function sanitizeFilename(s: string): string {
  return s.replace(/[\\/:*?"<>|\x00-\x1F]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 180)
}
function base64FromBytes(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(binary)
}

// deno-lint-ignore no-explicit-any
async function buildPdf(ctx: any): Promise<Uint8Array> {
  const { test, staff, dept, branch, attempts, cert, relSop, actorName } = ctx
  const doc = await PDFDocument.create()
  const page = doc.addPage([595.28, 841.89]) // A4
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const ink = rgb(0.09, 0.17, 0.14)
  const soft = rgb(0.3, 0.36, 0.34)
  const brass = rgb(0.627, 0.494, 0.173)
  const M = 50
  let y = 800

  // deno-lint-ignore no-explicit-any
  const draw = (s: string, o: any = {}) =>
    page.drawText(clean(s), { x: o.x ?? M, y, size: o.size ?? 11, font: o.f ?? font, color: o.color ?? ink })
  const gap = (n = 16) => { y -= n }
  const rule = () => page.drawLine({ start: { x: M, y }, end: { x: 545, y }, thickness: 0.8, color: rgb(0.85, 0.87, 0.83) })
  const row = (label: string, value: string) => {
    draw(label, { size: 10, color: soft })
    page.drawText(clean(value), { x: M + 155, y, size: 11, font, color: ink })
    gap(17)
  }
  const section = (t: string) => { draw(t, { size: 12, f: bold, color: brass }); gap(18) }

  draw('Training Test Report', { size: 22, f: bold })
  gap(19)
  draw('Hamsun Hospitality — SOP & Training Portal', { size: 11, color: soft })
  gap(15); rule(); gap(22)

  section('Staff member')
  row('Name', staff.name)
  row('Job title', staff.job_title || 'Staff')
  row('Department', dept ? `${dept.name} (${dept.code})` : '—')
  row('Branch', branch ? `${branch.name} (${branch.code})` : '—')
  gap(6); rule(); gap(22)

  section('Test')
  row('Title', test.title)
  row('Related SOP', relSop ? `${relSop.code} — ${relSop.title}` : 'None')
  row('Pass mark', `${test.pass_mark}%`)
  row('Certificate validity', `${test.validity_months} months`)
  gap(6); rule(); gap(22)

  const latest = attempts[0]
  section('Result (latest attempt)')
  row('Attempt date', fmtDateTime(latest.attempted_at))
  row('Score', `${latest.score} / ${latest.total}   (${latest.percentage}%)`)
  row('Outcome', latest.passed ? 'PASS' : 'FAIL')
  row('Language taken', LANG_NAMES[latest.language] ?? latest.language)
  if (cert) row('Certification', `Issued ${fmtDate(cert.issued_at)} · valid until ${fmtDate(cert.expires_at)}`)
  gap(6); rule(); gap(22)

  section('Attempt history')
  draw('Date', { size: 10, color: soft })
  page.drawText('Score', { x: M + 230, y, size: 10, font, color: soft })
  page.drawText('%', { x: M + 310, y, size: 10, font, color: soft })
  page.drawText('Result', { x: M + 370, y, size: 10, font, color: soft })
  gap(16)
  for (const a of attempts) {
    if (y < 90) break
    draw(fmtDateTime(a.attempted_at), { size: 10 })
    page.drawText(clean(`${a.score}/${a.total}`), { x: M + 230, y, size: 10, font, color: ink })
    page.drawText(clean(`${a.percentage}%`), { x: M + 310, y, size: 10, font, color: ink })
    page.drawText(a.passed ? 'PASS' : 'FAIL', {
      x: M + 370, y, size: 10, font: bold, color: a.passed ? rgb(0.12, 0.3, 0.16) : rgb(0.6, 0.15, 0.12),
    })
    gap(15)
  }

  y = 58
  rule(); gap(14)
  draw(`Generated ${fmtDateTime(new Date().toISOString())} by ${actorName}.`, { size: 9, color: soft })
  gap(12)
  draw('Scoring is by answer position and is identical in every language the test is offered in.', { size: 9, color: soft })

  return await doc.save()
}

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
    const fallbackFolder = String(body.folder_id ?? '')
    if (!testId || !staffId) return json({ error: 'Missing test or staff.' }, 400)

    const { data: test } = await admin.from('tests').select('*').eq('id', testId).maybeSingle()
    if (!test) return json({ error: 'That test no longer exists.' }, 404)
    const { data: staff } = await admin
      .from('staff').select('id, name, department_id, branch_id, job_title').eq('id', staffId).maybeSingle()
    if (!staff) return json({ error: 'That staff record no longer exists.' }, 404)

    if (role.kind === 'manager') {
      if (test.department_id !== role.department_id || staff.department_id !== role.department_id || staff.branch_id !== role.branch_id) {
        return json({ error: 'You can only report on your own department at your own branch.' }, 403)
      }
    }

    const [{ data: dept }, { data: branch }, { data: attempts }] = await Promise.all([
      admin.from('departments').select('code, name').eq('id', staff.department_id).maybeSingle(),
      admin.from('branches').select('code, name').eq('id', staff.branch_id).maybeSingle(),
      admin.from('attempts').select('*').eq('staff_id', staffId).eq('test_id', testId).order('attempted_at', { ascending: false }),
    ])
    if (!attempts || attempts.length === 0) return json({ error: 'This person has not attempted this test yet.' }, 400)

    const { data: cert } = await admin
      .from('certifications').select('*').eq('staff_id', staffId).eq('test_id', testId)
      .order('issued_at', { ascending: false }).limit(1).maybeSingle()
    const relSop = test.related_sop_id
      ? (await admin.from('sops').select('code, title, document_file_id').eq('id', test.related_sop_id).maybeSingle()).data
      : null

    const pdfBytes = await buildPdf({ test, staff, dept, branch, attempts, cert, relSop, actorName: role.name })

    const sopName = relSop ? `${relSop.code} ${relSop.title}` : test.title
    const dateStr = String(attempts[0].attempted_at).slice(0, 10)
    const filename = sanitizeFilename(`${sopName} — ${staff.name} — ${dateStr}.pdf`)

    // File a copy in the department's Drive folder (best-effort).
    let driveSaved = false
    const G_ID = Deno.env.get('GOOGLE_CLIENT_ID')
    const G_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')
    const G_REFRESH = Deno.env.get('GOOGLE_REFRESH_TOKEN')
    if (G_ID && G_SECRET && G_REFRESH) {
      try {
        const token = await getUserAccessToken(G_ID, G_SECRET, G_REFRESH)
        let folder = fallbackFolder
        if (relSop?.document_file_id && !/^(https?:|data:|blob:)/.test(relSop.document_file_id)) {
          folder = (await getFileParent(token, relSop.document_file_id)) ?? fallbackFolder
        }
        if (folder) {
          await uploadToDrive(token, folder, filename, 'application/pdf', pdfBytes as unknown as ArrayBuffer)
          driveSaved = true
        }
      } catch (_) {
        // Download still works even if filing the copy fails.
      }
    }

    return json({ pdf: base64FromBytes(pdfBytes), filename, driveSaved })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Could not generate the report.' }, 500)
  }
})
