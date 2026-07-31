import { useEffect, useMemo, useState } from 'react'
import {
  api,
  read,
  eligibleStaffFor,
  hasSigned,
  acknowledgmentFor,
  attemptsFor,
  latestCertification,
  openGrant,
  uploadSopViaFunction,
  listDriveFolders,
  createDriveFolder,
  ApiError,
} from '../data/store'
import type { Actor, DraftQuestion } from '../data/store'
import type { Branch, BranchScope, Department, Difficulty, Language, Manager, Sop, Staff, Test } from '../types'
import { scopeIncludes } from '../lib/scope'
import { certStatus, daysUntil } from '../lib/certs'
import { fmtD } from '../lib/format'
import { toast } from '../lib/toast'
import { isSupabaseEnabled } from '../lib/supabase'
import { DRIVE_DEPARTMENT_FOLDERS } from '../lib/drive'
import { Viewer } from '../components/Viewer'

/**
 * Manager / admin portal, in the prototype's board style. A manager is pinned to
 * her own department at her own branch; an admin picks any branch + department
 * and also manages the org. The boards and forms are the same; only the scope
 * and the extra admin sections differ.
 */
export function ManagerPortal({ actor, onLogout }: { actor: Actor; onLogout: () => void }) {
  const isAdmin = actor.kind === 'admin'
  const branches = read.branches()
  const departments = read.departments()

  const [aBranch, setABranch] = useState(branches[0]?.code ?? '')
  const [aDept, setADept] = useState(departments[0]?.id ?? '')
  const [viewer, setViewer] = useState<{ sop: Sop; kind: 'doc' | 'video' } | null>(null)

  const branch = isAdmin ? read.branchByCode(aBranch) : read.branch(actor.manager.branch_id)
  const dept = isAdmin ? read.department(aDept) : read.department(actor.manager.department_id)

  if (!branch || !dept) return <div className="allclear">No branches or departments yet.</div>

  return (
    <>
      {isAdmin ? (
        <div className="filters">
          <div className="field">
            <label htmlFor="a-branch">Branch</label>
            <select id="a-branch" value={aBranch} onChange={(e) => setABranch(e.target.value)}>
              {branches.map((b) => (
                <option key={b.id} value={b.code}>{b.code} — {b.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="a-dept">Department</label>
            <select id="a-dept" value={aDept} onChange={(e) => setADept(e.target.value)}>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: '0 0 auto', alignSelf: 'flex-end' }}>
            <button className="btn" onClick={onLogout}>Sign out</button>
          </div>
        </div>
      ) : (
        <div className="crumbs">
          <span className="here">{actor.manager.name} — {dept.name} Manager</span>
          <span className="sep">·</span>
          <span className="here mono">{branch.code}</span>
          <span className="who">
            <button onClick={onLogout} style={{ color: 'var(--pine)', fontWeight: 600 }}>Sign out</button>
          </span>
        </div>
      )}

      <SopBoard dept={dept} branch={branch} actor={actor} onOpen={(sop, kind) => setViewer({ sop, kind })} />
      <TestBoard dept={dept} branch={branch} actor={actor} />
      <AddSopForm dept={dept} branch={branch} actor={actor} lockBranch={!isAdmin} />
      <CreateTestForm dept={dept} branch={branch} actor={actor} lockBranch={!isAdmin} />

      {isAdmin && <AdminOrg actor={actor} dept={dept} branch={branch} />}

      {viewer && (
        <Viewer sop={viewer.sop} initialKind={viewer.kind} showViewOnly={false} onClose={() => setViewer(null)} />
      )}
    </>
  )
}

/* --------------------------------------------------------------- helpers -- */

function staffOf(deptId: string, branchId: string): Staff[] {
  return read
    .staff()
    .filter((s) => s.department_id === deptId && s.branch_id === branchId && s.active)
    .sort((a, b) => a.name.localeCompare(b.name))
}

function sopsOf(deptId: string, branchCode: string): Sop[] {
  return read
    .sops()
    .filter((s) => s.department_id === deptId && scopeIncludes(s.branch_scope, branchCode))
    .sort((a, b) => a.code.localeCompare(b.code))
}

function testsOf(deptId: string, branchCode: string): Test[] {
  return read
    .tests()
    .filter((t) => t.department_id === deptId && scopeIncludes(t.branch_scope, branchCode))
    .sort((a, b) => a.title.localeCompare(b.title))
}

async function run(fn: () => Promise<unknown>, ok?: string) {
  try {
    await fn()
    if (ok) toast(ok)
  } catch (e) {
    toast(e instanceof ApiError ? e.message : 'Something went wrong.')
  }
}

/* -------------------------------------------------------------- SOP board -- */

function SopBoard({
  dept,
  branch,
  actor,
  onOpen,
}: {
  dept: Department
  branch: Branch
  actor: Actor
  onOpen: (sop: Sop, kind: 'doc' | 'video') => void
}) {
  const people = staffOf(dept.id, branch.id)
  const sops = sopsOf(dept.id, branch.code)
  return (
    <div className="board">
      <div className="board-head">
        <h3>SOP sign-off — {dept.name} · {branch.code}</h3>
        <span className="hint">{people.length} staff</span>
      </div>
      {sops.length === 0 ? (
        <div className="empty-row">No SOPs here yet — add one below.</div>
      ) : (
        sops.map((s) => {
          const eligible = eligibleStaffFor(s).filter((p) => p.branch_id === branch.id)
          const signed = eligible.filter((p) => hasSigned(p.id, s)).length
          const full = eligible.length > 0 && signed === eligible.length
          return (
            <div className="brow" key={s.id}>
              <div className="brow-top">
                <span className="brow-title">
                  <span className="ver">{s.code}</span> {s.title} <span className="ver">v{s.version}</span>{' '}
                  {s.document_file_id && <span className="livechip">LIVE · DRIVE</span>}{' '}
                  {s.video_file_id && <span className="vidchip">▶ VIDEO</span>}
                </span>
                <button className="btn sm" onClick={() => onOpen(s, 'doc')}>Doc</button>
                <button className="btn sm" onClick={() => onOpen(s, 'video')}>▶ Video</button>
                <span className={`brow-frac ${full ? 'full' : 'gap'}`}>{signed}/{eligible.length} signed</span>
              </div>
              {eligible.length === 0 ? (
                <div className="names"><span className="nm">No staff here yet</span></div>
              ) : (
                <div className="names">
                  {eligible.map((p) => {
                    const a = acknowledgmentFor(p.id, s)
                    return <span key={p.id} className={`nm ${a ? 'ok' : ''}`}>{a ? '✓ ' : ''}{p.name}</span>
                  })}
                </div>
              )}
              <RevalidateRow actor={actor} sop={s} />
            </div>
          )
        })
      )}
    </div>
  )
}

function RevalidateRow({ actor, sop }: { actor: Actor; sop: Sop }) {
  return (
    <details className="inline">
      <summary>Manage this SOP</summary>
      <div style={{ marginTop: 8 }}>
        <p className="demo-hint" style={{ marginTop: 0 }}>
          A new version reopens the register — everyone who signed v{sop.version} must sign it again. Deleting removes
          the SOP and its sign-off records (the Drive file stays in your folder).
        </p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn sm"
            onClick={() => run(() => api.reviseSop(actor, sop.id, {}), `${sop.code} bumped to v${sop.version + 1}`)}
          >
            ↑ New version of {sop.code}
          </button>
          <button
            className="btn sm danger"
            onClick={() => {
              if (!confirm(`Delete ${sop.code} — ${sop.title}?\n\nThis removes the SOP and its sign-off records. It can't be undone.`)) return
              run(() => api.deleteSop(actor, sop.id), `${sop.code} deleted`)
            }}
          >
            ✕ Delete SOP
          </button>
        </div>
      </div>
    </details>
  )
}

/* ------------------------------------------------------------- Test board -- */

function TestBoard({ dept, branch, actor }: { dept: Department; branch: Branch; actor: Actor }) {
  const people = staffOf(dept.id, branch.id)
  const tests = testsOf(dept.id, branch.code)
  return (
    <div className="board">
      <div className="board-head">
        <h3>Tests &amp; scores — {dept.name} · {branch.code}</h3>
        <span className="hint">Assign by name · latest score shown</span>
      </div>
      {tests.length === 0 ? (
        <div className="empty-row">No tests for this department at this branch — create one below.</div>
      ) : (
        tests.map((t) => (
          <TestRow key={t.id} test={t} dept={dept} branch={branch} people={people} actor={actor} />
        ))
      )}
    </div>
  )
}

function TestRow({
  test,
  branch,
  people,
  actor,
}: {
  test: Test
  dept: Department
  branch: Branch
  people: Staff[]
  actor: Actor
}) {
  const assignedIds = new Set(read.assignments().filter((a) => a.test_id === test.id).map((a) => a.staff_id))
  const assigned = people.filter((p) => assignedIds.has(p.id))
  const valid = assigned.filter((p) => {
    const c = latestCertification(p.id, test.id)
    return c && certStatus(c) === 'valid'
  }).length
  const fails = assigned.filter((p) => {
    const h = attemptsFor(p.id, test.id)
    return h.length && !h[0].passed
  })
  const qCount = read.questionsFor(test.id).length

  return (
    <div className="brow">
      <div className="brow-top">
        <span className="brow-title">
          {test.title} <span className="ver">{qCount} Qs · pass {test.pass_mark}%</span>
          {test.status === 'draft' && <span className="vidchip" style={{ marginLeft: 6 }}>DRAFT</span>}
        </span>
        <span className={`brow-frac ${valid === assigned.length && assigned.length > 0 ? 'full' : 'gap'}`}>
          {valid}/{assigned.length} certified
        </span>
      </div>

      {assigned.length === 0 ? (
        <div className="names"><span className="nm">Nobody assigned yet</span></div>
      ) : (
        <div className="names">
          {assigned.map((p) => {
            const c = latestCertification(p.id, test.id)
            const last = attemptsFor(p.id, test.id)[0]
            const sc = last ? ` · ${last.score}/${last.total}` : ''
            if (!c) return <span key={p.id} className={`nm ${last && !last.passed ? 'bad' : ''}`}>{p.name}{sc || ' · not attempted'}</span>
            const s = certStatus(c)
            if (s === 'valid') return <span key={p.id} className="nm ok">✓ {p.name}{sc} · until {fmtD(c.expires_at)}</span>
            if (s === 'expiring_soon') return <span key={p.id} className="nm warn">⚠ {p.name}{sc} · {daysUntil(c.expires_at)} d left</span>
            return <span key={p.id} className="nm bad">✗ {p.name}{sc} · expired</span>
          })}
        </div>
      )}

      {fails.length > 0 && (
        <div className="names" style={{ alignItems: 'center' }}>
          <span className="nm" style={{ border: 'none', background: 'none', paddingLeft: 0 }}>Retest approval:</span>
          {fails.map((p) =>
            openGrant(p.id, test.id) ? (
              <span key={p.id} className="nm ok">✓ {p.name} — approved, awaiting attempt</span>
            ) : (
              <button
                key={p.id}
                className="btn sm"
                onClick={() => run(() => api.grantRetest(actor, test.id, p.id), `Retest approved for ${p.name}`)}
              >
                Allow {p.name}
              </button>
            ),
          )}
        </div>
      )}

      {test.status === 'draft' ? (
        <details className="inline">
          <summary>Review &amp; publish this draft</summary>
          <div style={{ marginTop: 8 }}>
            <p className="demo-hint" style={{ marginTop: 0 }}>{qCount} question(s) in this draft.</p>
            <button className="btn sm primary" onClick={() => run(() => api.publishTest(actor, test.id), 'Test published')}>
              Publish test
            </button>
          </div>
        </details>
      ) : (
        <AssignPanel test={test} people={people} branch={branch} actor={actor} assignedIds={assignedIds} />
      )}

      <details className="inline">
        <summary>Manage this test</summary>
        <div style={{ marginTop: 8 }}>
          <p className="demo-hint" style={{ marginTop: 0 }}>
            Deleting removes this test and everything tied to it — its questions, assignments, attempts,
            certifications and retest approvals. This can't be undone.
          </p>
          <button
            className="btn sm danger"
            onClick={() => {
              if (!confirm(`Delete the test "${test.title}"?\n\nThis also removes every assignment, attempt and certificate for it. It can't be undone.`)) return
              run(() => api.deleteTest(actor, test.id), `"${test.title}" deleted`)
            }}
          >
            ✕ Delete test
          </button>
        </div>
      </details>
    </div>
  )
}

function AssignPanel({
  test,
  people,
  actor,
  assignedIds,
}: {
  test: Test
  people: Staff[]
  branch: Branch
  actor: Actor
  assignedIds: Set<string>
}) {
  return (
    <details className="inline">
      <summary>Assign staff by name</summary>
      <div className="asgn">
        {people.length === 0 ? (
          <span className="nm">No staff in this department here</span>
        ) : (
          people.map((p) => {
            const on = assignedIds.has(p.id)
            return (
              <button
                key={p.id}
                className={`nm ${on ? 'ok' : ''}`}
                style={{ cursor: 'pointer' }}
                onClick={() =>
                  run(
                    () => (on ? api.unassignTest(actor, test.id, p.id) : api.assignTest(actor, test.id, p.id)),
                    on ? `${p.name} unassigned` : `${p.name} assigned`,
                  )
                }
              >
                {on ? '✓ ' : '+ '}{p.name}
              </button>
            )
          })
        )}
      </div>
    </details>
  )
}

/* --------------------------------------------------------------- add SOP -- */

interface Upload {
  name: string
  size: number
  /** blob: URL for the in-portal preview (session only). */
  src: string
  /** The actual file, sent to the upload function in Supabase mode. */
  file: File
}

/**
 * Add an SOP by uploading its document (PDF) and an optional training video, and
 * choosing which Drive folder they go into. In production these files are pushed
 * to the chosen folder by the upload-sop Edge Function (view-only), which stores
 * the returned file ids on the SOP. In the demo they are previewed inline so the
 * whole flow is visible without a backend.
 */
function AddSopForm({
  dept,
  branch,
  actor,
  lockBranch,
}: {
  dept: Department
  branch: Branch
  actor: Actor
  lockBranch: boolean
}) {
  const [folders, setFolders] = useState<Array<{ id: string; name: string }>>(DRIVE_DEPARTMENT_FOLDERS)
  const defaultFolder =
    DRIVE_DEPARTMENT_FOLDERS.find((f) => f.name === dept.name)?.id ?? DRIVE_DEPARTMENT_FOLDERS[0]?.id ?? ''
  const [title, setTitle] = useState('')
  const [code, setCode] = useState('')
  const [folderId, setFolderId] = useState(defaultFolder)
  const [pdf, setPdf] = useState<Upload | null>(null)
  const [video, setVideo] = useState<Upload | null>(null)
  const [allBranches, setAllBranches] = useState(false)
  const [busy, setBusy] = useState(false)
  const [newFolder, setNewFolder] = useState('')
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [creatingFolder, setCreatingFolder] = useState(false)

  // Load the live Drive folders (falls back to the known department folders).
  useEffect(() => {
    let active = true
    listDriveFolders().then((list) => {
      if (!active || !list.length) return
      setFolders(list)
      setFolderId((cur) => (list.some((f) => f.id === cur) ? cur : list.find((f) => f.name === dept.name)?.id ?? list[0].id))
    })
    return () => {
      active = false
    }
  }, [dept.name])

  async function addFolder() {
    if (!newFolder.trim()) return
    setCreatingFolder(true)
    try {
      const folder = await createDriveFolder(newFolder)
      setFolders((prev) => (prev.some((f) => f.id === folder.id) ? prev : [...prev, folder].sort((a, b) => a.name.localeCompare(b.name))))
      setFolderId(folder.id)
      setNewFolder('')
      setShowNewFolder(false)
      toast(`Folder "${folder.name}" ready`)
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not create the folder.')
    } finally {
      setCreatingFolder(false)
    }
  }

  function onPdf(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) { toast('Upload a PDF file'); e.target.value = ''; return }
    setPdf({ name: f.name, size: f.size, src: URL.createObjectURL(f), file: f })
  }

  function onVideo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    if (!f.type.startsWith('video/')) { toast('Upload a video file'); e.target.value = ''; return }
    setVideo({ name: f.name, size: f.size, src: URL.createObjectURL(f), file: f })
  }

  async function submit() {
    if (!title.trim()) { toast('Give the SOP a title first'); return }
    if (!pdf) { toast('Upload the SOP document (PDF) first'); return }
    setBusy(true)
    const scope: BranchScope = lockBranch || !allBranches ? { kind: 'LIST', branch_codes: [branch.code] } : { kind: 'ALL' }
    const folderName = DRIVE_DEPARTMENT_FOLDERS.find((f) => f.id === folderId)?.name ?? 'the folder'
    try {
      if (isSupabaseEnabled) {
        // Real upload: the Edge Function pushes the files to Drive and inserts the SOP.
        await uploadSopViaFunction(
          { title, code: code || undefined, department_id: dept.id, branch_scope: scope, folder_id: folderId },
          pdf.file,
          video?.file ?? null,
        )
        toast(`Uploaded to ${folderName} and published — matching ${dept.name} staff notified`)
      } else {
        const s = await api.publishSop(actor, {
          title,
          summary: '',
          department_id: dept.id,
          branch_scope: scope,
          code: code || undefined,
          document_file_id: pdf.src,
          video_file_id: video?.src ?? null,
        })
        toast(`Published as ${s.code} into ${folderName} — matching ${dept.name} staff notified`)
      }
      setTitle(''); setCode(''); setPdf(null); setVideo(null)
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not publish.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className="board">
      <summary>Add SOP<span className="hint">upload document + video · to {dept.name}{lockBranch ? ` · ${branch.code} only` : ''}</span></summary>
      <div className="card-body">
        {isSupabaseEnabled && (
          <div className="notice info" style={{ marginBottom: 14 }}>
            The document and video upload to your locked Drive folder through the upload function — deploy it (see
            supabase/SETUP.md) to save against your live database.
          </div>
        )}

        <div className="field"><label htmlFor="f-title">Title</label>
          <input id="f-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Guest Complaint Handling" /></div>
        <div className="field"><label htmlFor="f-code">SOP code — blank = auto</label>
          <input id="f-code" type="text" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} style={{ textTransform: 'uppercase' }} placeholder={`${dept.code}-00X`} /></div>

        <div className="field">
          <label>SOP document (PDF)</label>
          {pdf ? (
            <div className="pdfchip">
              <span className="mono">📄 {pdf.name}</span>
              <span className="mono" style={{ color: 'var(--ink-faint)' }}>{(pdf.size / 1024).toFixed(0)} KB</span>
              <button className="btn sm" onClick={() => setPdf(null)}>✕ Remove</button>
            </div>
          ) : (
            <input type="file" accept="application/pdf,.pdf" onChange={onPdf} />
          )}
        </div>

        <div className="field">
          <label>Training video (optional)</label>
          {video ? (
            <div className="pdfchip">
              <span className="mono">🎬 {video.name}</span>
              <span className="mono" style={{ color: 'var(--ink-faint)' }}>{(video.size / 1024 / 1024).toFixed(1)} MB</span>
              <button className="btn sm" onClick={() => setVideo(null)}>✕ Remove</button>
            </div>
          ) : (
            <input type="file" accept="video/*" onChange={onVideo} />
          )}
        </div>

        <div className="field">
          <label htmlFor="f-folder">Destination folder in Drive</label>
          <div className="row" style={{ gap: 8, alignItems: 'stretch' }}>
            <select id="f-folder" style={{ flex: 1 }} value={folderId} onChange={(e) => setFolderId(e.target.value)}>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>Hamsun_SOP / {f.name}</option>
              ))}
            </select>
            <button type="button" className="btn sm" onClick={() => setShowNewFolder((v) => !v)}>
              ＋ New folder
            </button>
          </div>
          {showNewFolder && (
            <div className="linkedit" style={{ marginTop: 8 }}>
              <input
                type="text"
                value={newFolder}
                onChange={(e) => setNewFolder(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addFolder() } }}
                placeholder="New folder name, e.g. Kitchen · Food Safety"
              />
              <button type="button" className="btn sm primary" disabled={creatingFolder || !newFolder.trim()} onClick={() => void addFolder()}>
                {creatingFolder ? <span className="spinner" /> : 'Create'}
              </button>
            </div>
          )}
          <div className="demo-hint">Files land here view-only inside the Hamsun_SOP folder. The viewer streams them; no downloads.</div>
        </div>

        {lockBranch ? (
          <div className="field"><label>Scope</label>
            <div style={{ fontSize: 13.5 }}>{dept.name} · {branch.code} only — managers publish to their own department at their branch.</div></div>
        ) : (
          <div className="field"><label>Scope</label>
            <div className="radio-row">
              <label><input type="radio" name="f-scope" checked={!allBranches} onChange={() => setAllBranches(false)} /> {branch.code} only</label>
              <label><input type="radio" name="f-scope" checked={allBranches} onChange={() => setAllBranches(true)} /> All branches</label>
            </div></div>
        )}
        <button className="btn primary block" disabled={busy} onClick={() => void submit()}>
          {busy ? <span className="spinner" /> : `Upload & publish to ${dept.name}`}
        </button>
      </div>
    </details>
  )
}

