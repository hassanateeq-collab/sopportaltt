import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { api, read, policyAcksFor, policyAckAudienceCount, ApiError } from '../data/store'
import type { Actor } from '../data/store'
import type { Policy, SopDoc } from '../types'
import { POLICY_STATUS_LABELS } from '../types'
import { useStore } from '../lib/useStore'
import { toast } from '../lib/toast'
import { SopEditor } from '../components/SopEditor'
import { PolicyReader } from '../components/PolicyReader'
import { SopSectionIcon, AddSectionIcon } from '../components/icons'

/**
 * HR portal. HR is org-wide and Policies-only: they write, publish, re-issue and
 * delete company policies (one Drive folder per department), and see who — the
 * admin and the managers — has acknowledged each one. HR never touches SOPs,
 * tests or staff.
 */
export function HrPortal({ actor, onLogout }: { actor: Actor; onLogout: () => void }) {
  useStore()
  const [reading, setReading] = useState<Policy | null>(null)
  const [composing, setComposing] = useState<'new' | Policy | null>(null)
  const name = actor.kind === 'manager' ? actor.manager.name : ''

  const crumbs = (back?: () => void) => (
    <div className="crumbs">
      {back && <button className="btn backbtn" style={{ margin: 0 }} onClick={back}>← Back to Policies</button>}
      <span className="here">{name} — HR</span>
      <span className="who">
        <button onClick={onLogout} style={{ color: 'var(--pine)', fontWeight: 600 }}>Sign out</button>
      </span>
    </div>
  )

  if (reading) {
    // Re-read from cache so the ack list stays live after any change.
    const fresh = read.policies().find((p) => p.id === reading.id) ?? reading
    return (
      <>
        {crumbs()}
        <PolicyReader actor={actor} policy={fresh} onBack={() => setReading(null)} />
      </>
    )
  }

  const departments = read.departments().slice().sort((a, b) => a.code.localeCompare(b.code))
  const policies = read.policies()

  return (
    <>
      {crumbs()}
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <p className="demo-hint" style={{ margin: 0 }}>
          Write and publish company policies. The admin and every manager read and acknowledge each one.
        </p>
        <button className="btn primary" onClick={() => setComposing('new')}>+ New policy</button>
      </div>

      {departments.map((d) => {
        const list = policies.filter((p) => p.department_id === d.id).sort((a, b) => a.code.localeCompare(b.code))
        if (list.length === 0) return null
        return (
          <details className="board" open key={d.id}>
            <summary><SopSectionIcon />{d.name}<span className="hint">{list.length} polic{list.length === 1 ? 'y' : 'ies'}</span></summary>
            {list.map((p) => (
              <PolicyRow key={p.id} actor={actor} policy={p} onOpen={() => setReading(p)} onEdit={() => setComposing(p)} />
            ))}
          </details>
        )
      })}
      {policies.length === 0 && (
        <div className="board"><div className="empty-row">No policies yet — click “New policy”.</div></div>
      )}

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

/** Create or edit a policy's inline document. */
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
