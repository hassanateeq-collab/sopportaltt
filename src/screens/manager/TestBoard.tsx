import { useMemo, useState } from 'react'
import {
  api,
  read,
  eligibleStaffFor,
  attemptsFor,
  latestCertification,
  openGrant,
  ApiError,
} from '../../data/store'
import type { Actor } from '../../data/store'
import type { Test } from '../../types'
import { scopeLabel } from '../../lib/scope'
import { certStatus, formatDate } from '../../lib/certs'
import { Badge, CertBadge, Notice, Empty, Spinner } from '../../components/ui'
import type { ManagerScope } from './scope'
import { TestComposer } from './TestComposer'

/**
 * The test board. Assignment by name, a certification board showing each
 * assigned person's latest score and certificate status, and the retest-approval
 * rows where failed staff wait for a manager to unlock exactly one attempt.
 */
export function TestBoard({ actor, scope }: { actor: Actor; scope: ManagerScope }) {
  const [composing, setComposing] = useState(false)

  const tests = useMemo(() => {
    return read
      .tests()
      .filter((t) => !scope.departmentId || t.department_id === scope.departmentId)
      .sort((a, b) => a.title.localeCompare(b.title))
  }, [scope.departmentId, read.tests()])

  return (
    <section>
      <div className="spread" style={{ marginBottom: 12 }}>
        <div>
          <h2>Tests &amp; certification</h2>
          <p className="tiny" style={{ marginTop: 2 }}>
            {scope.isAdmin ? 'All departments' : 'Your department'}
          </p>
        </div>
        <button className="btn btn--sm" onClick={() => setComposing(true)}>
          + New test
        </button>
      </div>

      {tests.length === 0 ? (
        <Empty icon="📝" title="No tests yet">Create one by hand, or generate a draft from an SOP.</Empty>
      ) : (
        <div className="stack">
          {tests.map((t) => (
            <TestRow key={t.id} actor={actor} scope={scope} test={t} />
          ))}
        </div>
      )}

      {composing && <TestComposer actor={actor} scope={scope} onClose={() => setComposing(false)} />}
    </section>
  )
}

function TestRow({ actor, scope, test }: { actor: Actor; scope: ManagerScope; test: Test }) {
  const [open, setOpen] = useState(false)
  const dept = read.department(test.department_id)
  const questions = read.questionsFor(test.id)

  return (
    <div className="card">
      <div className="spread">
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 8 }}>
            <span className="card__title">{test.title}</span>
            {test.status === 'draft' && <Badge tone="accent">Draft</Badge>}
          </div>
          <p className="tiny" style={{ marginTop: 3 }}>
            {dept?.name} · {scopeLabel(test.branch_scope)} · {questions.length} questions · pass {test.pass_mark}%
          </p>
        </div>
        <button className="btn btn--quiet btn--sm" onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide' : 'Manage'}
        </button>
      </div>

      {open && (
        <div style={{ marginTop: 14 }}>
          {test.status === 'draft' ? (
            <PublishRow actor={actor} test={test} />
          ) : (
            <>
              <AssignmentSection actor={actor} scope={scope} test={test} />
              <CertificationBoard test={test} />
              <RetestApprovals actor={actor} scope={scope} test={test} />
            </>
          )}
        </div>
      )}
    </div>
  )
}

