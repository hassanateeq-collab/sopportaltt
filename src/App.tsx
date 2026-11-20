import { useEffect, useState } from 'react'
import { initStore, api, read, getResumedActor, actorName, hasAckedPolicy } from './data/store'
import type { Actor } from './data/store'
import type { Staff } from './types'
import { useStore } from './lib/useStore'
import { StaffLogin } from './screens/StaffLogin'
import { StaffPortal } from './screens/StaffPortal'
import { ManagerLogin } from './screens/ManagerLogin'
import { ManagerPortal } from './screens/ManagerPortal'
import { NotificationBell } from './components/NotificationBell'
import { BellIcon } from './components/icons'
import { Toaster } from './lib/toast'

type Section = 'staff' | 'mgmt'
const STAFF_TOKEN_KEY = 'hamsun-sop-portal/staff-token'

/** What the management notification bell counts, and where it jumps to. */
function mgmtBell(actor: Actor): { count: number; target: string; title: string } {
  if (actor.kind === 'admin' || actor.manager.role === 'hr') {
    const n = read.sops().filter((s) => s.approval_status === 'admin_review').length
    return { count: n, target: 'approvals', title: n ? `${n} SOP${n === 1 ? '' : 's'} awaiting review` : 'SOP approvals' }
  }
  const n = read.policies().filter((p) => p.status === 'published' && !hasAckedPolicy(actor, p)).length
  return { count: n, target: 'policies', title: n ? `${n} polic${n === 1 ? 'y' : 'ies'} to acknowledge` : 'Policies' }
}

export function App() {
  const [ready, setReady] = useState(false)
  const [section, setSection] = useState<Section>('staff')
  const [staffSession, setStaffSession] = useState<{ staff: Staff; token: string } | null>(null)
  const [actor, setActor] = useState<Actor | null>(null)
  const [mgmtNav, setMgmtNav] = useState<{ page: string; nonce: number } | null>(null)
  useStore()

  const logoutMgmt = () => {
    void api.managerLogout()
    setActor(null)
  }

  useEffect(() => {
    let active = true
    initStore().then(() => {
      if (!active) return
      const resumed = getResumedActor()
      if (resumed) {
        setActor(resumed)
        setSection('mgmt')
      }
      const token = localStorage.getItem(STAFF_TOKEN_KEY)
      if (token) {
        const staff = api.resumeStaffSession(token)
        if (staff) setStaffSession({ staff, token })
        else localStorage.removeItem(STAFF_TOKEN_KEY)
      }
      setReady(true)
    })
    return () => {
      active = false
    }
  }, [])

  const mgmtLabel = actor ? (actor.kind === 'admin' ? 'Admin' : 'Manager') : 'Manager · Admin'

  return (
    <>
      <header className="topbar">
        <div className="topbar-in">
          <div className="wordmark">
            <span className="brand">HAMSUN</span>
            <span className="app">SOP Portal</span>
          </div>
          <div className="topbar-right">
            <div className="seg" role="group" aria-label="View">
              <button aria-pressed={section === 'staff'} onClick={() => setSection('staff')}>
                Staff
              </button>
              <button aria-pressed={section === 'mgmt'} onClick={() => setSection('mgmt')}>
                {mgmtLabel}
              </button>
            </div>
            {ready && section === 'staff' && staffSession && (
              <span className="bell-slot"><NotificationBell staffId={staffSession.staff.id} token={staffSession.token} /></span>
            )}
            {ready && section === 'mgmt' && actor && (() => {
              const b = mgmtBell(actor)
              return (
                <>
                  <span className="topuser">{actorName(actor)}</span>
                  <button
                    type="button"
                    className="reviewbell"
                    title={b.title}
                    aria-label={b.title}
                    onClick={() => setMgmtNav({ page: b.target, nonce: Date.now() })}
                  >
                    <BellIcon />
                    {b.count > 0 && <span className="reviewbell-badge">{b.count}</span>}
                  </button>
                  <button className="btn sm" onClick={logoutMgmt}>Sign out</button>
                </>
              )
            })()}
          </div>
        </div>
      </header>

      <main className="wrap">
        {!ready ? (
          <p className="foot" style={{ marginTop: 60 }}>
            Loading portal…
          </p>
        ) : section === 'staff' ? (
          staffSession ? (
            <StaffPortal
              staff={read.staffMember(staffSession.staff.id) ?? staffSession.staff}
              token={staffSession.token}
              onLogout={() => {
                api.staffLogout(staffSession.token)
                localStorage.removeItem(STAFF_TOKEN_KEY)
                setStaffSession(null)
              }}
            />
          ) : (
            <StaffLogin
              onLoggedIn={(staff, token) => {
                localStorage.setItem(STAFF_TOKEN_KEY, token)
                setStaffSession({ staff, token })
              }}
            />
          )
        ) : actor ? (
          <ManagerPortal actor={actor} navTo={mgmtNav} />
        ) : (
          <ManagerLogin onLoggedIn={(a) => setActor(a)} />
        )}
      </main>

      <Toaster />
    </>
  )
}
