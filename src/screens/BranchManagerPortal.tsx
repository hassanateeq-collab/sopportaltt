import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  read,
  attemptsFor,
  assignedTestsFor,
  latestCertification,
} from '../data/store'
import type { Actor } from '../data/store'
import type { Sop, Staff, Department } from '../types'
import { APPROVAL_STATUS_LABELS } from '../types'
import type { ApprovalStatus } from '../types'
import { useStore } from '../lib/useStore'
import { useBackNav } from '../lib/useBackNav'
import { certStatus, daysUntil } from '../lib/certs'
import { fmtD } from '../lib/format'
import { SopPage } from '../components/SopPage'
import { SopComments, sopCommentCount } from '../components/SopComments'
import { PoliciesReadBoard } from '../components/PoliciesReadBoard'
import { SopSectionIcon, PolicySectionIcon, StatusSectionIcon, StaffSectionIcon } from '../components/icons'

type Page = 'home' | 'sops' | 'policies' | 'results'

/**
 * The Branch Manager's portal. Branch managers oversee ONE branch and are
 * read-only + comments: they browse every SOP and leave change-suggestions for
 * the department manager, and they see the assessment results of the staff in
 * their own branch (across every department). They never author, approve, assign,
 * or manage anyone.
 */
export function BranchManagerPortal({ actor, navTo }: { actor: Actor; navTo: { page: string; nonce: number } | null }) {
  useStore()
  const [page, setPage] = useState<Page>('home')
  const [reading, setReading] = useState<Sop | null>(null)

  useEffect(() => {
    if (navTo) setPage(navTo.page as Page)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navTo?.nonce])

  const navDepth = (page !== 'home' ? 1 : 0) + (reading ? 1 : 0)
  useBackNav(navDepth, () => {
    if (reading) setReading(null)
    else if (page !== 'home') setPage('home')
  })

  const branchId = actor.kind === 'manager' ? actor.manager.branch_id : null
  const branch = branchId ? read.branch(branchId) : null
  if (!branch) return <div className="allclear">Your branch isn’t set up yet — ask an admin.</div>

  const sopCount = read.sops().length
  const staffCount = read.staff().filter((s) => s.branch_id === branch.id && s.active).length

  // --- the SOP reader (read-only; branch manager can comment) ---
  if (reading) {
    return (
      <>
        <div className="crumbs">
          <button className="btn backbtn" style={{ margin: 0 }} onClick={() => setReading(null)}>← Back to SOPs</button>
          <span className="here">{branch.name} Branch Manager</span>
        </div>
        <SopReadOnly sop={reading} />
        <SopComments actor={actor} sopId={reading.id} />
      </>
    )
  }

  const pubPolicies = read.policies().filter((p) => p.status === 'published').length
  const tiles: Array<{ key: Page; icon: ReactNode; title: string; sub: string }> = [
    { key: 'sops', icon: <SopSectionIcon />, title: 'SOPs', sub: `${sopCount} · read & suggest changes` },
    { key: 'policies', icon: <PolicySectionIcon />, title: 'Policies', sub: `${pubPolicies} · read & acknowledge` },
    { key: 'results', icon: <StatusSectionIcon />, title: 'Assessment results', sub: `${staffCount} staff at ${branch.name}` },
  ]

  return (
    <>
      <div className="crumbs">
        <span className="here">{branch.name} Branch Manager</span>
      </div>

      {page === 'home' ? (
        <>
          <p className="demo-hint" style={{ marginBottom: 14 }}>
            You oversee <strong>{branch.name}</strong>. Read any SOP and suggest changes to the department manager, and
            review your branch’s assessment results.
          </p>
          <div className="mtiles">
            {tiles.map((t) => (
              <button key={t.key} className="mtile" onClick={() => setPage(t.key)}>
                <span className="mtile-ico">{t.icon}</span>
                <span className="mtile-body">
                  <span className="mtile-title">{t.title}</span>
                  <span className="mtile-sub">{t.sub}</span>
                </span>
                <span className="mtile-go" aria-hidden>›</span>
              </button>
            ))}
          </div>
        </>
      ) : page === 'sops' ? (
        <SopBrowse onOpen={(s) => setReading(s)} />
      ) : page === 'policies' ? (
        <PoliciesReadBoard actor={actor} />
      ) : (
        <BranchResults branch={branch} />
      )}
    </>
  )
}

