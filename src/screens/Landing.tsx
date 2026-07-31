import { resetDemoData } from '../data/store'
import { isSupabaseEnabled } from '../lib/supabase'
import { useState } from 'react'

/**
 * The front door. Two ways in, deliberately: staff pick their way in by branch
 * and name and a code; managers and admins sign in with an email and password.
 */
export function Landing({ onStaff, onManager }: { onStaff: () => void; onManager: () => void }) {
  const [resetting, setResetting] = useState(false)

  return (
    <div className="app">
      <div className="landing">
        <div className="landing__mark" aria-hidden>
          H
        </div>
        <div className="eyebrow">Hamsun Hospitality</div>
        <h1 style={{ fontSize: '1.5rem', marginTop: 4 }}>SOP &amp; Training Portal</h1>
        <p className="muted" style={{ marginTop: 8, marginBottom: 24 }}>
          Read your department’s procedures, sign that you’ve understood them, watch the training, and take
          your certification tests.
        </p>

        <div className="stack">
          <button className="btn btn--block" onClick={onStaff} style={{ minHeight: 56 }}>
            I’m staff — sign in with my code
          </button>
          <button className="btn btn--ghost btn--block" onClick={onManager} style={{ minHeight: 56 }}>
            Manager or admin sign in
          </button>
        </div>

        <p className="tiny" style={{ marginTop: 26, textAlign: 'center' }}>
          Four branches · Front Desk, Housekeeping, Kitchen, Maintenance, Quality &amp; Compliance
        </p>

        {!isSupabaseEnabled && (
          <div style={{ marginTop: 20, textAlign: 'center' }}>
            <button
              className="linkbtn"
              onClick={async () => {
                if (!confirm('Reset all demo data back to its starting state?')) return
                setResetting(true)
                await resetDemoData()
                setResetting(false)
              }}
            >
              {resetting ? 'Resetting…' : 'Reset demo data'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
