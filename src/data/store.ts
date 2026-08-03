/**
 * The data layer.
 *
 * Every function on `api` below is shaped like the Edge Function that will
 * replace it — async, taking a session token where a real one would, and
 * enforcing its rule *here* rather than in the UI. That is deliberate. The
 * retest gate, the login lockout counter and certificate issuance are the three
 * things that are worthless if they live in the browser's render logic, so they
 * live in this module and the screens simply call in and are told no.
 *
 * When Supabase is wired up, each method becomes a fetch to the matching Edge
 * Function and the call sites do not change.
 */

import {
  BRANCHES,
  DEPARTMENTS,
  DEMO_STAFF,
  DEMO_PASSWORDS,
  MANAGERS,
  ADMINS,
  SOPS,
  TESTS,
  QUESTIONS,
} from './seed'
import { hashEmployeeCode, verifyEmployeeCode, generateEmployeeCode } from '../lib/hash'
import { addMonths } from '../lib/certs'
import { nextDocCode, isDocCodeTaken, isValidDocCode } from '../lib/codes'
import { appliesToStaff, scopeIncludes } from '../lib/scope'
import { supabase, isSupabaseEnabled, functionsBase, anonPublicKey } from '../lib/supabase'
import { DRIVE_DEPARTMENT_FOLDERS } from '../lib/drive'
import type {
  Acknowledgment,
  Admin,
  Attempt,
  Branch,
  BranchScope,
  Certification,
  Department,
  Difficulty,
  Language,
  Manager,
  Notification,
  NotificationKind,
  Question,
  RetestGrant,
  Sop,
  Staff,
  StaffSession,
  Test,
  TestAssignment,
} from '../types'

/* ----------------------------------------------------------------- state ---- */

interface Db {
  branches: Branch[]
  departments: Department[]
  staff: Staff[]
  managers: Manager[]
  admins: Admin[]
  sops: Sop[]
  acknowledgments: Acknowledgment[]
  tests: Test[]
  questions: Question[]
  assignments: TestAssignment[]
  attempts: Attempt[]
  certifications: Certification[]
  grants: RetestGrant[]
  notifications: Notification[]
  sessions: StaffSession[]
  /** Server-side failed-login counter. Counted here, never in the browser's head. */
  lockouts: Record<string, { failures: number; locked_until: string | null }>
}

const STORAGE_KEY = 'hamsun-sop-portal/db/v1'

let db: Db = emptyDb()

function emptyDb(): Db {
  return {
    branches: [],
    departments: [],
    staff: [],
    managers: [],
    admins: [],
    sops: [],
    acknowledgments: [],
    tests: [],
    questions: [],
    assignments: [],
    attempts: [],
    certifications: [],
    grants: [],
    notifications: [],
    sessions: [],
    lockouts: {},
  }
}

/* ------------------------------------------------------------ pub / sub ---- */

const listeners = new Set<() => void>()

export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

let snapshotVersion = 0
export function getSnapshotVersion(): number {
  return snapshotVersion
}

function commit(): void {
  snapshotVersion++
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
  } catch {
    // Private-browsing quota failures must not take the portal down.
  }
  listeners.forEach((fn) => fn())
}

/* ------------------------------------------------------------------ init ---- */

const LOCKOUT_THRESHOLD = 3
const LOCKOUT_MINUTES = 15
/** Roughly one shift. */
const SESSION_HOURS = 9

function id(prefix: string): string {
  const uuid =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36)
  return `${prefix}-${uuid}`
}

function nowIso(): string {
  return new Date().toISOString()
}

export async function initStore(): Promise<void> {
  // Supabase mode: no seed and no localStorage cache. The database is the source
  // of truth; the in-memory db is filled by hydrateFromSupabase() after a
  // manager/admin (or, later, a staff member) signs in. If a manager session is
  // still valid from a previous visit, resume it and hydrate straight away.
  if (isSupabaseEnabled) {
    db = emptyDb()
    // Branches and departments are anon-readable, so the login funnels work
    // before anyone signs in. A manager/admin session then hydrates the rest;
    // failing that, a still-valid staff token resumes the staff portal.
    await hydratePublic()
    await resumeSupabaseSession()
    await resumeSupabaseStaffSession()
    return
  }

  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw) {
    try {
      db = { ...emptyDb(), ...(JSON.parse(raw) as Db) }
      return
    } catch {
      // Corrupt payload — fall through and reseed.
    }
  }
  await seed()
}

export async function resetDemoData(): Promise<void> {
  localStorage.removeItem(STORAGE_KEY)
  db = emptyDb()
  await seed()
  commit()
}

/* ------------------------------------------------------ supabase backing ---- */

/**
 * When Supabase is enabled the in-memory `db` is a cache hydrated from the
 * database. RLS decides what each signed-in actor may load, so an admin's
 * hydrate returns everything and a manager's returns only her department and
 * branch. Reads and the screens are unchanged — they still read `db`
 * synchronously; only the source of the data moved.
 */

/** The manager/admin resumed from a persisted Supabase session, if any. */
let resumedActor: Actor | null = null
export function getResumedActor(): Actor | null {
  return resumedActor
}

function mapStaffRow(row: Record<string, unknown>): Staff {
  // employee_code_hash is intentionally never sent to the browser (column
  // grant), so it is blank in the cache. The plaintext employee_code IS granted
  // to authenticated, but only for rows the caller's RLS lets them see (their own
  // patch / themselves), so a manager or admin can look up a code to re-tell it.
  return {
    id: row.id as string,
    name: row.name as string,
    department_id: row.department_id as string,
    branch_id: row.branch_id as string,
    job_title: (row.job_title as string) ?? 'Staff',
    employee_code_hash: '',
    employee_code: (row.employee_code as string | null) ?? null,
    active: row.active as boolean,
    created_at: row.created_at as string,
  }
}

async function fetchAll<T>(table: string, columns = '*'): Promise<T[]> {
  const client = supabase!
  const { data, error } = await client.from(table).select(columns)
  if (error) throw new ApiError(`Could not load ${table}: ${error.message}`)
  return (data ?? []) as T[]
}

// The employee-code hash column is not granted to the browser, so staff must be
// selected by explicit columns — a plain `select *` trips the column privilege
// and Postgres answers "permission denied for table staff".
const STAFF_COLUMNS_BASE = 'id,name,department_id,branch_id,job_title,active,created_at'
const STAFF_COLUMNS = `${STAFF_COLUMNS_BASE},employee_code`

/**
 * Load the staff rows for a manager/admin, including the plaintext employee_code.
 * If migration 0002 hasn't added that column yet (e.g. the new frontend deployed
 * before the SQL was run), fall back to the base columns so the board still
 * works — codes just show as "not set" until the migration runs.
 */
async function fetchStaffRows(): Promise<Record<string, unknown>[]> {
  const client = supabase!
  const first = await client.from('staff').select(STAFF_COLUMNS)
  if (first.error) {
    if (/employee_code/.test(first.error.message)) {
      const base = await client.from('staff').select(STAFF_COLUMNS_BASE)
      if (base.error) throw new ApiError(`Could not load staff: ${base.error.message}`)
      return (base.data ?? []) as Record<string, unknown>[]
    }
    throw new ApiError(`Could not load staff: ${first.error.message}`)
  }
  return (first.data ?? []) as Record<string, unknown>[]
}

/** Load just the anon-readable org shell (branches + departments) for the login funnels. */
async function hydratePublic(): Promise<void> {
  try {
    const [branches, departments] = await Promise.all([
      fetchAll<Branch>('branches'),
      fetchAll<Department>('departments'),
    ])
    db.branches = branches
    db.departments = departments
    snapshotVersion++
    listeners.forEach((fn) => fn())
  } catch {
    // Misconfigured keys or offline — the shell just shows nothing to pick.
  }
}

/** Pull everything the current actor is allowed to see into the cache. */
async function hydrateFromSupabase(): Promise<void> {
  const [
    branches,
    departments,
    staff,
    managers,
    admins,
    sops,
    acknowledgments,
    tests,
    questions,
    assignments,
    attempts,
    certifications,
    grants,
    notifications,
  ] = await Promise.all([
    fetchAll<Branch>('branches'),
    fetchAll<Department>('departments'),
    fetchStaffRows(),
    fetchAll<Manager>('managers'),
    fetchAll<Admin>('admins'),
    fetchAll<Sop>('sops'),
    fetchAll<Acknowledgment>('acknowledgments'),
    fetchAll<Test>('tests'),
    fetchAll<Question>('questions'),
    fetchAll<TestAssignment>('test_assignments'),
    fetchAll<Attempt>('attempts'),
    fetchAll<Certification>('certifications'),
    fetchAll<RetestGrant>('retest_grants'),
    fetchAll<Notification>('notifications'),
  ])
  db = {
    ...emptyDb(),
    branches,
    departments,
    staff: staff.map(mapStaffRow),
    managers,
    admins,
    sops,
    acknowledgments,
    tests,
    questions,
    assignments,
    attempts,
    certifications,
    grants,
    notifications,
  }
  snapshotVersion++
  listeners.forEach((fn) => fn())
}

/** Resolve the signed-in Supabase Auth user to an admin or manager actor. */
async function resolveSupabaseActor(): Promise<Actor | null> {
  const client = supabase!
  const { data: userData } = await client.auth.getUser()
  const user = userData.user
  if (!user) return null

  const { data: adminRows } = await client
    .from('admins')
    .select('*')
    .eq('auth_user_id', user.id)
    .limit(1)
  if (adminRows && adminRows.length > 0) {
    const a = adminRows[0]
    return { kind: 'admin', admin: { id: a.id, name: a.name, email: a.email } }
  }

  const { data: managerRows } = await client
    .from('managers')
    .select('*')
    .eq('auth_user_id', user.id)
    .eq('active', true)
    .limit(1)
  if (managerRows && managerRows.length > 0) {
    const m = managerRows[0]
    return {
      kind: 'manager',
      manager: {
        id: m.id,
        name: m.name,
        email: m.email,
        department_id: m.department_id,
        branch_id: m.branch_id,
        active: m.active,
      },
    }
  }

  return null
}

/**
 * Publish an SOP by uploading its files through the upload-sop Edge Function
 * (which pushes them to the chosen Drive folder view-only and inserts the SOP).
 * Used in Supabase mode instead of the gated api.publishSop.
 */
export async function uploadSopViaFunction(
  input: { title: string; code?: string; department_id: string; branch_scope: BranchScope; folder_id: string },
  pdf: File,
  video: File | null,
): Promise<void> {
  if (!supabase) throw new ApiError('Not connected to the database.')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new ApiError('Please sign in again.')

  const fd = new FormData()
  fd.set('title', input.title)
  fd.set('code', input.code ?? '')
  fd.set('department_id', input.department_id)
  fd.set('branch_scope', JSON.stringify(input.branch_scope))
  fd.set('folder_id', input.folder_id)
  fd.set('document', pdf)
  if (video) fd.set('video', video)

  let res: Response
  try {
    res = await fetch(`${functionsBase}/upload-sop`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: fd,
    })
  } catch {
    throw new ApiError('Could not reach the upload function.')
  }
  if (res.status === 404) throw new ApiError('The upload function isn’t deployed yet — see supabase/SETUP.md.')
  if (!res.ok) {
    let msg = 'Upload failed.'
    try {
      const j = await res.json()
      if (j?.error) msg = j.error
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(msg)
  }
  await hydrateFromSupabase()
}

