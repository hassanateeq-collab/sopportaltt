import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Editor } from '@tiptap/react'
import { api, read, policyAcksFor, policyAckAudienceCount, ApiError } from '../data/store'
import type { Actor } from '../data/store'
import type { Policy, Sop, SopDoc } from '../types'
import { POLICY_STATUS_LABELS, APPROVAL_STATUS_LABELS } from '../types'
import { useStore } from '../lib/useStore'
import { fmtD } from '../lib/format'
import { toast } from '../lib/toast'
import { SopEditor } from '../components/SopEditor'
import { PolicyReader } from '../components/PolicyReader'
import { TrainingRecordsBoard } from '../components/TrainingRecordsBoard'
import { SopSectionIcon, PolicySectionIcon, AddSectionIcon, ApprovalSectionIcon, StatusSectionIcon } from '../components/icons'

type Page = 'home' | 'policies' | 'approvals' | 'training'

/**
 * HR portal. HR is org-wide: they own Policies (write / publish / track), and
 * they can SEE — read-only — every department's SOP approvals and every branch's
 * assessment results (the training records). HR never writes SOPs, tests or staff.
 */
export function HrPortal({ actor, onLogout }: { actor: Actor; onLogout: () => void }) {
  useStore()
  const [page, setPage] = useState<Page>('home')
  const [reading, setReading] = useState<Policy | null>(null)
  const [composing, setComposing] = useState<'new' | Policy | null>(null)
  const name = actor.kind === 'manager' ? actor.manager.name : ''

  const header = (back?: () => void) => (
    <div className="crumbs">
      {back && <button className="btn backbtn" style={{ margin: 0 }} onClick={back}>← {reading ? 'Back' : 'Menu'}</button>}
      <span className="here">{name} — HR</span>
      <span className="who">
        <button onClick={onLogout} style={{ color: 'var(--pine)', fontWeight: 600 }}>Sign out</button>
      </span>
    </div>
  )

  if (reading) {
    const fresh = read.policies().find((p) => p.id === reading.id) ?? reading
    return (
      <>
        {header()}
        <PolicyReader actor={actor} policy={fresh} onBack={() => setReading(null)} />
      </>
    )
  }

  if (page !== 'home') {
    return (
      <>
        {header(() => setPage('home'))}
        {page === 'policies' && (
          <HrPolicies actor={actor} onRead={(p) => setReading(p)} onCompose={(c) => setComposing(c)} />
        )}
        {page === 'approvals' && <HrSopApprovals />}
        {page === 'training' && <TrainingRecordsBoard actor={actor} />}
        {composing && (
          <PolicyEditorModal
            actor={actor}
            policy={composing === 'new' ? null : composing}
            onClose={() => setComposing(null)}
            onSaved={() => setComposing(null)}
          />
        )}
      </>
    )
  }

  const pubPolicies = read.policies().filter((p) => p.status === 'published').length
  const pendingSops = read.sops().filter((s) => s.approval_status === 'admin_review').length
  const tiles: Array<{ key: Page; icon: ReactNode; title: string; sub: string }> = [
    { key: 'policies', icon: <PolicySectionIcon />, title: 'Policies', sub: `${pubPolicies} published · write & track` },
    { key: 'approvals', icon: <ApprovalSectionIcon />, title: 'SOP approvals', sub: pendingSops ? `${pendingSops} with the admin` : 'every SOP’s status' },
    { key: 'training', icon: <StatusSectionIcon />, title: 'Training records', sub: 'every branch · assessments & PDFs' },
  ]

  return (
    <>
      {header()}
      <p className="demo-hint" style={{ marginBottom: 14 }}>
        Write and publish company policies, and review SOP approvals and training records across every branch.
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
  )
}

/* ------------------------------------------------------------- policies -- */

function HrPolicies({ actor, onRead, onCompose }: { actor: Actor; onRead: (p: Policy) => void; onCompose: (c: 'new' | Policy) => void }) {
  const departments = read.departments().slice().sort((a, b) => a.code.localeCompare(b.code))
  const policies = read.policies()

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <p className="demo-hint" style={{ margin: 0 }}>
          The admin and every manager read and acknowledge each published policy.
        </p>
        <button className="btn primary" onClick={() => onCompose('new')}>+ New policy</button>
      </div>
      {departments.map((d) => {
        const list = policies.filter((p) => p.department_id === d.id).sort((a, b) => a.code.localeCompare(b.code))
        if (list.length === 0) return null
        return (
          <details className="board" open key={d.id}>
            <summary><SopSectionIcon />{d.name}<span className="hint">{list.length} polic{list.length === 1 ? 'y' : 'ies'}</span></summary>
            {list.map((p) => <PolicyRow key={p.id} actor={actor} policy={p} onOpen={() => onRead(p)} onEdit={() => onCompose(p)} />)}
          </details>
        )
      })}
      {policies.length === 0 && <div className="board"><div className="empty-row">No policies yet — click “New policy”.</div></div>}
    </>
  )
}

