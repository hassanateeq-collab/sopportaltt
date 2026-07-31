import { useEffect, useState } from 'react'
import { initStore, api, read } from './data/store'
import type { Actor } from './data/store'
import type { Staff } from './types'
import { useStore } from './lib/useStore'
import { Landing } from './screens/Landing'
import { StaffLogin } from './screens/StaffLogin'
import { StaffPortal } from './screens/StaffPortal'
import { ManagerLogin } from './screens/ManagerLogin'
import { ManagerPortal } from './screens/ManagerPortal'
import { Spinner } from './components/ui'

type Route =
  | { name: 'landing' }
  | { name: 'staff-login' }
  | { name: 'staff'; staff: Staff; token: string }
  | { name: 'manager-login' }
  | { name: 'manager'; actor: Actor }

const STAFF_TOKEN_KEY = 'hamsun-sop-portal/staff-token'

export function App() {
  const [ready, setReady] = useState(false)
  const [route, setRoute] = useState<Route>({ name: 'landing' })
  useStore()

  useEffect(() => {
    let active = true
    initStore().then(() => {
      if (!active) return
      // Resume a staff shift session across a reload without a second code entry.
      const token = localStorage.getItem(STAFF_TOKEN_KEY)
      if (token) {
        const staff = api.resumeStaffSession(token)
        if (staff) setRoute({ name: 'staff', staff, token })
        else localStorage.removeItem(STAFF_TOKEN_KEY)
      }
      setReady(true)
    })
    return () => {
      active = false
    }
  }, [])

  if (!ready) {
    return (
      <div className="app" style={{ display: 'grid', placeItems: 'center' }}>
        <div className="row" style={{ color: 'var(--brand)' }}>
          <Spinner /> <span className="muted">Loading portal…</span>
        </div>
      </div>
    )
  }

  switch (route.name) {
    case 'landing':
      return (
        <Landing
          onStaff={() => setRoute({ name: 'staff-login' })}
          onManager={() => setRoute({ name: 'manager-login' })}
        />
      )

    case 'staff-login':
      return (
        <StaffLogin
          onBack={() => setRoute({ name: 'landing' })}
          onLoggedIn={(staff, token) => {
            localStorage.setItem(STAFF_TOKEN_KEY, token)
            setRoute({ name: 'staff', staff, token })
          }}
        />
      )

    case 'staff': {
      const fresh = read.staffMember(route.staff.id) ?? route.staff
      return (
        <StaffPortal
          staff={fresh}
          token={route.token}
          onLogout={() => {
            api.staffLogout(route.token)
            localStorage.removeItem(STAFF_TOKEN_KEY)
            setRoute({ name: 'landing' })
          }}
        />
      )
    }

    case 'manager-login':
      return (
        <ManagerLogin
          onBack={() => setRoute({ name: 'landing' })}
          onLoggedIn={(actor) => setRoute({ name: 'manager', actor })}
        />
      )

    case 'manager':
      return <ManagerPortal actor={route.actor} onLogout={() => setRoute({ name: 'landing' })} />
  }
}