/* ------------------------------------------------------------ create test -- */

function CreateTestForm({
  dept,
  branch,
  actor,
  lockBranch,
}: {
  dept: Department
  branch: Branch
  actor: Actor
  lockBranch: boolean
}) {
  const deptSops = useMemo(() => sopsOf(dept.id, branch.code), [dept.id, branch.code, read.sops()])
  const [genSop, setGenSop] = useState('')
  const [level, setLevel] = useState<Difficulty>('medium')
  const [count, setCount] = useState('5')
  const [genBusy, setGenBusy] = useState(false)
  const [draft, setDraft] = useState<DraftQuestion[]>([])
  const [warnings, setWarnings] = useState<string[]>([])

  const [title, setTitle] = useState('')
  const [pass, setPass] = useState('80')
  const [valid, setValid] = useState('12')
  const [relSop, setRelSop] = useState('')
  const [allBranches, setAllBranches] = useState(false)
  const [langs, setLangs] = useState<{ ur: boolean; ps: boolean }>({ ur: false, ps: false })
  const [pubBusy, setPubBusy] = useState(false)

  // manual question entry
  const [qText, setQText] = useState('')
  const [opts, setOpts] = useState(['', '', '', ''])
  const [ans, setAns] = useState(0)

  async function generate() {
    if (!genSop) { toast('Choose a source SOP first'); return }
    setGenBusy(true)
    try {
      const res = await api.generateTestDraft(actor, {
        sopId: genSop,
        difficulty: level,
        count: Math.min(6, Math.max(3, parseInt(count) || 5)),
      })
      if (res.questions.length === 0) { toast('The generator returned nothing usable — add questions by hand'); setWarnings(res.warnings) }
      else {
        setDraft((d) => [...d, ...res.questions])
        setWarnings(res.warnings)
        toast(`Generated ${res.questions.length} ${level}-level questions — review before publishing`)
      }
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Generation failed — add questions manually.')
    } finally {
      setGenBusy(false)
    }
  }

  function addManual() {
    if (!qText.trim() || opts.some((o) => !o.trim())) { toast('Fill the question and all four options'); return }
    setDraft((d) => [...d, { text: qText.trim(), options: opts.map((o) => o.trim()), correct_index: ans }])
    setQText(''); setOpts(['', '', '', '']); setAns(0)
    toast('Question added')
  }

  async function publish() {
    if (!title.trim()) { toast('Give the test a title'); return }
    if (draft.length < 3) { toast('Add at least 3 questions first'); return }
    setPubBusy(true)
    const scope: BranchScope = lockBranch || !allBranches ? { kind: 'LIST', branch_codes: [branch.code] } : { kind: 'ALL' }
    const wanted: Language[] = (['ur', 'ps'] as const).filter((l) => langs[l])
    try {
      const test = await api.createTest(actor, {
        title,
        department_id: dept.id,
        branch_scope: scope,
        related_sop_id: relSop || null,
        pass_mark: Math.min(100, Math.max(1, parseInt(pass) || 80)),
        validity_months: Math.min(60, Math.max(1, parseInt(valid) || 12)),
        languages: ['en', ...wanted],
      })
      await api.replaceQuestions(actor, test.id, draft)
      if (wanted.length) await api.translateTest(actor, test.id, wanted)
      await api.publishTest(actor, test.id)
      toast(`Test published${wanted.length ? ' with translations' : ''} — now assign staff by name`)
      setDraft([]); setTitle(''); setWarnings([])
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not publish.')
    } finally {
      setPubBusy(false)
    }
  }

  return (
    <details className="board" open={draft.length > 0}>
      <summary>Create a test<span className="hint">for {dept.name}{lockBranch ? ` · ${branch.code} only` : ''}</span></summary>
      <div className="card-body">
        <div className="genblock">
          <div className="gh">✦ Generate the test from an SOP</div>
          <div className="gs">
            Claude reads the SOP and drafts the questions at your chosen level. You stay the examiner — review every
            question and its marked answer before publishing. In production the portal fetches the document from Drive
            itself.
          </div>
          <div className="fieldrow">
            <div className="field"><label htmlFor="g-sop">Source SOP</label>
              <select id="g-sop" value={genSop} onChange={(e) => setGenSop(e.target.value)}>
                <option value="">— choose —</option>
                {deptSops.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.title}</option>)}
              </select></div>
          </div>
          <div className="fieldrow">
            <div className="field"><label htmlFor="g-level">Difficulty</label>
              <select id="g-level" value={level} onChange={(e) => setLevel(e.target.value as Difficulty)}>
                <option value="low">Low — recall the SOP</option>
                <option value="medium">Medium — apply to a scenario</option>
                <option value="high">High — exceptions &amp; judgment</option>
              </select></div>
            <div className="field"><label htmlFor="g-count">Questions (3–6)</label>
              <input id="g-count" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} /></div>
          </div>
          <button className="btn primary block" disabled={genBusy} onClick={() => void generate()}>
            {genBusy ? <><span className="spinner" /> Generating…</> : '✦ Generate questions'}
          </button>
        </div>

        {warnings.length > 0 && (
          <div className="notice" style={{ marginBottom: 12 }}>
            {warnings.length} generated question(s) dropped in validation — {warnings[0]}
          </div>
        )}

        <div className="field"><label htmlFor="t-title">Test title</label>
          <input id="t-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Linen Handling Test" /></div>
        <div className="fieldrow">
          <div className="field"><label htmlFor="t-pass">Pass mark %</label>
            <input id="t-pass" inputMode="numeric" value={pass} onChange={(e) => setPass(e.target.value)} /></div>
          <div className="field"><label htmlFor="t-valid">Cert valid (months)</label>
            <input id="t-valid" inputMode="numeric" value={valid} onChange={(e) => setValid(e.target.value)} /></div>
        </div>
        <div className="field"><label htmlFor="t-sop">Related SOP (optional)</label>
          <select id="t-sop" value={relSop} onChange={(e) => setRelSop(e.target.value)}>
            <option value="">— none —</option>
            {deptSops.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.title}</option>)}
          </select></div>
        {!lockBranch && (
          <div className="field"><label>Scope</label>
            <div className="radio-row">
              <label><input type="radio" name="t-scope" checked={!allBranches} onChange={() => setAllBranches(false)} /> {branch.code} only</label>
              <label><input type="radio" name="t-scope" checked={allBranches} onChange={() => setAllBranches(true)} /> All branches</label>
            </div></div>
        )}
        <div className="field"><label>Test languages</label>
          <div className="radio-row">
            <label><input type="checkbox" checked disabled /> English — record copy</label>
            <label><input type="checkbox" checked={langs.ur} onChange={(e) => setLangs({ ...langs, ur: e.target.checked })} /> اردو Urdu</label>
            <label><input type="checkbox" checked={langs.ps} onChange={(e) => setLangs({ ...langs, ps: e.target.checked })} /> پښتو Pashto</label>
          </div>
          <div className="demo-hint">Extra languages are auto-translated when you publish — review them like any controlled content. English remains the record copy; scoring is identical in every language.</div>
        </div>

        <div className="field"><label>Questions in draft ({draft.length})</label>
          {draft.length ? (
            draft.map((q, i) => (
              <div className="qb-item" key={i}>
                <span className="n">Q{i + 1}</span>
                <span className="q">{q.text}<br /><span style={{ color: 'var(--pine)', fontSize: 12 }}>✓ {q.options[q.correct_index]}</span></span>
                <button onClick={() => setDraft((d) => d.filter((_, idx) => idx !== i))}>remove</button>
              </div>
            ))
          ) : (
            <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>Generate above, or add at least 3 questions manually below.</div>
          )}
        </div>

        <div className="field"><label htmlFor="q-text">New question</label>
          <input id="q-text" type="text" value={qText} onChange={(e) => setQText(e.target.value)} placeholder="Question text" /></div>
        {[0, 1, 2, 3].map((i) => (
          <div className="field" style={{ marginBottom: 8 }} key={i}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>Option {i + 1}
              <span style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>
                <input type="radio" name="q-ans" checked={ans === i} onChange={() => setAns(i)} /> correct
              </span></label>
            <input type="text" value={opts[i]} onChange={(e) => setOpts(opts.map((o, idx) => (idx === i ? e.target.value : o)))} placeholder={`Option ${i + 1}`} />
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '6px 0 14px' }}>
          <button className="btn sm" onClick={addManual}>＋ Add question</button>
        </div>

        <button className="btn primary block" disabled={pubBusy} onClick={() => void publish()}>
          {pubBusy ? <><span className="spinner" /> Publishing…</> : 'Publish test'}
        </button>
        <div className="demo-hint">After publishing, open "Assign staff by name" on the test to choose who takes it.</div>
      </div>
    </details>
  )
}

