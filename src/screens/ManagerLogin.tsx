import { useState } from 'react'
import { api, ApiError } from '../data/store'
import type { Actor } from '../data/store'
import { isSupabaseEnabled } from '../lib/supabase'
import { TopBar, Spinner, Notice } from '../components/ui'

/**
 * Manager and admin sign-in with email and password. In production this is
 * Supabase Auth; the demo checks a small in-memory password map instead. Either
 * way the authority that follows is enforced by row-level security scoped to a
 * department and branch, not by which screen renders.
 */
export function ManagerLogin({ onBack, onLoggedIn }: { onBack: () => void; onLoggedIn: (actor: Actor) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const actor = await api.managerLogin(email, password)
      onLoggedIn(actor)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not sign in.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app">
      <TopBar title="Manager / admin sign-in" onBack={onBack} />
      <main className="main">
        <div className="card">
          <label className="field">
            <span className="field__label">Email</span>
            <input
              className="input"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@hamsun.example"
            />
          </label>
          <label className="field">
            <span className="field__label">Password</span>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !busy) submit()
              }}
              placeholder="••••••••"
            />
          </label>

          {error && <Notice tone="bad">{error}</Notice>}

          <button className="btn btn--block" style={{ marginTop: 12 }} disabled={busy || !email || !password} onClick={submit}>
            {busy ? <Spinner /> : 'Sign in'}
          </button>
        </div>

        {isSupabaseEnabled ? (
          <div style={{ marginTop: 14 }}>
            <Notice tone="info">
              Sign in with your real Supabase account. This portal is connected to your live database.
            </Notice>
          </div>
        ) : (
          <div className="card" style={{ marginTop: 14 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>
              Demo accounts
            </div>
            <div className="stack" style={{ gap: 8 }}>
              <DemoLogin
                label="Admin — all branches"
                email="admin@hamsun.example"
                password="admin123"
                onPick={(e, p) => {
                  setEmail(e)
                  setPassword(p)
                }}
              />
              <DemoLogin
                label="Kitchen manager — FSL only"
                email="mehreen.kitchen.fsl@hamsun.example"
                password="kitchen123"
                onPick={(e, p) => {
                  setEmail(e)
                  setPassword(p)
                }}
              />
              <DemoLogin
                label="Housekeeping manager — Clifton only"
                email="owais.housekeeping.clf@hamsun.example"
                password="housekeeping123"
                onPick={(e, p) => {
                  setEmail(e)
                  setPassword(p)
                }}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

function DemoLogin({
  label,
  email,
  password,
  onPick,
}: {
  label: string
  email: string
  password: string
  onPick: (email: string, password: string) => void
}) {
  return (
    <button className="choice" onClick={() => onPick(email, password)}>
      <span>
        <span className="choice__label">{label}</span>
        <span className="choice__meta" style={{ display: 'block' }}>
          {email}
        </span>
      </span>
      <span className="tiny">Use ›</span>
    </button>
  )
}
