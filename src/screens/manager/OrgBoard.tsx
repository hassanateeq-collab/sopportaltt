import { useState } from 'react'
import { api, read, ApiError } from '../../data/store'
import type { Actor } from '../../data/store'
import type { Staff } from '../../types'
import { Badge, Notice, Field, Spinner, Sheet, Empty } from '../../components/ui'

/**
 * The admin-only org board: branches, departments, staff and managers. This is
 * the piece that makes onboarding "add a row and hand over the code" and
 * offboarding "deactivate the row".
 *
 * Adding a staff member shows the generated employee code exactly once. It is
 * never stored in plaintext — only its hash — so if the admin loses it the only
 * remedy is to regenerate.
 */
export function OrgBoard({ actor }: { actor: Actor }) {
  const [tab, setTab] = useState<'staff' | 'branches' | 'departments' | 'managers'>('staff')

  return (
    <section>
      <h2 style={{ marginBottom: 12 }}>Organisation</h2>

      <div className="tabs">
        {(['staff', 'branches', 'departments', 'managers'] as const).map((t) => (
          <button key={t} className={`tab ${tab === t ? 'tab--on' : ''}`} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'staff' && <StaffAdmin actor={actor} />}
      {tab === 'branches' && <BranchAdmin actor={actor} />}
      {tab === 'departments' && <DepartmentAdmin actor={actor} />}
      {tab === 'managers' && <ManagerAdmin actor={actor} />}
    </section>
  )
}

/* --------------------------------------------------------------- staff ----- */

function StaffAdmin({ actor }: { actor: Actor }) {
  const [adding, setAdding] = useState(false)
  const [branchFilter, setBranchFilter] = useState('all')
  const [codeReveal, setCodeReveal] = useState<{ name: string; code: string } | null>(null)

  const staff = read
    .staff()
    .filter((s) => branchFilter === 'all' || s.branch_id === branchFilter)
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div>
      <div className="spread" style={{ marginBottom: 12 }}>
        <select className="select" style={{ maxWidth: 200 }} value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
          <option value="all">All branches</option>
          {read.branches().map((b) => (
            <option key={b.id} value={b.id}>
              {b.code}
            </option>
          ))}
        </select>
        <button className="btn btn--sm" onClick={() => setAdding(true)}>
          + Add staff
        </button>
      </div>

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Dept</th>
              <th>Branch</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <StaffRow key={s.id} actor={actor} staff={s} onCode={(code) => setCodeReveal({ name: s.name, code })} />
            ))}
          </tbody>
        </table>
      </div>

      {adding && <AddStaff actor={actor} onClose={() => setAdding(false)} onCreated={(name, code) => setCodeReveal({ name, code })} />}
      {codeReveal && <CodeReveal name={codeReveal.name} code={codeReveal.code} onClose={() => setCodeReveal(null)} />}
    </div>
  )
}

