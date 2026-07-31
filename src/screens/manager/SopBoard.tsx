import { useMemo, useState } from 'react'
import { api, read, eligibleStaffFor, hasSigned, acknowledgmentFor, ApiError } from '../../data/store'
import type { Actor } from '../../data/store'
import type { BranchScope, Sop } from '../../types'
import { scopeLabel } from '../../lib/scope'
import { nextDocCode } from '../../lib/codes'
import { formatDate } from '../../lib/certs'
import { Badge, Notice, Empty, Field, Spinner, Sheet } from '../../components/ui'
import { Viewer } from '../../components/Viewer'
import type { ManagerScope } from './scope'
import { ScopePicker } from './ScopePicker'

/**
 * The SOP board. Managers and admins publish SOPs for their department, and the
 * sign-off board answers the core compliance question — who has and who hasn't
 * signed the current version — filterable by branch.
 */
export function SopBoard({ actor, scope }: { actor: Actor; scope: ManagerScope }) {
  const [composing, setComposing] = useState(false)
  const [signBoardFor, setSignBoardFor] = useState<Sop | null>(null)
  const [viewer, setViewer] = useState<Sop | null>(null)

  const sops = useMemo(() => {
    return read
      .sops()
      .filter((s) => {
        if (scope.departmentId && s.department_id !== scope.departmentId) return false
        return true
      })
      .sort((a, b) => a.code.localeCompare(b.code))
  }, [scope.departmentId, read.sops()])

  return (
    <section>
      <div className="spread" style={{ marginBottom: 12 }}>
        <div>
          <h2>SOP library</h2>
          <p className="tiny" style={{ marginTop: 2 }}>
            {scope.isAdmin ? 'All departments across the group' : 'Your department'}
          </p>
        </div>
        <button className="btn btn--sm" onClick={() => setComposing(true)}>
          + Publish SOP
        </button>
      </div>

      {sops.length === 0 ? (
        <Empty icon="📄" title="No SOPs published yet">Publish the first one for your department.</Empty>
      ) : (
        <div className="stack">
          {sops.map((sop) => {
            const eligible = eligibleStaffFor(sop)
            const signed = eligible.filter((s) => hasSigned(s.id, sop)).length
            const dept = read.department(sop.department_id)
            const complete = eligible.length > 0 && signed === eligible.length
            return (
              <div className="card" key={sop.id}>
                <div className="spread">
                  <div style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <span className="tile__code">{sop.code}</span>
                      <span className="tiny">v{sop.version}</span>
                    </div>
                    <div className="card__title" style={{ marginTop: 3 }}>
                      {sop.title}
                    </div>
                    <p className="tiny" style={{ marginTop: 3 }}>
                      {dept?.name} · {scopeLabel(sop.branch_scope)} · updated {formatDate(sop.updated_at)}
                    </p>
                  </div>
                  <Badge tone={complete ? 'ok' : eligible.length === 0 ? 'neutral' : 'warn'}>
                    {signed}/{eligible.length} signed
                  </Badge>
                </div>
                <div className="row row--wrap" style={{ marginTop: 12, gap: 8 }}>
                  <button className="btn btn--ghost btn--sm" onClick={() => setViewer(sop)}>
                    Open
                  </button>
                  <button className="btn btn--quiet btn--sm" onClick={() => setSignBoardFor(sop)}>
                    Sign-off board
                  </button>
                  <RevalidateButton actor={actor} sop={sop} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {composing && <ComposeSop actor={actor} scope={scope} onClose={() => setComposing(false)} />}
      {signBoardFor && <SignOffBoard sop={signBoardFor} onClose={() => setSignBoardFor(null)} />}
      {viewer && <Viewer sop={viewer} onClose={() => setViewer(null)} />}
    </section>
  )
}

/** Bumping the version reopens every eligible person's obligation to re-sign. */
function RevalidateButton({ actor, sop }: { actor: Actor; sop: Sop }) {
  const [busy, setBusy] = useState(false)
  return (
    <button
      className="btn btn--quiet btn--sm"
      disabled={busy}
      onClick={async () => {
        if (!confirm(`Publish a new version of ${sop.code}? Everyone who signed v${sop.version} must sign again.`)) return
        setBusy(true)
        try {
          await api.reviseSop(actor, sop.id, {})
        } catch (e) {
          alert(e instanceof ApiError ? e.message : 'Could not revise the SOP.')
        } finally {
          setBusy(false)
        }
      }}
    >
      {busy ? <Spinner /> : 'New version'}
    </button>
  )
}

function ComposeSop({ actor, scope, onClose }: { actor: Actor; scope: ManagerScope; onClose: () => void }) {
  const departments = read.departments()
  const defaultDept = scope.departmentId ?? departments[0]?.id ?? ''
  const [departmentId, setDepartmentId] = useState(defaultDept)
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [codeOverride, setCodeOverride] = useState('')
  const [documentId, setDocumentId] = useState('')
  const [videoId, setVideoId] = useState('')
  const [branchScope, setBranchScope] = useState<BranchScope>(
    actor.kind === 'admin' ? { kind: 'ALL' } : { kind: 'LIST', branch_codes: [read.branch(scope.branchId!)!.code] },
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dept = read.department(departmentId)
  const suggestedCode = dept
    ? nextDocCode(
        dept.code,
        read.sops().map((s) => s.code),
      )
    : ''

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await api.publishSop(actor, {
        title,
        summary,
        department_id: departmentId,
        branch_scope: branchScope,
        code: codeOverride || undefined,
        document_file_id: documentId.trim() || null,
        video_file_id: videoId.trim() || null,
      })
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not publish the SOP.')
      setBusy(false)
    }
  }

  return (
    <Sheet title="Publish SOP" onClose={onClose}>
      {scope.isAdmin && (
        <Field label="Department">
          <select className="select" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} — {d.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label="Title">
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Guest Check-In and Registration" />
      </Field>

      <Field label="Document-control code" hint={`Leave blank to auto-assign ${suggestedCode}. A manager may override; duplicates are rejected.`}>
        <input className="input" value={codeOverride} onChange={(e) => setCodeOverride(e.target.value.toUpperCase())} placeholder={suggestedCode} />
      </Field>

      <Field label="Summary" hint="Shown on the tile and in the viewer header.">
        <textarea className="textarea" value={summary} onChange={(e) => setSummary(e.target.value)} />
      </Field>

      <ScopePicker actor={actor} value={branchScope} onChange={setBranchScope} />

      <Field label="Google Drive document file ID" hint="In production the upload pushes the file to a locked Drive folder and stores its ID here. Leave blank in the demo.">
        <input className="input" value={documentId} onChange={(e) => setDocumentId(e.target.value)} placeholder="optional" />
      </Field>

      <Field label="Google Drive video file ID" hint="The training video that belongs to this same SOP — one record, two links.">
        <input className="input" value={videoId} onChange={(e) => setVideoId(e.target.value)} placeholder="optional" />
      </Field>

      {error && <Notice tone="bad">{error}</Notice>}

      <button className="btn btn--block" style={{ marginTop: 12 }} disabled={busy || !title.trim()} onClick={submit}>
        {busy ? <Spinner /> : 'Publish'}
      </button>
    </Sheet>
  )
}

/** Who has and hasn't signed, with names, filterable by branch. */
function SignOffBoard({ sop, onClose }: { sop: Sop; onClose: () => void }) {
  const [branchFilter, setBranchFilter] = useState<string>('all')
  const eligible = eligibleStaffFor(sop)
  const branches = read.branches()

  const filtered = eligible
    .filter((s) => branchFilter === 'all' || s.branch_id === branchFilter)
    .sort((a, b) => a.name.localeCompare(b.name))

  const signedCount = eligible.filter((s) => hasSigned(s.id, sop)).length

  return (
    <Sheet title={`${sop.code} · sign-off`} onClose={onClose}>
      <p className="muted" style={{ marginBottom: 12 }}>
        {sop.title} — v{sop.version}. {signedCount} of {eligible.length} eligible staff have signed the current
        version.
      </p>

      <Field label="Branch">
        <select className="select" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
          <option value="all">All branches</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.code} — {b.name}
            </option>
          ))}
        </select>
      </Field>

      {filtered.length === 0 ? (
        <Empty icon="—" title="No eligible staff in this filter" />
      ) : (
        <div className="tablewrap" style={{ marginTop: 6 }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Branch</th>
                <th>Status</th>
                <th>Signed</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const ack = acknowledgmentFor(s.id, sop)
                return (
                  <tr key={s.id}>
                    <td className="wrap">{s.name}</td>
                    <td>{read.branch(s.branch_id)?.code}</td>
                    <td>{ack ? <Badge tone="ok">Signed</Badge> : <Badge tone="warn">Not yet</Badge>}</td>
                    <td>{ack ? formatDate(ack.signed_at) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Sheet>
  )
}
