import { useEffect, useRef, useState } from 'react'
import { api, notificationsFor, unreadCount } from '../data/store'
import { fmt } from '../lib/format'
import { BellIcon } from './icons'

/**
 * The notification bell: a small dropdown panel in the topbar, matching the
 * prototype. Opening it marks everything read, and the items opened while unread
 * keep a brass rail for that one viewing.
 */
export function NotificationBell({ staffId, token }: { staffId: string; token: string }) {
  const [open, setOpen] = useState(false)
  const [wasUnread, setWasUnread] = useState<Set<string>>(new Set())
  const ref = useRef<HTMLSpanElement>(null)

  const count = unreadCount(staffId)
  const items = notificationsFor(staffId).slice(0, 12)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  async function toggle() {
    if (!open) {
      setWasUnread(new Set(notificationsFor(staffId).filter((n) => !n.read).map((n) => n.id)))
      if (count > 0) await api.markNotificationsRead(token)
      setOpen(true)
    } else {
      setOpen(false)
    }
  }

  return (
    <span className="bell-slot" ref={ref}>
      <button className="bell" aria-label={`Notifications${count ? ` — ${count} unread` : ''}`} onClick={toggle}>
        <BellIcon />
        {count > 0 && <span className="badge">{count}</span>}
      </button>
      {open && (
        <div className="notifpanel">
          <div className="np-head">Notifications</div>
          {items.length === 0 ? (
            <div className="notifempty">No notifications yet.</div>
          ) : (
            <ul>
              {items.map((n) => (
                <li key={n.id} className={wasUnread.has(n.id) ? 'unread' : ''}>
                  {n.text}
                  <span className="nts">{fmt(n.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </span>
  )
}