function StaffRow({ actor, staff, onCode }: { actor: Actor; staff: Staff; onCode: (code: string) => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <tr style={{ opacity: staff.active ? 1 : 0.55 }}>
      <td className="wrap">{staff.name}</td>
      <td>{read.department(staff.department_id)?.code}</td>
      <td>{read.branch(staff.branch_id)?.code}</td>
      <td>{staff.active ? <Badge tone="ok">Active</Badge> : <Badge tone="neutral">Inactive</Badge>}</td>
      <td>
        <div className="row" style={{ gap: 6 }}>
          <button
            className="linkbtn"
            onClick={async () => {
              if (!confirm(`Regenerate ${staff.name}’s code? Their old code stops working immediately.`)) return
              setBusy(true)
              try {
                const code = await api.regenerateStaffCode(actor, staff.id)
                onCode(code)
              } catch (e) {
                alert(e instanceof ApiError ? e.message : 'Could not regenerate.')
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? '…' : 'New code'}
          </button>
          <button
            className="linkbtn"
            onClick={async () => {
              try {
                await api.setStaffActive(actor, staff.id, !staff.active)
              } catch (e) {
                alert(e instanceof ApiError ? e.message : 'Could not update.')
              }
            }}
          >
            {staff.active ? 'Deactivate' : 'Reactivate'}
          </button>
        </div>
      </td>
    </tr>
  )
}

function AddStaff({
  actor,
  onClose,
  onCreated,
}: {
  actor: Actor
  onClose: () => void
  onCreated: (name: string, code: string) => void
}) {
  const [name, setName] = useState('')
  const [departmentId, setDepartmentId] = useState(read.departments()[0]?.id ?? '')
  const [branchId, setBranchId] = useState(read.branches()[0]?.id ?? '')
  const [jobTitle, setJobTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const { code } = await api.addStaff(actor, { name, department_id: departmentId, branch_id: branchId, job_title: jobTitle })
      onCreated(name, code)
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not add staff.')
      setBusy(false)
    }
  }

  return (
    <Sheet title="Add staff" onClose={onClose}>
      <Field label="Full name">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Job title">
        <input className="input" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="e.g. Room Attendant" />
      </Field>
      <div className="row" style={{ gap: 10 }}>
        <Field label="Department">
          <select className="select" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            {read.departments().map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} — {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Branch">
          <select className="select" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            {read.branches().map((b) => (
              <option key={b.id} value={b.id}>
                {b.code}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {error && <Notice tone="bad">{error}</Notice>}
      <button className="btn btn--block" style={{ marginTop: 12 }} disabled={busy || !name.trim()} onClick={submit}>
        {busy ? <Spinner /> : 'Add and generate code'}
      </button>
    </Sheet>
  )
}

/** The one-and-only showing of a generated code. */
function CodeReveal({ name, code, onClose }: { name: string; code: string; onClose: () => void }) {
  return (
    <Sheet title="Employee code" onClose={onClose}>
      <p className="muted" style={{ marginBottom: 12 }}>
        Hand this code to <strong>{name}</strong>. It is shown once and cannot be retrieved — only the hash is
        stored. If it’s lost, generate a new one.
      </p>
      <div className="codebox">{code}</div>
      <button className="btn btn--block" style={{ marginTop: 16 }} onClick={onClose}>
        Done — I’ve noted it
      </button>
    </Sheet>
  )
}

/* -------------------------------------------------------------- branches --- */

function BranchAdmin({ actor }: { actor: Actor }) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [preOpening, setPreOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function add() {
    setBusy(true)
    setError(null)
    try {
      await api.addBranch(actor, code, name, preOpening ? 'pre_opening' : 'open')
      setCode('')
      setName('')
      setPreOpening(false)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not add branch.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="stack" style={{ marginBottom: 16 }}>
        {read.branches().map((b) => (
          <div className="spread card" key={b.id} style={{ padding: 13 }}>
            <div>
              <span className="tile__code">{b.code}</span>
              <span style={{ marginLeft: 10, fontWeight: 600 }}>{b.name}</span>
            </div>
            <Badge tone={b.status === 'open' ? 'ok' : 'accent'}>{b.status === 'open' ? 'Open' : 'Pre-opening'}</Badge>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="eyebrow" style={{ marginBottom: 10 }}>
          Add branch
        </div>
        <Notice tone="info">
          A new branch inherits every “all branches” SOP and test the moment it’s added — nothing is copied or
          re-assigned.
        </Notice>
        <div className="row" style={{ gap: 10, marginTop: 12 }}>
          <Field label="Code">
            <input className="input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="DHA" maxLength={4} />
          </Field>
          <Field label="Name">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="DHA" />
          </Field>
        </div>
        <label className="row" style={{ gap: 8, marginBottom: 12 }}>
          <input type="checkbox" checked={preOpening} onChange={(e) => setPreOpening(e.target.checked)} />
          <span className="muted">Pre-opening (not yet taking staff logins)</span>
        </label>
        {error && <Notice tone="bad">{error}</Notice>}
        <button className="btn btn--block" style={{ marginTop: 6 }} disabled={busy || !code || !name} onClick={add}>
          {busy ? <Spinner /> : 'Add branch'}
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ departments -- */

function DepartmentAdmin({ actor }: { actor: Actor }) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function add() {
    setBusy(true)
    setError(null)
    try {
      await api.addDepartment(actor, code, name)
      setCode('')
      setName('')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not add department.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="stack" style={{ marginBottom: 16 }}>
        {read.departments().map((d) => (
          <div className="spread card" key={d.id} style={{ padding: 13 }}>
            <div>
              <span className="tile__code">{d.code}</span>
              <span style={{ marginLeft: 10, fontWeight: 600 }}>{d.name}</span>
            </div>
            <span className="tiny">Doc codes {d.code}-001…</span>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="eyebrow" style={{ marginBottom: 10 }}>
          Add department
        </div>
        <div className="row" style={{ gap: 10 }}>
          <Field label="Code">
            <input className="input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="SP" maxLength={4} />
          </Field>
          <Field label="Name">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Spa" />
          </Field>
        </div>
        {error && <Notice tone="bad">{error}</Notice>}
        <button className="btn btn--block" style={{ marginTop: 6 }} disabled={busy || !code || !name} onClick={add}>
          {busy ? <Spinner /> : 'Add department'}
        </button>
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- managers -- */

function ManagerAdmin({ actor }: { actor: Actor }) {
  const [adding, setAdding] = useState(false)

  return (
    <div>
      <div className="spread" style={{ marginBottom: 12 }}>
        <p className="muted">Each manager owns one department at one branch.</p>
        <button className="btn btn--sm" onClick={() => setAdding(true)}>
          + Add manager
        </button>
      </div>

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Department</th>
              <th>Branch</th>
            </tr>
          </thead>
          <tbody>
            {read.managers().map((m) => (
              <tr key={m.id}>
                <td className="wrap">{m.name}</td>
                <td className="wrap">{m.email}</td>
                <td>{read.department(m.department_id)?.name}</td>
                <td>{read.branch(m.branch_id)?.code}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {adding && <AddManager actor={actor} onClose={() => setAdding(false)} />}
    </div>
  )
}

function AddManager({ actor, onClose }: { actor: Actor; onClose: () => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [departmentId, setDepartmentId] = useState(read.departments()[0]?.id ?? '')
  const [branchId, setBranchId] = useState(read.branches()[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await api.addManager(actor, { name, email, department_id: departmentId, branch_id: branchId })
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not add manager.')
      setBusy(false)
    }
  }

  return (
    <Sheet title="Add manager" onClose={onClose}>
      <Field label="Full name">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Email" hint="In production this becomes their Supabase Auth login.">
        <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <div className="row" style={{ gap: 10 }}>
        <Field label="Department">
          <select className="select" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            {read.departments().map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} — {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Branch">
          <select className="select" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            {read.branches().map((b) => (
              <option key={b.id} value={b.id}>
                {b.code}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {error && <Notice tone="bad">{error}</Notice>}
      <button className="btn btn--block" style={{ marginTop: 12 }} disabled={busy || !name || !email} onClick={submit}>
        {busy ? <Spinner /> : 'Add manager'}
      </button>
      <div style={{ marginTop: 10 }}>
        <Empty icon="🔒" title="" >
          RLS confines each manager to her own department and branch — her queries can’t return another patch’s rows.
        </Empty>
      </div>
    </Sheet>
  )
}
