import { useMemo, useState } from 'react'
import {
  api,
  read,
  hasSigned,
  acknowledgmentFor,
  attemptsFor,
  latestCertification,
  attemptPermission,
  assignedTestsFor,
  ApiError,
} from '../data/store'
import type { Attempt, Certification, Sop, Staff, Test } from '../types'
import { sopsForStaff } from '../lib/scope'
import { certStatus, needsAttention, formatDate, formatDateTime } from '../lib/certs'
import { TopBar, Badge, CertBadge, Notice, Empty, Spinner } from '../components/ui'
import { NotificationBell } from '../components/NotificationBell'
import { Viewer } from '../components/Viewer'
import { TestRunner } from './TestRunner'

/**
 * The staff portal. Two tabs: the SOP library they owe sign-offs on, and the
 * tests assigned to them. Everything is scoped to this one person — they see
 * their own department's SOPs, their own assigned tests, their own scores and
 * certificates, and nothing about anyone else.
 */
export function StaffPortal({ staff, token, onLogout }: { staff: Staff; token: string; onLogout: () => void }) {
  const [tab, setTab] = useState<'sops' | 'tests'>('sops')
  const branch = read.branch(staff.branch_id)!
  const department = read.department(staff.department_id)!

  const [viewer, setViewer] = useState<{ sop: Sop; tab: 'document' | 'video' } | null>(null)
  const [runner, setRunner] = useState<Test | null>(null)
  const [result, setResult] = useState<{ attempt: Attempt; certification: Certification | null; test: Test } | null>(
    null,
  )

  const sops = useMemo(
    () => sopsForStaff(read.sops(), staff, branch.code),
    [staff, branch.code, read.sops()],
  )
  const tests = useMemo(() => assignedTestsFor(staff), [staff])

  const outstandingSigns = sops.filter((s) => !hasSigned(staff.id, s)).length
  const certAlerts = tests.filter((t) => needsAttention(certStatus(latestCertification(staff.id, t.id)))).length

  if (runner) {
    return (
      <TestRunner
        test={runner}
        token={token}
        onDone={(r) => {
          setRunner(null)
          if (r) setResult({ ...r, test: runner })
        }}
      />
    )
  }

  return (
    <div className="app">
      <TopBar
        title={staff.name}
        subtitle={`${department.name} · ${branch.name}`}
        actions={
          <>
            <NotificationBell staffId={staff.id} token={token} />
            <button className="iconbtn" onClick={onLogout} aria-label="Sign out">
              ⎋
            </button>
          </>
        }
      />

      <div className="tabs" style={{ padding: '12px 14px 0', marginBottom: 0 }}>
        <button className={`tab ${tab === 'sops' ? 'tab--on' : ''}`} onClick={() => setTab('sops')}>
          SOPs {outstandingSigns > 0 && <span className="badge badge--accent" style={{ marginLeft: 6 }}>{outstandingSigns}</span>}
        </button>
        <button className={`tab ${tab === 'tests' ? 'tab--on' : ''}`} onClick={() => setTab('tests')}>
          Tests {certAlerts > 0 && <span className="badge badge--warn" style={{ marginLeft: 6 }}>{certAlerts}</span>}
        </button>
      </div>

      <main className="main">
        {tab === 'sops' ? (
          <SopLibrary
            staff={staff}
            sops={sops}
            onOpen={(sop, which) => setViewer({ sop, tab: which })}
          />
        ) : (
          <TestList staff={staff} tests={tests} onOpenViewer={(sop) => setViewer({ sop, tab: 'document' })} onStart={(t) => setRunner(t)} />
        )}
      </main>

      {viewer && (
        <Viewer
          sop={viewer.sop}
          initialTab={viewer.tab}
          onClose={() => setViewer(null)}
          footer={<SignOff staff={staff} sop={viewer.sop} token={token} />}
        />
      )}

      {result && (
        <ResultSheet
          result={result}
          onClose={() => setResult(null)}
          onReviewSop={(sop) => {
            setResult(null)
            setViewer({ sop, tab: 'document' })
          }}
        />
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- SOP tab -- */

function SopLibrary({
  staff,
  sops,
  onOpen,
}: {
  staff: Staff
  sops: Sop[]
  onOpen: (sop: Sop, tab: 'document' | 'video') => void
}) {
  if (sops.length === 0) {
    return <Empty icon="📄" title="No SOPs for your department yet" >When your manager publishes one it appears here.</Empty>
  }

  const outstanding = sops.filter((s) => !hasSigned(staff.id, s))

  return (
    <>
      {outstanding.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <Notice tone="warn">
            You have {outstanding.length} SOP{outstanding.length === 1 ? '' : 's'} to read and sign. Tap a tile
            to open it.
          </Notice>
        </div>
      )}

      <div className="tiles">
        {sops.map((sop) => {
          const signed = hasSigned(staff.id, sop)
          const ack = acknowledgmentFor(staff.id, sop)
          return (
            <div className="tile" key={sop.id}>
              <button className="tile__body" onClick={() => onOpen(sop, 'document')}>
                <div className="tile__top">
                  <span className="tile__code">{sop.code}</span>
                  <span className="tiny">v{sop.version}</span>
                </div>
                <div className="tile__title">{sop.title}</div>
                <div className="tile__summary">{sop.summary}</div>
                <div className="tile__meta">
                  {signed ? (
                    <Badge tone="ok">✓ Signed</Badge>
                  ) : (
                    <Badge tone="accent">Needs sign-off</Badge>
                  )}
                  {ack && <span className="tiny">on {formatDate(ack.signed_at)}</span>}
                </div>
              </button>
              <button
                className="tile__video"
                onClick={() => onOpen(sop, 'video')}
                disabled={!sop.video_file_id}
                title={sop.video_file_id ? 'Watch the training video' : 'No training video attached yet'}
              >
                ▶ Video
              </button>
            </div>
          )
        })}
      </div>
    </>
  )
}

/** The read-and-understood sign-off, sitting under both the document and video. */
function SignOff({ staff, sop, token }: { staff: Staff; sop: Sop; token: string }) {
  const signed = hasSigned(staff.id, sop)
  const ack = acknowledgmentFor(staff.id, sop)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (signed && ack) {
    return (
      <Notice tone="ok">
        You signed {sop.code} v{sop.version} on {formatDateTime(ack.signed_at)}.
      </Notice>
    )
  }

  return (
    <div className="stack">
      {error && <Notice tone="bad">{error}</Notice>}
      <button
        className="btn btn--accent btn--block"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setError(null)
          try {
            await api.signSop(token, sop.id)
          } catch (e) {
            setError(e instanceof ApiError ? e.message : 'Could not record your sign-off.')
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? <Spinner /> : `I have read and understood ${sop.code}`}
      </button>
      <p className="tiny" style={{ textAlign: 'center' }}>
        Your name and the time are recorded against {sop.code} v{sop.version}.
      </p>
    </div>
  )
}

/* --------------------------------------------------------------- Test tab -- */

function TestList({
  staff,
  tests,
  onOpenViewer,
  onStart,
}: {
  staff: Staff
  tests: Test[]
  onOpenViewer: (sop: Sop) => void
  onStart: (test: Test) => void
}) {
  if (tests.length === 0) {
    return <Empty icon="📝" title="No tests assigned to you">When your manager assigns one it appears here with your attempt history.</Empty>
  }
  return (
    <div className="stack">
      {tests.map((test) => (
        <TestCard key={test.id} staff={staff} test={test} onOpenViewer={onOpenViewer} onStart={onStart} />
      ))}
    </div>
  )
}

function TestCard({
  staff,
  test,
  onOpenViewer,
  onStart,
}: {
  staff: Staff
  test: Test
  onOpenViewer: (sop: Sop) => void
  onStart: (test: Test) => void
}) {
  const attempts = attemptsFor(staff.id, test.id)
  const cert = latestCertification(staff.id, test.id)
  const status = certStatus(cert)
  const permission = attemptPermission(staff.id, test.id)
  const relatedSop = test.related_sop_id ? read.sop(test.related_sop_id) : null

  return (
    <div className="card">
      <div className="spread">
        <div style={{ minWidth: 0 }}>
          <div className="card__title">{test.title}</div>
          <p className="tiny" style={{ marginTop: 3 }}>
            Pass {test.pass_mark}% · valid {test.validity_months} months
          </p>
        </div>
        <CertBadge status={status} />
      </div>

      {needsAttention(status) && cert && (
        <div style={{ marginTop: 11 }}>
          <Notice tone={status === 'expired' ? 'bad' : 'warn'}>
            {status === 'expired'
              ? `Your certificate expired on ${formatDate(cert.expires_at)}.`
              : `Your certificate expires on ${formatDate(cert.expires_at)}.`}{' '}
            Renew it below.
          </Notice>
        </div>
      )}

      {attempts.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            Your attempts
          </div>
          <div className="stack" style={{ gap: 6 }}>
            {attempts.map((a) => (
              <div className="spread" key={a.id} style={{ fontSize: '0.86rem' }}>
                <span>{formatDateTime(a.attempted_at)}</span>
                <span className="row" style={{ gap: 8 }}>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{a.percentage}%</span>
                  <Badge tone={a.passed ? 'ok' : 'bad'}>{a.passed ? 'Pass' : 'Fail'}</Badge>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="stack" style={{ marginTop: 14, gap: 9 }}>
        {relatedSop && (
          <button className="btn btn--ghost btn--block" onClick={() => onOpenViewer(relatedSop)}>
            Review {relatedSop.code} &amp; its video
          </button>
        )}

        {permission.allowed ? (
          <button className="btn btn--block" onClick={() => onStart(test)}>
            {permission.reason === 'first_attempt'
              ? 'Start test'
              : permission.reason === 'renewal'
                ? 'Renew certificate'
                : 'Start approved retest'}
          </button>
        ) : (
          <Notice tone="warn">
            {permission.reason === 'not_assigned'
              ? 'This test is no longer assigned to you.'
              : 'This test is locked after your last attempt. Your manager must approve a retest before you can try again — this turns a fail into a review of the SOP, not a re-guess.'}
          </Notice>
        )}
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- result --- */

function ResultSheet({
  result,
  onClose,
  onReviewSop,
}: {
  result: { attempt: Attempt; certification: Certification | null; test: Test }
  onClose: () => void
  onReviewSop: (sop: Sop) => void
}) {
  const { attempt, certification, test } = result
  const relatedSop = test.related_sop_id ? read.sop(test.related_sop_id) : null
  const passed = attempt.passed

  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheet__panel" onClick={(e) => e.stopPropagation()} style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '2.6rem' }} aria-hidden>
          {passed ? '🎉' : '📋'}
        </div>
        <h2 style={{ marginTop: 6 }}>{passed ? 'You passed' : 'Not this time'}</h2>
        <div className="codebox" style={{ margin: '14px 0', fontSize: '2.4rem' }}>
          {attempt.percentage}%
        </div>
        <p className="muted">
          {attempt.score} of {attempt.total} correct · pass mark {test.pass_mark}%
        </p>

        {passed && certification ? (
          <div style={{ marginTop: 14 }}>
            <Notice tone="ok">
              Certificate issued, valid until {formatDate(certification.expires_at)}.
            </Notice>
          </div>
        ) : (
          <div style={{ marginTop: 14 }}>
            <Notice tone="warn">
              The test is now locked. Ask your manager to approve a retest — and use the chance to go back over
              the SOP first.
            </Notice>
          </div>
        )}

        <div className="stack" style={{ marginTop: 16 }}>
          {!passed && relatedSop && (
            <button className="btn btn--ghost btn--block" onClick={() => onReviewSop(relatedSop)}>
              Review {relatedSop.code}
            </button>
          )}
          <button className="btn btn--block" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
