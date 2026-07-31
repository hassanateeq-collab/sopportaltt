import { useMemo, useState } from 'react'
import {
  api,
  read,
  hasSigned,
  acknowledgmentFor,
  attemptsFor,
  latestCertification,
  attemptPermission,
  openGrant,
  assignedTestsFor,
  ApiError,
} from '../data/store'
import type { Attempt, Certification, Sop, Staff, Test } from '../types'
import { sopsForStaff } from '../lib/scope'
import { certStatus, daysUntil } from '../lib/certs'
import { fmt, fmtD } from '../lib/format'
import { toast } from '../lib/toast'
import { DocIcon, TestIcon } from '../components/icons'
import { Viewer } from '../components/Viewer'
import { TestRunner } from './TestRunner'

/**
 * The staff portal — the signed-in member's own page: the SOPs they owe
 * sign-offs on, and the tests assigned to them, each as a tile. Everything is
 * scoped to this one person.
 */
export function StaffPortal({ staff, token, onLogout }: { staff: Staff; token: string; onLogout: () => void }) {
  const branch = read.branch(staff.branch_id)!

  const [view, setView] = useState<{ sop: Sop; kind: 'doc' | 'video'; justSigned?: boolean } | null>(null)
  const [testView, setTestView] = useState<string | null>(null)
  const [taking, setTaking] = useState<Test | null>(null)

  const sops = useMemo(() => sopsForStaff(read.sops(), staff, branch.code), [staff, branch.code, read.sops()])
  const tests = useMemo(() => assignedTestsFor(staff), [staff, read.assignments(), read.tests()])

  if (taking) {
    return (
      <TestRunner
        test={taking}
        token={token}
        onDone={() => setTaking(null)}
        crumbs={<Crumbs staff={staff} onLogout={onLogout} />}
      />
    )
  }

  const pending = sops.filter((s) => !hasSigned(staff.id, s)).length
  const certIssues = tests.filter((t) => {
    const c = latestCertification(staff.id, t.id)
    return c && certStatus(c) !== 'valid'
  })

  return (
    <>
      <Crumbs staff={staff} onLogout={onLogout} />

      {testView ? (
        <TestDetail
          test={read.test(testView)!}
          staff={staff}
          onBack={() => setTestView(null)}
          onReviewSop={(sop, kind) => setView({ sop, kind })}
          onStart={(t) => { setTestView(null); setTaking(t) }}
        />
      ) : (
        <>
          {certIssues.length > 0 && (
            <div className="notice">
              ⚠{' '}
              {certIssues
                .map((t) => {
                  const c = latestCertification(staff.id, t.id)!
                  const s = certStatus(c)
                  return `${t.title}${s === 'expired' ? ' certification has expired' : ` certification expires in ${daysUntil(c.expires_at)} days`}`
                })
                .join(' · ')}{' '}
              — tap the test tile to renew.
            </div>
          )}

          <div className="duty-note">
            <h2 className="section">My SOPs</h2>
            <span className="duty-count">{pending} to sign</span>
          </div>
          {sops.length ? (
            <div className="tilegrid">
              {sops.map((s) => (
                <SopTile key={s.id} sop={s} staff={staff} onOpen={(kind) => setView({ sop: s, kind })} />
              ))}
            </div>
          ) : (
            <div className="allclear">No SOPs for this department at this branch yet.</div>
          )}

          <div className="duty-note">
            <h2 className="section">My tests &amp; scores</h2>
            <span className="duty-count">{tests.length} assigned</span>
          </div>
          {tests.length ? (
            <div className="tilegrid">
              {tests.map((t) => (
                <TestTile key={t.id} test={t} staff={staff} onOpen={() => setTestView(t.id)} />
              ))}
            </div>
          ) : (
            <div className="allclear">No tests assigned to you yet — your manager assigns tests by name.</div>
          )}
        </>
      )}

      {view && (
        <Viewer
          sop={view.sop}
          initialKind={view.kind}
          onClose={() => setView(null)}
          footer={
            <SignOff
              sop={view.sop}
              staff={staff}
              token={token}
              justSigned={!!view.justSigned}
              onSigned={() => setView({ ...view, justSigned: true })}
            />
          }
        />
      )}
    </>
  )
}

