import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  api,
  read,
  eligibleStaffFor,
  hasSigned,
  acknowledgmentFor,
  attemptsFor,
  assignedTestsFor,
  latestCertification,
  openGrant,
  uploadSopViaFunction,
  attachSopVideo,
  removeSopVideo,
  downloadTestReport,
  orgStaffDirectory,
  listDriveFolders,
  createDriveFolder,
  getSopFormat,
  setSopFormat,
  clearSopFormat,
  driveFileViewLink,
  ApiError,
} from '../data/store'
import type { Actor, DraftQuestion, OrgStaff, SopFormat } from '../data/store'
import { generateSopDocx, sopContentHtml, sopNumber, SOP_DOCX_MIME } from '../lib/sopdoc'
import { SopEditor } from '../components/SopEditor'
import type { Editor } from '@tiptap/react'
import type { Branch, BranchScope, Department, Difficulty, Language, Manager, Sop, Staff, Test } from '../types'
import { LANGUAGE_NAMES } from '../types'
import { scopeIncludes } from '../lib/scope'
import { certStatus, daysUntil } from '../lib/certs'
import { fmtD } from '../lib/format'
import { toast } from '../lib/toast'
import { isSupabaseEnabled } from '../lib/supabase'
import { DRIVE_DEPARTMENT_FOLDERS } from '../lib/drive'
import { Viewer } from '../components/Viewer'
import {
  SopSectionIcon,
  TestSectionIcon,
  StaffSectionIcon,
  ManagerSectionIcon,
  AddSectionIcon,
  BranchSectionIcon,
  DepartmentSectionIcon,
} from '../components/icons'

/**
 * Manager / admin portal, in the prototype's board style. A manager is pinned to
 * her own department at her own branch; an admin picks any branch + department
 * and also manages the org. The boards and forms are the same; only the scope
 * and the extra admin sections differ.
 */
type Page = 'home' | 'sops' | 'tests' | 'staff' | 'managers' | 'branches' | 'departments'

export function ManagerPortal({ actor, onLogout }: { actor: Actor; onLogout: () => void }) {
  const isAdmin = actor.kind === 'admin'
  const branches = read.branches()
  const departments = read.departments()

  // A manager runs her whole department across every branch, so she gets a
  // branch selector too (department locked to hers); an admin picks both.
  const managerHomeBranchCode = actor.kind === 'manager' ? read.branch(actor.manager.branch_id)?.code ?? '' : ''
  const [aBranch, setABranch] = useState(isAdmin ? branches[0]?.code ?? '' : managerHomeBranchCode || branches[0]?.code || '')
  const [aDept, setADept] = useState(departments[0]?.id ?? '')
  const [viewer, setViewer] = useState<{ sop: Sop; kind: 'doc' | 'video' } | null>(null)
  const [page, setPage] = useState<Page>('home')
  const [formatOpen, setFormatOpen] = useState(false)

  const branch = read.branchByCode(aBranch)
  const dept = isAdmin ? read.department(aDept) : read.department(actor.manager.department_id)

  if (!branch || !dept) return <div className="allclear">No branches or departments yet.</div>

  // SOPs and managers are one-per-department across every branch (branch-
  // independent); staff belong to a branch. So SOP/manager counts are
  // department-wide, staff counts are for the branch being viewed.
  const staffCount = read.staff().filter((s) => s.department_id === dept.id && s.branch_id === branch.id).length
  const mgrCount = read.managers().filter((m) => m.department_id === dept.id).length
  const sopCount = deptSopsAll(dept.id).length
  const testCount = isAdmin ? testsOf(dept.id, branch.code).length : deptTestsAll(dept.id).length

  type TileDef = { key: Page; icon: ReactNode; title: string; sub: string }
  const sopTile: TileDef = { key: 'sops', icon: <SopSectionIcon />, title: 'SOPs', sub: `${sopCount} · every branch · sign-off` }
  const testTile: TileDef = { key: 'tests', icon: <TestSectionIcon />, title: 'Tests & scores', sub: isAdmin ? `${testCount} · assign & score` : `${testCount} · every branch · assign & score` }
  const staffTile: TileDef = { key: 'staff', icon: <StaffSectionIcon />, title: 'Staff', sub: isAdmin ? `${staffCount} here · add & codes` : `${staffCount} here · codes` }
  const managerTile: TileDef = { key: 'managers', icon: <ManagerSectionIcon />, title: 'Managers', sub: `${mgrCount} · every branch · access` }
  const branchTile: TileDef = { key: 'branches', icon: <BranchSectionIcon />, title: 'Branches', sub: `${branches.length} · add, rename, status` }
  const deptTile: TileDef = { key: 'departments', icon: <DepartmentSectionIcon />, title: 'Departments', sub: `${departments.length} · add, rename, delete` }

  const renderTile = (t: TileDef) => (
    <button key={t.key} className="mtile" onClick={() => setPage(t.key)}>
      <span className="mtile-ico">{t.icon}</span>
      <span className="mtile-body">
        <span className="mtile-title">{t.title}</span>
        <span className="mtile-sub">{t.sub}</span>
      </span>
      <span className="mtile-go" aria-hidden>›</span>
    </button>
  )

  // Not a page — opens a popup. The one SOP format template is the same for
  // every branch, so it sits with the branch-independent tiles.
  const formatTile = (
    <button className="mtile" onClick={() => setFormatOpen(true)}>
      <span className="mtile-ico"><SopSectionIcon /></span>
      <span className="mtile-body">
        <span className="mtile-title">SOP format</span>
        <span className="mtile-sub">{isAdmin ? 'upload the template managers write in' : 'the template to write your SOPs in'}</span>
      </span>
      <span className="mtile-go" aria-hidden>⤢</span>
    </button>
  )

  // The "Viewing branch" picker only matters for branch-dependent views: the
  // staff roster (staff belong to a branch) and, for an admin, test scores.
  const showBranchOnPage = page !== 'home' && (page === 'staff' || (isAdmin && page === 'tests'))
  const branchSelect = (
    <div className="filters">
      <div className="field">
        <label htmlFor="m-branch">Viewing branch</label>
        <select id="m-branch" value={aBranch} onChange={(e) => setABranch(e.target.value)}>
          {branches.map((b) => (
            <option key={b.id} value={b.code}>{b.code} — {b.name}</option>
          ))}
        </select>
      </div>
    </div>
  )

  return (
    <>
      {isAdmin ? (
        <div className="filters">
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
          <span className="here">all branches</span>
          <span className="who">
            <button onClick={onLogout} style={{ color: 'var(--pine)', fontWeight: 600 }}>Sign out</button>
          </span>
        </div>
      )}

      {page === 'home' ? (
        isAdmin ? (
          <>
            {/* Branch-independent: one SOP, one format, the managers, and the
                branch/department setup are the same regardless of which branch
                you're viewing, so they sit above the branch picker. */}
            <div className="mtiles">
              {[sopTile, managerTile].map(renderTile)}
              {formatTile}
              {[branchTile, deptTile].map(renderTile)}
            </div>
            {branchSelect}
            {/* Branch-dependent: staff and test scores for the selected branch. */}
            <div className="mtiles">
              {[testTile, staffTile].map(renderTile)}
            </div>
          </>
        ) : (
          <>
            <div className="mtiles">
              {[sopTile, testTile, staffTile].map(renderTile)}
              {formatTile}
            </div>
            {branchSelect}
            <EmployeeResults dept={dept} branch={branch} />
          </>
        )
      ) : (
        <>
          {showBranchOnPage && branchSelect}
          <button className="btn backbtn" onClick={() => setPage('home')}>← Menu</button>

          {page === 'sops' && (
            <>
              <SopBoard dept={dept} branch={branch} actor={actor} orgWide onOpen={(sop, kind) => setViewer({ sop, kind })} />
              <AddSopForm dept={dept} branch={branch} actor={actor} lockBranch={false} forceAllBranches />
            </>
          )}

          {page === 'tests' && (
            <>
              <TestBoard dept={dept} branch={branch} actor={actor} orgWide={!isAdmin} />
              <CreateTestForm dept={dept} branch={branch} actor={actor} lockBranch={false} forceAllBranches={!isAdmin} />
            </>
          )}

          {page === 'staff' &&
            (isAdmin ? (
              <>
                <StaffRoster actor={actor} dept={dept} branch={branch} />
                <AddStaff actor={actor} dept={dept} branch={branch} />
              </>
            ) : (
              <StaffCodes actor={actor} dept={dept} branch={branch} />
            ))}

          {page === 'managers' && isAdmin && (
            <>
              <ManagerRoster actor={actor} dept={dept} />
              <AddManager actor={actor} dept={dept} branch={branch} />
            </>
          )}

          {page === 'branches' && isAdmin && <BranchAdmin actor={actor} />}
          {page === 'departments' && isAdmin && <DepartmentAdmin actor={actor} />}
        </>
      )}

      {viewer && (
        <Viewer sop={viewer.sop} initialKind={viewer.kind} showViewOnly={false} onClose={() => setViewer(null)} />
      )}
      {formatOpen && <SopFormatModal actor={actor} onClose={() => setFormatOpen(false)} />}
    </>
  )
}

