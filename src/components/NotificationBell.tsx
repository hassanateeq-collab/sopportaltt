import { useState } from 'react'
import { api, read, notificationsFor, unreadCount } from '../data/store'
import { formatDateTime } from '../lib/certs'
import { Sheet, Empty } from './ui'

/**
 * The notification bell with its unread badge. Opening it marks everything read
 * — same behaviour the brief asks for. Notifications are written by the Edge
 * Functions that approve retests, assign tests, publish SOPs and record scores;
 * this component only reads and marks them.
 */
export function NotificationBell({ staffId, token }: { staffId: string; token: string }) {
  const [open, setOpen] = useState(false)
  const count = unreadCount(staffId)
  const items = notificationsFor(staffId)

  async function openSheet() {
    setOpen(true)
    if (count > 0) await api.markNotificationsRead(token)
  }

  return (
    <>
      <button className="iconbtn" onClick={openSheet} aria-label={`Notifications, ${count} unread`}>
        🔔
        {count > 0 && <span className="badge-dot">{count > 9 ? '9+' : count}</span>}
      </button>

      {open && (
        <Sheet title="Notifications" onClose={() => setOpen(false)}>
          {items.length === 0 ? (
            <Empty icon="🔔" title="No notifications yet">
              You’ll be told here when a test is assigned, a retest is approved, a new SOP is published, or a
              score is recorded.
            </Empty>
          ) : (
            <div>
              {items.map((n) => (
                <div className="notif" key={n.id}>
                  <span className={`notif__dot ${n.read ? 'notif__dot--read' : ''}`} aria-hidden />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '0.9rem' }}>{n.text}</div>
                    <div className="tiny" style={{ marginTop: 3 }}>
                      {kindLabel(n.kind)} · {formatDateTime(n.created_at)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Sheet>
      )}
    </>
  )
}

function kindLabel(kind: string): string {
  return (
    {
      retest_approved: 'Retest approved',
      test_assigned: 'Test assigned',
      sop_published: 'SOP published',
      score_recorded: 'Score recorded',
    }[kind] ?? 'Update'
  )
}

/** Named export kept small so screens can also show a bell without the sheet. */
export function unreadBadge(staffId: string): number {
  void read
  return unreadCount(staffId)
}
