import { useEffect, useState } from 'react'
import { initStore, api, read, getResumedActor, actorName } from './data/store'
import type { Actor } from './data/store'
import type { Staff } from './types'
import { useStore } from './lib/useStore'
import { StaffLogin } from './screens/StaffLogin'
import { StaffPortal } from './screens/StaffPortal'
import { ManagerLogin } from './screens/ManagerLogin'
import { ManagerPortal } from './screens/ManagerPortal'
import { NotificationBell } from './components/NotificationBell'
import { MgmtNotificationBell } from './components/MgmtNotificationBell'
import { Toaster } from './lib/toast'

type Section = 'staff' | 'mgmt'
const STAFF_TOKEN_KEY = 'hamsun-sop-portal/staff-token'

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
            {ready && section === 'mgmt' && actor && (
              <>
                <span className="topuser">{actorName(actor)}</span>
                <MgmtNotificationBell
                  actor={actor}
                  onNavigate={(page) => setMgmtNav({ page, nonce: Date.now() })}
                />
                <button className="btn sm" onClick={logoutMgmt}>Sign out</button>
              </>
            )}
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