/* ------------------------------------------------------------ SOP format -- */

/**
 * A popup (not a page) for the one org-wide SOP format template. An admin can
 * upload, replace or remove it; a manager can only view/download it, so they
 * know which layout to write their SOPs in. Backed by the sop-format function.
 */
function SopFormatModal({ actor, onClose }: { actor: Actor; onClose: () => void }) {
  const isAdmin = actor.kind === 'admin'
  const [format, setFormat] = useState<SopFormat | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [file, setFile] = useState<File | null>(null)

  useEffect(() => {
    let active = true
    getSopFormat()
      .then((f) => { if (active) setFormat(f) })
      .catch((e) => { if (active) toast(e instanceof ApiError ? e.message : 'Could not load the format.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  async function upload() {
    if (!file) { toast('Choose a file first'); return }
    setBusy(true)
    try {
      const f = await setSopFormat(file)
      setFormat(f)
      setFile(null)
      toast('SOP format uploaded')
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not upload the format.')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!confirm('Remove the SOP format file? Managers will no longer see a template.')) return
    setBusy(true)
    try {
      await clearSopFormat()
      setFormat(null)
      toast('SOP format removed')
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not remove the format.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span><SopSectionIcon /> SOP format</span>
          <button className="v-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="card-body">
          <p className="demo-hint" style={{ marginTop: 0 }}>
            The template document SOPs are written in.{' '}
            {isAdmin ? 'Upload or replace it here — managers can only view it.' : 'Download it to see the required layout.'}
          </p>

          {loading ? (
            <div className="empty-row"><span className="spinner" /> Loading…</div>
          ) : format ? (
            <div className="pdfchip" style={{ marginBottom: 4 }}>
              <span className="mono">📄 {format.name}</span>
              <a className="btn sm primary" href={driveFileViewLink(format.id)} target="_blank" rel="noopener noreferrer">
                View / Download
              </a>
            </div>
          ) : (
            <div className="empty-row">No format uploaded yet{isAdmin ? ' — upload one below.' : '. Ask an admin to add it.'}</div>
          )}

          {isAdmin ? (
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
              <div className="field">
                <label>{format ? 'Replace the format file' : 'Upload a format file'}</label>
                <input
                  type="file"
                  accept=".doc,.docx,.pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button className="btn sm primary" disabled={busy || !file} onClick={() => void upload()}>
                  {busy ? <span className="spinner" /> : format ? 'Replace format' : 'Upload format'}
                </button>
                {format && (
                  <button className="btn sm danger" disabled={busy} onClick={() => void remove()}>
                    Remove format
                  </button>
                )}
              </div>
              <p className="demo-hint" style={{ marginTop: 8 }}>
                Word (.doc/.docx) or PDF. Managers can view and download it but can't change it.
              </p>
            </div>
          ) : (
            <p className="demo-hint" style={{ marginTop: 8 }}>Only an admin can add or change this format.</p>
          )}
        </div>
      </div>
    </div>
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

/* A manager runs one department across every branch: these ignore branch. */
function deptSopsAll(deptId: string): Sop[] {
  return read
    .sops()
    .filter((s) => s.department_id === deptId)
    .sort((a, b) => a.code.localeCompare(b.code))
}

function deptTestsAll(deptId: string): Test[] {
  return read
    .tests()
    .filter((t) => t.department_id === deptId)
    .sort((a, b) => a.title.localeCompare(b.title))
}

function deptStaffAll(deptId: string): Staff[] {
  return read
    .staff()
    .filter((s) => s.department_id === deptId && s.active)
    .sort((a, b) => a.name.localeCompare(b.name))
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
  orgWide,
  onOpen,
}: {
  dept: Department
  branch: Branch
  actor: Actor
  /** Manager view: one department across every branch — ignore the branch. */
  orgWide: boolean
  onOpen: (sop: Sop, kind: 'doc' | 'video') => void
}) {
  const people = orgWide ? deptStaffAll(dept.id) : staffOf(dept.id, branch.id)
  const sops = orgWide ? deptSopsAll(dept.id) : sopsOf(dept.id, branch.code)
  return (
    <details className="board" open>
      <summary><SopSectionIcon />SOP sign-off — {orgWide ? dept.name : `${dept.name} · ${branch.code}`}<span className="hint">{people.length} staff{orgWide ? ' · all branches' : ''}</span></summary>
      {sops.length === 0 ? (
        <div className="empty-row">No SOPs here yet — add one below.</div>
      ) : (
        sops.map((s) => {
          const eligible = orgWide ? eligibleStaffFor(s) : eligibleStaffFor(s).filter((p) => p.branch_id === branch.id)
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
    </details>
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

        <SopVideoControl sop={sop} />
      </div>
    </details>
  )
}

/* ---- add / replace / remove the training video on an existing SOP ---- */

function SopVideoControl({ sop }: { sop: Sop }) {
  const [video, setVideo] = useState<Upload | null>(null)
  const [busy, setBusy] = useState(false)
  const dept = read.department(sop.department_id)
  const fallbackFolder =
    DRIVE_DEPARTMENT_FOLDERS.find((f) => f.name === dept?.name)?.id ?? DRIVE_DEPARTMENT_FOLDERS[0]?.id ?? ''

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    if (!f.type.startsWith('video/')) { toast('Upload a video file'); e.target.value = ''; return }
    setVideo({ name: f.name, size: f.size, src: URL.createObjectURL(f), file: f })
  }

  async function upload() {
    if (!video) { toast('Choose a video file first'); return }
    const replacing = !!sop.video_file_id
    setBusy(true)
    try {
      await attachSopVideo(sop.id, video.file, fallbackFolder)
      toast(replacing ? `Video replaced for ${sop.code}` : `Video added to ${sop.code}`)
      setVideo(null)
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not update the video.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
      <p className="demo-hint" style={{ marginTop: 0 }}>
        Training video (optional) — {sop.video_file_id ? 'one is attached. Upload a new file to replace it.' : 'none yet. Add one any time.'}
      </p>
      {video ? (
        <div className="pdfchip">
          <span className="mono">🎬 {video.name}</span>
          <span className="mono" style={{ color: 'var(--ink-faint)' }}>{(video.size / 1048576).toFixed(1)} MB</span>
          <button className="btn sm" onClick={() => setVideo(null)}>✕ Remove</button>
        </div>
      ) : (
        <input type="file" accept="video/*" onChange={onPick} />
      )}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <button className="btn sm primary" disabled={busy || !video} onClick={() => void upload()}>
          {busy ? <span className="spinner" /> : sop.video_file_id ? 'Replace video' : 'Add video'}
        </button>
        {sop.video_file_id && (
          <button
            className="btn sm"
            disabled={busy}
            onClick={() => {
              if (!confirm(`Remove the training video from ${sop.code}?`)) return
              run(() => removeSopVideo(sop.id), `Video removed from ${sop.code}`)
            }}
          >
            Remove video
          </button>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- Test board -- */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
/** "Fri · 08 Aug 2026" — the day + date a test was set up. */
function dayDate(iso: string): string {
  const d = new Date(iso)
  return `${WEEKDAYS[d.getDay()]} · ${fmtD(d)}`
}

function TestBoard({ dept, branch, actor, orgWide }: { dept: Department; branch: Branch; actor: Actor; orgWide: boolean }) {
  // Every active staff member across all departments/branches — a test can be
  // assigned beyond its own department, so the board and picker work over the
  // whole org, not just this department's people.
  const [everyone, setEveryone] = useState<OrgStaff[]>([])
  useEffect(() => {
    let active = true
    orgStaffDirectory().then((list) => { if (active) setEveryone(list) })
    return () => { active = false }
  }, [])
  const tests = orgWide ? deptTestsAll(dept.id) : testsOf(dept.id, branch.code)
  // The manager sees scores for all branches; the admin sees just the branch
  // she has selected, so the score rows filter to that branch.
  const branchId = orgWide ? undefined : branch.id
  return (
    <details className="board" open>
      <summary><TestSectionIcon />Tests &amp; scores — {orgWide ? dept.name : `${dept.name} · ${branch.code}`}<span className="hint">{orgWide ? 'Assign anyone · latest score shown' : `scores for ${branch.code}`}</span></summary>
      {tests.length === 0 ? (
        <div className="empty-row">No tests for this department{orgWide ? '' : ' at this branch'} — create one below.</div>
      ) : (
        tests.map((t, i) => <TestRow key={t.id} test={t} index={i + 1} people={everyone} actor={actor} branchId={branchId} />)
      )}
    </details>
  )
}

function TestRow({
  test,
  index,
  people,
  actor,
  branchId,
}: {
  test: Test
  /** 1-based position in the board, shown as "1.", "2." … */
  index: number
  people: OrgStaff[]
  actor: Actor
  /** When set (admin viewing one branch), show only that branch's scores. */
  branchId?: string
}) {
  const assignedIds = new Set(read.assignments().filter((a) => a.test_id === test.id).map((a) => a.staff_id))
  const assignedAll = people.filter((p) => assignedIds.has(p.id))
  const assigned = branchId ? assignedAll.filter((p) => p.branch_id === branchId) : assignedAll
  const valid = assigned.filter((p) => {
    const c = latestCertification(p.id, test.id)
    return c && certStatus(c) === 'valid'
  }).length
  const fails = assigned.filter((p) => {
    const h = attemptsFor(p.id, test.id)
    return h.length && !h[0].passed
  })
  const qCount = read.questionsFor(test.id).length
  const attemptedPeople = assigned.filter((p) => attemptsFor(p.id, test.id).length > 0)

  return (
    <div className="brow">
      <div className="brow-top">
        <span className="brow-title">
          <span className="tnum">{index}.</span> {test.title} <span className="ver">{qCount} Qs · pass {test.pass_mark}%</span>
          <span className="datechip" title="When this test was set up">🗓 {dayDate(test.created_at)}</span>
          {test.status === 'draft' && <span className="vidchip" style={{ marginLeft: 6 }}>DRAFT</span>}
        </span>
        <span className={`brow-frac ${valid === assigned.length && assigned.length > 0 ? 'full' : 'gap'}`}>
          {valid}/{assigned.length} certified
        </span>
      </div>

      {assigned.length === 0 ? (
        <div className="names"><span className="nm">{branchId && assignedAll.length ? 'No one at this branch assigned' : 'Nobody assigned yet'}</span></div>
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

      <div className="subtree">
        <div className="subtree-path">📁 {index}. {test.title}</div>

        {test.status === 'draft' ? (
          <details className="inline">
            <summary><span className="tree-b">├─</span> Review &amp; publish this draft</summary>
            <div style={{ marginTop: 8 }}>
              <p className="demo-hint" style={{ marginTop: 0 }}>{qCount} question(s) in this draft.</p>
              <button className="btn sm primary" onClick={() => run(() => api.publishTest(actor, test.id), 'Test published')}>
                Publish test
              </button>
            </div>
          </details>
        ) : (
          <AssignPanel test={test} people={people} actor={actor} assignedIds={assignedIds} />
        )}

        {attemptedPeople.length > 0 && (
          <details className="inline">
            <summary><span className="tree-b">├─</span> Download reports</summary>
            <div style={{ marginTop: 8 }}>
              {attemptedPeople.map((p) => {
                const last = attemptsFor(p.id, test.id)[0]
                return (
                  <div key={p.id} className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                    <span style={{ minWidth: 150 }}>
                      {p.name} <span className="ver">{last.score}/{last.total} · {last.passed ? 'PASS' : 'FAIL'}</span>
                    </span>
                    <ReportBtn testId={test.id} staffId={p.id} deptId={test.department_id} name={p.name} />
                  </div>
                )
              })}
              <p className="demo-hint" style={{ marginTop: 6 }}>
                A PDF is downloaded and a copy is filed in the department's Drive folder, named by SOP, date and person.
              </p>
            </div>
          </details>
        )}

        <details className="inline">
          <summary><span className="tree-b">└─</span> Manage this test</summary>
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
    </div>
  )
}

function ReportBtn({ testId, staffId, deptId, name }: { testId: string; staffId: string; deptId: string; name: string }) {
  const [busy, setBusy] = useState(false)
  const deptName = read.department(deptId)?.name
  const folderId = DRIVE_DEPARTMENT_FOLDERS.find((f) => f.name === deptName)?.id ?? ''

  return (
    <button
      className="btn sm primary"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          const { driveSaved } = await downloadTestReport(testId, staffId, folderId)
          toast(driveSaved ? `Report for ${name} downloaded and filed in Drive` : `Report for ${name} downloaded`)
        } catch (e) {
          toast(e instanceof ApiError ? e.message : 'Could not generate the report.')
        } finally {
          setBusy(false)
        }
      }}
    >
      {busy ? <span className="spinner" /> : '⬇ PDF report'}
    </button>
  )
}

function AssignPanel({
  test,
  people,
  actor,
  assignedIds,
}: {
  test: Test
  people: OrgStaff[]
  actor: Actor
  assignedIds: Set<string>
}) {
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()
  const labelled = people.map((p) => ({
    ...p,
    dept: read.department(p.department_id)?.name ?? '',
    branchCode: read.branch(p.branch_id)?.code ?? '',
  }))
  const shown = labelled.filter((p) => !query || `${p.name} ${p.dept} ${p.branchCode}`.toLowerCase().includes(query))
  const unassignedShown = shown.filter((p) => !assignedIds.has(p.id))

  // Group the picker by branch, then department, so people are easy to find.
  const groups = new Map<string, { branchCode: string; dept: string; items: typeof shown }>()
  for (const p of shown) {
    const key = `${p.branchCode}||${p.dept}`
    const g = groups.get(key) ?? { branchCode: p.branchCode, dept: p.dept, items: [] as typeof shown }
    g.items.push(p)
    groups.set(key, g)
  }
  const groupList = [...groups.values()].sort(
    (a, b) => a.branchCode.localeCompare(b.branchCode) || a.dept.localeCompare(b.dept),
  )
  groupList.forEach((g) => g.items.sort((a, b) => a.name.localeCompare(b.name)))

  return (
    <details className="inline">
      <summary>
        <span className="tree-b">├─</span> Assign staff by name <span style={{ color: 'var(--ink-faint)', fontWeight: 500 }}>· {assignedIds.size} assigned</span>
      </summary>
      <div style={{ marginTop: 8 }}>
        <p className="demo-hint" style={{ marginTop: 0 }}>
          Assign this test to anyone — any department, any branch. Search by name, department or branch.
        </p>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search staff…"
          style={{ width: '100%', marginBottom: 6, padding: '8px 11px', border: '1px solid var(--line-strong)', borderRadius: 'var(--r-sm)', fontSize: 13 }}
        />
        {unassignedShown.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <button
              className="btn sm primary"
              onClick={async () => {
                if (!confirm(`Assign "${test.title}" to all ${unassignedShown.length} staff ${query ? 'shown' : 'in every branch'}?`)) return
                try {
                  const n = await api.assignMany(actor, test.id, unassignedShown.map((p) => p.id))
                  toast(n ? `Assigned to ${n} staff` : 'Everyone shown was already assigned')
                } catch (e) {
                  toast(e instanceof ApiError ? e.message : 'Could not assign.')
                }
              }}
            >
              ＋ Assign all {query ? 'shown' : ''} ({unassignedShown.length})
            </button>
          </div>
        )}
        <div style={{ maxHeight: 320, overflowY: 'auto' }}>
          {groupList.length === 0 ? (
            <div className="asgn"><span className="nm">No matching staff</span></div>
          ) : (
            groupList.map((g) => (
              <div key={`${g.branchCode}-${g.dept}`} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--brass-deep)', fontWeight: 700, margin: '8px 0 5px' }}>
                  {g.branchCode} · {g.dept}
                </div>
                <div className="asgn" style={{ marginTop: 0 }}>
                  {g.items.map((p) => {
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
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </details>
  )
}

/* --------------------------------------------------- employees & results -- */

/**
 * The manager's home board: every employee in her department at the selected
 * branch — each shown with their sign-in code and an expandable panel of every
 * test assigned to them (latest score, pass/fail, certificate status) plus a
 * per-person PDF report. This is what a manager lands on, below the tiles.
 */
function EmployeeResults({ dept, branch }: { dept: Department; branch: Branch }) {
  const people = read
    .staff()
    .filter((s) => s.department_id === dept.id && s.branch_id === branch.id)
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))

  return (
    <details className="board" open>
      <summary>
        <StaffSectionIcon />Employees &amp; results — {dept.name} · {branch.code}
        <span className="hint">{people.length} on file · codes &amp; test scores</span>
      </summary>
      {people.length === 0 ? (
        <div className="empty-row">No staff at this branch yet — an admin adds them.</div>
      ) : (
        people.map((emp) => <EmployeeCard key={emp.id} emp={emp} />)
      )}
    </details>
  )
}

function EmployeeCard({ emp }: { emp: Staff }) {
  const tests = assignedTestsFor(emp).sort((a, b) => a.title.localeCompare(b.title))

  return (
    <div className="brow">
      <div className="brow-top">
        <span className="brow-title">
          {emp.name} <span className="ver">{emp.job_title}</span>
          {!emp.active && <span className="vidchip" style={{ marginLeft: 6 }}>INACTIVE</span>}
        </span>
        <span className="mono" style={{ fontWeight: 700 }} title="Employee code">
          {emp.employee_code ?? '— no code yet'}
        </span>
      </div>

      {tests.length === 0 ? (
        <div className="names"><span className="nm">No tests assigned yet</span></div>
      ) : (
        <details className="inline">
          <summary>Test results ({tests.length})</summary>
          <div style={{ marginTop: 8 }}>
            {tests.map((t) => {
              const last = attemptsFor(emp.id, t.id)[0]
              const cert = latestCertification(emp.id, t.id)
              const sc = last ? `${last.score}/${last.total}` : ''
              let cls = ''
              let status = 'not attempted'
              if (last) {
                if (cert) {
                  const s = certStatus(cert)
                  if (s === 'valid') { cls = 'ok'; status = `✓ ${sc} · certified until ${fmtD(cert.expires_at)}` }
                  else if (s === 'expiring_soon') { cls = 'warn'; status = `⚠ ${sc} · ${daysUntil(cert.expires_at)} d left` }
                  else { cls = 'bad'; status = `✗ ${sc} · certificate expired` }
                } else {
                  cls = last.passed ? 'ok' : 'bad'
                  status = `${sc} · ${last.passed ? 'PASS' : 'FAIL'}`
                }
              }
              return (
                <div key={t.id} className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                  <span style={{ flex: 1, minWidth: 150, fontSize: 13 }}>{t.title}</span>
                  <span className={`nm ${cls}`}>{status}</span>
                  {last && <ReportBtn testId={t.id} staffId={emp.id} deptId={t.department_id} name={emp.name} />}
                </div>
              )
            })}
          </div>
        </details>
      )}
    </div>
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
 * Write a new SOP in a Word-like editor. The manager enters the title, number,
 * purpose and who it applies to, then writes the body with full formatting
 * (headings, fonts, lists, tables…). On save the app composes the controlled
 * header + body into a real .docx and the upload-sop Edge Function pushes it to
 * the chosen Drive folder (view-only) and inserts the SOP. An optional training
 * video can be attached too.
 */
function AddSopForm({
  dept,
  branch,
  actor,
  lockBranch,
  forceAllBranches = false,
}: {
  dept: Department
  branch: Branch
  actor: Actor
  lockBranch: boolean
  /** Manager view: always publish to every branch — no scope choice. */
  forceAllBranches?: boolean
}) {
  const [folders, setFolders] = useState<Array<{ id: string; name: string }>>(DRIVE_DEPARTMENT_FOLDERS)
  const defaultFolder =
    DRIVE_DEPARTMENT_FOLDERS.find((f) => f.name === dept.name)?.id ?? DRIVE_DEPARTMENT_FOLDERS[0]?.id ?? ''
  const [title, setTitle] = useState('')
  const [purpose, setPurpose] = useState('')
  const [appliesTo, setAppliesTo] = useState('')
  const [folderId, setFolderId] = useState(defaultFolder)
  const [video, setVideo] = useState<Upload | null>(null)
  const [allBranches, setAllBranches] = useState(true)
  const [busy, setBusy] = useState(false)
  const [newFolder, setNewFolder] = useState('')
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [editor, setEditor] = useState<Editor | null>(null)

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

  function onVideo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    if (!f.type.startsWith('video/')) { toast('Upload a video file'); e.target.value = ''; return }
    setVideo({ name: f.name, size: f.size, src: URL.createObjectURL(f), file: f })
  }

  async function submit() {
    if (!title.trim()) { toast('Enter the SOP title'); return }
    if (!purpose.trim()) { toast('Enter the purpose'); return }
    if (!appliesTo.trim()) { toast('Enter who this SOP applies to'); return }
    if (!editor || editor.getText().trim().length === 0) { toast('Write the SOP body in the editor'); return }
    const body = editor.getHTML()
    setBusy(true)
    // The SOP number is generated: <dept code>-<title initials>-<ddmmyyyy>-<version>.
    const now = new Date()
    const codeVal = sopNumber(dept.code, title.trim(), now, 1)
    const scope: BranchScope =
      forceAllBranches ? { kind: 'ALL' } : lockBranch || !allBranches ? { kind: 'LIST', branch_codes: [branch.code] } : { kind: 'ALL' }
    const folderName = folders.find((f) => f.id === folderId)?.name ?? 'the folder'
    const meta = {
      title: title.trim(),
      code: codeVal,
      version: 1,
      department: dept.name,
      effectiveDate: fmtD(now),
      purpose: purpose.trim(),
      appliesTo: appliesTo.trim(),
    }
    // The same composed HTML backs both the .docx and the in-portal view.
    const contentHtml = sopContentHtml(meta, body)
    try {
      const blob = await generateSopDocx(meta, body)
      const docFile = new File([blob], `${codeVal.replace(/[\\/:*?"<>|]/g, '-')}.docx`, { type: SOP_DOCX_MIME })

      if (isSupabaseEnabled) {
        await uploadSopViaFunction(
          { title: title.trim(), code: codeVal, department_id: dept.id, branch_scope: scope, folder_id: folderId, document_html: contentHtml },
          docFile,
          video?.file ?? null,
        )
        toast(`Saved as ${codeVal} to ${folderName} — matching ${dept.name} staff notified`)
      } else {
        const s = await api.publishSop(actor, {
          title: title.trim(),
          summary: '',
          department_id: dept.id,
          branch_scope: scope,
          code: codeVal,
          document_file_id: URL.createObjectURL(blob),
          video_file_id: video?.src ?? null,
          document_html: contentHtml,
        })
        toast(`Published as ${s.code} into ${folderName}`)
      }
      setTitle(''); setPurpose(''); setAppliesTo(''); setVideo(null)
      editor.commands.clearContent(true)
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not save the SOP.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className="board">
      <summary><SopSectionIcon />Write a new SOP<span className="hint">editor → Word file · to {dept.name}{lockBranch ? ` · ${branch.code} only` : forceAllBranches ? ' · all branches' : ''}</span></summary>
      <div className="card-body">
        {isSupabaseEnabled && (
          <div className="notice info" style={{ marginBottom: 14 }}>
            The SOP saves to your Drive folder as an editable Word (.docx) file through the upload function — deploy it
            (see supabase/SETUP.md) to save against your live database.
          </div>
        )}

        <div className="field"><label htmlFor="f-title">SOP title</label>
          <input id="f-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Personal Grooming" /></div>
        <div className="field">
          <label>SOP number <span style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0, color: 'var(--ink-faint)' }}>— generated automatically</span></label>
          <div className="pdfchip">
            <span className="mono" style={{ fontWeight: 700 }}>{title.trim() ? sopNumber(dept.code, title, new Date(), 1) : `${dept.code}-…`}</span>
          </div>
          <div className="demo-hint">Department code · title initials · date (ddmmyyyy) · version. The department code is set in Departments (admin only).</div>
        </div>
        <div className="field"><label htmlFor="f-purpose">Purpose</label>
          <textarea id="f-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={2} placeholder="What this SOP is for" style={{ resize: 'vertical', width: '100%' }} /></div>
        <div className="field"><label htmlFor="f-applies">Who this applies to</label>
          <textarea id="f-applies" value={appliesTo} onChange={(e) => setAppliesTo(e.target.value)} rows={2} placeholder="e.g. All Housekeeping room attendants at every branch" style={{ resize: 'vertical', width: '100%' }} /></div>

        <div className="field">
          <label>SOP document</label>
          <div className="demo-hint" style={{ marginTop: 0, marginBottom: 6 }}>
            Write the SOP below with full formatting — headings, fonts, bold, lists, tables. The Hamsun header (logo,
            SOP no., title, department, effective date) and the confidential footer are added automatically, and it
            saves to Drive as an editable Word (.docx) file.
          </div>
          <SopEditor onEditor={setEditor} />
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

        {forceAllBranches ? (
          <div className="field"><label>Scope</label>
            <div style={{ fontSize: 13.5 }}>All branches — one {dept.name} SOP that every branch follows.</div></div>
        ) : lockBranch ? (
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
          {busy ? <><span className="spinner" /> Saving…</> : `Save & publish to ${dept.name}`}
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
  forceAllBranches = false,
}: {
  dept: Department
  branch: Branch
  actor: Actor
  lockBranch: boolean
  /** Manager view: the test is conducted at every branch — no scope choice. */
  forceAllBranches?: boolean
}) {
  const deptSops = useMemo(
    () => (forceAllBranches ? deptSopsAll(dept.id) : sopsOf(dept.id, branch.code)),
    [dept.id, branch.code, forceAllBranches, read.sops()],
  )
  const [genSop, setGenSop] = useState('')
  const [level, setLevel] = useState<Difficulty>('medium')
  const [count, setCount] = useState('5')
  const [genLang, setGenLang] = useState<Language>('en')
  const [genBusy, setGenBusy] = useState(false)
  const [draft, setDraft] = useState<DraftQuestion[]>([])
  const [warnings, setWarnings] = useState<string[]>([])

  const [title, setTitle] = useState('')
  const [pass, setPass] = useState('80')
  const [valid, setValid] = useState('12')
  const [relSop, setRelSop] = useState('')
  const [allBranches, setAllBranches] = useState(true)
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
        count: Math.min(20, Math.max(3, parseInt(count) || 5)),
        language: genLang,
      })
      if (res.questions.length === 0) { toast('The generator returned nothing usable — add questions by hand'); setWarnings(res.warnings) }
      else {
        setDraft((d) => [...d, ...res.questions])
        setWarnings(res.warnings)
        const langName = genLang === 'en' ? '' : ` in ${LANGUAGE_NAMES[genLang]}`
        toast(`Generated ${res.questions.length} ${level}-level questions${langName} — review before publishing`)
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
    const scope: BranchScope =
      forceAllBranches ? { kind: 'ALL' } : lockBranch || !allBranches ? { kind: 'LIST', branch_codes: [branch.code] } : { kind: 'ALL' }
    const wanted: Language[] = (['ur', 'ps'] as const).filter((l) => langs[l])
    // The generation language leads; any extra checked languages are added too.
    const languages: Language[] = Array.from(new Set<Language>([genLang, ...wanted]))
    try {
      const test = await api.createTest(actor, {
        title,
        department_id: dept.id,
        branch_scope: scope,
        related_sop_id: relSop || null,
        pass_mark: Math.min(100, Math.max(1, parseInt(pass) || 80)),
        validity_months: Math.min(60, Math.max(1, parseInt(valid) || 12)),
        languages,
      })
      await api.replaceQuestions(actor, test.id, draft)
      const toTranslate = wanted.filter((l) => l !== genLang)
      if (toTranslate.length) await api.translateTest(actor, test.id, toTranslate)
      await api.publishTest(actor, test.id)
      toast(`Test published${toTranslate.length ? ' with translations' : ''} — now assign staff by name`)
      setDraft([]); setTitle(''); setWarnings([])
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not publish.')
    } finally {
      setPubBusy(false)
    }
  }

  return (
    <details className="board" open={draft.length > 0}>
      <summary><TestSectionIcon />Create a test<span className="hint">for {dept.name}{lockBranch ? ` · ${branch.code} only` : forceAllBranches ? ' · all branches' : ''}</span></summary>
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
            <div className="field"><label htmlFor="g-count">Questions (3–20)</label>
              <input id="g-count" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} /></div>
          </div>
          <div className="fieldrow">
            <div className="field"><label htmlFor="g-lang">Generate in language</label>
              <select id="g-lang" value={genLang} onChange={(e) => setGenLang(e.target.value as Language)}>
                <option value="en">English</option>
                <option value="ur">اردو Urdu</option>
                <option value="ps">پښتو Pashto</option>
              </select>
              {genLang !== 'en' && (
                <div className="demo-hint">
                  The AI writes the questions in {LANGUAGE_NAMES[genLang]}, and the test is offered to staff in {LANGUAGE_NAMES[genLang]}.
                </div>
              )}
            </div>
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
        {forceAllBranches ? (
          <div className="field"><label>Scope</label>
            <div style={{ fontSize: 13.5 }}>All branches — one {dept.name} test conducted at every branch.</div></div>
        ) : !lockBranch ? (
          <div className="field"><label>Scope</label>
            <div className="radio-row">
              <label><input type="radio" name="t-scope" checked={!allBranches} onChange={() => setAllBranches(false)} /> {branch.code} only</label>
              <label><input type="radio" name="t-scope" checked={allBranches} onChange={() => setAllBranches(true)} /> All branches</label>
            </div></div>
        ) : null}
        <div className="field"><label>Test languages</label>
          <div className="radio-row">
            <label><input type="checkbox" checked disabled /> {LANGUAGE_NAMES[genLang]} — generated above</label>
            <label><input type="checkbox" checked={genLang === 'ur' || langs.ur} disabled={genLang === 'ur'} onChange={(e) => setLangs({ ...langs, ur: e.target.checked })} /> اردو Urdu</label>
            <label><input type="checkbox" checked={genLang === 'ps' || langs.ps} disabled={genLang === 'ps'} onChange={(e) => setLangs({ ...langs, ps: e.target.checked })} /> پښتو Pashto</label>
          </div>
          <div className="demo-hint">The test is offered in the language you generate in above. Ticking another language auto-translates a copy on publish — review it like any controlled content; scoring is identical in every language.</div>
        </div>

        <div className="field"><label>Questions in draft ({draft.length})</label>
          {draft.length ? (
            draft.map((q, i) => (
              <div className="qb-item" key={i}>
                <span className="n">Q{i + 1}</span>
                <span className="q" dir="auto">{q.text}<br /><span style={{ color: 'var(--pine)', fontSize: 12 }}>✓ {q.options[q.correct_index]}</span></span>
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

/* ---- staff codes: read-only roster a manager can look codes up in ---- */

function StaffCodes({ actor, dept, branch }: { actor: Actor; dept: Department; branch: Branch }) {
  const people = read
    .staff()
    .filter((s) => s.department_id === dept.id && s.branch_id === branch.id)
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))

  return (
    <details className="board">
      <summary><StaffSectionIcon />Staff codes — {dept.name} · {branch.code}<span className="hint">{people.length} on file · set or reissue</span></summary>
      <div className="card-body">
        {people.length === 0 ? (
          <div className="empty-row">No staff here yet — an admin adds them.</div>
        ) : (
          people.map((s) => (
            <div className="brow" key={s.id}>
              <div className="brow-top">
                <span className="brow-title">
                  {s.name} <span className="ver">{s.job_title}</span>
                  {!s.active && <span className="vidchip" style={{ marginLeft: 6 }}>INACTIVE</span>}
                </span>
                <span className="mono" style={{ fontWeight: 700 }} title="Employee code">
                  {s.employee_code ?? '— no code yet'}
                </span>
              </div>
              <StaffCodeEditor actor={actor} staff={s} />
            </div>
          ))
        )}
        <p className="demo-hint" style={{ marginTop: 8 }}>
          Codes let staff sign in to see their SOPs and tests. Set a specific code or issue a random one — share it privately.
        </p>
      </div>
    </details>
  )
}

/**
 * Change a staff member's sign-in code — set a specific 4–8 digit code, or issue
 * a fresh random one. Available to both admins (anyone) and managers (their own
 * department). The new code is revealed once for the manager to share privately.
 */
function StaffCodeEditor({ actor, staff }: { actor: Actor; staff: Staff }) {
  const [code, setCode] = useState('')
  const [reveal, setReveal] = useState<string | null>(null)
  const valid = /^\d{1,8}$/.test(code)

  return (
    <div style={{ marginTop: 6 }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          inputMode="numeric"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
          placeholder="type any code, e.g. 01"
          style={{ maxWidth: 190, padding: '7px 10px', border: '1px solid var(--line-strong)', borderRadius: 'var(--r-sm)', fontSize: 13 }}
        />
        <button
          className="btn sm primary"
          disabled={!valid}
          onClick={() =>
            run(async () => {
              const c = await api.setStaffCode(actor, staff.id, code)
              setReveal(c)
              setCode('')
            })
          }
        >
          Save code
        </button>
        <button
          className="btn sm"
          onClick={() =>
            run(async () => {
              const c = await api.regenerateStaffCode(actor, staff.id)
              setReveal(c)
            })
          }
        >
          {staff.employee_code ? '↻ Random code' : '＋ Issue code'}
        </button>
      </div>
      {reveal && (
        <div className="notice info" style={{ marginTop: 8 }}>
          Code for <strong>{staff.name}</strong> is now <span className="mono">{reveal}</span> — share it privately; it
          replaces any previous code.{' '}
          <button className="btn sm" style={{ marginLeft: 6 }} onClick={() => setReveal(null)}>Done</button>
        </div>
      )}
    </div>
  )
}

/* ---- staff roster: reveal a new code, deactivate / reactivate ---- */

function StaffRoster({ actor, dept, branch }: { actor: Actor; dept: Department; branch: Branch }) {
  const people = read
    .staff()
    .filter((s) => s.department_id === dept.id && s.branch_id === branch.id)
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))

  return (
    <details className="board">
      <summary><StaffSectionIcon />Staff — {dept.name} · {branch.code}<span className="hint">{people.length} on file</span></summary>
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
                <span className="mono" style={{ fontWeight: 700 }} title="Employee code">
                  {s.employee_code ?? '— no code yet'}
                </span>
              </div>
              <StaffCodeEditor actor={actor} staff={s} />
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
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
      <summary><AddSectionIcon />Add staff member<span className="hint">code auto-generated</span></summary>
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

function ManagerRoster({ actor, dept }: { actor: Actor; dept: Department }) {
  // A manager runs her whole department across every branch, so the roster is
  // department-wide — not filtered to a single branch.
  const managers = read
    .managers()
    .filter((m) => m.department_id === dept.id)
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <details className="board">
      <summary><ManagerSectionIcon />Managers — {dept.name}<span className="hint">{managers.length} with access · all branches</span></summary>
      <div className="card-body">
        {managers.length === 0 ? (
          <div className="empty-row">No manager has access to this department yet — add one below.</div>
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
  const [email, setEmail] = useState(manager.email)
  const [password, setPassword] = useState('')
  const postingDirty = deptId !== manager.department_id || branchId !== manager.branch_id
  const loginDirty = email.trim().toLowerCase() !== manager.email || password.trim() !== ''

  return (
    <div className="brow">
      <div className="brow-top">
        <span className="brow-title">
          {manager.name}
          {!manager.active && <span className="vidchip" style={{ marginLeft: 6 }}>DISABLED</span>}
        </span>
      </div>

      <div className="fieldrow" style={{ marginTop: 6 }}>
        <div className="field"><label>Department</label>
          <select value={deptId} onChange={(e) => setDeptId(e.target.value)}>{read.departments().map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
        <div className="field"><label>Branch (home)</label>
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)}>{read.branches().map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}</select></div>
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
        <button
          className="btn sm primary"
          disabled={!postingDirty}
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

      <div className="fieldrow" style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--line)' }}>
        <div className="field"><label>Sign-in email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="field"><label>New password — blank keeps current</label>
          <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="set a new password" /></div>
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button
          className="btn sm primary"
          disabled={!loginDirty}
          onClick={() =>
            run(async () => {
              await api.updateManagerLogin(actor, manager.id, {
                email: email.trim().toLowerCase() !== manager.email ? email : undefined,
                password: password.trim() || undefined,
              })
              setPassword('')
            }, `${manager.name}'s login updated`)
          }
        >
          Save login
        </button>
        <span className="demo-hint" style={{ alignSelf: 'center' }}>They sign in on Manager · Admin with this email + password.</span>
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
      <summary><AddSectionIcon />Add department manager<span className="hint">creates their sign-in</span></summary>
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

/* ---- branches: add, rename, set status, delete ---- */

function BranchAdmin({ actor }: { actor: Actor }) {
  const branches = read.branches().slice().sort((a, b) => a.code.localeCompare(b.code))
  return (
    <details className="board">
      <summary><BranchSectionIcon />Branches<span className="hint">{branches.length}</span></summary>
      <div className="card-body">
        {branches.length === 0 ? (
          <div className="empty-row">No branches yet — add one below.</div>
        ) : (
          branches.map((b) => <BranchRow key={b.id} actor={actor} branch={b} />)
        )}
        <NewBranch actor={actor} />
        <p className="demo-hint" style={{ marginTop: 8 }}>
          A branch code (e.g. FSL) can't be changed — SOPs and tests are scoped to it. An “all branches” SOP or test
          applies to every branch here automatically.
        </p>
      </div>
    </details>
  )
}

function BranchRow({ actor, branch }: { actor: Actor; branch: Branch }) {
  const [name, setName] = useState(branch.name)
  const [status, setStatus] = useState<Branch['status']>(branch.status)
  const dirty = name.trim() !== branch.name || status !== branch.status
  const inUse =
    read.staff().some((s) => s.branch_id === branch.id) ||
    read.managers().some((m) => m.branch_id === branch.id)

  return (
    <div className="brow">
      <div className="brow-top">
        <span className="brow-title">
          <span className="ver mono">{branch.code}</span> {branch.name}
          {branch.status === 'pre_opening' && <span className="vidchip" style={{ marginLeft: 6 }}>PRE-OPENING</span>}
        </span>
      </div>
      <div className="fieldrow" style={{ marginTop: 6 }}>
        <div className="field"><label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as Branch['status'])}>
            <option value="open">Open</option>
            <option value="pre_opening">Pre-opening</option>
          </select></div>
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          className="btn sm primary"
          disabled={!dirty}
          onClick={() => run(() => api.updateBranch(actor, branch.id, { name, status }), `${branch.code} updated`)}
        >
          Save changes
        </button>
        <button
          className="btn sm danger"
          disabled={inUse}
          onClick={() => {
            if (!confirm(`Delete branch ${branch.code} — ${branch.name}?\n\nThis can't be undone.`)) return
            run(() => api.deleteBranch(actor, branch.id), `${branch.code} deleted`)
          }}
        >
          ✕ Delete
        </button>
        {inUse && <span className="demo-hint">Has staff/managers — move them before deleting.</span>}
      </div>
    </div>
  )
}

function NewBranch({ actor }: { actor: Actor }) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [status, setStatus] = useState<Branch['status']>('open')
  const [busy, setBusy] = useState(false)

  return (
    <div className="brow" style={{ background: 'var(--ground)' }}>
      <div className="brow-top"><span className="brow-title">＋ Add a branch</span></div>
      <div className="fieldrow" style={{ marginTop: 6 }}>
        <div className="field"><label>Code (2–4 letters)</label>
          <input maxLength={4} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} style={{ textTransform: 'uppercase' }} placeholder="e.g. GLB" /></div>
        <div className="field"><label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Gulberg" /></div>
        <div className="field"><label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as Branch['status'])}>
            <option value="open">Open</option>
            <option value="pre_opening">Pre-opening</option>
          </select></div>
      </div>
      <button
        className="btn sm primary"
        disabled={busy}
        onClick={async () => {
          if (!code.trim() || !name.trim()) { toast('Enter a code and a name'); return }
          setBusy(true)
          try {
            await api.addBranch(actor, code, name, status)
            toast(`Branch ${code.toUpperCase()} added`)
            setCode(''); setName(''); setStatus('open')
          } catch (e) {
            toast(e instanceof ApiError ? e.message : 'Could not add branch.')
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? <span className="spinner" /> : '＋ Add branch'}
      </button>
    </div>
  )
}

/* ---- departments: add, rename, delete ---- */

function DepartmentAdmin({ actor }: { actor: Actor }) {
  const departments = read.departments().slice().sort((a, b) => a.code.localeCompare(b.code))
  return (
    <details className="board">
      <summary><DepartmentSectionIcon />Departments<span className="hint">{departments.length}</span></summary>
      <div className="card-body">
        {departments.length === 0 ? (
          <div className="empty-row">No departments yet — add one below.</div>
        ) : (
          departments.map((d) => <DepartmentRow key={d.id} actor={actor} dept={d} />)
        )}
        <NewDepartment actor={actor} />
        <p className="demo-hint" style={{ marginTop: 8 }}>
          A department's code (e.g. HK, KTC, Q&amp;C) prefixes its SOP numbers — edit the code or name above. Only an
          admin can change it.
        </p>
      </div>
    </details>
  )
}

function DepartmentRow({ actor, dept }: { actor: Actor; dept: Department }) {
  const [name, setName] = useState(dept.name)
  const [code, setCode] = useState(dept.code)
  const dirty = name.trim() !== dept.name || code.trim().toUpperCase() !== dept.code
  const inUse =
    read.staff().some((s) => s.department_id === dept.id) ||
    read.managers().some((m) => m.department_id === dept.id) ||
    read.sops().some((s) => s.department_id === dept.id) ||
    read.tests().some((t) => t.department_id === dept.id)

  return (
    <div className="brow">
      <div className="brow-top">
        <span className="brow-title"><span className="ver mono">{dept.code}</span> {dept.name}</span>
      </div>
      <div className="fieldrow" style={{ marginTop: 6 }}>
        <div className="field" style={{ flex: '0 0 110px' }}><label>Code</label>
          <input value={code} maxLength={5} onChange={(e) => setCode(e.target.value.toUpperCase())} style={{ textTransform: 'uppercase' }} /></div>
        <div className="field"><label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} /></div>
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          className="btn sm primary"
          disabled={!dirty}
          onClick={() => run(() => api.updateDepartment(actor, dept.id, { name, code }), `${code.trim().toUpperCase()} updated`)}
        >
          Save changes
        </button>
        <button
          className="btn sm danger"
          disabled={inUse}
          onClick={() => {
            if (!confirm(`Delete department ${dept.code} — ${dept.name}?\n\nThis can't be undone.`)) return
            run(() => api.deleteDepartment(actor, dept.id), `${dept.name} deleted`)
          }}
        >
          ✕ Delete
        </button>
        {inUse && <span className="demo-hint">Has staff, SOPs or tests — remove those before deleting.</span>}
      </div>
    </div>
  )
}

function NewDepartment({ actor }: { actor: Actor }) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  return (
    <div className="brow" style={{ background: 'var(--ground)' }}>
      <div className="brow-top"><span className="brow-title">＋ Add a department</span></div>
      <div className="fieldrow" style={{ marginTop: 6 }}>
        <div className="field"><label>Code (2–4 letters)</label>
          <input maxLength={4} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} style={{ textTransform: 'uppercase' }} placeholder="e.g. SP" /></div>
        <div className="field"><label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Spa" /></div>
      </div>
      <button
        className="btn sm primary"
        disabled={busy}
        onClick={async () => {
          if (!code.trim() || !name.trim()) { toast('Enter a code and a name'); return }
          setBusy(true)
          try {
            await api.addDepartment(actor, code, name)
            toast(`Department ${code.toUpperCase()} added`)
            setCode(''); setName('')
          } catch (e) {
            toast(e instanceof ApiError ? e.message : 'Could not add department.')
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? <span className="spinner" /> : '＋ Add department'}
      </button>
    </div>
  )
}