/* ------------------------------------------------------------- admin org -- */

function AdminOrg({ actor, dept, branch }: { actor: Actor; dept: Department; branch: Branch }) {
  return (
    <>
      <StaffRoster actor={actor} dept={dept} branch={branch} />
      <AddStaff actor={actor} dept={dept} branch={branch} />
      <ManagerRoster actor={actor} dept={dept} branch={branch} />
      <AddManager actor={actor} dept={dept} branch={branch} />
      <AddBranch actor={actor} />
      <AddDepartment actor={actor} />
    </>
  )
}

/* ---- staff roster: reveal a new code, deactivate / reactivate ---- */

function StaffRoster({ actor, dept, branch }: { actor: Actor; dept: Department; branch: Branch }) {
  const people = read
    .staff()
    .filter((s) => s.department_id === dept.id && s.branch_id === branch.id)
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
  const [reveal, setReveal] = useState<{ id: string; code: string } | null>(null)

  return (
    <details className="board">
      <summary>Staff — {dept.name} · {branch.code}<span className="hint">{people.length} on file</span></summary>
      <div className="card-body">
        {people.length === 0 ? (
          <div className="empty-row">No staff here yet — add one below.</div>
        ) : (
          people.map((s) => (
            <div className="brow" key={s.id}>
              <div className="brow-top">
                <span className="brow-title">
                  {s.name} <span className="ver">{s.job_title}</span>
                  {!s.active && <span className="vidchip" style={{ marginLeft: 6 }}>INACTIVE</span>}
                </span>
              </div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                <button
                  className="btn sm"
                  onClick={() =>
                    run(async () => {
                      const code = await api.regenerateStaffCode(actor, s.id)
                      setReveal({ id: s.id, code })
                    })
                  }
                >
                  ↻ New code
                </button>
                <button
                  className="btn sm"
                  onClick={() =>
                    run(
                      () => api.setStaffActive(actor, s.id, !s.active),
                      s.active ? `${s.name} deactivated` : `${s.name} reactivated`,
                    )
                  }
                >
                  {s.active ? 'Deactivate' : 'Reactivate'}
                </button>
              </div>
              {reveal?.id === s.id && (
                <div className="notice info" style={{ marginTop: 8 }}>
                  New employee code for <strong>{s.name}</strong>: <span className="mono">{reveal.code}</span> — share it
                  privately. It won't be shown again.{' '}
                  <button className="btn sm" style={{ marginLeft: 6 }} onClick={() => setReveal(null)}>Done</button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </details>
  )
}

function AddStaff({ actor, dept, branch }: { actor: Actor; dept: Department; branch: Branch }) {
  const [name, setName] = useState('')
  const [deptId, setDeptId] = useState(dept.id)
  const [branchId, setBranchId] = useState(branch.id)
  const [job, setJob] = useState('')
  const [busy, setBusy] = useState(false)
  const [issued, setIssued] = useState<{ name: string; code: string } | null>(null)

  return (
    <details className="board">
      <summary>Add staff member<span className="hint">code auto-generated</span></summary>
      <div className="card-body">
        <div className="field"><label>Name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Areeba" /></div>
        <div className="field"><label>Job title</label><input value={job} onChange={(e) => setJob(e.target.value)} placeholder="e.g. Room Attendant" /></div>
        <div className="fieldrow">
          <div className="field"><label>Department</label>
            <select value={deptId} onChange={(e) => setDeptId(e.target.value)}>{read.departments().map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
          <div className="field"><label>Branch</label>
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)}>{read.branches().map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}</select></div>
        </div>
        <button
          className="btn primary block"
          disabled={busy}
          onClick={async () => {
            if (!name.trim()) { toast('Enter the staff member’s name'); return }
            setBusy(true)
            try {
              const { code } = await api.addStaff(actor, { name, department_id: deptId, branch_id: branchId, job_title: job })
              setIssued({ name: name.trim(), code })
              toast(`${name} added`)
              setName(''); setJob('')
            } catch (e) {
              toast(e instanceof ApiError ? e.message : 'Could not add staff.')
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? <span className="spinner" /> : 'Add staff'}
        </button>
        {issued && (
          <div className="notice info" style={{ marginTop: 12 }}>
            <strong>{issued.name}</strong> added. Employee code: <span className="mono">{issued.code}</span> — share it
            privately; it won't be shown again.{' '}
            <button className="btn sm" style={{ marginLeft: 6 }} onClick={() => setIssued(null)}>Done</button>
          </div>
        )}
      </div>
    </details>
  )
}

/* ---- manager roster: reassign posting, disable / enable, delete ---- */

function ManagerRoster({ actor, dept, branch }: { actor: Actor; dept: Department; branch: Branch }) {
  const managers = read
    .managers()
    .filter((m) => m.department_id === dept.id && m.branch_id === branch.id)
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <details className="board">
      <summary>Managers — {dept.name} · {branch.code}<span className="hint">{managers.length} with access</span></summary>
      <div className="card-body">
        {managers.length === 0 ? (
          <div className="empty-row">No manager has access here yet — add one below.</div>
        ) : (
          managers.map((m) => <ManagerRow key={m.id} actor={actor} manager={m} />)
        )}
      </div>
    </details>
  )
}

function ManagerRow({ actor, manager }: { actor: Actor; manager: Manager }) {
  const [deptId, setDeptId] = useState(manager.department_id)
  const [branchId, setBranchId] = useState(manager.branch_id)
  const dirty = deptId !== manager.department_id || branchId !== manager.branch_id

  return (
    <div className="brow">
      <div className="brow-top">
        <span className="brow-title">
          {manager.name} <span className="ver mono">{manager.email}</span>
          {!manager.active && <span className="vidchip" style={{ marginLeft: 6 }}>DISABLED</span>}
        </span>
      </div>
      <div className="fieldrow" style={{ marginTop: 6 }}>
        <div className="field"><label>Department</label>
          <select value={deptId} onChange={(e) => setDeptId(e.target.value)}>{read.departments().map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
        <div className="field"><label>Branch</label>
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)}>{read.branches().map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}</select></div>
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button
          className="btn sm primary"
          disabled={!dirty}
          onClick={() => run(() => api.updateManager(actor, manager.id, { department_id: deptId, branch_id: branchId }), `${manager.name} reassigned`)}
        >
          Save posting
        </button>
        <button
          className="btn sm"
          onClick={() => run(() => api.updateManager(actor, manager.id, { active: !manager.active }), manager.active ? `${manager.name} disabled` : `${manager.name} enabled`)}
        >
          {manager.active ? 'Disable login' : 'Enable login'}
        </button>
        <button
          className="btn sm danger"
          onClick={() => {
            if (!confirm(`Delete manager ${manager.name} (${manager.email})?\n\nThis removes their login for good. It can't be undone.`)) return
            run(() => api.deleteManager(actor, manager.id), `${manager.name} deleted`)
          }}
        >
          ✕ Delete
        </button>
      </div>
    </div>
  )
}

function AddManager({ actor, dept, branch }: { actor: Actor; dept: Department; branch: Branch }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [deptId, setDeptId] = useState(dept.id)
  const [branchId, setBranchId] = useState(branch.id)
  const [busy, setBusy] = useState(false)
  const [issued, setIssued] = useState<{ name: string; email: string; password: string | null } | null>(null)

  return (
    <details className="board">
      <summary>Add department manager<span className="hint">creates their sign-in</span></summary>
      <div className="card-body">
        <div className="field"><label>Name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Faisal" /></div>
        <div className="field"><label>Email (their Supabase Auth login)</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@hamsun.example" /></div>
        <div className="field"><label>Temporary password — blank = auto-generate</label>
          <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="at least 8 characters, or leave blank" /></div>
        <div className="fieldrow">
          <div className="field"><label>Department</label>
            <select value={deptId} onChange={(e) => setDeptId(e.target.value)}>{read.departments().map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
          <div className="field"><label>Branch</label>
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)}>{read.branches().map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}</select></div>
        </div>
        <button
          className="btn primary block"
          disabled={busy}
          onClick={async () => {
            if (!name.trim()) { toast('Enter the manager’s name'); return }
            setBusy(true)
            try {
              const { password: pw } = await api.addManager(actor, {
                name,
                email,
                department_id: deptId,
                branch_id: branchId,
                password: password || undefined,
              })
              setIssued({ name: name.trim(), email: email.trim().toLowerCase(), password: pw })
              toast(`${name} added as ${read.department(deptId)?.name} manager`)
              setName(''); setEmail(''); setPassword('')
            } catch (e) {
              toast(e instanceof ApiError ? e.message : 'Could not add manager.')
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? <span className="spinner" /> : 'Add manager'}
        </button>
        {issued && (
          <div className="notice info" style={{ marginTop: 12 }}>
            <strong>{issued.name}</strong> can sign in at <span className="mono">{issued.email}</span>
            {issued.password ? (
              <> with password <span className="mono">{issued.password}</span> — share it privately; it won't be shown again.</>
            ) : (
              <> with the password you set.</>
            )}{' '}
            <button className="btn sm" style={{ marginLeft: 6 }} onClick={() => setIssued(null)}>Done</button>
          </div>
        )}
      </div>
    </details>
  )
}

function AddBranch({ actor }: { actor: Actor }) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  return (
    <details className="board">
      <summary>Add branch</summary>
      <div className="card-body">
        <div className="field"><label>Branch code</label><input maxLength={4} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} style={{ textTransform: 'uppercase' }} placeholder="e.g. GLB" /></div>
        <div className="field"><label>Branch name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Gulberg" /></div>
        <button
          className="btn primary block"
          onClick={() =>
            run(async () => {
              await api.addBranch(actor, code, name, 'open')
              setCode(''); setName('')
            }, `Branch ${code} added — "all branches" SOPs and tests apply to it automatically`)
          }
        >
          Add branch
        </button>
      </div>
    </details>
  )
}

function AddDepartment({ actor }: { actor: Actor }) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  return (
    <details className="board">
      <summary>Add department</summary>
      <div className="card-body">
        <div className="field"><label>Code (2–4 letters)</label><input maxLength={4} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} style={{ textTransform: 'uppercase' }} placeholder="e.g. SP" /></div>
        <div className="field"><label>Department name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Spa" /></div>
        <button
          className="btn primary block"
          onClick={() =>
            run(async () => {
              await api.addDepartment(actor, code, name)
              setCode(''); setName('')
            }, 'Department added — now add its staff, SOPs and tests')
          }
        >
          Add department
        </button>
      </div>
    </details>
  )
}
