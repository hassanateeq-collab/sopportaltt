import { useState } from 'react'
import { read, hasAckedPolicy } from '../data/store'
import type { Actor } from '../data/store'
import type { Policy } from '../types'
import { useStore } from '../lib/useStore'
import { SopSectionIcon } from './icons'
import { PolicyReader } from './PolicyReader'

/**
 * The read-&-acknowledge policy board for the admin and the managers. Lists every
 * PUBLISHED policy (grouped by department); opening one shows the document and
 * the acknowledge button. HR publishes these elsewhere.
 */
export function PoliciesReadBoard({ actor }: { actor: Actor }) {
  useStore()
  const [reading, setReading] = useState<Policy | null>(null)

  if (reading) {
    const fresh = read.policies().find((p) => p.id === reading.id) ?? reading
    return <PolicyReader actor={actor} policy={fresh} onBack={() => setReading(null)} />
  }

  const departments = read.departments().slice().sort((a, b) => a.code.localeCompare(b.code))
  const published = read.policies().filter((p) => p.status === 'published')

  if (published.length === 0) {
    return <div className="board"><div className="empty-row">No policies published yet — HR will add them here.</div></div>
  }

  return (
    <>
      <p className="demo-hint" style={{ marginBottom: 14 }}>
        Company policies published by HR. Open each one and acknowledge that you’ve read it.
      </p>
      {departments.map((d) => {
        const list = published.filter((p) => p.department_id === d.id).sort((a, b) => a.code.localeCompare(b.code))
        if (list.length === 0) return null
        return (
          <details className="board" open key={d.id}>
            <summary><SopSectionIcon />{d.name}<span className="hint">{list.length} polic{list.length === 1 ? 'y' : 'ies'}</span></summary>
            {list.map((p) => {
              const acked = hasAckedPolicy(actor, p)
              return (
                <div className="brow" key={p.id}>
                  <div className="brow-top">
                    <span className="brow-title">
                      <span className="ver">{p.code}</span> {p.title} <span className="ver">v{p.version}</span>{' '}
                      {acked
                        ? <span className="livechip">✓ ACKNOWLEDGED</span>
                        : <span className="vidchip">● NEEDS ACK</span>}
                    </span>
                    <button className="btn sm primary" onClick={() => setReading(p)}>
                      {acked ? 'Read again' : 'Read & acknowledge'}
                    </button>
                  </div>
                  {p.summary && <div className="names"><span className="nm">{p.summary}</span></div>}
                </div>
              )
            })}
          </details>
        )
      })}
    </>
  )
}
