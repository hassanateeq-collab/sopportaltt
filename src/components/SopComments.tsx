import { useState } from 'react'
import { api, read, commentsFor, ApiError } from '../data/store'
import type { Actor } from '../data/store'
import { useStore } from '../lib/useStore'
import { MANAGER_ROLE_LABELS } from '../types'
import { fmt } from '../lib/format'
import { toast } from '../lib/toast'

/**
 * The comment / change-suggestion thread on an SOP. Branch managers raise
 * suggestions here; the owning department manager and the admin see them and
 * reply in the same thread. Shown at the bottom of an opened SOP.
 *
 * `canPost` says whether this viewer may add to the thread (a department manager
 * only on their own department's SOPs — the server enforces it too).
 */
export function SopComments({ actor, sopId, canPost = true }: { actor: Actor; sopId: string; canPost?: boolean }) {
  useStore()
  const comments = commentsFor(sopId)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)

  const roleLabel = (role: string) =>
    role === 'admin' ? 'Admin' : MANAGER_ROLE_LABELS[role as keyof typeof MANAGER_ROLE_LABELS] ?? 'Manager'

  async function post() {
    if (!body.trim()) { toast('Write a comment first'); return }
    setBusy(true)
    try {
      await api.addSopComment(actor, sopId, body)
      setBody('')
      toast('Comment posted')
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not post the comment.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="sopcomments">
      <div className="sopcomments-head">
        Comments &amp; suggestions{comments.length > 0 && <span className="sopcomments-count"> · {comments.length}</span>}
      </div>

      {comments.length === 0 ? (
        <p className="sopcomments-empty">No comments yet. Branch managers can suggest changes here for the department manager to pick up.</p>
      ) : (
        <ul className="sopcomment-list">
          {comments.map((c) => {
            const mine = actor.kind === 'manager' ? c.author_manager_id === actor.manager.id : c.author_role === 'admin'
            return (
              <li key={c.id} className={`sopcomment ${mine ? 'mine' : ''}`}>
                <div className="sopcomment-meta">
                  <span className="sopcomment-who">{c.author_name}</span>
                  <span className={`sopcomment-role role-${c.author_role}`}>{roleLabel(c.author_role)}</span>
                  <span className="sopcomment-at">{fmt(c.created_at)}</span>
                </div>
                <p className="sopcomment-body">{c.body}</p>
              </li>
            )
          })}
        </ul>
      )}

      {canPost ? (
        <div className="sopcomment-compose">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={
              actor.kind === 'manager' && actor.manager.role === 'branch_manager'
                ? 'Suggest a change for the department manager…'
                : 'Reply to the thread…'
            }
            rows={3}
          />
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn sm primary" disabled={busy} onClick={post}>
              {busy ? 'Posting…' : 'Post comment'}
            </button>
          </div>
        </div>
      ) : (
        <p className="sopcomments-empty">Only the owning department manager, branch managers, and the admin can comment here.</p>
      )}
    </section>
  )
}

/** The number of comments on an SOP — for a small badge on SOP rows. */
export function sopCommentCount(sopId: string): number {
  return read.sopComments().filter((c) => c.sop_id === sopId).length
}