/**
 * Add or replace the training video on an EXISTING SOP, without bumping the
 * version (a video change is not a new revision, so it doesn't reopen sign-off).
 * In Supabase mode the attach-video Edge Function uploads it to the SOP's Drive
 * folder view-only and swaps the id; in demo mode it just points at the file.
 */
export async function attachSopVideo(sopId: string, video: File, fallbackFolderId: string): Promise<void> {
  const sop = read.sop(sopId)
  if (!sop) throw new ApiError('That SOP no longer exists.')

  if (!isSupabaseEnabled) {
    sop.video_file_id = URL.createObjectURL(video)
    commit()
    return
  }
  if (!supabase) throw new ApiError('Not connected to the database.')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new ApiError('Please sign in again.')

  const fd = new FormData()
  fd.set('sop_id', sopId)
  fd.set('folder_id', fallbackFolderId)
  fd.set('video', video)

  let res: Response
  try {
    res = await fetch(`${functionsBase}/attach-video`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: fd,
    })
  } catch {
    throw new ApiError('Could not reach the attach-video function.')
  }
  if (res.status === 404) throw new ApiError('Deploy the attach-video function first (see supabase/SETUP.md).')
  if (!res.ok) {
    const j = await res.json().catch(() => ({}))
    throw new ApiError((j as { error?: string }).error ?? 'Could not update the video.')
  }
  await hydrateFromSupabase()
}

/**
 * Generate and download a PDF report of one staff member's result on one test
 * (their details, the test, the latest result, the full attempt history and any
 * certificate). The report is built server-side by the test-report Edge Function
 * and a copy is filed in the department's Drive folder, named by SOP + date +
 * person. Returns whether the Drive copy was saved.
 */
export async function downloadTestReport(
  testId: string,
  staffId: string,
  folderId: string,
): Promise<{ driveSaved: boolean }> {
  if (!isSupabaseEnabled) throw new ApiError('Report download works in the live app.')

  const test = read.test(testId)
  if (!test) throw new ApiError('That test no longer exists.')
  const staff = read.staffMember(staffId)
  if (!staff) throw new ApiError('That staff record no longer exists.')
  const attempts = attemptsFor(staffId, testId)
  const latest = attempts[0]
  if (!latest) throw new ApiError('This person has not attempted this test yet.')

  const data = {
    test,
    staff,
    dept: read.department(staff.department_id),
    branch: read.branch(staff.branch_id),
    attempts,
    latest,
    cert: latestCertification(staffId, testId),
    relSop: test.related_sop_id ? read.sop(test.related_sop_id) : null,
    questions: read.questionsFor(testId),
    answers: (latest as unknown as { answers?: Array<number | null> }).answers ?? null,
  }

  // Rendered in the browser so Urdu/Pashto (right-to-left, shaped) come out
  // correct — a PDF font can't lay out those scripts on the server.
  const el = buildReportElement(data)
  document.body.appendChild(el)
  let blob: Blob
  try {
    const [h2c, jspdf] = await Promise.all([import('html2canvas'), import('jspdf')])
    const html2canvas = h2c.default
    const { jsPDF } = jspdf
    const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff' })
    const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
    const pageW = pdf.internal.pageSize.getWidth()
    const pageH = pdf.internal.pageSize.getHeight()
    const imgH = (canvas.height * pageW) / canvas.width
    const imgData = canvas.toDataURL('image/jpeg', 0.92)
    let position = 0
    let heightLeft = imgH
    pdf.addImage(imgData, 'JPEG', 0, position, pageW, imgH)
    heightLeft -= pageH
    while (heightLeft > 0) {
      position -= pageH
      pdf.addPage()
      pdf.addImage(imgData, 'JPEG', 0, position, pageW, imgH)
      heightLeft -= pageH
    }
    blob = pdf.output('blob')
  } finally {
    el.remove()
  }

  const sopName = data.relSop ? `${data.relSop.code} ${data.relSop.title}` : test.title
  const filename = `${sopName} - ${staff.name} - ${latest.attempted_at.slice(0, 10)}.pdf`
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)

  // File a copy in the department's Drive folder (best-effort — the download
  // already happened, so a filing failure just means no archived copy).
  let driveSaved = false
  try {
    const pdfBase64 = await blobToBase64(blob)
    const j = await callAdminFn('test-report', {
      test_id: testId,
      staff_id: staffId,
      folder_id: folderId,
      filename,
      pdf: pdfBase64,
    })
    driveSaved = !!j.driveSaved
  } catch {
    driveSaved = false
  }
  return { driveSaved }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = reject
    r.readAsDataURL(blob)
  })
}

/** Build the off-screen HTML the report PDF is rendered from. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildReportElement(d: any): HTMLElement {
  const esc = (s: unknown) =>
    String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)
  const LANG: Record<string, string> = { en: 'English', ur: 'Urdu', ps: 'Pashto' }
  const fmtD = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  const fmtDT = (iso: string) =>
    new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  const { test, staff, dept, branch, attempts, latest, cert, relSop, questions, answers } = d

  const rows = (list: Array<[string, string]>) =>
    list
      .map(
        ([l, v]) =>
          `<div style="display:flex;margin-bottom:7px"><div style="width:170px;color:#4e5d56;font-size:12px">${esc(l)}</div><div style="flex:1;font-size:13px">${esc(v)}</div></div>`,
      )
      .join('')

  let qHtml: string
  if (!Array.isArray(answers)) {
    qHtml = '<p style="color:#4e5d56;font-size:12px">This attempt predates answer capture, so the per-question breakdown is unavailable.</p>'
  } else if (!questions.length) {
    qHtml = '<p style="color:#4e5d56;font-size:12px">The test has no questions on file.</p>'
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    qHtml = questions
      .map((q: any, i: number) => {
        const sel = answers[i]
        const opts = (q.options as string[])
          .map((opt, oi) => {
            const isC = oi === q.correct_index
            const isS = sel === oi
            let tag = ''
            if (isC && isS) tag = ' — correct answer, their choice'
            else if (isC) tag = ' — correct answer'
            else if (isS) tag = ' — their choice'
            const color = isC ? '#1f5030' : isS ? '#99271f' : '#182b25'
            const weight = isC || isS ? '600' : '400'
            return `<div dir="auto" style="margin:3px 0;color:${color};font-weight:${weight};font-size:13px">${String.fromCharCode(65 + oi)}.&nbsp; ${esc(opt)}${esc(tag)}</div>`
          })
          .join('')
        const none = sel === null || sel === undefined ? '<div style="color:#4e5d56;font-size:11px">(no answer selected)</div>' : ''
        return `<div style="margin-bottom:14px"><div dir="auto" style="font-weight:700;font-size:13.5px;margin-bottom:4px">Q${i + 1}. ${esc(q.text)}</div><div style="padding-left:12px">${opts}${none}</div></div>`
      })
      .join('')
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hist = (attempts as any[])
    .map(
      (a) =>
        `<div style="display:flex;font-size:12px;margin-bottom:4px"><div style="width:180px">${esc(fmtDT(a.attempted_at))}</div><div style="width:70px">${a.score}/${a.total}</div><div style="width:50px">${a.percentage}%</div><div style="font-weight:600;color:${a.passed ? '#1f5030' : '#99271f'}">${a.passed ? 'PASS' : 'FAIL'}</div></div>`,
    )
    .join('')

  const H = (t: string) =>
    `<div style="color:#a07e2c;font-weight:700;font-size:13px;margin:18px 0 10px;border-top:1px solid #e2e6dc;padding-top:14px">${t}</div>`

  const el = document.createElement('div')
  el.setAttribute('dir', 'ltr')
  el.style.cssText =
    'position:fixed;left:-10000px;top:0;width:794px;box-sizing:border-box;padding:48px;background:#fff;color:#182b25;font-family:"Segoe UI","Noto Naskh Arabic","Nirmala UI",Tahoma,Arial,sans-serif;font-size:13px;line-height:1.5'
  el.innerHTML = `
    <div style="font-size:24px;font-weight:800">Training Test Report</div>
    <div style="color:#4e5d56;font-size:12px;margin-top:4px">Hamsun Hospitality — SOP &amp; Training Portal</div>
    ${H('Staff member')}
    ${rows([['Name', staff.name], ['Job title', staff.job_title || 'Staff'], ['Department', dept ? `${dept.name} (${dept.code})` : '—'], ['Branch', branch ? `${branch.name} (${branch.code})` : '—']])}
    ${H('Test')}
    ${rows([['Title', test.title], ['Related SOP', relSop ? `${relSop.code} — ${relSop.title}` : 'None'], ['Pass mark', `${test.pass_mark}%`], ['Certificate validity', `${test.validity_months} months`]])}
    ${H('Result (latest attempt)')}
    ${rows([['Attempt date', fmtDT(latest.attempted_at)], ['Score', `${latest.score} / ${latest.total}  (${latest.percentage}%)`], ['Outcome', latest.passed ? 'PASS' : 'FAIL'], ['Language taken', LANG[latest.language] || latest.language], ...(cert ? [['Certification', `Issued ${fmtD(cert.issued_at)} · valid until ${fmtD(cert.expires_at)}`] as [string, string]] : [])])}
    ${H('Questions &amp; answers — latest attempt')}
    ${qHtml}
    ${H('Attempt history')}
    <div style="display:flex;font-size:11px;color:#4e5d56;margin-bottom:5px"><div style="width:180px">Date</div><div style="width:70px">Score</div><div style="width:50px">%</div><div>Result</div></div>
    ${hist}
    <div style="margin-top:22px;border-top:1px solid #e2e6dc;padding-top:12px;color:#4e5d56;font-size:10.5px">Generated ${fmtDT(new Date().toISOString())}. Scoring is by answer position and is identical in every language the test is offered in.</div>
  `
  return el
}

/**
 * On-demand translation of one quiz question + options into Urdu/Pashto, for a
 * staff member taking a test. Option order is preserved so scoring is unchanged.
 * In demo mode there's no translator, so it just tags the text (an honest
 * placeholder), matching the demo translate behaviour elsewhere.
 */
export async function translateQuestion(
  token: string,
  q: string,
  opts: string[],
  language: Language,
): Promise<{ q: string; opts: string[] }> {
  if (!isSupabaseEnabled) {
    const tag = language === 'ur' ? '[اردو]' : language === 'ps' ? '[پښتو]' : ''
    return { q: `${tag} ${q}`.trim(), opts: opts.map((o) => `${tag} ${o}`.trim()) }
  }
  const j = await callStaffFn('translate-question', { token, q, opts, language })
  return { q: j.q as string, opts: j.opts as string[] }
}

