/**
 * Public Integration API — the `api` Edge Function.
 *
 * One REST-ish surface a SECOND portal can call to read from and write into this
 * portal. Authentication is a shared secret in the `x-api-key` header (see
 * ../_shared/integration.ts); there is no Supabase JWT, so deploy with
 * `--no-verify-jwt`. All work runs as service_role (RLS is bypassed), which is
 * exactly why the api-key gate is the whole security boundary here.
 *
 *   GET  /api            → API info + the available endpoints (key test)
 *   GET  /api/meta       → valid department + branch codes
 *   GET  /api/sops       → list SOPs           (?department=HK&branch=CLF)
 *   POST /api/sops       → create an SOP        (multipart: file + metadata → Drive)
 *   GET  /api/policies   → list policies        (?department=HK&status=published)
 *   POST /api/policies   → publish a policy     (multipart: file + metadata → Drive)
 *   GET  /api/assessments→ list tests + results (?department=HK)
 *   POST /api/assessments→ create a test (quiz) (JSON: questions[])
 *   GET  /api/training   → per-staff training records (?department=HK&branch=CLF)
 *
 * Secrets: INTEGRATION_API_KEY, GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN. Supabase
 * injects SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getUserAccessToken, uploadToDrive, makeViewOnly, findOrCreateFolder, deleteFromDrive } from '../_shared/google.ts'
import { cors, json, requireApiKey, driveUrl } from '../_shared/integration.ts'
import { scopeIncludes } from '../_shared/scope.ts'

const STORAGE_FOLDER_ID = '1ERAgtoCpbhCEzFYq0gxhfbXc_rM6l9LQ'

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>

function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const keyError = requireApiKey(req)
  if (keyError) return keyError

  // Route on the path after the function name, regardless of how the gateway
  // presents it (/functions/v1/api/sops or /api/sops).
  let path = new URL(req.url).pathname.replace(/^\/functions\/v1/, '').replace(/^\/api/, '')
  if (path === '' || path === '/') path = '/'
  path = path.replace(/\/$/, '') || '/'
  const method = req.method

  const admin = serviceClient()
  try {
    if (method === 'GET' && path === '/') return info()
    if (method === 'GET' && path === '/meta') return await getMeta(admin)
    if (method === 'GET' && path === '/sops') return await listSops(admin, req)
    if (method === 'POST' && path === '/sops') return await createSop(admin, req)
    if (method === 'GET' && path === '/policies') return await listPolicies(admin, req)
    if (method === 'POST' && path === '/policies') return await createPolicy(admin, req)
    if (method === 'DELETE' && path === '/policies') return await deletePolicy(admin, req)
    if (method === 'GET' && path === '/acks-debug') return await acksDebug(admin)
    if (method === 'GET' && path === '/assessments') return await listAssessments(admin, req)
    if (method === 'POST' && path === '/assessments') return await createAssessment(admin, req)
    if (method === 'GET' && path === '/training') return await listTraining(admin, req)
    return json({ error: `No route for ${method} ${path}` }, 404)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Request failed.' }, 500)
  }
})

// ───────────────────────────────────────────────────────────── info / meta ──

function info(): Response {
  return json({
    name: 'Hamsun Hospitality — SOP & Training Portal Integration API',
    version: '1',
    authentication: "x-api-key header",
    endpoints: {
      'GET /meta': 'Valid department and branch codes',
      'GET /sops': 'List SOPs (?department=HK&branch=CLF)',
      'POST /sops': 'Create an SOP (multipart/form-data)',
      'GET /policies': 'List policies (?department=HK&status=published)',
      'POST /policies': 'Publish a policy (multipart/form-data)',
      'DELETE /policies': 'Delete a policy (?id=<policyId>)',
      'GET /assessments': 'List tests and their results (?department=HK)',
      'POST /assessments': 'Create a test/quiz (application/json)',
      'GET /training': 'Per-staff training records (?department=HK&branch=CLF)',
    },
  })
}

async function deptMaps(admin: SupabaseClient) {
  const { data } = await admin.from('departments').select('id, code, name, drive_folder_id, policy_folder_id')
  const byId = new Map<string, Row>()
  const byCode = new Map<string, Row>()
  for (const d of (data ?? []) as Row[]) {
    byId.set(d.id, d)
    byCode.set(String(d.code).toUpperCase(), d)
  }
  return { byId, byCode }
}

async function branchMaps(admin: SupabaseClient) {
  const { data } = await admin.from('branches').select('id, code, name, status')
  const byId = new Map<string, Row>()
  const byCode = new Map<string, Row>()
  for (const b of (data ?? []) as Row[]) {
    byId.set(b.id, b)
    byCode.set(String(b.code).toUpperCase(), b)
  }
  return { byId, byCode }
}

async function getMeta(admin: SupabaseClient): Promise<Response> {
  const { byId: dById } = await deptMaps(admin)
  const { byId: bById } = await branchMaps(admin)
  const departments = [...dById.values()].map((d) => ({ code: d.code, name: d.name }))
  const branches = [...bById.values()].map((b) => ({ code: b.code, name: b.name, status: b.status }))
  return json({ departments, branches })
}

// ───────────────────────────────────────────────────────────────── shapers ──

function deptRef(byId: Map<string, Row>, id: string) {
  const d = byId.get(id)
  return d ? { code: d.code, name: d.name } : null
}

function branchesOut(scope: Row | null) {
  return scope?.kind === 'ALL' ? 'ALL' : (scope?.branch_codes ?? [])
}

function shapeSop(s: Row, dById: Map<string, Row>) {
  return {
    id: s.id,
    code: s.code,
    title: s.title,
    summary: s.summary ?? '',
    department: deptRef(dById, s.department_id),
    branches: branchesOut(s.branch_scope),
    version: s.version,
    document_url: driveUrl(s.document_file_id),
    video_url: driveUrl(s.video_file_id),
    published_by: s.published_by ?? '',
    updated_at: s.updated_at,
  }
}

function shapePolicy(p: Row, dById: Map<string, Row>) {
  return {
    id: p.id,
    code: p.code,
    title: p.title,
    summary: p.summary ?? '',
    department: deptRef(dById, p.department_id),
    version: p.version,
    status: p.status,
    document_url: driveUrl(p.document_file_id),
    published_by: p.published_by ?? '',
    updated_at: p.updated_at,
    created_at: p.created_at,
  }
}

// ───────────────────────────────────────────────────────────────────── sops ──

async function listSops(admin: SupabaseClient, req: Request): Promise<Response> {
  const url = new URL(req.url)
  const { byId: dById, byCode: dByCode } = await deptMaps(admin)

  let q = admin.from('sops').select('*').eq('approval_status', 'authorized')
  const deptCode = url.searchParams.get('department')
  if (deptCode) {
    const d = dByCode.get(deptCode.toUpperCase())
    if (!d) return json({ sops: [] })
    q = q.eq('department_id', d.id)
  }
  const { data, error } = await q.order('code')
  if (error) return json({ error: error.message }, 500)

  let rows = (data ?? []) as Row[]
  const branch = url.searchParams.get('branch')
  if (branch) rows = rows.filter((s) => scopeIncludes(s.branch_scope, branch.toUpperCase()))
  return json({ sops: rows.map((s) => shapeSop(s, dById)) })
}

async function createSop(admin: SupabaseClient, req: Request): Promise<Response> {
  const form = await req.formData()
  const title = String(form.get('title') ?? '').trim()
  const deptCode = String(form.get('department') ?? '').trim().toUpperCase()
  const providedCode = String(form.get('code') ?? '').trim().toUpperCase()
  const summary = String(form.get('summary') ?? '').trim()
  const publishedBy = String(form.get('published_by') ?? '').trim() || 'External portal'
  const branchesRaw = String(form.get('branches') ?? '').trim()
  const file = form.get('file')
  const video = form.get('video')

  if (!title) return json({ error: 'title is required.' }, 400)
  if (!deptCode) return json({ error: 'department (a department code, e.g. HK) is required.' }, 400)
  if (!(file instanceof File)) return json({ error: 'file is required — the SOP document (PDF or DOCX).' }, 400)

  const { byCode: dByCode, byId: dById } = await deptMaps(admin)
  const dept = dByCode.get(deptCode)
  if (!dept) return json({ error: `Unknown department code: ${deptCode}. See GET /meta.` }, 400)

  const { byCode: bByCode, byId: bById } = await branchMaps(admin)
  let branchScope: Row
  if (!branchesRaw) {
    branchScope = { kind: 'ALL' }
  } else {
    const codes = branchesRaw.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean)
    for (const c of codes) if (!bByCode.has(c)) return json({ error: `Unknown branch code: ${c}. See GET /meta.` }, 400)
    branchScope = { kind: 'LIST', branch_codes: codes }
  }

  const gid = Deno.env.get('GOOGLE_CLIENT_ID')
  const gsecret = Deno.env.get('GOOGLE_CLIENT_SECRET')
  const grefresh = Deno.env.get('GOOGLE_REFRESH_TOKEN')
  if (!gid || !gsecret || !grefresh) return json({ error: 'Drive is not configured on the portal.' }, 500)
  const token = await getUserAccessToken(gid, gsecret, grefresh)

  let folderId = dept.drive_folder_id as string | null
  if (!folderId) folderId = await findOrCreateFolder(token, STORAGE_FOLDER_ID, String(dept.name).trim())

  // Document-control code: honour one given, else auto-number within the department.
  const { data: existing } = await admin.from('sops').select('code')
  const codes = ((existing ?? []) as Row[]).map((r) => String(r.code))
  let code = providedCode
  if (!code) {
    let highest = 0
    for (const c of codes) {
      const m = /^([A-Z]{2,4})-(\d{3,})$/.exec(c)
      if (m && m[1] === dept.code && Number(m[2]) > highest) highest = Number(m[2])
    }
    code = `${dept.code}-${String(highest + 1).padStart(3, '0')}`
  }
  if (codes.some((c) => c.toUpperCase() === code)) return json({ error: `Code ${code} is already in use.` }, 409)

  const isDocx = (file.type || '').includes('word') || file.name.toLowerCase().endsWith('.docx')
  const ext = isDocx ? 'docx' : 'pdf'
  const mime = isDocx
    ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    : 'application/pdf'
  const docId = await uploadToDrive(token, folderId!, `${code} — ${title}.${ext}`, mime, await file.arrayBuffer())
  await makeViewOnly(token, docId)

  let videoId: string | null = null
  if (video instanceof File && video.size > 0) {
    videoId = await uploadToDrive(token, folderId!, `${code} — ${title} (video)`, video.type || 'video/mp4', await video.arrayBuffer())
    await makeViewOnly(token, videoId)
  }

  const { data: sop, error } = await admin
    .from('sops')
    .insert({
      code,
      title,
      summary,
      department_id: dept.id,
      branch_scope: branchScope,
      version: 1,
      document_file_id: docId,
      video_file_id: videoId,
      approval_status: 'authorized',
      updated_at: new Date().toISOString(),
      published_by: publishedBy,
    })
    .select('*')
    .single()
  if (error) return json({ error: `Could not save the SOP: ${error.message}` }, 500)

  // Notify eligible staff (best-effort — a notification failure never fails the write).
  try {
    const { data: staff } = await admin.from('staff').select('id, branch_id').eq('department_id', dept.id).eq('active', true)
    const applies = (bid: string) => branchScope.kind === 'ALL' || branchScope.branch_codes.includes(bById.get(bid)?.code)
    const notes = ((staff ?? []) as Row[])
      .filter((s) => applies(s.branch_id))
      .map((s) => ({
        staff_id: s.id,
        kind: 'sop_published',
        text: `New SOP ${code} — ${title} — has been published for your department.`,
        whatsapp_pending: true,
      }))
    if (notes.length) await admin.from('notifications').insert(notes)
  } catch (_) {
    // ignore
  }

  return json({ sop: shapeSop(sop as Row, dById) }, 201)
}

// ───────────────────────────────────────────────────────────────── policies ──

async function listPolicies(admin: SupabaseClient, req: Request): Promise<Response> {
  const url = new URL(req.url)
  const { byId: dById, byCode: dByCode } = await deptMaps(admin)

  let q = admin.from('policies').select('*')
  const deptCode = url.searchParams.get('department')
  if (deptCode) {
    const d = dByCode.get(deptCode.toUpperCase())
    if (!d) return json({ policies: [] })
    q = q.eq('department_id', d.id)
  }
  const status = url.searchParams.get('status')
  if (status) q = q.eq('status', status)
  const { data, error } = await q.order('code')
  if (error) return json({ error: error.message }, 500)

  const rows = (data ?? []) as Row[]

  // Branch + staff + manager reference data for resolving each person's branch.
  const { byId: bById } = await branchMaps(admin)
  const branchCodeOf = (bid: string | null | undefined) =>
    bid && bById.get(bid) ? (bById.get(bid)!.code as string) : null

  // Policies reach EVERY active staff member — that is the roster we mark
  // acknowledged / not-acknowledged against.
  const { data: staffRows } = await admin.from('staff').select('id, name, branch_id').eq('active', true)
  const staffList = (staffRows ?? []) as Row[]
  const staffBranch = new Map<string, string | null>()
  for (const s of staffList) staffBranch.set(s.id, branchCodeOf(s.branch_id))

  // Managers (their acks are management sign-offs) — for their branch.
  const { data: mgrRows } = await admin.from('managers').select('id, branch_id')
  const mgrBranch = new Map<string, string | null>()
  for (const m of (mgrRows ?? []) as Row[]) mgrBranch.set(m.id, branchCodeOf(m.branch_id))

  // All acknowledgments for these policies.
  const acksByPolicy = new Map<string, Row[]>()
  const ids = rows.map((r) => r.id)
  if (ids.length) {
    const { data: acks, error: ackErr } = await admin
      .from('policy_acknowledgments')
      .select('policy_id, staff_id, manager_id, name, role, version, acknowledged_at')
      .in('policy_id', ids)
    if (!ackErr) {
      for (const a of (acks ?? []) as Row[]) {
        if (!acksByPolicy.has(a.policy_id)) acksByPolicy.set(a.policy_id, [])
        acksByPolicy.get(a.policy_id)!.push(a)
      }
    }
  }

  const policies = rows.map((p) => {
    const current = (acksByPolicy.get(p.id) ?? [])
      .filter((a) => a.version === p.version)
      .sort((a, b) => new Date(a.acknowledged_at).getTime() - new Date(b.acknowledged_at).getTime())

    // Everyone who DID acknowledge (staff + managers + admin), with branch.
    const people = current.map((a) => ({
      name: a.name,
      role: a.role,
      branch: a.staff_id ? staffBranch.get(a.staff_id) ?? null : a.manager_id ? mgrBranch.get(a.manager_id) ?? null : null,
      acknowledged_at: a.acknowledged_at,
    }))

    // Full staff roster: acknowledged (green) vs not (red), for this version.
    const ackedAt = new Map<string, string>()
    for (const a of current) if (a.staff_id) ackedAt.set(a.staff_id, a.acknowledged_at)
    const roster = staffList
      .map((s) => ({
        name: s.name,
        branch: staffBranch.get(s.id) ?? null,
        acknowledged: ackedAt.has(s.id),
        acknowledged_at: ackedAt.get(s.id) ?? null,
      }))
      .sort((a, b) => Number(b.acknowledged) - Number(a.acknowledged) || a.name.localeCompare(b.name))

    return {
      ...shapePolicy(p, dById),
      acknowledgments: {
        version: p.version,
        count: current.length,
        acknowledged_staff: roster.filter((r) => r.acknowledged).length,
        total_staff: staffList.length,
        people,
        roster,
      },
    }
  })
  return json({ policies })
}

async function createPolicy(admin: SupabaseClient, req: Request): Promise<Response> {
  const form = await req.formData()
  const title = String(form.get('title') ?? '').trim()
  const deptCode = String(form.get('department') ?? '').trim().toUpperCase()
  const providedCode = String(form.get('code') ?? '').trim().toUpperCase()
  const summary = String(form.get('summary') ?? '').trim()
  const publishedBy = String(form.get('published_by') ?? '').trim() || 'External portal'
  const file = form.get('file')

  if (!title) return json({ error: 'title is required.' }, 400)
  if (!deptCode) return json({ error: 'department (a department code, e.g. HK) is required.' }, 400)
  if (!(file instanceof File)) return json({ error: 'file is required — the policy document (PDF or DOCX).' }, 400)

  const { byCode: dByCode, byId: dById } = await deptMaps(admin)
  const dept = dByCode.get(deptCode)
  if (!dept) return json({ error: `Unknown department code: ${deptCode}. See GET /meta.` }, 400)

  const gid = Deno.env.get('GOOGLE_CLIENT_ID')
  const gsecret = Deno.env.get('GOOGLE_CLIENT_SECRET')
  const grefresh = Deno.env.get('GOOGLE_REFRESH_TOKEN')
  if (!gid || !gsecret || !grefresh) return json({ error: 'Drive is not configured on the portal.' }, 500)
  const token = await getUserAccessToken(gid, gsecret, grefresh)

  // Destination: the department's Policies folder, else a Policies/<dept> folder.
  let folderId = dept.policy_folder_id as string | null
  if (!folderId) {
    const policiesRoot = await findOrCreateFolder(token, STORAGE_FOLDER_ID, 'Policies')
    folderId = await findOrCreateFolder(token, policiesRoot, String(dept.name).trim())
  }

  const { data: existing } = await admin.from('policies').select('code')
  const codes = ((existing ?? []) as Row[]).map((r) => String(r.code))
  let code = providedCode
  if (!code) {
    let highest = 0
    for (const c of codes) {
      const m = /^POL-([A-Z]{2,4})-(\d{3,})$/.exec(c)
      if (m && m[1] === dept.code && Number(m[2]) > highest) highest = Number(m[2])
    }
    code = `POL-${dept.code}-${String(highest + 1).padStart(3, '0')}`
  }
  if (codes.some((c) => c.toUpperCase() === code)) return json({ error: `Code ${code} is already in use.` }, 409)

  const isDocx = (file.type || '').includes('word') || file.name.toLowerCase().endsWith('.docx')
  const ext = isDocx ? 'docx' : 'pdf'
  const mime = isDocx
    ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    : 'application/pdf'
  const docId = await uploadToDrive(token, folderId!, `${code} — ${title}.${ext}`, mime, await file.arrayBuffer())
  await makeViewOnly(token, docId)

  // The uploaded file IS the policy document; the portal streams it inline
  // (policy-view) with no Drive/external link, so no stub content is stored.
  const { data: policy, error } = await admin
    .from('policies')
    .insert({
      code,
      title,
      summary,
      department_id: dept.id,
      policy_doc: null,
      document_file_id: docId,
      version: 1,
      status: 'published',
      published_by: publishedBy,
      updated_at: new Date().toISOString(),
    })
    .select('*')
    .single()
  if (error) return json({ error: `Could not save the policy: ${error.message}` }, 500)

  // A published policy reaches everyone — notify every active staff member.
  try {
    const { data: staff } = await admin.from('staff').select('id').eq('active', true)
    const text = `New company policy ${code} — ${title} — has been published. Please read and acknowledge it.`
    const notes = ((staff ?? []) as Row[]).map((s) => ({ staff_id: s.id, kind: 'policy_published', text, whatsapp_pending: true }))
    if (notes.length) await admin.from('notifications').insert(notes)
  } catch (_) {
    // ignore
  }

  return json({ policy: shapePolicy(policy as Row, dById) }, 201)
}

// A Drive file id is a longish token with no slashes/spaces (not a URL or stub).
function isDriveId(ref: string | null): ref is string {
  return !!ref && !/[\s/]/.test(ref) && ref.length > 20
}

// TEMP diagnostic: raw policy acknowledgements vs policy versions, to find why
// an acknowledgement isn't surfacing. Safe to remove later.
async function acksDebug(admin: SupabaseClient): Promise<Response> {
  const { data: pols } = await admin.from('policies').select('id, code, title, version')
  const { data: acks } = await admin
    .from('policy_acknowledgments')
    .select('policy_id, name, role, version, staff_id, manager_id, acknowledged_at')
    .order('acknowledged_at', { ascending: false })
  const { data: sopAcks } = await admin
    .from('acknowledgments')
    .select('staff_id, sop_id, version, signed_at')
    .order('signed_at', { ascending: false })
    .limit(50)
  const { data: managers } = await admin.from('managers').select('id, name, email, role, department_id, active')
  const { data: admins } = await admin.from('admins').select('id, name')
  return json({
    policies: pols ?? [],
    policy_ack_count: (acks ?? []).length,
    policy_acks: acks ?? [],
    sop_sign_count: (sopAcks ?? []).length,
    sop_signs: sopAcks ?? [],
    managers: managers ?? [],
    admins: admins ?? [],
  })
}

async function deletePolicy(admin: SupabaseClient, req: Request): Promise<Response> {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return json({ error: 'id is required (?id=<policyId>).' }, 400)

  const { data: pol } = await admin.from('policies').select('id, document_file_id').eq('id', id).maybeSingle()
  if (!pol) return json({ error: 'Policy not found.' }, 404)

  // Remove the Drive file (best-effort — a failed Drive delete shouldn't strand
  // the record).
  try {
    const gid = Deno.env.get('GOOGLE_CLIENT_ID')
    const gsecret = Deno.env.get('GOOGLE_CLIENT_SECRET')
    const grefresh = Deno.env.get('GOOGLE_REFRESH_TOKEN')
    const fileId = (pol as Row).document_file_id as string | null
    if (gid && gsecret && grefresh && isDriveId(fileId)) {
      const token = await getUserAccessToken(gid, gsecret, grefresh)
      await deleteFromDrive(token, fileId)
    }
  } catch (_) {
    // ignore Drive errors
  }

  // Delete the policy (its acknowledgments cascade via the FK).
  const { error } = await admin.from('policies').delete().eq('id', id)
  if (error) return json({ error: `Could not delete the policy: ${error.message}` }, 500)
  return json({ ok: true })
}

// ────────────────────────────────────────────────────────────── assessments ──

async function listAssessments(admin: SupabaseClient, req: Request): Promise<Response> {
  const url = new URL(req.url)
  const { byId: dById, byCode: dByCode } = await deptMaps(admin)

  let q = admin.from('tests').select('*')
  const deptCode = url.searchParams.get('department')
  if (deptCode) {
    const d = dByCode.get(deptCode.toUpperCase())
    if (!d) return json({ assessments: [] })
    q = q.eq('department_id', d.id)
  }
  const { data: tests, error } = await q.order('created_at', { ascending: false })
  if (error) return json({ error: error.message }, 500)

  const { data: questions } = await admin.from('questions').select('test_id')
  const qCount = new Map<string, number>()
  for (const row of (questions ?? []) as Row[]) qCount.set(row.test_id, (qCount.get(row.test_id) ?? 0) + 1)

  const { data: attempts } = await admin.from('attempts').select('test_id, staff_id, passed, percentage, attempted_at')
  // Latest attempt per (test, staff).
  const latest = new Map<string, Row>()
  for (const a of (attempts ?? []) as Row[]) {
    const k = `${a.test_id}:${a.staff_id}`
    const cur = latest.get(k)
    if (!cur || new Date(a.attempted_at).getTime() > new Date(cur.attempted_at).getTime()) latest.set(k, a)
  }
  const totalAttempts = new Map<string, number>()
  for (const a of (attempts ?? []) as Row[]) totalAttempts.set(a.test_id, (totalAttempts.get(a.test_id) ?? 0) + 1)
  const staffAttempted = new Map<string, number>()
  const staffPassed = new Map<string, number>()
  for (const a of latest.values()) {
    staffAttempted.set(a.test_id, (staffAttempted.get(a.test_id) ?? 0) + 1)
    if (a.passed) staffPassed.set(a.test_id, (staffPassed.get(a.test_id) ?? 0) + 1)
  }

  const assessments = ((tests ?? []) as Row[]).map((t) => {
    const attempted = staffAttempted.get(t.id) ?? 0
    const passed = staffPassed.get(t.id) ?? 0
    return {
      id: t.id,
      title: t.title,
      department: deptRef(dById, t.department_id),
      branches: branchesOut(t.branch_scope),
      pass_mark: t.pass_mark,
      validity_months: t.validity_months,
      languages: t.languages,
      status: t.status,
      question_count: qCount.get(t.id) ?? 0,
      results: {
        total_attempts: totalAttempts.get(t.id) ?? 0,
        staff_attempted: attempted,
        staff_passed: passed,
        pass_rate: attempted ? Math.round((passed / attempted) * 100) : 0,
      },
    }
  })
  return json({ assessments })
}

async function createAssessment(admin: SupabaseClient, req: Request): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as Row
  const title = String(body.title ?? '').trim()
  const deptCode = String(body.department ?? '').trim().toUpperCase()
  const passMark = Number.isFinite(body.pass_mark) ? Number(body.pass_mark) : 80
  const validityMonths = Number.isFinite(body.validity_months) ? Number(body.validity_months) : 12
  const status = body.status === 'draft' ? 'draft' : 'published'
  const languages = Array.isArray(body.languages) && body.languages.length ? body.languages.map(String) : ['en']
  const questions = Array.isArray(body.questions) ? (body.questions as Row[]) : []

  if (!title) return json({ error: 'title is required.' }, 400)
  if (!deptCode) return json({ error: 'department (a department code, e.g. HK) is required.' }, 400)
  if (passMark < 1 || passMark > 100) return json({ error: 'pass_mark must be between 1 and 100.' }, 400)
  if (validityMonths < 1 || validityMonths > 120) return json({ error: 'validity_months must be between 1 and 120.' }, 400)
  if (questions.length < 1) return json({ error: 'Provide at least one question.' }, 400)

  for (let i = 0; i < questions.length; i++) {
    const quiz = questions[i]
    const opts = Array.isArray(quiz.options) ? quiz.options.map((o: unknown) => String(o)) : []
    if (!String(quiz.text ?? '').trim()) return json({ error: `questions[${i}].text is required.` }, 400)
    if (opts.length !== 4) return json({ error: `questions[${i}].options must be exactly 4 strings.` }, 400)
    const ci = Number(quiz.correct_index)
    if (!Number.isInteger(ci) || ci < 0 || ci > 3) return json({ error: `questions[${i}].correct_index must be 0–3.` }, 400)
  }

  const { byCode: dByCode, byId: dById } = await deptMaps(admin)
  const dept = dByCode.get(deptCode)
  if (!dept) return json({ error: `Unknown department code: ${deptCode}. See GET /meta.` }, 400)

  const { byCode: bByCode } = await branchMaps(admin)
  let branchScope: Row = { kind: 'ALL' }
  if (typeof body.branches === 'string' && body.branches.trim()) {
    const codes = body.branches.split(',').map((c: string) => c.trim().toUpperCase()).filter(Boolean)
    for (const c of codes) if (!bByCode.has(c)) return json({ error: `Unknown branch code: ${c}. See GET /meta.` }, 400)
    branchScope = { kind: 'LIST', branch_codes: codes }
  } else if (Array.isArray(body.branches) && body.branches.length) {
    const codes = body.branches.map((c: unknown) => String(c).trim().toUpperCase()).filter(Boolean)
    for (const c of codes) if (!bByCode.has(c)) return json({ error: `Unknown branch code: ${c}. See GET /meta.` }, 400)
    branchScope = { kind: 'LIST', branch_codes: codes }
  }

  const { data: test, error } = await admin
    .from('tests')
    .insert({
      title,
      department_id: dept.id,
      branch_scope: branchScope,
      pass_mark: passMark,
      validity_months: validityMonths,
      languages,
      status,
    })
    .select('*')
    .single()
  if (error) return json({ error: `Could not create the test: ${error.message}` }, 500)

  const rows = questions.map((quiz, i) => ({
    test_id: (test as Row).id,
    position: i,
    text: String(quiz.text).trim(),
    options: quiz.options.map((o: unknown) => String(o)),
    correct_index: Number(quiz.correct_index),
  }))
  const { error: qErr } = await admin.from('questions').insert(rows)
  if (qErr) {
    // Roll back the test so we don't leave a question-less shell behind.
    await admin.from('tests').delete().eq('id', (test as Row).id)
    return json({ error: `Could not save the questions: ${qErr.message}` }, 500)
  }

  const t = test as Row
  return json({
    assessment: {
      id: t.id,
      title: t.title,
      department: deptRef(dById, t.department_id),
      branches: branchesOut(t.branch_scope),
      pass_mark: t.pass_mark,
      validity_months: t.validity_months,
      languages: t.languages,
      status: t.status,
      question_count: rows.length,
    },
  }, 201)
}

// ───────────────────────────────────────────────────────────────── training ──

async function listTraining(admin: SupabaseClient, req: Request): Promise<Response> {
  const url = new URL(req.url)
  const { byId: dById, byCode: dByCode } = await deptMaps(admin)
  const { byId: bById, byCode: bByCode } = await branchMaps(admin)

  let sq = admin.from('staff').select('id, name, department_id, branch_id, job_title').eq('active', true)
  const deptCode = url.searchParams.get('department')
  if (deptCode) {
    const d = dByCode.get(deptCode.toUpperCase())
    if (!d) return json({ training: [] })
    sq = sq.eq('department_id', d.id)
  }
  const branchCode = url.searchParams.get('branch')
  if (branchCode) {
    const b = bByCode.get(branchCode.toUpperCase())
    if (!b) return json({ training: [] })
    sq = sq.eq('branch_id', b.id)
  }
  const { data: staff, error } = await sq.order('name')
  if (error) return json({ error: error.message }, 500)
  const staffIds = new Set(((staff ?? []) as Row[]).map((s) => s.id))

  const { data: tests } = await admin.from('tests').select('id, title')
  const testTitle = new Map<string, string>()
  for (const t of (tests ?? []) as Row[]) testTitle.set(t.id, t.title)

  const { data: assigns } = await admin.from('test_assignments').select('staff_id, test_id')
  const assignedByStaff = new Map<string, Set<string>>()
  for (const a of (assigns ?? []) as Row[]) {
    if (!staffIds.has(a.staff_id)) continue
    if (!assignedByStaff.has(a.staff_id)) assignedByStaff.set(a.staff_id, new Set())
    assignedByStaff.get(a.staff_id)!.add(a.test_id)
  }

  const { data: attempts } = await admin.from('attempts').select('staff_id, test_id, passed, percentage, attempted_at')
  const latest = new Map<string, Row>() // key staff:test
  for (const a of (attempts ?? []) as Row[]) {
    if (!staffIds.has(a.staff_id)) continue
    const k = `${a.staff_id}:${a.test_id}`
    const cur = latest.get(k)
    if (!cur || new Date(a.attempted_at).getTime() > new Date(cur.attempted_at).getTime()) latest.set(k, a)
  }

  const training = ((staff ?? []) as Row[]).map((s) => {
    const assigned = [...(assignedByStaff.get(s.id) ?? new Set<string>())]
    let passed = 0
    let failed = 0
    let notTaken = 0
    const assessments = assigned.map((testId) => {
      const a = latest.get(`${s.id}:${testId}`)
      let st: 'passed' | 'failed' | 'not_taken'
      if (!a) {
        st = 'not_taken'
        notTaken++
      } else if (a.passed) {
        st = 'passed'
        passed++
      } else {
        st = 'failed'
        failed++
      }
      return {
        test_id: testId,
        title: testTitle.get(testId) ?? '',
        status: st,
        percentage: a ? a.percentage : null,
        attempted_at: a ? a.attempted_at : null,
      }
    })
    return {
      staff: {
        id: s.id,
        name: s.name,
        job_title: s.job_title,
        department: deptRef(dById, s.department_id),
        branch: bById.get(s.branch_id) ? { code: bById.get(s.branch_id)!.code, name: bById.get(s.branch_id)!.name } : null,
      },
      summary: { assigned: assigned.length, passed, failed, not_taken: notTaken },
      assessments,
    }
  })
  return json({ training })
}