function Crumbs({ staff, onLogout }: { staff: Staff; onLogout: () => void }) {
  const branch = read.branch(staff.branch_id)
  const dept = read.department(staff.department_id)
  return (
    <div className="crumbs">
      <span className="here">{branch?.code}</span>
      <span className="sep">/</span>
      <span className="here">{dept?.name}</span>
      <span className="who">
        {staff.name} ·{' '}
        <button onClick={onLogout} style={{ color: 'var(--pine)', fontWeight: 600 }}>Sign out</button>
      </span>
    </div>
  )
}

function SopTile({ sop, staff, onOpen }: { sop: Sop; staff: Staff; onOpen: (kind: 'doc' | 'video') => void }) {
  const signed = hasSigned(staff.id, sop)
  return (
    <div className="tile">
      <button className="tile-main" onClick={() => onOpen('doc')}>
        <span className="kind"><DocIcon /></span>
        <span className="t-title">{sop.title}</span>
        <span className="ver">{sop.code} · v{sop.version}</span>
        {signed ? <span className="chip signed">✓ Signed</span> : <span className="chip pending">Read &amp; sign</span>}
      </button>
      <button
        className={`tile-video ${sop.video_file_id ? '' : 'none'}`}
        onClick={() => onOpen('video')}
        title={sop.video_file_id ? 'Watch the training video' : 'No training video attached yet'}
      >
        ▶ Video
      </button>
    </div>
  )
}

function TestTile({ test, staff, onOpen }: { test: Test; staff: Staff; onOpen: () => void }) {
  const cert = latestCertification(staff.id, test.id)
  let chip: React.ReactNode
  if (cert) {
    const s = certStatus(cert)
    chip =
      s === 'valid' ? <span className="chip signed">✓ Certified</span>
        : s === 'expiring_soon' ? <span className="chip pending">Expires {daysUntil(cert.expires_at)} d</span>
          : <span className="chip expired">Expired</span>
  } else {
    const last = attemptsFor(staff.id, test.id)[0]
    if (last && !last.passed) {
      chip = openGrant(staff.id, test.id)
        ? <span className="chip signed">✓ Retest approved</span>
        : <span className="chip expired">Awaiting approval</span>
    } else {
      chip = <span className="chip pending">Take test</span>
    }
  }
  const qCount = read.questionsFor(test.id).length
  return (
    <div className="tile">
      <button className="tile-main" onClick={onOpen}>
        <span className="kind testk"><TestIcon /></span>
        <span className="t-title">{test.title}</span>
        <span className="signed-ts">{qCount} Qs · pass {test.pass_mark}%</span>
        {chip}
      </button>
    </div>
  )
}

