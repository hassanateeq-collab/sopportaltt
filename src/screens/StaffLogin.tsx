import { useEffect, useMemo, useState } from 'react'
import { api, read, staffDirectory, ApiError } from '../data/store'
import { DEMO_STAFF } from '../data/seed'
import { sopsForStaff, testsForStaff } from '../lib/scope'
import { isSupabaseEnabled } from '../lib/supabase'
import type { Staff } from '../types'

/**
 * Staff sign-in funnel, in the prototype's style: choose branch, then
 * department, then your name, then a numeric code. Real login — the code is
 * verified by the data layer (and, in production, the staff-login Edge
 * Function with bcrypt + server-side lockout).
 */
export function StaffLogin({ onLoggedIn }: { onLoggedIn: (staff: Staff, token: string) => void }) {
  const [branchCode, setBranchCode] = useState<string | null>(null)
  const [departmentId, setDepartmentId] = useState<string | null>(null)
  const [staffId, setStaffId] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const branches = read.branches()
  const departments = read.departments()
  const branch = branchCode ? read.branchByCode(branchCode) : null

  // The staff table has no anon read access, so in Supabase mode the name list
  // for a branch comes from the staff-directory Edge Function (id + name only).
  const [directory, setDirectory] = useState<Array<{ id: string; name: string; department_id: string }>>([])
  useEffect(() => {
    if (!isSupabaseEnabled || !branchCode) {
      setDirectory([])
      return
    }
    let active = true
    staffDirectory(branchCode).then((list) => {
      if (active) setDirectory(list)
    })
    return () => {
      active = false
    }
  }, [branchCode])

  const staffHere = useMemo(() => {
    if (!branch || !departmentId) return []
    if (isSupabaseEnabled) {
      return directory
        .filter((s) => s.department_id === departmentId)
        .sort((a, b) => a.name.localeCompare(b.name))
    }
    return read
      .staff()
      .filter((s) => s.branch_id === branch.id && s.department_id === departmentId && s.active)
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [branch, departmentId, directory, read.staff()])

  function countsFor(deptId: string) {
    if (!branch) return { sops: 0, tests: 0, staff: 0 }
    if (isSupabaseEnabled) {
      // SOP/test counts need the tables staff can't read before signing in, so
      // the picker shows only the headcount here.
      return { sops: 0, tests: 0, staff: directory.filter((s) => s.department_id === deptId).length }
    }
    const fake = { department_id: deptId, branch_id: branch.id } as Staff
    return {
      sops: sopsForStaff(read.sops(), fake, branch.code).length,
      tests: testsForStaff(read.tests(), fake, branch.code).length,
      staff: read.staff().filter((s) => s.branch_id === branch.id && s.department_id === deptId).length,
    }
  }

  const crumbs = (
    <div className="crumbs">
      {branchCode ? (
        <button onClick={() => { setBranchCode(null); setDepartmentId(null); setStaffId(''); setError('') }}>Branches</button>
      ) : (
        <span className="here">Branches</span>
      )}
      {branchCode && (
        <>
          <span className="sep">/</span>
          {departmentId ? (
            <button onClick={() => { setDepartmentId(null); setStaffId(''); setError('') }}>{branchCode}</button>
          ) : (
            <span className="here">{branchCode}</span>
          )}
        </>
      )}
      {departmentId && (
        <>
          <span className="sep">/</span>
          <span className="here">{read.department(departmentId)?.name}</span>
        </>
      )}
    </div>
  )

  // Step 1 — branch
  if (!branchCode) {
    return (
      <>
        <div className="lead">
          <div className="kb">Hamsun SOP Portal</div>
          <h2>Choose your branch</h2>
        </div>
        <div className="grid2">
          {branches.map((b) => {
            const n = read.staff().filter((s) => s.branch_id === b.id).length
            return (
              <button key={b.id} className="pick" onClick={() => setBranchCode(b.code)}>
                <div className="code">{b.code}</div>
                <div className="name">{b.name}{b.status === 'pre_opening' ? ' · pre-opening' : ''}</div>
                <div className="sub mono">{n} staff</div>
              </button>
            )
          })}
        </div>
      </>
    )
  }

  // Step 2 — department
  if (!departmentId) {
    return (
      <>
        {crumbs}
        <div className="lead"><h2>Choose your department</h2></div>
        <div className="grid2">
          {departments.map((d) => {
            const c = countsFor(d.id)
            const off = !isSupabaseEnabled && c.sops === 0 && c.tests === 0 && c.staff === 0
            return (
              <button
                key={d.id}
                className={`pick ${off ? 'off' : ''}`}
                disabled={off}
                onClick={() => setDepartmentId(d.id)}
              >
                <div className="name">{d.name}</div>
                <div className="sub">
                  {off ? (
                    'No content at this branch yet'
                  ) : isSupabaseEnabled ? (
                    <><span className="mono">{c.staff}</span> staff</>
                  ) : (
                    <>
                      <span className="mono">{c.sops}</span> SOPs · <span className="mono">{c.tests}</span> tests ·{' '}
                      <span className="mono">{c.staff}</span> staff
                    </>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </>
    )
  }

  // Step 3 — identify
  const demoHint = DEMO_STAFF.filter(
    (s) => branch && s.branch_id === branch.id && s.department_id === departmentId,
  )
    .map((s) => `${s.name} ${s.code}`)
    .join(' · ')

  async function enter() {
    if (!staffId) {
      setError('Select your name first.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const session = await api.staffLogin(staffId, code)
      onLoggedIn(read.staffMember(staffId)!, session.token)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.')
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {crumbs}
      <div className="lead">
        <h2>Who are you?</h2>
        <p>Pick your name and enter your employee code.</p>
      </div>
      <div className="kcard">
        {staffHere.length === 0 ? (
          <div className="allclear">
            No staff registered for {read.department(departmentId)?.name} at {branchCode} yet.
          </div>
        ) : (
          <>
            <div className="field">
              <label htmlFor="k-name">Your name</label>
              <select id="k-name" value={staffId} onChange={(e) => { setStaffId(e.target.value); setError('') }}>
                <option value="">Select your name…</option>
                {staffHere.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="k-code">Employee code</label>
              <input
                id="k-code"
                className="code-input"
                type="password"
                inputMode="numeric"
                maxLength={8}
                placeholder="••••"
                autoComplete="off"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => { if (e.key === 'Enter') void enter() }}
              />
              {!isSupabaseEnabled && demoHint && <div className="demo-hint">Prototype demo codes: {demoHint}</div>}
            </div>
            {error && <div className="err">{error}</div>}
            <button className="btn primary block" disabled={busy} onClick={() => void enter()}>
              {busy ? <span className="spinner" /> : 'Enter'}
            </button>
          </>
        )}
      </div>
    </>
  )
}
