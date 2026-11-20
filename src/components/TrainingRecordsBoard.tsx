import { useState } from 'react'
import { read, trainingLinesFor, downloadTrainingRecord, ApiError } from '../data/store'
import type { Actor } from '../data/store'
import type { Staff } from '../types'
import { useStore } from '../lib/useStore'
import { toast } from '../lib/toast'
import { StaffSectionIcon } from './icons'

/**
 * Training records. Each staff member shows their assessment status (passed /
 * failed / not taken) per assigned test, with an on-demand button to save their
 * consolidated record as a PDF into the department's Drive folder.
 *
 * With `deptId`+`branchId` (admin picks them, a department manager is locked to
 * their own) it shows that one department+branch as a flat list. Without them
 * (HR) it shows every staff member, grouped by department, across all branches.
 */
export function TrainingRecordsBoard({ actor, deptId, branchId }: { actor: Actor; deptId?: string; branchId?: string }) {
  useStore()
  void actor
  const scoped = deptId !== undefined && branchId !== undefined

  if (scoped) {
    const dept = read.department(deptId!)
    const branch = read.branch(branchId!)
    const people = read.staff()
      .filter((s) => s.active && s.department_id === deptId && s.branch_id === branchId)
      .sort((a, b) => a.name.localeCompare(b.name))
    return (
      <>
        <p className="demo-hint" style={{ marginBottom: 14 }}>
          Training on assigned SOPs for {dept?.name ?? 'this department'} · {branch?.name ?? 'this branch'} — assessment
          status and sign-offs. Save any person’s full record as a PDF into the department’s Drive folder.
        </p>
        <details className="board" open>
          <summary><StaffSectionIcon />{dept?.name} — {branch?.code}<span className="hint">{people.length} staff</span></summary>
          {people.length === 0 ? (
            <div className="empty-row">No staff in this department at this branch.</div>
          ) : (
            people.map((p) => <TrainingRow key={p.id} staff={p} />)
          )}
        </details>
      </>
    )
  }

  const departments = read.departments().slice().sort((a, b) => a.code.localeCompare(b.code))
  const staff = read.staff().filter((s) => s.active)
  if (staff.length === 0) return <div className="board"><div className="empty-row">No staff on file yet.</div></div>

  return (
    <>
      <p className="demo-hint" style={{ marginBottom: 14 }}>
        Every staff member’s training on the SOPs assigned to them, across every branch — assessment status and SOP
        sign-offs. Save any person’s full record as a PDF into their department’s Drive folder.
      </p>
      {departments.map((d) => {
        const people = staff
          .filter((s) => s.department_id === d.id)
          .sort((a, b) => a.name.localeCompare(b.name))
        if (people.length === 0) return null
        return (
          <details className="board" open key={d.id}>
            <summary><StaffSectionIcon />{d.name}<span className="hint">{people.length} staff</span></summary>
            {people.map((p) => <TrainingRow key={p.id} staff={p} />)}
          </details>
        )
      })}
    </>
  )
}

function TrainingRow({ staff }: { staff: Staff }) {
  const [busy, setBusy] = useState(false)
  const lines = trainingLinesFor(staff)
  const branch = read.branch(staff.branch_id)
  const passed = lines.filter((l) => l.status === 'passed').length
  const failed = lines.filter((l) => l.status === 'failed').length
  const notTaken = lines.filter((l) => l.status === 'not_taken').length

  async function save() {
    setBusy(true)
    try {
      const { driveSaved } = await downloadTrainingRecord(staff.id)
      toast(driveSaved ? `Record saved to Drive & downloaded` : `Record downloaded`)
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not build the record.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="brow">
      <div className="brow-top">
        <span className="brow-title">
          {staff.name} <span className="ver">{staff.job_title}</span> <span className="ver">{branch?.code}</span>
        </span>
        <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {passed > 0 && <span className="nm ok">{passed} passed</span>}
          {failed > 0 && <span className="nm bad">{failed} failed</span>}
          {notTaken > 0 && <span className="nm">{notTaken} not taken</span>}
          {lines.length === 0 && <span className="nm">no tests assigned</span>}
        </span>
        <button className="btn sm primary" disabled={busy} onClick={() => void save()}>
          {busy ? 'Building…' : '⤓ Save record'}
        </button>
      </div>
      {lines.length > 0 && (
        <details className="inline">
          <summary>Assessments ({lines.length})</summary>
          <div style={{ marginTop: 8 }}>
            {lines.map((l) => (
              <div key={l.test.id} className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                <span style={{ flex: 1, minWidth: 150, fontSize: 13 }}>{l.test.title}</span>
                <span className={`nm ${l.status === 'passed' ? 'ok' : l.status === 'failed' ? 'bad' : ''}`}>
                  {l.status === 'passed' ? `✓ ${l.score} · ${l.detail}` : l.status === 'failed' ? `✗ ${l.score} · Failed` : 'Not taken'}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