/** Remove the training video from an SOP (deletes the Drive file in Supabase mode). */
export async function removeSopVideo(sopId: string): Promise<void> {
  const sop = read.sop(sopId)
  if (!sop) throw new ApiError('That SOP no longer exists.')

  if (!isSupabaseEnabled) {
    sop.video_file_id = null
    commit()
    return
  }
  if (!supabase) throw new ApiError('Not connected to the database.')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new ApiError('Please sign in again.')

  const fd = new FormData()
  fd.set('sop_id', sopId)
  fd.set('remove', 'true')

  let res: Response
  try {
    res = await fetch(`${functionsBase}/attach-video`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: fd,
    })
  } catch {
    throw new ApiError('Could not reach the attach-video function.')
  }
  if (res.status === 404) throw new ApiError('Deploy the attach-video function first (see supabase/SETUP.md).')
  if (!res.ok) {
    const j = await res.json().catch(() => ({}))
    throw new ApiError((j as { error?: string }).error ?? 'Could not remove the video.')
  }
  await hydrateFromSupabase()
}

/**
 * Drive folder picker for the Add-SOP form. In Supabase mode these call the
 * drive-folders Edge Function (live Drive folders + create). If it isn't
 * deployed yet, listing falls back to the known department folders and creating
 * explains what to do. In demo mode there is no Drive, so folders are local.
 */
export async function listDriveFolders(): Promise<Array<{ id: string; name: string }>> {
  if (!isSupabaseEnabled || !supabase) return DRIVE_DEPARTMENT_FOLDERS
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return DRIVE_DEPARTMENT_FOLDERS
  try {
    const res = await fetch(`${functionsBase}/drive-folders`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    if (!res.ok) return DRIVE_DEPARTMENT_FOLDERS // not deployed / error → safe fallback
    const j = await res.json()
    return Array.isArray(j.folders) && j.folders.length ? j.folders : DRIVE_DEPARTMENT_FOLDERS
  } catch {
    return DRIVE_DEPARTMENT_FOLDERS
  }
}

export async function createDriveFolder(name: string): Promise<{ id: string; name: string }> {
  const clean = name.trim()
  if (!clean) throw new ApiError('Give the folder a name.')
  if (!isSupabaseEnabled || !supabase) return { id: `demo-${clean}`, name: clean }
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new ApiError('Please sign in again.')
  const res = await fetch(`${functionsBase}/drive-folders`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: clean }),
  }).catch(() => null)
  if (res && res.status === 404) throw new ApiError('Deploy the drive-folders function first (see supabase/SETUP.md).')
  if (!res || !res.ok) {
    const j = res ? await res.json().catch(() => ({})) : {}
    throw new ApiError((j as { error?: string }).error ?? 'Could not create the folder.')
  }
  const j = await res.json()
  return j.folder as { id: string; name: string }
}

/**
 * The staff sign-in name list for one branch. The staff table has no anon read
 * access, so in Supabase mode this goes through the staff-directory Edge Function
 * (service_role, returns only id/name/department — never a code). In demo mode it
 * reads the seeded staff straight from the cache.
 */
export async function staffDirectory(
  branchCode: string,
): Promise<Array<{ id: string; name: string; department_id: string }>> {
  if (!isSupabaseEnabled) {
    const branch = read.branchByCode(branchCode)
    if (!branch) return []
    return read
      .staff()
      .filter((s) => s.branch_id === branch.id && s.active)
      .map((s) => ({ id: s.id, name: s.name, department_id: s.department_id }))
  }
  try {
    const res = await fetch(`${functionsBase}/staff-directory`, {
      method: 'POST',
      headers: staffFnHeaders(),
      body: JSON.stringify({ branch_code: branchCode }),
    })
    if (!res.ok) return []
    const j = await res.json().catch(() => ({ staff: [] }))
    return Array.isArray(j.staff) ? j.staff : []
  } catch {
    return []
  }
}

/** On boot, resume a still-valid manager/admin session and hydrate the cache. */
async function resumeSupabaseSession(): Promise<void> {
  try {
    const { data } = await supabase!.auth.getSession()
    if (!data.session) return
    const actor = await resolveSupabaseActor()
    if (!actor) return
    await hydrateFromSupabase()
    resumedActor = actor
  } catch {
    // A failed resume just lands the user back on the sign-in screen.
    resumedActor = null
  }
}

/* --------------------------------------------------- staff supabase mode ---- */

/**
 * Staff sign-in in Supabase mode.
 *
 * Staff have no Supabase Auth account, so they can't hold a real JWT and can't
 * be served by RLS directly. Instead the staff-login Edge Function mints an
 * OPAQUE session token (stored server-side as a hash), and every staff read or
 * write goes through an Edge Function carrying that token. staff-data returns
 * exactly what this member is allowed to see — computed server-side with the
 * same derived-eligibility rule the RLS policies use — which we drop into the
 * same in-memory `db` the screens already read from. So the staff screens are
 * unchanged; only the source of their data moved.
 */

/** localStorage key for the staff session token (shared with App). */
export const STAFF_TOKEN_KEY = 'hamsun-sop-portal/staff-token'

/** The staff member resumed from a persisted token on boot, if any. */
let resumedStaff: { staff: Staff; token: string } | null = null
export function getResumedStaff(): { staff: Staff; token: string } | null {
  return resumedStaff
}

/** Headers for staff-facing functions: anon key at the gateway, token in body. */
function staffFnHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    apikey: anonPublicKey,
    Authorization: `Bearer ${anonPublicKey}`,
  }
}

/** POST to a staff-facing Edge Function; returns parsed JSON or throws ApiError. */
async function callStaffFn(name: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  let res: Response | null = null
  try {
    res = await fetch(`${functionsBase}/${name}`, { method: 'POST', headers: staffFnHeaders(), body: JSON.stringify(body) })
  } catch {
    // A missing function 404s without CORS headers, so the browser blocks it and
    // fetch throws here — the usual cause is that it hasn't been deployed yet.
    throw new ApiError(`Couldn’t reach the ${name} function — deploy it (see supabase/SETUP.md), or check your connection.`)
  }
  if (res.status === 404) throw new ApiError(`This feature isn’t deployed yet — deploy the ${name} function (see supabase/SETUP.md).`)
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new ApiError((j.error as string) ?? 'Something went wrong. Try again.')
  return j
}

/** Fetch the whole staff payload (optionally marking notifications read first). */
async function fetchStaffData(token: string, markRead = false): Promise<Record<string, unknown> | null> {
  let res: Response | null = null
  try {
    res = await fetch(`${functionsBase}/staff-data`, {
      method: 'POST',
      headers: staffFnHeaders(),
      body: JSON.stringify({ token, mark_read: markRead }),
    })
  } catch {
    return null
  }
  if (!res.ok) return null
  return (await res.json().catch(() => null)) as Record<string, unknown> | null
}

/** Drop a staff-data payload into the in-memory cache and notify listeners. */
function applyStaffData(payload: Record<string, unknown>): Staff | null {
  const staffRow = payload.staff as Record<string, unknown> | null
  db = {
    ...emptyDb(),
    branches: (payload.branches as Branch[]) ?? [],
    departments: (payload.departments as Department[]) ?? [],
    staff: staffRow ? [mapStaffRow(staffRow)] : [],
    sops: (payload.sops as Sop[]) ?? [],
    acknowledgments: (payload.acknowledgments as Acknowledgment[]) ?? [],
    tests: (payload.tests as Test[]) ?? [],
    questions: (payload.questions as Question[]) ?? [],
    assignments: (payload.assignments as TestAssignment[]) ?? [],
    attempts: (payload.attempts as Attempt[]) ?? [],
    certifications: (payload.certifications as Certification[]) ?? [],
    grants: (payload.grants as RetestGrant[]) ?? [],
    notifications: (payload.notifications as Notification[]) ?? [],
  }
  snapshotVersion++
  listeners.forEach((fn) => fn())
  return db.staff[0] ?? null
}

/** Validate a token by loading its portal; returns the staff row or null. */
async function activateStaffSession(token: string): Promise<Staff | null> {
  const payload = await fetchStaffData(token)
  if (!payload || payload.error) return null
  return applyStaffData(payload)
}

/** On boot, resume a still-valid staff token and hydrate the cache. */
async function resumeSupabaseStaffSession(): Promise<void> {
  if (resumedActor) return // a manager/admin owns this tab
  try {
    const token = localStorage.getItem(STAFF_TOKEN_KEY)
    if (!token) return
    const staff = await activateStaffSession(token)
    if (staff) resumedStaff = { staff, token }
    else localStorage.removeItem(STAFF_TOKEN_KEY)
  } catch {
    resumedStaff = null
  }
}

/** Headers for admin/manager functions: the caller's Auth JWT at the gateway. */
async function adminFnHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase!.auth.getSession()
  if (!session) throw new ApiError('Please sign in again.')
  return {
    'Content-Type': 'application/json',
    apikey: anonPublicKey,
    Authorization: `Bearer ${session.access_token}`,
  }
}

/** POST to an admin/manager Edge Function; returns parsed JSON or throws. */
async function callAdminFn(name: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const headers = await adminFnHeaders()
  let res: Response | null = null
  try {
    res = await fetch(`${functionsBase}/${name}`, { method: 'POST', headers, body: JSON.stringify(body) })
  } catch {
    // A missing function 404s without CORS headers, so the browser blocks it and
    // fetch throws here — the usual cause is that it hasn't been deployed yet.
    throw new ApiError(`Couldn’t reach the ${name} function — deploy it (see supabase/SETUP.md), or check your connection.`)
  }
  if (res.status === 404) throw new ApiError(`Deploy the ${name} function first (see supabase/SETUP.md).`)
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new ApiError((j.error as string) ?? 'Something went wrong. Try again.')
  return j
}

async function seed(): Promise<void> {
  const created_at = nowIso()
  const staff: Staff[] = []
  for (const s of DEMO_STAFF) {
    const { code, ...rest } = s
    staff.push({ ...rest, employee_code_hash: await hashEmployeeCode(code), employee_code: code, created_at })
  }
  db = {
    ...emptyDb(),
    branches: [...BRANCHES],
    departments: [...DEPARTMENTS],
    staff,
    managers: [...MANAGERS],
    admins: [...ADMINS],
    sops: [...SOPS],
    tests: [...TESTS],
    questions: [...QUESTIONS],
  }
  seedHistory()
  commit()
}

/**
 * A little history so the boards are not empty on first look: some sign-offs,
 * one lapsed certificate, and one failure sitting in the retest queue.
 */
