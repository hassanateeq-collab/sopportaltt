import { useState } from 'react'
import { api, ApiError } from '../data/store'
import type { Actor } from '../data/store'
import { isSupabaseEnabled } from '../lib/supabase'

/**
 * Manager / admin sign-in — email + password via Supabase Auth (or the demo
 * password map when Supabase isn't configured). Authority is enforced by RLS
 * scoped to the account's department and branch, not by this screen.
 */
export function ManagerLogin({ onLoggedIn }: { onLoggedIn: (actor: Actor) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    setBusy(true)
    setError('')
    try {
      onLoggedIn(await api.managerLogin(email, password))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not sign in.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="lead">
        <div className="kb">Manager · Admin</div>
        <h2>Manager &amp; admin sign-in</h2>
        <p>Managers publish SOPs and tests for their own department at their branch, and assign tests by name. Admins oversee every branch.</p>
      </div>
      <div className="kcard">
        <div className="field">
          <label htmlFor="m-email">Email</label>
          <input id="m-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@hamsun.example" />
        </div>
        <div className="field">
          <label htmlFor="m-pass">Password</label>
          <input
            id="m-pass"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !busy) void submit() }}
            placeholder="••••••••"
          />
        </div>
        {error && <div className="err">{error}</div>}
        <button className="btn primary block" disabled={busy || !email || !password} onClick={() => void submit()}>
          {busy ? <span className="spinner" /> : 'Sign in'}
        </button>
        {isSupabaseEnabled ? (
          <div className="demo-hint">Sign in with your work email and password.</div>
        ) : (
          <div className="demo-hint">
            Demo · admin@hamsun.example / admin123
            <br />
            mehreen.kitchen.fsl@hamsun.example / kitchen123 · owais.housekeeping.clf@hamsun.example / housekeeping123
          </div>
        )}
      </div>
    </>
  )
}