function PolicyRow({ actor, policy, onOpen, onEdit }: { actor: Actor; policy: Policy; onOpen: () => void; onEdit: () => void }) {
  const acks = policyAcksFor(policy).length
  const total = policyAckAudienceCount()
  const published = policy.status === 'published'

  function run(fn: () => Promise<void>, ok: string) {
    fn().then(() => toast(ok)).catch((e) => toast(e instanceof ApiError ? e.message : 'Something went wrong.'))
  }

  return (
    <div className="brow">
      <div className="brow-top">
        <span className="brow-title">
          <span className="ver">{policy.code}</span> {policy.title} <span className="ver">v{policy.version}</span>{' '}
          <span className={`apchip ap-${published ? 'authorized' : 'draft'}`}>{POLICY_STATUS_LABELS[policy.status]}</span>
        </span>
        <button className="btn sm" onClick={onOpen}>Open</button>
        <button className="btn sm" onClick={onEdit}>✎ Edit</button>
        {published && <span className={`brow-frac ${acks >= total && total > 0 ? 'full' : 'gap'}`}>{acks}/{total} acknowledged</span>}
      </div>
      {policy.summary && <div className="names"><span className="nm">{policy.summary}</span></div>}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
        {!published ? (
          <button className="btn sm primary" onClick={() => run(() => api.publishPolicy(actor, policy.id), `${policy.code} published`)}>✓ Publish</button>
        ) : (
          <button
            className="btn sm"
            onClick={() => {
              if (!confirm(`Re-issue ${policy.code}? This bumps it to v${policy.version + 1} and reopens everyone's acknowledgment.`)) return
              run(() => api.reissuePolicy(actor, policy.id), `${policy.code} re-issued as v${policy.version + 1}`)
            }}
          >
            ↻ Re-issue (require re-acknowledgment)
          </button>
        )}
        <button
          className="btn sm danger"
          onClick={() => {
            if (!confirm(`Delete policy ${policy.code}? This can't be undone.`)) return
            run(() => api.deletePolicy(actor, policy.id), `${policy.code} deleted`)
          }}
        >
          ✕ Delete
        </button>
      </div>
    </div>
  )
}

function PolicyEditorModal({ actor, policy, onClose, onSaved }: { actor: Actor; policy: Policy | null; onClose: () => void; onSaved: () => void }) {
  const departments = read.departments().slice().sort((a, b) => a.code.localeCompare(b.code))
  const [deptId, setDeptId] = useState(policy?.department_id ?? departments[0]?.id ?? '')
  const [title, setTitle] = useState(policy?.title ?? '')
  const [summary, setSummary] = useState(policy?.summary ?? '')
  const [purpose, setPurpose] = useState(policy?.policy_doc?.purpose ?? '')
  const [appliesTo, setAppliesTo] = useState(policy?.policy_doc?.appliesTo ?? '')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (editor && policy?.policy_doc?.body) editor.commands.setContent(policy.policy_doc.body)
  }, [editor, policy?.policy_doc?.body])

  async function save() {
    if (!title.trim()) { toast('Enter the policy title'); return }
    if (!editor || editor.getText().trim().length === 0) { toast('Write the policy'); return }
    const policyDoc: SopDoc = { body: editor.getHTML(), purpose: purpose.trim(), appliesTo: appliesTo.trim() }
    setBusy(true)
    try {
      if (policy) {
        await api.savePolicy(actor, policy.id, { title: title.trim(), summary, policy_doc: policyDoc })
        toast(`${policy.code} updated`)
      } else {
        await api.createPolicy(actor, { title: title.trim(), summary, department_id: deptId, policy_doc: policyDoc })
        toast('Policy drafted')
      }
      onSaved()
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not save the policy.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: 920 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span><AddSectionIcon /> {policy ? `Edit policy — ${policy.code}` : 'New policy'}</span>
          <button className="v-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="card-body">
          <div className="field"><label>Department</label>
            <select value={deptId} onChange={(e) => setDeptId(e.target.value)} disabled={!!policy}>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div className="field"><label>Policy title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Code of Conduct" /></div>
          <div className="field"><label>Short summary (shown in the list)</label>
            <input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="one line" /></div>
          <div className="field"><label>Purpose</label>
            <textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={2} style={{ width: '100%', resize: 'vertical' }} /></div>
          <div className="field"><label>Who this applies to</label>
            <textarea value={appliesTo} onChange={(e) => setAppliesTo(e.target.value)} rows={2} style={{ width: '100%', resize: 'vertical' }} /></div>
          <div className="field"><label>Policy document</label><SopEditor onEditor={setEditor} /></div>
          <button className="btn primary block" disabled={busy} onClick={() => void save()}>
            {busy ? <><span className="spinner" /> Saving…</> : policy ? `Save changes to ${policy.code}` : 'Save draft'}
          </button>
          {!policy && <p className="demo-hint" style={{ marginTop: 8 }}>Saved as a draft. Publish it from the list when it’s ready.</p>}
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------- SOP approvals (read) -- */

/** Read-only: where every SOP stands in the approval chain, across departments. */
function HrSopApprovals() {
  const departments = read.departments().slice().sort((a, b) => a.code.localeCompare(b.code))
  const sops = read.sops()

  return (
    <>
      <p className="demo-hint" style={{ marginBottom: 14 }}>
        Where every SOP stands — HR sees the approval status across all departments (read-only).
      </p>
      {departments.map((d) => {
        const list = sops.filter((s) => s.department_id === d.id).sort((a, b) => a.code.localeCompare(b.code))
        if (list.length === 0) return null
        return (
          <details className="board" open key={d.id}>
            <summary><SopSectionIcon />{d.name}<span className="hint">{list.length} SOP{list.length === 1 ? '' : 's'}</span></summary>
            {list.map((s: Sop) => (
              <div className="brow" key={s.id}>
                <div className="brow-top">
                  <span className="brow-title">
                    <span className="ver">{s.code}</span> {s.title} <span className="ver">v{s.version}</span>{' '}
                    <span className={`apchip ap-${s.approval_status}`}>{APPROVAL_STATUS_LABELS[s.approval_status]}</span>
                  </span>
                  <span className="hint">{s.published_by ? `by ${s.published_by}` : ''}{s.updated_at ? ` · ${fmtD(s.updated_at)}` : ''}</span>
                </div>
              </div>
            ))}
          </details>
        )
      })}
      {sops.length === 0 && <div className="board"><div className="empty-row">No SOPs yet.</div></div>}
    </>
  )
}