function seedHistory(): void {
  const ack = (staff_id: string, sop_id: string, daysAgo: number) => {
    const sop = db.sops.find((s) => s.id === sop_id)
    if (!sop) return
    db.acknowledgments.push({
      id: id('ack'),
      staff_id,
      sop_id,
      version: sop.version,
      signed_at: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
    })
  }
  ack('st-01', 'sop-fd-001', 12)
  ack('st-01', 'sop-fd-002', 12)
  ack('st-02', 'sop-fd-001', 9)
  ack('st-03', 'sop-hk-001', 5)
  ack('st-04', 'sop-kt-001', 3)
  ack('st-10', 'sop-hk-001', 20)
  ack('st-10', 'sop-hk-002', 20)
  ack('st-11', 'sop-hk-001', 2)

  const assign = (test_id: string, staff_id: string) => {
    db.assignments.push({
      id: id('asg'),
      test_id,
      staff_id,
      assigned_by: 'Hamsun Group Admin',
      assigned_at: new Date(Date.now() - 30 * 86_400_000).toISOString(),
    })
  }
  assign('ts-kt-food', 'st-04')
  assign('ts-kt-food', 'st-08')
  assign('ts-kt-food', 'st-13')
  assign('ts-hk-room', 'st-03')
  assign('ts-hk-room', 'st-10')
  assign('ts-hk-room', 'st-11')
  assign('ts-hk-room', 'st-12')
  assign('ts-fd-complaint', 'st-01')
  assign('ts-fd-complaint', 'st-06')

  // Waqas passed food safety eleven months ago — certificate is inside the
  // thirty-day window, so his page should be showing the expiry alert.
  const passedAt = new Date(Date.now() - 335 * 86_400_000).toISOString()
  const attemptId = id('att')
  db.attempts.push({
    id: attemptId,
    staff_id: 'st-13',
    test_id: 'ts-kt-food',
    score: 4,
    total: 4,
    percentage: 100,
    passed: true,
    language: 'en',
    attempted_at: passedAt,
  })
  db.certifications.push({
    id: id('cert'),
    staff_id: 'st-13',
    test_id: 'ts-kt-food',
    issued_at: passedAt,
    expires_at: addMonths(new Date(passedAt), 12).toISOString(),
    source_attempt_id: attemptId,
  })

  // Salma failed the room standard assessment, so she is locked and appears in
  // the manager's retest-approval row until someone approves an attempt.
  db.attempts.push({
    id: id('att'),
    staff_id: 'st-10',
    test_id: 'ts-hk-room',
    score: 1,
    total: 3,
    percentage: 33,
    passed: false,
    language: 'ur',
    attempted_at: new Date(Date.now() - 6 * 86_400_000).toISOString(),
  })

  // Kiran holds a healthy certificate.
  const kiranAt = new Date(Date.now() - 40 * 86_400_000).toISOString()
  const kiranAttempt = id('att')
  db.attempts.push({
    id: kiranAttempt,
    staff_id: 'st-11',
    test_id: 'ts-hk-room',
    score: 3,
    total: 3,
    percentage: 100,
    passed: true,
    language: 'en',
    attempted_at: kiranAt,
  })
  db.certifications.push({
    id: id('cert'),
    staff_id: 'st-11',
    test_id: 'ts-hk-room',
    issued_at: kiranAt,
    expires_at: addMonths(new Date(kiranAt), 6).toISOString(),
    source_attempt_id: kiranAttempt,
  })
}

/* --------------------------------------------------------------- reading ---- */

/** Read-only view of the tables. Screens read through this; they never mutate. */
export const read = {
  branches: () => db.branches,
  departments: () => db.departments,
  staff: () => db.staff,
  managers: () => db.managers,
  admins: () => db.admins,
  sops: () => db.sops,
  acknowledgments: () => db.acknowledgments,
  tests: () => db.tests,
  questions: () => db.questions,
  assignments: () => db.assignments,
  attempts: () => db.attempts,
  certifications: () => db.certifications,
  grants: () => db.grants,
  notifications: () => db.notifications,

  branch: (id: string) => db.branches.find((b) => b.id === id) ?? null,
  branchByCode: (code: string) => db.branches.find((b) => b.code === code) ?? null,
  department: (id: string) => db.departments.find((d) => d.id === id) ?? null,
  staffMember: (id: string) => db.staff.find((s) => s.id === id) ?? null,
  sop: (id: string) => db.sops.find((s) => s.id === id) ?? null,
  test: (id: string) => db.tests.find((t) => t.id === id) ?? null,
  questionsFor: (testId: string) =>
    db.questions.filter((q) => q.test_id === testId).sort((a, b) => a.position - b.position),
}

/** Has this person signed the *current* version of this SOP? */
export function hasSigned(staffId: string, sop: Sop): boolean {
  return db.acknowledgments.some(
    (a) => a.staff_id === staffId && a.sop_id === sop.id && a.version === sop.version,
  )
}

export function acknowledgmentFor(staffId: string, sop: Sop): Acknowledgment | null {
  return (
    db.acknowledgments.find(
      (a) => a.staff_id === staffId && a.sop_id === sop.id && a.version === sop.version,
    ) ?? null
  )
}

export function attemptsFor(staffId: string, testId: string): Attempt[] {
  return db.attempts
    .filter((a) => a.staff_id === staffId && a.test_id === testId)
    .sort((a, b) => b.attempted_at.localeCompare(a.attempted_at))
}

export function latestCertification(staffId: string, testId: string): Certification | null {
  return (
    db.certifications
      .filter((c) => c.staff_id === staffId && c.test_id === testId)
      .sort((a, b) => b.issued_at.localeCompare(a.issued_at))[0] ?? null
  )
}

export function openGrant(staffId: string, testId: string): RetestGrant | null {
  return db.grants.find((g) => g.staff_id === staffId && g.test_id === testId && !g.used) ?? null
}

/** Tests this person can actually see: eligible by scope AND assigned by name. */
export function assignedTestsFor(staff: Staff): Test[] {
  const branch = read.branch(staff.branch_id)
  if (!branch) return []
  const assignedIds = new Set(
    db.assignments.filter((a) => a.staff_id === staff.id).map((a) => a.test_id),
  )
  return db.tests.filter(
    (t) =>
      t.status === 'published' &&
      assignedIds.has(t.id) &&
      appliesToStaff(t, staff, branch.code),
  )
}

export function unreadCount(staffId: string): number {
  return db.notifications.filter((n) => n.staff_id === staffId && !n.read).length
}

