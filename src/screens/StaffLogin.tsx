import { useMemo, useState } from 'react'
import { api, read, ApiError } from '../data/store'
import type { Staff } from '../types'
import { TopBar, Spinner, Notice } from '../components/ui'

/**
 * Staff sign-in: branch, then department, then their own name, then a numeric
 * code. This is the right login for hotel line staff — no emails, no passwords,
 * onboarding is "add a row and hand over the code".
 *
 * The wrong-code lockout is counted and enforced server-side (see
 * api.staffLogin); this screen only surfaces what the server says. It never
 * counts attempts itself, because a browser-side counter is trivially bypassed.
 */
export function StaffLogin({
  onBack,
  onLoggedIn,
}: {
  onBack: () => void
  onLoggedIn: (staff: Staff, token: string) => void
}) {
  const [branchId, setBranchId] = useState<string | null>(null)
  const [departmentId, setDepartmentId] = useState<string | null>(null)
  const [staffId, setStaffId] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const branches = read.branches().filter((b) => b.status === 'open')
  const departments = read.departments()

  const staffHere = useMemo(() => {
    if (!branchId || !departmentId) return []
    return read
      .staff()
      .filter((s) => s.branch_id === branchId && s.department_id === departmentId && s.active)
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [branchId, departmentId])

  const step: 'branch' | 'department' | 'name' | 'code' = !branchId
    ? 'branch'
    : !departmentId
      ? 'department'
      : !staffId
        ? 'name'
        : 'code'

  const staff = staffId ? read.staffMember(staffId) : null

  async function submit() {
    if (!staffId) return
    setBusy(true)
    setError(null)
    try {
      const session = await api.staffLogin(staffId, code)
      const s = read.staffMember(staffId)!
      onLoggedIn(s, session.token)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.')
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  function back() {
    setError(null)
    if (step === 'code') setStaffId(null)
    else if (step === 'name') setDepartmentId(null)
    else if (step === 'department') setBranchId(null)
    else onBack()
  }

  return (
    <div className="app">
      <TopBar title="Staff sign-in" subtitle={stepLabel(step)} onBack={back} />
      <main className="main">
        {step === 'branch' && (
          <section className="section">
            <div className="eyebrow" style={{ marginBottom: 10 }}>
              Step 1 · Choose your branch
            </div>
            <div className="choices">
              {branches.map((b) => (
                <button key={b.id} className="choice" onClick={() => setBranchId(b.id)}>
                  <span>
                    <span className="choice__code">{b.code}</span>
                    <span className="choice__label" style={{ marginLeft: 10 }}>
                      {b.name}
                    </span>
                  </span>
                  <span aria-hidden>›</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {step === 'department' && (
          <section className="section">
            <div className="eyebrow" style={{ marginBottom: 10 }}>
              Step 2 · Choose your department
            </div>
            <div className="choices">
              {departments.map((d) => (
                <button key={d.id} className="choice" onClick={() => setDepartmentId(d.id)}>
                  <span>
                    <span className="choice__code">{d.code}</span>
                    <span className="choice__label" style={{ marginLeft: 10 }}>
                      {d.name}
                    </span>
                  </span>
                  <span aria-hidden>›</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {step === 'name' && (
          <section className="section">
            <div className="eyebrow" style={{ marginBottom: 10 }}>
              Step 3 · Choose your name
            </div>
            {staffHere.length === 0 ? (
              <Notice tone="info">
                No staff are listed for this department at this branch yet. Ask your manager to add you.
              </Notice>
            ) : (
              <div className="choices">
                {staffHere.map((s) => (
                  <button key={s.id} className="choice" onClick={() => setStaffId(s.id)}>
                    <span>
                      <span className="choice__label">{s.name}</span>
                      <span className="choice__meta" style={{ display: 'block' }}>
                        {s.job_title}
                      </span>
                    </span>
                    <span aria-hidden>›</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {step === 'code' && staff && (
          <section className="section">
            <div className="card">
              <div className="eyebrow">Step 4 · Enter your code</div>
              <h2 style={{ marginTop: 6 }}>{staff.name}</h2>
              <p className="muted" style={{ marginBottom: 14 }}>
                {read.department(staff.department_id)?.name} · {read.branch(staff.branch_id)?.name}
              </p>

              <input
                className="input input--code"
                inputMode="numeric"
                autoComplete="off"
                autoFocus
                maxLength={8}
                value={code}
                placeholder="••••••"
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && code.length >= 4 && !busy) submit()
                }}
                aria-label="Employee code"
              />

              {error && (
                <div style={{ marginTop: 12 }}>
                  <Notice tone="bad">{error}</Notice>
                </div>
              )}

              <button
                className="btn btn--block"
                style={{ marginTop: 14 }}
                disabled={code.length < 4 || busy}
                onClick={submit}
              >
                {busy ? <Spinner /> : 'Sign in'}
              </button>
              <p className="tiny" style={{ marginTop: 10, textAlign: 'center' }}>
                Three wrong codes locks this name for 15 minutes.
              </p>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

function stepLabel(step: string): string {
  return { branch: 'Branch', department: 'Department', name: 'Your name', code: 'Your code' }[step] ?? ''
}
