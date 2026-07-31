import { useState } from 'react'
import { read } from '../data/store'
import type { Actor } from '../data/store'
import { TopBar, Badge } from '../components/ui'
import { SopBoard } from './manager/SopBoard'
import { TestBoard } from './manager/TestBoard'
import { OrgBoard } from './manager/OrgBoard'
import { scopeOf } from './manager/scope'

/**
 * The manager / admin portal.
 *
 * A manager sees only her own department at her own branch, across SOPs and
 * tests. An admin sees everything and additionally gets the org board — adding
 * branches, departments, staff and managers, and publishing group-wide.
 */
export function ManagerPortal({ actor, onLogout }: { actor: Actor; onLogout: () => void }) {
  const scope = scopeOf(actor)
  const isAdmin = actor.kind === 'admin'
  const [tab, setTab] = useState<'sops' | 'tests' | 'org'>('sops')

  const subtitle = isAdmin
    ? 'Admin · all branches'
    : `${read.department(actor.manager.department_id)?.name} · ${read.branch(actor.manager.branch_id)?.name}`

  const tabs: Array<{ id: 'sops' | 'tests' | 'org'; label: string }> = [
    { id: 'sops', label: 'SOPs' },
    { id: 'tests', label: 'Tests' },
    ...(isAdmin ? [{ id: 'org' as const, label: 'Organisation' }] : []),
  ]

  return (
    <div className="app">
      <TopBar
        title={isAdmin ? actor.admin.name : actor.manager.name}
        subtitle={subtitle}
        actions={
          <button className="iconbtn" onClick={onLogout} aria-label="Sign out">
            ⎋
          </button>
        }
      />

      <div style={{ background: 'var(--paper)', borderBottom: '1px solid var(--line)', padding: '10px 14px 0' }}>
        <div style={{ maxWidth: 1180, margin: '0 auto' }}>
          <div className="row" style={{ marginBottom: 8 }}>
            <Badge tone={isAdmin ? 'brand' : 'neutral'}>{isAdmin ? 'Group admin' : 'Department manager'}</Badge>
            {!isAdmin && <span className="tiny">Confined to your department and branch by row-level security</span>}
          </div>
          <div className="tabs" style={{ marginBottom: 0 }}>
            {tabs.map((t) => (
              <button key={t.id} className={`tab ${tab === t.id ? 'tab--on' : ''}`} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <main className="main main--wide">
        {tab === 'sops' && <SopBoard actor={actor} scope={scope} />}
        {tab === 'tests' && <TestBoard actor={actor} scope={scope} />}
        {tab === 'org' && isAdmin && <OrgBoard actor={actor} />}
      </main>
    </div>
  )
}