function PublishRow({ actor, test }: { actor: Actor; test: Test }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const questions = read.questionsFor(test.id)
  return (
    <div className="stack">
      <Notice tone="info">
        This test is a draft. Review its {questions.length} question{questions.length === 1 ? '' : 's'}, then
        publish so it can be assigned.
      </Notice>
      {error && <Notice tone="bad">{error}</Notice>}
      <button
        className="btn btn--block"
        disabled={busy || questions.length === 0}
        onClick={async () => {
          setBusy(true)
          setError(null)
          try {
            await api.publishTest(actor, test.id)
          } catch (e) {
            setError(e instanceof ApiError ? e.message : 'Could not publish.')
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? <Spinner /> : 'Publish test'}
      </button>
    </div>
  )
}

/** Assign a test to specific staff by name — only assigned staff ever see it. */
function AssignmentSection({ actor, scope, test }: { actor: Actor; scope: ManagerScope; test: Test }) {
  // Eligibility is derived (department + branch-in-scope); assignment is manual
  // on top of that. Only eligible staff can be assigned.
  const eligible = eligibleStaffFor(test).filter((s) => {
    if (scope.departmentId && s.department_id !== scope.departmentId) return false
    if (scope.branchId && s.branch_id !== scope.branchId) return false
    return true
  })
  const assignments = read.assignments().filter((a) => a.test_id === test.id)
  const assignedIds = new Set(assignments.map((a) => a.staff_id))

  return (
    <div style={{ marginBottom: 14 }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>
        Assign by name
      </div>
      {eligible.length === 0 ? (
        <p className="tiny">No eligible staff in your patch for this test’s scope.</p>
      ) : (
        <div className="choices">
          {eligible.map((s) => {
            const on = assignedIds.has(s.id)
            return (
              <button
                key={s.id}
                className={`choice ${on ? 'choice--on' : ''}`}
                onClick={async () => {
                  try {
                    if (on) await api.unassignTest(actor, test.id, s.id)
                    else await api.assignTest(actor, test.id, s.id)
                  } catch (e) {
                    alert(e instanceof ApiError ? e.message : 'Could not update assignment.')
                  }
                }}
              >
                <span>
                  <span className="choice__label">{s.name}</span>
                  <span className="choice__meta" style={{ display: 'block' }}>
                    {read.branch(s.branch_id)?.code} · {s.job_title}
                  </span>
                </span>
                <span>{on ? <Badge tone="ok">Assigned</Badge> : <span className="tiny">Assign ›</span>}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Latest score and certificate status per assigned person. */
function CertificationBoard({ test }: { test: Test }) {
  const assignments = read.assignments().filter((a) => a.test_id === test.id)
  if (assignments.length === 0) return null

  const rows = assignments
    .map((a) => read.staffMember(a.staff_id))
    .filter((s): s is NonNullable<typeof s> => !!s)
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div style={{ marginBottom: 14 }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>
        Certification board
      </div>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Branch</th>
              <th>Latest</th>
              <th>Certificate</th>
              <th>Expires</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const attempts = attemptsFor(s.id, test.id)
              const latest = attempts[0]
              const cert = latestCertification(s.id, test.id)
              const status = certStatus(cert)
              return (
                <tr key={s.id}>
                  <td className="wrap">{s.name}</td>
                  <td>{read.branch(s.branch_id)?.code}</td>
                  <td>
                    {latest ? (
                      <span className="row" style={{ gap: 6 }}>
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{latest.percentage}%</span>
                        <Badge tone={latest.passed ? 'ok' : 'bad'}>{latest.passed ? 'Pass' : 'Fail'}</Badge>
                      </span>
                    ) : (
                      <span className="tiny">Not attempted</span>
                    )}
                  </td>
                  <td>
                    <CertBadge status={status} />
                  </td>
                  <td>{cert ? formatDate(cert.expires_at) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * The retest-approval rows. Anyone whose latest attempt failed and who has no
 * open grant is locked and appears here with an "allow" button. Each approval
 * unlocks exactly one attempt, consumed when they retake — so failing again
 * means asking again.
 */
function RetestApprovals({ actor, scope, test }: { actor: Actor; scope: ManagerScope; test: Test }) {
  const assignments = read.assignments().filter((a) => a.test_id === test.id)

  const locked = assignments
    .map((a) => read.staffMember(a.staff_id))
    .filter((s): s is NonNullable<typeof s> => !!s)
    .filter((s) => {
      if (scope.departmentId && s.department_id !== scope.departmentId) return false
      if (scope.branchId && s.branch_id !== scope.branchId) return false
      const attempts = attemptsFor(s.id, test.id)
      const last = attempts[0]
      return last && !last.passed && !openGrant(s.id, test.id)
    })

  const granted = assignments
    .map((a) => read.staffMember(a.staff_id))
    .filter((s): s is NonNullable<typeof s> => !!s)
    .filter((s) => openGrant(s.id, test.id))

  if (locked.length === 0 && granted.length === 0) return null

  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 8 }}>
        Retest approvals
      </div>

      {locked.length > 0 && (
        <div className="stack" style={{ marginBottom: granted.length ? 12 : 0 }}>
          {locked.map((s) => (
            <div className="spread card" key={s.id} style={{ padding: 12 }}>
              <div>
                <div style={{ fontWeight: 600 }}>{s.name}</div>
                <div className="tiny">Failed — locked until you approve a retest</div>
              </div>
              <AllowButton actor={actor} test={test} staffId={s.id} />
            </div>
          ))}
        </div>
      )}

      {granted.map((s) => (
        <Notice key={s.id} tone="ok">
          {s.name} has one approved retest waiting — it unlocks a single attempt.
        </Notice>
      ))}
    </div>
  )
}

function AllowButton({ actor, test, staffId }: { actor: Actor; test: Test; staffId: string }) {
  const [busy, setBusy] = useState(false)
  return (
    <button
      className="btn btn--accent btn--sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          await api.grantRetest(actor, test.id, staffId)
        } catch (e) {
          alert(e instanceof ApiError ? e.message : 'Could not approve the retest.')
        } finally {
          setBusy(false)
        }
      }}
    >
      {busy ? <Spinner /> : 'Allow retest'}
    </button>
  )
}