export function notificationsFor(staffId: string): Notification[] {
  return db.notifications
    .filter((n) => n.staff_id === staffId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

/* ------------------------------------------------------- the retest gate ---- */

export type AttemptPermission =
  | { allowed: true; reason: 'first_attempt' | 'renewal' | 'granted'; grant?: RetestGrant }
  | { allowed: false; reason: 'locked_after_failure' | 'not_assigned' }

/**
 * The gate, stated once, in one place.
 *
 * One free first attempt. A free renewal attempt once a pass is already held.
 * After a failure the test locks and only a manager or admin can open exactly
 * one attempt, consumed when it is taken — so failing again means asking again.
 *
 * This is called by the UI to render state, and independently re-checked inside
 * submitAttempt, which is the check that actually matters.
 */
export function attemptPermission(staffId: string, testId: string): AttemptPermission {
  const assigned = db.assignments.some((a) => a.staff_id === staffId && a.test_id === testId)
  if (!assigned) return { allowed: false, reason: 'not_assigned' }

  const history = attemptsFor(staffId, testId)
  if (history.length === 0) return { allowed: true, reason: 'first_attempt' }

  const last = history[0]
  if (last.passed) return { allowed: true, reason: 'renewal' }

  const grant = openGrant(staffId, testId)
  if (grant) return { allowed: true, reason: 'granted', grant }

  return { allowed: false, reason: 'locked_after_failure' }
}

/* -------------------------------------------------------------- sessions ---- */

function validateStaffToken(token: string): Staff {
  const session = db.sessions.find((s) => s.token === token)
  if (!session) throw new ApiError('Your session has ended. Please sign in again.')
  if (new Date(session.expires_at).getTime() < Date.now()) {
    db.sessions = db.sessions.filter((s) => s.token !== token)
    throw new ApiError('Your shift session has expired. Please sign in again.')
  }
  const staff = db.staff.find((s) => s.id === session.staff_id)
  if (!staff || !staff.active) throw new ApiError('This staff record is no longer active.')
  return staff
}

export class ApiError extends Error {}

/* --------------------------------------------------------- notifications ---- */

function notify(staff_id: string, kind: NotificationKind, text: string): void {
  db.notifications.push({
    id: id('ntf'),
    staff_id,
    kind,
    text,
    read: false,
    created_at: nowIso(),
    // Flagged for the WhatsApp mirror that Hamsun already runs elsewhere. No
    // consumer yet — the flag is what makes that a worker, not a migration.
    whatsapp_pending: true,
  })
}

/* -------------------------------------------------- manager authorisation ---- */

export type Actor =
  | { kind: 'manager'; manager: Manager }
  | { kind: 'admin'; admin: Admin }

export function actorName(actor: Actor): string {
  return actor.kind === 'admin' ? actor.admin.name : actor.manager.name
}

/**
 * A manager is confined to her own department at her own branch. This is the
 * stand-in for the row-level security policy that will enforce it in Postgres,
 * where her queries will be physically unable to return another patch's rows.
 */
/**
 * In Supabase mode the manager/admin boards read live data, but the write paths
 * are not wired up until the Edge Functions ship (they need server-side hashing,
 * auth-user creation, and notification writes that RLS reserves for the
 * service_role). Until then, editing actions surface this rather than silently
 * changing only the local cache. Every consequential write funnels through one
 * of the four authorisation helpers below, so guarding them here covers them
 * all in one place.
 */
const SUPA_WRITE_MSG =
  'You’re viewing live data from your database. Saving changes switches on in the next update, once the Edge Functions are deployed.'

function assertLocalWrite(): void {
  if (isSupabaseEnabled) throw new ApiError(SUPA_WRITE_MSG)
}

function assertCanTouchStaff(actor: Actor, staff: Staff): void {
  assertLocalWrite()
  if (actor.kind === 'admin') return
  if (staff.department_id !== actor.manager.department_id || staff.branch_id !== actor.manager.branch_id) {
    throw new ApiError('You can only act on staff in your own department at your own branch.')
  }
}

function assertCanTouchScope(actor: Actor, departmentId: string, scope: BranchScope): void {
  assertLocalWrite()
  if (actor.kind === 'admin') return
  const branch = read.branch(actor.manager.branch_id)
  if (!branch) throw new ApiError('Your branch record is missing.')
  if (departmentId !== actor.manager.department_id) {
    throw new ApiError('You can only publish for your own department.')
  }
  // Only an admin publishes group-wide. A manager is confined to her own branch.
  if (scope.kind === 'ALL') {
    throw new ApiError('Only an admin can publish to all branches.')
  }
  if (scope.branch_codes.length !== 1 || scope.branch_codes[0] !== branch.code) {
    throw new ApiError('You can only publish to your own branch.')
  }
}

/**
 * Authorises *reading* a department's content — distinct from publishing to a
 * scope. A manager may generate a test from any SOP in her own department even
 * when that SOP is scoped to all branches, because reading a group-wide
 * Housekeeping SOP is not the same act as publishing a group-wide record. Only
 * the department has to match here; the SOP's branch scope is irrelevant.
 */
function assertCanReadDepartment(actor: Actor, departmentId: string): void {
  assertLocalWrite()
  if (actor.kind === 'admin') return
  if (departmentId !== actor.manager.department_id) {
    throw new ApiError('You can only work with your own department’s content.')
  }
}

/* ------------------------------------------------------------------- api ---- */

export const api = {
  /* ---- staff-login Edge Function ---- */

  /**
   * Verifies the employee code against the stored hash and counts failures
   * server-side. Three wrong codes locks the record for fifteen minutes —
   * counted here, in the same place that issues the token, because a counter the
   * browser keeps is a counter an attacker deletes.
   */
  async staffLogin(staffId: string, code: string): Promise<StaffSession> {
    if (isSupabaseEnabled) {
      // Verified server-side by the staff-login Edge Function (bcrypt + lockout).
      // It returns an opaque session token; we then load the staff portal with it.
      const j = await callStaffFn('staff-login', { staff_id: staffId, code })
      const token = j.token as string
      const staffRow = j.staff as Record<string, unknown>
      applyStaffData({ staff: staffRow, branches: db.branches, departments: db.departments })
      await activateStaffSession(token)
      resumedStaff = { staff: mapStaffRow(staffRow), token }
      return { staff_id: staffRow.id as string, token, expires_at: j.expires_at as string }
    }
    const staff = db.staff.find((s) => s.id === staffId)
    if (!staff || !staff.active) {
      throw new ApiError('That staff record is not active. Speak to your manager.')
    }

    const lock = db.lockouts[staffId]
    if (lock?.locked_until && new Date(lock.locked_until).getTime() > Date.now()) {
      const mins = Math.ceil((new Date(lock.locked_until).getTime() - Date.now()) / 60_000)
      throw new ApiError(`Too many wrong codes. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`)
    }

    const ok = await verifyEmployeeCode(code, staff.employee_code_hash)
    if (!ok) {
      const failures = (lock?.failures ?? 0) + 1
      const locked_until =
        failures >= LOCKOUT_THRESHOLD
          ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString()
          : null
      db.lockouts[staffId] = { failures, locked_until }
      commit()
      if (locked_until) {
        throw new ApiError(`Too many wrong codes. This record is locked for ${LOCKOUT_MINUTES} minutes.`)
      }
      const left = LOCKOUT_THRESHOLD - failures
      throw new ApiError(`Wrong code. ${left} attempt${left === 1 ? '' : 's'} left before this record locks.`)
    }

    delete db.lockouts[staffId]
    const session: StaffSession = {
      staff_id: staff.id,
      token: id('tok'),
      expires_at: new Date(Date.now() + SESSION_HOURS * 3_600_000).toISOString(),
    }
    db.sessions.push(session)
    commit()
    return session
  },

  staffLogout(token: string): void {
    if (isSupabaseEnabled) {
      // Clear the local session and reset the cache to the public shell so no
      // staff data lingers. The opaque token simply expires server-side.
      resumedStaff = null
      db = { ...emptyDb(), branches: db.branches, departments: db.departments }
      snapshotVersion++
      listeners.forEach((fn) => fn())
      return
    }
    db.sessions = db.sessions.filter((s) => s.token !== token)
    commit()
  },

  /** Restores a session on page reload without a second code entry. */
  resumeStaffSession(token: string): Staff | null {
    if (isSupabaseEnabled) {
      // In Supabase mode the resume happens during initStore (async); the App
      // reads getResumedStaff() instead of calling this.
      return resumedStaff?.token === token ? resumedStaff.staff : null
    }
    try {
      return validateStaffToken(token)
    } catch {
      return null
    }
  },

  /* ---- manager / admin sign-in ---- */

  async managerLogin(email: string, password: string): Promise<Actor> {
    const normalised = email.trim().toLowerCase()

    if (isSupabaseEnabled) {
      // Real Supabase Auth. On success we resolve the user to an admin or
      // manager row and hydrate the cache with exactly what RLS lets them see.
      const client = supabase!
      const { error } = await client.auth.signInWithPassword({ email: normalised, password })
      if (error) throw new ApiError('Email or password is incorrect.')

      const actor = await resolveSupabaseActor()
      if (!actor) {
        await client.auth.signOut()
        throw new ApiError(
          'That login is valid but is not registered as an admin or department manager. Ask an admin to add you.',
        )
      }
      await hydrateFromSupabase()
      resumedActor = actor
      return actor
    }

    if (DEMO_PASSWORDS[normalised] !== password) {
      throw new ApiError('Email or password is incorrect.')
    }
    const admin = db.admins.find((a) => a.email === normalised)
    if (admin) return { kind: 'admin', admin }
    const manager = db.managers.find((m) => m.email === normalised && m.active)
    if (manager) return { kind: 'manager', manager }
    throw new ApiError('Email or password is incorrect.')
  },

  async managerLogout(): Promise<void> {
    resumedActor = null
    if (isSupabaseEnabled && supabase) await supabase.auth.signOut()
  },

  /* ---- sign-sop Edge Function ---- */

  async signSop(token: string, sopId: string): Promise<Acknowledgment> {
    if (isSupabaseEnabled) {
      const j = await callStaffFn('sign-sop', { token, sop_id: sopId })
      await activateStaffSession(token) // re-hydrate so the stamp shows
      return j.acknowledgment as Acknowledgment
    }

    const staff = validateStaffToken(token)
    const sop = read.sop(sopId)
    if (!sop) throw new ApiError('That SOP no longer exists.')

    const branch = read.branch(staff.branch_id)
    if (!branch || !appliesToStaff(sop, staff, branch.code)) {
      throw new ApiError('This SOP does not apply to your department or branch.')
    }

    const existing = acknowledgmentFor(staff.id, sop)
    if (existing) return existing

    const ack: Acknowledgment = {
      id: id('ack'),
      staff_id: staff.id,
      sop_id: sop.id,
      version: sop.version,
      signed_at: nowIso(),
    }
    db.acknowledgments.push(ack)
    commit()
    return ack
  },

  /* ---- submit-attempt Edge Function ---- */

  /**
   * Records a score, enforces the retest gate, issues a certification on a pass
   * and writes the notification. The gate is re-checked here rather than trusted
   * from the UI — a locked test that only *looks* locked is decorative.
   */
  async submitAttempt(
    token: string,
    testId: string,
    answers: Array<number | null>,
    language: Language,
  ): Promise<{ attempt: Attempt; certification: Certification | null }> {
    if (isSupabaseEnabled) {
      const j = await callStaffFn('submit-attempt', { token, test_id: testId, answers, language })
      await activateStaffSession(token) // re-hydrate scores + certificate
      return { attempt: j.attempt as Attempt, certification: (j.certification as Certification | null) ?? null }
    }

    const staff = validateStaffToken(token)
    const test = read.test(testId)
    if (!test) throw new ApiError('That test no longer exists.')

    const permission = attemptPermission(staff.id, testId)
    if (!permission.allowed) {
      throw new ApiError(
        permission.reason === 'not_assigned'
          ? 'This test has not been assigned to you.'
          : 'This test is locked after your last attempt. Your manager must approve a retest.',
      )
    }

    const questions = read.questionsFor(testId)
    // Scoring is by option position, so the result is identical in every
    // language the test is offered in.
    let score = 0
    questions.forEach((q, i) => {
      if (answers[i] === q.correct_index) score++
    })
    const total = questions.length
    const percentage = total === 0 ? 0 : Math.round((score / total) * 100)
    const passed = percentage >= test.pass_mark

    const attempt: Attempt = {
      id: id('att'),
      staff_id: staff.id,
      test_id: testId,
      score,
      total,
      percentage,
      passed,
      language,
      attempted_at: nowIso(),
    }
    db.attempts.push(attempt)

    // A granted retest is consumed by the attempt whether it is passed or
    // failed. Failing again means asking again.
    if (permission.reason === 'granted' && permission.grant) {
      permission.grant.used = true
    }

    let certification: Certification | null = null
    if (passed) {
      const issued = new Date()
      certification = {
        id: id('cert'),
        staff_id: staff.id,
        test_id: testId,
        issued_at: issued.toISOString(),
        expires_at: addMonths(issued, test.validity_months).toISOString(),
        source_attempt_id: attempt.id,
      }
      db.certifications.push(certification)
    }

    notify(
      staff.id,
      'score_recorded',
      passed
        ? `You passed ${test.title} with ${percentage}%. Your certificate is valid for ${test.validity_months} months.`
        : `You scored ${percentage}% on ${test.title}, below the ${test.pass_mark}% pass mark. Your manager must approve a retest.`,
    )

    commit()
    return { attempt, certification }
  },

  /* ---- grant-retest Edge Function ---- */

  async grantRetest(actor: Actor, testId: string, staffId: string): Promise<RetestGrant> {
    if (isSupabaseEnabled) {
      const existing = openGrant(staffId, testId)
      if (existing) return existing
      // RLS reserves retest_grants inserts for this function so the grant and the
      // staff notification are written together as the service_role.
      const j = await callAdminFn('grant-retest', { test_id: testId, staff_id: staffId })
      await hydrateFromSupabase()
      return j.grant as RetestGrant
    }

    const staff = db.staff.find((s) => s.id === staffId)
    if (!staff) throw new ApiError('That staff record no longer exists.')
    assertCanTouchStaff(actor, staff)

    const test = read.test(testId)
    if (!test) throw new ApiError('That test no longer exists.')

    const already = openGrant(staffId, testId)
    if (already) return already

    const grant: RetestGrant = {
      id: id('grn'),
      test_id: testId,
      staff_id: staffId,
      granted_by: actor.kind === 'admin' ? actor.admin.id : actor.manager.id,
      granted_by_name: actorName(actor),
      granted_at: nowIso(),
      used: false,
    }
    db.grants.push(grant)
    notify(
      staffId,
      'retest_approved',
      `${actorName(actor)} approved one retest of ${test.title}. Review the SOP before you start — this unlocks a single attempt.`,
    )
    commit()
    return grant
  },

  /* ---- assignment ---- */

  async assignTest(actor: Actor, testId: string, staffId: string): Promise<void> {
    if (isSupabaseEnabled) {
      const { error } = await supabase!
        .from('test_assignments')
        .insert({ test_id: testId, staff_id: staffId, assigned_by: actorName(actor) })
      // 23505 = already assigned; treat as success.
      if (error && error.code !== '23505') throw new ApiError(error.message)
      await hydrateFromSupabase()
      return
    }

    const staff = db.staff.find((s) => s.id === staffId)
    if (!staff) throw new ApiError('That staff record no longer exists.')
    assertCanTouchStaff(actor, staff)

    const test = read.test(testId)
    if (!test) throw new ApiError('That test no longer exists.')

    const branch = read.branch(staff.branch_id)
    if (!branch || !appliesToStaff(test, staff, branch.code)) {
      throw new ApiError('That test does not apply to this person’s department or branch.')
    }

    if (db.assignments.some((a) => a.test_id === testId && a.staff_id === staffId)) return

    db.assignments.push({
      id: id('asg'),
      test_id: testId,
      staff_id: staffId,
      assigned_by: actorName(actor),
      assigned_at: nowIso(),
    })
    notify(staffId, 'test_assigned', `${test.title} has been assigned to you by ${actorName(actor)}.`)
    commit()
  },

  async unassignTest(actor: Actor, testId: string, staffId: string): Promise<void> {
    if (isSupabaseEnabled) {
      const { error } = await supabase!.from('test_assignments').delete().eq('test_id', testId).eq('staff_id', staffId)
      if (error) throw new ApiError(error.message)
      await hydrateFromSupabase()
      return
    }
    const staff = db.staff.find((s) => s.id === staffId)
    if (!staff) throw new ApiError('That staff record no longer exists.')
    assertCanTouchStaff(actor, staff)
    db.assignments = db.assignments.filter((a) => !(a.test_id === testId && a.staff_id === staffId))
    commit()
  },

  /* ---- SOP publishing ---- */

  async publishSop(
    actor: Actor,
    input: {
      title: string
      summary: string
      department_id: string
      branch_scope: BranchScope
      code?: string
      document_file_id?: string | null
      video_file_id?: string | null
    },
  ): Promise<Sop> {
    assertCanTouchScope(actor, input.department_id, input.branch_scope)

    const dept = read.department(input.department_id)
    if (!dept) throw new ApiError('That department does not exist.')
    if (!input.title.trim()) throw new ApiError('An SOP needs a title.')

    const existingCodes = db.sops.map((s) => s.code)
    let code = input.code?.trim().toUpperCase() || nextDocCode(dept.code, existingCodes)
    if (!isValidDocCode(code)) {
      throw new ApiError('Document-control code must look like FD-001.')
    }
    if (isDocCodeTaken(code, existingCodes)) {
      throw new ApiError(`${code} is already in use. Codes must identify one procedure.`)
    }

    const sop: Sop = {
      id: id('sop'),
      code,
      title: input.title.trim(),
      summary: input.summary.trim(),
      department_id: input.department_id,
      branch_scope: input.branch_scope,
      version: 1,
      document_file_id: input.document_file_id ?? null,
      video_file_id: input.video_file_id ?? null,
      updated_at: nowIso(),
      published_by: actorName(actor),
    }
    db.sops.push(sop)

    for (const staff of eligibleStaffFor(sop)) {
      notify(staff.id, 'sop_published', `New SOP ${sop.code} — ${sop.title} — has been published for your department.`)
    }
    commit()
    return sop
  },

  /**
   * A version bump reopens the obligation: every eligible person's existing
   * acknowledgment was pinned to the old version, so they all owe a fresh one.
   * Nothing is deleted — the old signatures stay as the trail of what was agreed
   * when.
   */
  async reviseSop(
    actor: Actor,
    sopId: string,
    changes: { title?: string; summary?: string; document_file_id?: string | null; video_file_id?: string | null },
  ): Promise<Sop> {
    const current = read.sop(sopId)
    if (!current) throw new ApiError('That SOP no longer exists.')

    // Supabase mode: bump the version via PostgREST (RLS confines managers to
    // their own department + branch). The bump reopens the sign-off because
    // acknowledgments are pinned to the old version number.
    if (isSupabaseEnabled) {
      const patch: Record<string, unknown> = {
        version: current.version + 1,
        updated_at: nowIso(),
        published_by: actorName(actor),
      }
      if (changes.title !== undefined) patch.title = changes.title.trim()
      if (changes.summary !== undefined) patch.summary = changes.summary.trim()
      if (changes.document_file_id !== undefined) patch.document_file_id = changes.document_file_id
      if (changes.video_file_id !== undefined) patch.video_file_id = changes.video_file_id
      const { data, error } = await supabase!.from('sops').update(patch).eq('id', sopId).select('*').single()
      if (error) throw new ApiError(error.message)
      await hydrateFromSupabase()
      return data as Sop
    }

    const sop = current
    assertCanTouchScope(actor, sop.department_id, sop.branch_scope)

    if (changes.title !== undefined) sop.title = changes.title.trim()
    if (changes.summary !== undefined) sop.summary = changes.summary.trim()
    if (changes.document_file_id !== undefined) sop.document_file_id = changes.document_file_id
    if (changes.video_file_id !== undefined) sop.video_file_id = changes.video_file_id
    sop.version += 1
    sop.updated_at = nowIso()
    sop.published_by = actorName(actor)

    for (const staff of eligibleStaffFor(sop)) {
      notify(
        staff.id,
        'sop_published',
        `${sop.code} — ${sop.title} — has been updated to version ${sop.version}. Please read and sign it again.`,
      )
    }
    commit()
    return sop
  },

  /**
   * Delete an SOP and its acknowledgments. In Supabase mode this is a PostgREST
   * delete (RLS lets admins delete anything and confines managers to their own
   * department); the acknowledgments cascade via the foreign key. The Drive
   * files are left in the folder — clean those up in Drive if you want them gone.
   */
  async deleteSop(actor: Actor, sopId: string): Promise<void> {
    if (isSupabaseEnabled) {
      // Prefer the delete-sop Edge Function, which also removes the Drive files.
      // If it isn't deployed yet (404), fall back to a direct row delete so the
      // button still works (the Drive file just stays in the folder).
      const { data: { session } } = await supabase!.auth.getSession()
      if (session) {
        const res = await fetch(`${functionsBase}/delete-sop`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ sop_id: sopId }),
        }).catch(() => null)
        if (res && res.ok) {
          await hydrateFromSupabase()
          return
        }
        if (res && res.status !== 404) {
          const j = await res.json().catch(() => ({}))
          throw new ApiError((j as { error?: string }).error ?? 'Delete failed.')
        }
      }
      const { error } = await supabase!.from('sops').delete().eq('id', sopId)
      if (error) throw new ApiError(error.message)
      await hydrateFromSupabase()
      return
    }

    const sop = read.sop(sopId)
    if (!sop) throw new ApiError('That SOP no longer exists.')
    assertCanTouchScope(actor, sop.department_id, sop.branch_scope)
    db.sops = db.sops.filter((s) => s.id !== sopId)
    db.acknowledgments = db.acknowledgments.filter((a) => a.sop_id !== sopId)
    commit()
  },

  /* ---- notifications ---- */

  async markNotificationsRead(token: string): Promise<void> {
    if (isSupabaseEnabled) {
      const payload = await fetchStaffData(token, true)
      if (payload && !payload.error) applyStaffData(payload)
      return
    }

    const staff = validateStaffToken(token)
    let changed = false
    for (const n of db.notifications) {
      if (n.staff_id === staff.id && !n.read) {
        n.read = true
        changed = true
      }
    }
    if (changed) commit()
  },

  /* ---- admin: org management ---- */

  async addBranch(actor: Actor, code: string, name: string, status: Branch['status']): Promise<Branch> {
    const normalised = code.trim().toUpperCase()
    if (!/^[A-Z]{2,4}$/.test(normalised)) throw new ApiError('Branch code must be 2–4 letters, e.g. DHA.')
    if (!name.trim()) throw new ApiError('A branch needs a name.')
    if (db.branches.some((b) => b.code === normalised)) throw new ApiError(`Branch ${normalised} already exists.`)

    // Adding a branch is enough on its own: every ALL-scope SOP and test now
    // applies to it by derivation, with nothing copied.
    if (isSupabaseEnabled) {
      const { data, error } = await supabase!
        .from('branches')
        .insert({ code: normalised, name: name.trim(), status })
        .select('*')
        .single()
      if (error) throw new ApiError(error.message)
      await hydrateFromSupabase()
      return data as Branch
    }

    requireAdmin(actor)
    const branch: Branch = { id: id('br'), code: normalised, name: name.trim(), status }
    db.branches.push(branch)
    commit()
    return branch
  },

  /** Rename a branch or change its open / pre-opening status. The code is fixed. */
  async updateBranch(
    actor: Actor,
    branchId: string,
    changes: { name?: string; status?: Branch['status'] },
  ): Promise<void> {
    const patch: Record<string, unknown> = {}
    if (changes.name !== undefined) {
      if (!changes.name.trim()) throw new ApiError('A branch needs a name.')
      patch.name = changes.name.trim()
    }
    if (changes.status !== undefined) patch.status = changes.status
    if (Object.keys(patch).length === 0) return

    if (isSupabaseEnabled) {
      const { error } = await supabase!.from('branches').update(patch).eq('id', branchId)
      if (error) throw new ApiError(error.message)
      await hydrateFromSupabase()
      return
    }
    requireAdmin(actor)
    const branch = db.branches.find((b) => b.id === branchId)
    if (!branch) throw new ApiError('That branch no longer exists.')
    Object.assign(branch, patch)
    commit()
  },

  /** Delete a branch — refused while any staff or manager is still posted there. */
  async deleteBranch(actor: Actor, branchId: string): Promise<void> {
    const branch = read.branch(branchId)
    if (!branch) throw new ApiError('That branch no longer exists.')
    if (db.staff.some((s) => s.branch_id === branchId) || db.managers.some((m) => m.branch_id === branchId)) {
      throw new ApiError(`${branch.code} still has staff or managers. Move or remove them first.`)
    }

    if (isSupabaseEnabled) {
      const { error } = await supabase!.from('branches').delete().eq('id', branchId)
      if (error) {
        // 23503 = foreign-key violation (something still references the branch).
        if (error.code === '23503') throw new ApiError(`${branch.code} is still in use — move its staff and managers first.`)
        throw new ApiError(error.message)
      }
      await hydrateFromSupabase()
      return
    }
    requireAdmin(actor)
    db.branches = db.branches.filter((b) => b.id !== branchId)
    commit()
  },

  async addDepartment(actor: Actor, code: string, name: string): Promise<Department> {
    const normalised = code.trim().toUpperCase()
    if (!/^[A-Z]{2,4}$/.test(normalised)) throw new ApiError('Department code must be 2–4 letters, e.g. FD.')
    if (!name.trim()) throw new ApiError('A department needs a name.')
    if (db.departments.some((d) => d.code === normalised)) throw new ApiError(`Department ${normalised} already exists.`)

    if (isSupabaseEnabled) {
      const { data, error } = await supabase!
        .from('departments')
        .insert({ code: normalised, name: name.trim() })
        .select('*')
        .single()
      if (error) throw new ApiError(error.message)
      await hydrateFromSupabase()
      return data as Department
    }

    requireAdmin(actor)
    const dept: Department = { id: id('dp'), code: normalised, name: name.trim() }
    db.departments.push(dept)
    commit()
    return dept
  },

  /** Rename a department. Its code is fixed (it prefixes its SOP codes). */
  async updateDepartment(actor: Actor, deptId: string, changes: { name?: string }): Promise<void> {
    const patch: Record<string, unknown> = {}
    if (changes.name !== undefined) {
      if (!changes.name.trim()) throw new ApiError('A department needs a name.')
      patch.name = changes.name.trim()
    }
    if (Object.keys(patch).length === 0) return

    if (isSupabaseEnabled) {
      const { error } = await supabase!.from('departments').update(patch).eq('id', deptId)
      if (error) throw new ApiError(error.message)
      await hydrateFromSupabase()
      return
    }
    requireAdmin(actor)
    const dept = db.departments.find((d) => d.id === deptId)
    if (!dept) throw new ApiError('That department no longer exists.')
    Object.assign(dept, patch)
    commit()
  },

  /** Delete a department — refused while anything is still filed under it. */
  async deleteDepartment(actor: Actor, deptId: string): Promise<void> {
    const dept = read.department(deptId)
    if (!dept) throw new ApiError('That department no longer exists.')
    if (
      db.staff.some((s) => s.department_id === deptId) ||
      db.managers.some((m) => m.department_id === deptId) ||
      db.sops.some((s) => s.department_id === deptId) ||
      db.tests.some((t) => t.department_id === deptId)
    ) {
      throw new ApiError(`${dept.name} still has staff, managers, SOPs or tests. Remove those first.`)
    }

    if (isSupabaseEnabled) {
      const { error } = await supabase!.from('departments').delete().eq('id', deptId)
      if (error) {
        if (error.code === '23503') throw new ApiError(`${dept.name} is still in use — remove its staff, SOPs and tests first.`)
        throw new ApiError(error.message)
      }
      await hydrateFromSupabase()
      return
    }
    requireAdmin(actor)
    db.departments = db.departments.filter((d) => d.id !== deptId)
    commit()
  },

  /**
   * Adds a staff member and returns the generated employee code ONCE. The
   * plaintext is never stored — only the hash goes into the table — so if the
   * admin loses it the only remedy is to regenerate.
   */
  async addStaff(
    actor: Actor,
    input: { name: string; department_id: string; branch_id: string; job_title: string },
  ): Promise<{ staff: Staff; code: string }> {
    if (isSupabaseEnabled) {
      // The manage-staff function generates the code, hashes it in Postgres, and
      // returns the plaintext once. The hash never reaches the browser.
      const j = await callAdminFn('manage-staff', {
        action: 'create',
        name: input.name,
        department_id: input.department_id,
        branch_id: input.branch_id,
        job_title: input.job_title,
      })
      await hydrateFromSupabase()
      return { staff: mapStaffRow(j.staff as Record<string, unknown>), code: j.code as string }
    }

    requireAdmin(actor)
    if (!input.name.trim()) throw new ApiError('A staff member needs a name.')

    const code = generateEmployeeCode()
    const staff: Staff = {
      id: id('st'),
      name: input.name.trim(),
      department_id: input.department_id,
      branch_id: input.branch_id,
      job_title: input.job_title.trim() || 'Staff',
      employee_code_hash: await hashEmployeeCode(code),
      employee_code: code,
      active: true,
      created_at: nowIso(),
    }
    db.staff.push(staff)
    commit()
    return { staff, code }
  },

  /** Offboarding is deactivating the row, which is what makes turnover cheap. */
  async setStaffActive(actor: Actor, staffId: string, active: boolean): Promise<void> {
    if (isSupabaseEnabled) {
      // A plain column flip — RLS lets admins (and a manager on her own patch) do
      // it directly, so no Edge Function is needed.
      const { error } = await supabase!.from('staff').update({ active }).eq('id', staffId)
      if (error) throw new ApiError(error.message)
      await hydrateFromSupabase()
      return
    }
    const staff = db.staff.find((s) => s.id === staffId)
    if (!staff) throw new ApiError('That staff record no longer exists.')
    assertCanTouchStaff(actor, staff)
    staff.active = active
    if (!active) db.sessions = db.sessions.filter((s) => s.staff_id !== staffId)
    commit()
  },

  async regenerateStaffCode(actor: Actor, staffId: string): Promise<string> {
    if (isSupabaseEnabled) {
      const j = await callAdminFn('manage-staff', { action: 'regenerate', staff_id: staffId })
      await hydrateFromSupabase() // so the roster row shows the new code at once
      return j.code as string
    }
    const staff = db.staff.find((s) => s.id === staffId)
    if (!staff) throw new ApiError('That staff record no longer exists.')
    assertCanTouchStaff(actor, staff)
    const code = generateEmployeeCode()
    staff.employee_code_hash = await hashEmployeeCode(code)
    staff.employee_code = code
    delete db.lockouts[staffId]
    commit()
    return code
  },

  /**
   * Create a department manager. In Supabase mode this creates their Supabase
   * Auth login (via the manage-managers function) and returns a generated
   * password to share once, unless one was supplied.
   */
  async addManager(
    actor: Actor,
    input: { name: string; email: string; department_id: string; branch_id: string; password?: string },
  ): Promise<{ manager: Manager; password: string | null }> {
    if (isSupabaseEnabled) {
      const j = await callAdminFn('manage-managers', {
        action: 'create',
        name: input.name,
        email: input.email,
        department_id: input.department_id,
        branch_id: input.branch_id,
        password: input.password ?? '',
      })
      await hydrateFromSupabase()
      return { manager: j.manager as Manager, password: (j.password as string | null) ?? null }
    }

    requireAdmin(actor)
    const email = input.email.trim().toLowerCase()
    if (!input.name.trim()) throw new ApiError('A manager needs a name.')
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ApiError('That email does not look right.')
    if (db.managers.some((m) => m.email === email)) throw new ApiError('That manager already exists.')

    const manager: Manager = {
      id: id('mg'),
      name: input.name.trim(),
      email,
      department_id: input.department_id,
      branch_id: input.branch_id,
      active: true,
    }
    db.managers.push(manager)
    commit()
    return { manager, password: null }
  },

  /**
   * Update a manager's posting (name / department / branch / active). These are
   * plain column changes an admin does directly under RLS — no Auth user touched.
   */
  async updateManager(
    actor: Actor,
    managerId: string,
    changes: { name?: string; department_id?: string; branch_id?: string; active?: boolean },
  ): Promise<void> {
    const patch: Record<string, unknown> = {}
    if (changes.name !== undefined) patch.name = changes.name.trim()
    if (changes.department_id !== undefined) patch.department_id = changes.department_id
    if (changes.branch_id !== undefined) patch.branch_id = changes.branch_id
    if (changes.active !== undefined) patch.active = changes.active
    if (Object.keys(patch).length === 0) return

    if (isSupabaseEnabled) {
      const { error } = await supabase!.from('managers').update(patch).eq('id', managerId)
      if (error) throw new ApiError(error.message)
      await hydrateFromSupabase()
      return
    }
    requireAdmin(actor)
    const manager = db.managers.find((m) => m.id === managerId)
    if (!manager) throw new ApiError('That manager no longer exists.')
    Object.assign(manager, patch)
    commit()
  },

  /** Remove a manager and (in Supabase mode) their Auth login. */
  async deleteManager(actor: Actor, managerId: string): Promise<void> {
    if (isSupabaseEnabled) {
      await callAdminFn('manage-managers', { action: 'delete', manager_id: managerId })
      await hydrateFromSupabase()
      return
    }
    requireAdmin(actor)
    db.managers = db.managers.filter((m) => m.id !== managerId)
    commit()
  },

  /* ---- tests ---- */

  async createTest(
    actor: Actor,
    input: {
      title: string
      department_id: string
      branch_scope: BranchScope
      related_sop_id: string | null
      pass_mark: number
      validity_months: number
      languages: Language[]
    },
  ): Promise<Test> {
    if (!input.title.trim()) throw new ApiError('A test needs a title.')
    // Respect the languages the form chose (the generation language leads); only
    // default to English when nothing was passed.
    const languages: Language[] = input.languages.length ? Array.from(new Set(input.languages)) : ['en']

    if (isSupabaseEnabled) {
      const { data, error } = await supabase!
        .from('tests')
        .insert({
          title: input.title.trim(),
          department_id: input.department_id,
          branch_scope: input.branch_scope,
          related_sop_id: input.related_sop_id,
          pass_mark: input.pass_mark,
          validity_months: input.validity_months,
          languages,
          status: 'draft',
        })
        .select('*')
        .single()
      if (error) throw new ApiError(error.message)
      await hydrateFromSupabase()
      return data as Test
    }

    assertCanTouchScope(actor, input.department_id, input.branch_scope)
    const test: Test = {
      id: id('ts'),
      title: input.title.trim(),
      department_id: input.department_id,
      branch_scope: input.branch_scope,
      related_sop_id: input.related_sop_id,
      pass_mark: input.pass_mark,
      validity_months: input.validity_months,
      languages,
      status: 'draft',
      created_at: nowIso(),
    }
    db.tests.push(test)
    commit()
    return test
  },

  async replaceQuestions(
    actor: Actor,
    testId: string,
    questions: Array<{ text: string; options: string[]; correct_index: number }>,
  ): Promise<void> {
    if (isSupabaseEnabled) {
      const del = await supabase!.from('questions').delete().eq('test_id', testId)
      if (del.error) throw new ApiError(del.error.message)
      if (questions.length) {
        const rows = questions.map((q, i) => ({
          test_id: testId,
          position: i + 1,
          text: q.text,
          options: q.options,
          correct_index: q.correct_index,
          translations: {},
          audio: {},
        }))
        const ins = await supabase!.from('questions').insert(rows)
        if (ins.error) throw new ApiError(ins.error.message)
      }
      await hydrateFromSupabase()
      return
    }

    const test = read.test(testId)
    if (!test) throw new ApiError('That test no longer exists.')
    assertCanTouchScope(actor, test.department_id, test.branch_scope)

    db.questions = db.questions.filter((q) => q.test_id !== testId)
    questions.forEach((q, i) => {
      db.questions.push({
        id: id('q'),
        test_id: testId,
        position: i + 1,
        text: q.text,
        options: q.options,
        correct_index: q.correct_index,
        // Translations are regenerated from the English at publish time; a
        // question whose English has just been rewritten has none until then.
        translations: {},
        audio: {},
      })
    })
    commit()
  },

  async publishTest(actor: Actor, testId: string): Promise<Test> {
    if (isSupabaseEnabled) {
      const { count } = await supabase!
        .from('questions')
        .select('id', { count: 'exact', head: true })
        .eq('test_id', testId)
      if (!count) throw new ApiError('A test needs at least one question before it can be published.')
      const { data, error } = await supabase!.from('tests').update({ status: 'published' }).eq('id', testId).select('*').single()
      if (error) throw new ApiError(error.message)
      await hydrateFromSupabase()
      return data as Test
    }

    const test = read.test(testId)
    if (!test) throw new ApiError('That test no longer exists.')
    assertCanTouchScope(actor, test.department_id, test.branch_scope)
    if (read.questionsFor(testId).length === 0) {
      throw new ApiError('A test needs at least one question before it can be published.')
    }
    test.status = 'published'
    commit()
    return test
  },

  /**
   * Delete a test and everything tied to it (questions, assignments, attempts,
   * certifications, retest grants — all cascade via the foreign keys).
   */
  async deleteTest(actor: Actor, testId: string): Promise<void> {
    if (isSupabaseEnabled) {
      const { error } = await supabase!.from('tests').delete().eq('id', testId)
      if (error) throw new ApiError(error.message)
      await hydrateFromSupabase()
      return
    }
    const test = read.test(testId)
    if (!test) throw new ApiError('That test no longer exists.')
    assertCanTouchScope(actor, test.department_id, test.branch_scope)
    db.tests = db.tests.filter((t) => t.id !== testId)
    db.questions = db.questions.filter((q) => q.test_id !== testId)
    db.assignments = db.assignments.filter((a) => a.test_id !== testId)
    db.attempts = db.attempts.filter((a) => a.test_id !== testId)
    db.certifications = db.certifications.filter((c) => c.test_id !== testId)
    db.grants = db.grants.filter((g) => g.test_id !== testId)
    commit()
  },

  /* ---- generate-test Edge Function (Claude API) ---- */

  /**
   * Drafts questions from an SOP document.
   *
   * In production this is an Edge Function that fetches the document straight
   * from Drive, sends it to the Claude API with a difficulty-tuned instruction,
   * and strictly validates the JSON that comes back. The API key lives in the
   * function's environment and never reaches the browser.
   *
   * Two rules survive into this stand-in because they are the point of the
   * feature, not implementation detail:
   *   - generation NEVER auto-publishes. It returns a draft the manager reviews,
   *     edits and publishes, because a language model will occasionally write an
   *     ambiguous question or mark a defensible-but-wrong option, and the
   *     manager must remain the examiner.
   *   - anything that fails validation is dropped and the manager is told, so a
   *     bad response degrades to manual authoring rather than to a broken test.
   */
  async generateTestDraft(
    actor: Actor,
    input: { sopId: string; difficulty: Difficulty; count: number; language?: Language },
  ): Promise<{ questions: DraftQuestion[]; warnings: string[] }> {
    const sop = read.sop(input.sopId)
    if (!sop) throw new ApiError('That SOP no longer exists.')

    // Supabase mode: the generate-test Edge Function reads the SOP's PDF from
    // Drive and calls the Gemini API (the key lives only in the function).
    if (isSupabaseEnabled) {
      const { data: { session } } = await supabase!.auth.getSession()
      if (!session) throw new ApiError('Please sign in again.')
      const res = await fetch(`${functionsBase}/generate-test`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sopId: input.sopId, difficulty: input.difficulty, count: input.count, language: input.language ?? 'en' }),
      }).catch(() => null)
      if (res && res.status === 404) throw new ApiError('The generate-test function isn’t deployed yet (see supabase/SETUP.md).')
      if (!res || !res.ok) {
        const j = res ? await res.json().catch(() => ({})) : {}
        throw new ApiError((j as { error?: string }).error ?? 'Generation failed. Write the questions by hand.')
      }
      const j = await res.json()
      return { questions: j.questions ?? [], warnings: j.warnings ?? [] }
    }

    // Demo mode: reading a department SOP to draft questions (no publish).
    assertCanReadDepartment(actor, sop.department_id)
    await delay(900)
    const raw = mockClaudeGeneration(sop, input.difficulty, input.count)
    return validateGeneratedQuestions(raw)
  },

  /* ---- translate-test Edge Function (Claude API) ---- */

  /**
   * Renders the whole English question set into the chosen languages and stores
   * the result alongside the English on each question.
   *
   * Translations are renderings of the English original. They are regenerated
   * when a question changes and are never edited independently — otherwise you
   * are certifying people against three subtly different tests.
   */
  async translateTest(actor: Actor, testId: string, languages: Language[]): Promise<number> {
    if (isSupabaseEnabled) {
      // The translate-test function isn't deployed yet, so skip translation and
      // let the test publish in English. Urdu/Pashto fall back to English in the
      // runner until translate-test is built; nothing breaks.
      void languages
      return 0
    }

    const test = read.test(testId)
    if (!test) throw new ApiError('That test no longer exists.')
    assertCanTouchScope(actor, test.department_id, test.branch_scope)

    await delay(700)
    const questions = read.questionsFor(testId)
    for (const q of questions) {
      for (const lang of languages) {
        if (lang === 'en') continue
        q.translations[lang] = mockTranslate(q, lang)
      }
    }
    test.languages = ['en', ...languages.filter((l) => l !== 'en')]
    commit()
    return questions.length
  },
}

