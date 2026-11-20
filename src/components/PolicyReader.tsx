import { useState } from 'react'
import { api, read, policyAcksFor, hasAckedPolicy, policyAckAudienceCount, staffPolicyAcks, policyStaffAudience, ApiError } from '../data/store'
import type { Actor } from '../data/store'
import type { Policy } from '../types'
import { MANAGER_ROLE_LABELS, POLICY_STATUS_LABELS } from '../types'
import { useStore } from '../lib/useStore'
import { fmt } from '../lib/format'
import { toast } from '../lib/toast'
import { isSupabaseEnabled } from '../lib/supabase'
import { PolicyPage } from './PolicyPage'
import { PolicyDocFrame } from './DocFrame'

/**
 * Read a policy inline, with the acknowledgment controls. The admin and managers
 * get an "Acknowledge" button; HR (and everyone) sees who has acknowledged the
 * current version. `canAcknowledge` is false for HR (they publish, they don't
 * sign) and for drafts.
 */
export function PolicyReader({ actor, policy, onBack, inModal }: { actor: Actor; policy: Policy; onBack: () => void; inModal?: boolean }) {
  useStore()
  const [busy, setBusy] = useState(false)
  const dept = read.department(policy.department_id)
  const isHr = actor.kind === 'manager' && actor.manager.role === 'hr'
  const published = policy.status === 'published'
  const acks = policyAcksFor(policy)
  const mine = hasAckedPolicy(actor, policy)
  const canAcknowledge = published && !isHr

  async function acknowledge() {
    setBusy(true)
    try {
      await api.acknowledgePolicy(actor, policy.id)
      toast('Acknowledged')
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not acknowledge.')
    } finally {
      setBusy(false)
    }
  }

  const roleLabel = (role: string) =>
    role === 'admin' ? 'Admin' : MANAGER_ROLE_LABELS[role as keyof typeof MANAGER_ROLE_LABELS] ?? 'Manager'

  return (
    <>
      {!inModal && (
        <div className="row" style={{ marginBottom: 10, gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn backbtn" style={{ margin: 0 }} onClick={onBack}>← Back to Policies</button>
          <span className="brow-title" style={{ fontSize: 16 }}>
            <span className="ver">{policy.code}</span> {policy.title} <span className="ver">v{policy.version}</span>
          </span>
          <span className={`apchip ap-${policy.status === 'published' ? 'authorized' : 'draft'}`}>{POLICY_STATUS_LABELS[policy.status]}</span>
          {dept && <span className="ver">{dept.name}</span>}
        </div>
      )}

      {isSupabaseEnabled && policy.document_file_id
        ? <PolicyDocFrame policyId={policy.id} title={`${policy.code} document`} />
        : <PolicyPage policy={policy} />}

      {canAcknowledge && (
        <div className="row" style={{ marginTop: 16, gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {mine ? (
            <span className="nm ok" style={{ fontWeight: 700 }}>✓ You’ve acknowledged this version</span>
          ) : (
            <button className="btn primary" disabled={busy} onClick={() => void acknowledge()}>
              {busy ? 'Saving…' : '✓ Acknowledge I’ve read this'}
            </button>
          )}
        </div>
      )}

      {published && (
        <section className="sop-approvals">
          <div className={`sop-approvals-head ${acks.length >= policyAckAudienceCount() && policyAckAudienceCount() > 0 ? 'done' : ''}`}>
            Acknowledged by {acks.length} of {policyAckAudienceCount()} (admin &amp; managers) · v{policy.version}
          </div>
          {acks.length === 0 ? (
            <p className="sopcomments-empty">No manager has acknowledged this version yet.</p>
          ) : (
            <ol className="approval-trail">
              {acks.map((a) => (
                <li key={a.id} className="atr atr-authorized">
                  <span className="atr-mark" aria-hidden>✓</span>
                  <span className="atr-role">{a.name}</span>
                  <span className="atr-action">{roleLabel(a.role)}</span>
                  <span className="atr-at">{fmt(a.acknowledged_at)}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {published && <PolicyStaffSignOff policy={policy} />}
    </>
  )
}

/** Which staff have read & acknowledged this policy (for HR / admin). */
function PolicyStaffSignOff({ policy }: { policy: Policy }) {
  const audience = policyStaffAudience(policy)
  if (audience.length === 0) return null
  const acks = staffPolicyAcks(policy)
  return (
    <section className="sop-approvals">
      <div className={`sop-approvals-head ${acks.length >= audience.length ? 'done' : ''}`}>
        Staff sign-off — {acks.length} of {audience.length} have acknowledged v{policy.version}
      </div>
      <ol className="approval-trail">
        {audience.map((s) => {
          const ack = acks.find((a) => a.staff_id === s.id)
          return (
            <li key={s.id} className={`atr ${ack ? 'atr-authorized' : ''}`}>
              <span className="atr-mark" aria-hidden>{ack ? '✓' : '•'}</span>
              <span className="atr-role">{s.name}</span>
              <span className="atr-action">{ack ? 'Acknowledged' : 'Not yet'}</span>
              {ack && <span className="atr-at">{fmt(ack.acknowledged_at)}</span>}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