function SignOff({
  sop,
  staff,
  token,
  justSigned,
  onSigned,
}: {
  sop: Sop
  staff: Staff
  token: string
  justSigned: boolean
  onSigned: () => void
}) {
  const [busy, setBusy] = useState(false)
  const ack = acknowledgmentFor(staff.id, sop)
  const branch = read.branch(staff.branch_id)
  const dept = read.department(staff.department_id)

  if (ack) {
    return (
      <div className="stampbox">
        <span className={`stamp ${justSigned ? 'animate' : ''}`}>SIGNED</span>
        <div className="stampmeta">
          <strong>{staff.name}</strong> — {dept?.name} · {branch?.code}
          <br />
          <span className="mono">{fmt(ack.signed_at)} · v{sop.version}</span>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="who">
        Signing as <strong>{staff.name}</strong> · {dept?.name} · {branch?.code} — signing confirms you have read this SOP.
      </div>
      <button
        className="btn primary block"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          try {
            await api.signSop(token, sop.id)
            toast(`Signed — ${sop.code} v${sop.version}`)
            onSigned()
          } catch (e) {
            toast(e instanceof ApiError ? e.message : 'Could not record your sign-off.')
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? <span className="spinner" /> : 'Read & understood — sign the register'}
      </button>
    </>
  )
}

/* ---- test detail ---- */

function TestDetail({
  test,
  staff,
  onBack,
  onReviewSop,
  onStart,
}: {
  test: Test
  staff: Staff
  onBack: () => void
  onReviewSop: (sop: Sop, kind: 'doc' | 'video') => void
  onStart: (test: Test) => void
}) {
  const cert = latestCertification(staff.id, test.id)
  const hist = attemptsFor(staff.id, test.id)
  const permission = attemptPermission(staff.id, test.id)
  const grant = openGrant(staff.id, test.id)
  const rel = test.related_sop_id ? read.sop(test.related_sop_id) : null

  let certLine: React.ReactNode
  if (cert) {
    const s = certStatus(cert)
    certLine =
      s === 'valid' ? (
        <div className="stampbox">
          <span className="stamp">CERTIFIED</span>
          <div className="stampmeta">
            <strong>{staff.name}</strong>
            <br />
            <span className="mono">valid until {fmtD(cert.expires_at)}</span>
          </div>
        </div>
      ) : (
        <div className="failbox">
          <div className="fh">{s === 'expiring_soon' ? 'RENEWAL DUE' : 'CERTIFICATION EXPIRED'}</div>
          <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
            {s === 'expiring_soon'
              ? `Expires in ${daysUntil(cert.expires_at)} days — retake below to renew.`
              : `Expired ${Math.abs(daysUntil(cert.expires_at))} days ago — retake below.`}
          </div>
        </div>
      )
  } else {
    certLine = <div className="allclear" style={{ padding: 14 }}>Not certified yet{hist.length ? ' — see your attempts below' : ''}.</div>
  }

  return (
    <div className="kcard">
      <div className="kmeta">
        <span>{test.title}</span>
        <span className="mono">pass {test.pass_mark}% · valid {test.validity_months} mo</span>
      </div>
      {certLine}
      {!permission.allowed && permission.reason === 'locked_after_failure' && (
        <div className="notice" style={{ margin: '12px 0 0' }}>
          Retest locked — only your manager can approve a retest after a fail. You'll get a notification here when it's
          approved.
        </div>
      )}
      {grant && (
        <div className="stampbox" style={{ marginTop: 12 }}>
          <span className="stamp">APPROVED</span>
          <div className="stampmeta">
            Retest approved by <strong>{grant.granted_by_name}</strong>
            <br />
            <span className="mono">{fmt(grant.granted_at)} · one attempt</span>
          </div>
        </div>
      )}

      <div className="duty-note" style={{ margin: '18px 0 4px' }}>
        <h2 className="section" style={{ fontSize: 14.5 }}>My previous attempts</h2>
        <span className="duty-count">{hist.length}</span>
      </div>
      {hist.length ? (
        <ul className="attempts">
          {hist.map((a: Attempt) => (
            <li key={a.id}>
              <span className="ts">{fmt(a.attempted_at)}</span>
              <span className="sc">{a.score}/{a.total} · {a.percentage}%</span>
              <span className={`pf ${a.passed ? 'p' : 'f'}`}>{a.passed ? 'PASS' : 'FAIL'}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div style={{ fontSize: 13, color: 'var(--ink-soft)', padding: '6px 0 2px' }}>No attempts yet.</div>
      )}

      <div className="backlink">
        {rel && (
          <>
            <button className="btn" onClick={() => onReviewSop(rel, 'doc')}>Review SOP</button>
            <button className="btn" onClick={() => onReviewSop(rel, 'video')}>▶ Video</button>
          </>
        )}
        {permission.allowed && (
          <button className="btn primary" onClick={() => onStart(test)}>
            {hist.length || cert ? 'Retake test' : 'Start test'}
          </button>
        )}
        <button className="btn" onClick={onBack}>Back</button>
      </div>
    </div>
  )
}

export type { Certification }
