import { useEffect, useRef, useState } from 'react'
import { read, hasAckedPolicy } from '../data/store'
import type { Actor } from '../data/store'
import { useStore } from '../lib/useStore'
import { BellIcon } from './icons'

/**
 * The management notification bell: a dropdown panel (like the staff one) that
 * lists what needs the signed-in manager/admin's attention — right now, the
 * published policies they haven't acknowledged yet. Clicking an item jumps to the
 * Policies board. HR publishes policies rather than acknowledging them, so their
 * bell is informational only.
 */
export function MgmtNotificationBell({ actor, onNavigate }: { actor: Actor; onNavigate: (page: string) => void }) {
  useStore()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const isHr = actor.kind === 'manager' && actor.manager.role === 'hr'
  const pending = isHr
    ? []
    : read.policies().filter((p) => p.status === 'published' && !hasAckedPolicy(actor, p))
  const items = pending.map((p) => ({ id: p.id, title: `${p.code} — ${p.title}` }))
  const count = items.length

  return (
    <span className="bell-slot" ref={ref}>
      <button
        className="bell"
        aria-label={count ? `Notifications — ${count} to acknowledge` : 'Notifications'}
        onClick={() => setOpen((o) => !o)}
      >
        <BellIcon />
        {count > 0 && <span className="badge">{count}</span>}
      </button>
      {open && (
        <div className="notifpanel">
          <div className="np-head">Notifications</div>
          {items.length === 0 ? (
            <div className="notifempty">You’re all caught up.</div>
          ) : (
            <ul>
              {items.map((it) => (
                <li key={it.id}>
                  <button
                    className="np-item"
                    onClick={() => {
                      onNavigate('policies')
                      setOpen(false)
                    }}
                  >
                    <span className="np-item-title">{it.title}</span>
                    <span className="nts">Policy — needs your acknowledgment</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </span>
  )
}