/** A read-only SOP page (no edit, no approval controls). */
function SopReadOnly({ sop }: { sop: Sop }) {
  const dept = read.department(sop.department_id)
  return (
    <>
      <div className="row" style={{ marginBottom: 10, gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <span className="brow-title" style={{ fontSize: 16 }}>
          <span className="ver">{sop.code}</span> {sop.title} <span className="ver">v{sop.version}</span>
        </span>
        <StatusChip status={sop.approval_status} />
        {dept && <span className="ver">{dept.name}</span>}
      </div>
      {sop.sop_doc ? (
        <SopPage sop={sop} />
      ) : (
        <div className="notice">This SOP doesn’t have an in-portal document yet.</div>
      )}
    </>
  )
}

/** Every SOP, grouped by department, each openable to read + comment. */
function SopBrowse({ onOpen }: { onOpen: (s: Sop) => void }) {
  const departments = read.departments().slice().sort((a, b) => a.code.localeCompare(b.code))
  const all = read.sops()

  return (
    <>
      {departments.map((d) => {
        const sops = all.filter((s) => s.department_id === d.id).sort((a, b) => a.code.localeCompare(b.code))
        if (sops.length === 0) return null
        return (
          <details className="board" open key={d.id}>
            <summary>
              <SopSectionIcon />{d.name}
              <span className="hint">{sops.length} SOP{sops.length === 1 ? '' : 's'}</span>
            </summary>
            {sops.map((s) => {
              const comments = sopCommentCount(s.id)
              return (
                <div className="brow" key={s.id}>
                  <div className="brow-top">
                    <span className="brow-title">
                      <span className="ver">{s.code}</span> {s.title} <span className="ver">v{s.version}</span>{' '}
                      <StatusChip status={s.approval_status} />
                      {comments > 0 && <span className="vidchip" style={{ marginLeft: 6 }}>💬 {comments}</span>}
                    </span>
                    <button className="btn sm primary" onClick={() => onOpen(s)}>Read &amp; comment</button>
                  </div>
                </div>
              )
            })}
          </details>
        )
      })}
    </>
  )
}

/** Branch assessment results: every staff member in the branch, by department. */
function BranchResults({ branch }: { branch: { id: string; name: string; code: string } }) {
  const departments = read.departments().slice().sort((a, b) => a.code.localeCompare(b.code))
  const branchStaff = read.staff().filter((s) => s.branch_id === branch.id)

  const anyStaff = branchStaff.length > 0
  return (
    <>
      <p className="demo-hint" style={{ marginBottom: 14 }}>
        Assessment results for every staff member at <strong>{branch.name}</strong>, across all departments.
      </p>
      {!anyStaff && <div className="board"><div className="empty-row">No staff at this branch yet.</div></div>}
      {departments.map((d) => {
        const people = branchStaff
          .filter((s) => s.department_id === d.id)
          .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
        if (people.length === 0) return null
        return (
          <details className="board" open key={d.id}>
            <summary>
              <StaffSectionIcon />{d.name} — {branch.code}
              <span className="hint">{people.length} on file · latest scores</span>
            </summary>
            {people.map((emp) => <ResultCard key={emp.id} emp={emp} dept={d} />)}
          </details>
        )
      })}
    </>
  )
}

function ResultCard({ emp, dept }: { emp: Staff; dept: Department }) {
  const tests = assignedTestsFor(emp).sort((a, b) => a.title.localeCompare(b.title))
  return (
    <div className="brow">
      <div className="brow-top">
        <span className="brow-title">
          {emp.name} <span className="ver">{emp.job_title}</span>
          {!emp.active && <span className="vidchip" style={{ marginLeft: 6 }}>INACTIVE</span>}
        </span>
        <span className="ver">{dept.name}</span>
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
                </div>
              )
            })}
          </div>
        </details>
      )}
    </div>
  )
}

function StatusChip({ status }: { status: ApprovalStatus }) {
  return <span className={`apchip ap-${status}`}>{APPROVAL_STATUS_LABELS[status]}</span>
}