function requireAdmin(actor: Actor): void {
  assertLocalWrite()
  if (actor.kind !== 'admin') {
    throw new ApiError('Only an admin can do that.')
  }
}

/** Everyone the derivation says this SOP or test applies to. */
export function eligibleStaffFor(record: { department_id: string; branch_scope: BranchScope }): Staff[] {
  return db.staff.filter((s) => {
    if (!s.active) return false
    if (s.department_id !== record.department_id) return false
    const branch = read.branch(s.branch_id)
    return !!branch && scopeIncludes(record.branch_scope, branch.code)
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/* ------------------------------------------------- generation validation ---- */

export interface DraftQuestion {
  text: string
  options: string[]
  correct_index: number
}

/**
 * Strict validation of what the model returns: four options each, exactly one
 * correct answer index that actually points at an option, no blanks, no
 * duplicate options. A question that fails any of these is dropped with a
 * warning rather than quietly repaired.
 */
export function validateGeneratedQuestions(raw: unknown): {
  questions: DraftQuestion[]
  warnings: string[]
} {
  const warnings: string[] = []
  if (!Array.isArray(raw)) {
    return { questions: [], warnings: ['The model did not return a list of questions. Write the test by hand.'] }
  }

  const questions: DraftQuestion[] = []
  raw.forEach((item, i) => {
    const n = i + 1
    if (typeof item !== 'object' || item === null) {
      warnings.push(`Question ${n} was not an object and was dropped.`)
      return
    }
    const q = item as Record<string, unknown>
    if (typeof q.text !== 'string' || !q.text.trim()) {
      warnings.push(`Question ${n} had no question text and was dropped.`)
      return
    }
    if (!Array.isArray(q.options) || q.options.length !== 4) {
      warnings.push(`Question ${n} did not have exactly four options and was dropped.`)
      return
    }
    const options = q.options.map((o) => (typeof o === 'string' ? o.trim() : ''))
    if (options.some((o) => !o)) {
      warnings.push(`Question ${n} had a blank option and was dropped.`)
      return
    }
    if (new Set(options.map((o) => o.toLowerCase())).size !== 4) {
      warnings.push(`Question ${n} repeated an option and was dropped.`)
      return
    }
    const idx = q.correct_index
    if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx > 3) {
      warnings.push(`Question ${n} had no valid correct answer and was dropped.`)
      return
    }
    questions.push({ text: q.text.trim(), options, correct_index: idx })
  })

  if (questions.length === 0 && warnings.length === 0) {
    warnings.push('The model returned nothing usable. Write the test by hand.')
  }
  return { questions, warnings }
}

/* ------------------------------------------------------------ mock Claude ---- */

/**
 * Stand-in for the Claude call. It produces questions at the requested
 * difficulty from the SOP's own title and summary, and — like the real prompt
 * will instruct — invents no policy that is not in the document. A thin SOP
 * yields thin questions, which is a feature: it pressures managers into writing
 * real SOPs.
 */
function mockClaudeGeneration(sop: Sop, difficulty: Difficulty, count: number): unknown {
  const dept = read.department(sop.department_id)?.name ?? 'the department'
  const templates: Record<Difficulty, Array<() => DraftQuestion>> = {
    // Low: direct recall of what the SOP states.
    low: [
      () => ({
        text: `Which document-control code identifies the ${sop.title.toLowerCase()} procedure?`,
        options: [sop.code, shiftCode(sop.code, 1), shiftCode(sop.code, 2), shiftCode(sop.code, 3)],
        correct_index: 0,
      }),
      () => ({
        text: `${sop.code} applies to which department?`,
        options: [dept, 'Front Desk', 'Maintenance', 'Any department'].filter(
          (v, i, arr) => arr.indexOf(v) === i,
        ).concat(['Quality & Compliance', 'Kitchen']).slice(0, 4),
        correct_index: 0,
      }),
      () => ({
        text: `According to ${sop.code}, which of the following is part of the stated procedure?`,
        options: [
          firstClause(sop.summary),
          'Whatever the shift supervisor prefers on the day',
          'Nothing is specified; use your judgement',
          'It is decided branch by branch',
        ],
        correct_index: 0,
      }),
    ],
    // Medium: applying the rule inside a simple realistic on-shift scenario.
    medium: [
      () => ({
        text: `Mid-shift you hit the situation ${sop.code} covers and a colleague suggests skipping a step to save time. What does the SOP require?`,
        options: [
          'Follow the procedure as written and record it',
          'Skip the step if the guest has not noticed',
          'Ask the guest which they would prefer',
          'Do it your own way and mention it at handover',
        ],
        correct_index: 0,
      }),
      () => ({
        text: `A new colleague on your shift has not read ${sop.code}. Under the SOP, what should happen before they carry out the task alone?`,
        options: [
          'They read and sign the current version first',
          'They watch once and start immediately',
          'They can start; the SOP is guidance only',
          'They wait for the next quarterly briefing',
        ],
        correct_index: 0,
      }),
      () => ({
        text: `You are part-way through the ${sop.title.toLowerCase()} procedure when you are pulled away. What is the correct action?`,
        options: [
          'Hand over the incomplete step explicitly so it is picked up',
          'Leave it; the next person will notice',
          'Mark it complete and finish it later',
          'Start again from the beginning at the end of your shift',
        ],
        correct_index: 0,
      }),
    ],
    // High: multi-step or exception scenarios where the wrong options are
    // plausible near-miss mistakes staff actually make.
    high: [
      () => ({
        text: `${sop.code} covers the normal case, but tonight you face an exception it does not name, and the duty manager is unreachable. What is the correct sequence?`,
        options: [
          'Apply the closest stated rule, record the deviation, and escalate at the first opportunity',
          'Improvise and say nothing, since the SOP does not cover it',
          'Refuse to act at all until the manager answers',
          'Ask the guest to decide and follow whatever they choose',
        ],
        correct_index: 0,
      }),
      () => ({
        text: `Two requirements of ${sop.code} appear to conflict during a busy period. What does the SOP expect of you?`,
        options: [
          'Satisfy the safety or compliance requirement first and record why the other slipped',
          'Satisfy whichever is quicker and move on',
          'Average the two and do neither fully',
          'Wait until the rush is over and do both then',
        ],
        correct_index: 0,
      }),
      () => ({
        text: `A near-miss occurs that ${sop.code} would have prevented, but no guest was affected and nobody else saw it. What now?`,
        options: [
          'Report it anyway, citing the code, so the cause is followed up',
          'Do nothing, since there was no harm',
          'Mention it verbally at handover only',
          'Correct it quietly and keep it off the record',
        ],
        correct_index: 0,
      }),
    ],
  }

  const pool = templates[difficulty]
  const out: DraftQuestion[] = []
  for (let i = 0; i < count; i++) {
    out.push(pool[i % pool.length]())
  }
  // Rotate the correct option around the four positions so the draft does not
  // train staff to always pick A.
  return out.map((q, i) => rotateAnswer(q, i % 4))
}

function rotateAnswer(q: DraftQuestion, target: number): DraftQuestion {
  const options = [...q.options]
  const [correct] = options.splice(q.correct_index, 1)
  options.splice(target, 0, correct)
  return { ...q, options, correct_index: target }
}

function shiftCode(code: string, by: number): string {
  const m = /^([A-Z]{2,4})-(\d{3,})$/.exec(code)
  if (!m) return `${code}-${by}`
  return `${m[1]}-${String(Number(m[2]) + by).padStart(m[2].length, '0')}`
}

function firstClause(summary: string): string {
  const clause = summary.split(/[,.;]/)[0]?.trim() ?? summary
  return clause.charAt(0).toUpperCase() + clause.slice(1)
}

/**
 * Stand-in for the translate call. It marks the string rather than inventing
 * Urdu or Pashto that nobody has checked — an honest placeholder beats
 * confident-looking machine text that a manager might wave through. The real
 * Edge Function replaces this with the Claude API and the manager reviews the
 * output as controlled content before it goes live.
 */
function mockTranslate(q: Question, lang: Language): { text: string; options: string[] } {
  const existing = q.translations[lang]
  if (existing) return existing
  const tag = lang === 'ur' ? '[اردو ترجمہ زیرِ التوا]' : '[پښتو ژباړه پاتې ده]'
  return {
    text: `${tag} ${q.text}`,
    options: q.options.map((o) => `${tag} ${o}`),
  }
}
