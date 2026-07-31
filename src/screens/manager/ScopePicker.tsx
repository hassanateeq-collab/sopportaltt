import { read } from '../../data/store'
import type { Actor } from '../../data/store'
import type { BranchScope } from '../../types'
import { Field } from '../../components/ui'

/**
 * Choosing the branch scope of an SOP or test.
 *
 * This is where the roles earn their meaning. Only an admin publishes
 * group-wide; a manager is confined to her own branch, so for a manager this
 * renders as a fixed, non-editable statement rather than a set of choices.
 */
export function ScopePicker({
  actor,
  value,
  onChange,
}: {
  actor: Actor
  value: BranchScope
  onChange: (scope: BranchScope) => void
}) {
  const branches = read.branches()

  if (actor.kind === 'manager') {
    const branch = read.branch(actor.manager.branch_id)
    return (
      <Field label="Branch scope">
        <div className="notice notice--info">
          Your branch only — {branch?.code} {branch?.name}. Only an admin can publish to all branches.
        </div>
      </Field>
    )
  }

  const mode: 'all' | 'list' = value.kind === 'ALL' ? 'all' : 'list'
  const selected = value.kind === 'LIST' ? value.branch_codes : []

  return (
    <Field label="Branch scope" hint="One record, one scope — never a copy per branch. A new branch inherits every ‘all branches’ record automatically.">
      <div className="choices" style={{ marginBottom: selected !== null && mode === 'list' ? 10 : 0 }}>
        <button
          type="button"
          className={`choice ${mode === 'all' ? 'choice--on' : ''}`}
          onClick={() => onChange({ kind: 'ALL' })}
        >
          <span className="choice__label">All branches</span>
          <span className="choice__meta">Group-wide, including branches added later</span>
        </button>
        <button
          type="button"
          className={`choice ${mode === 'list' ? 'choice--on' : ''}`}
          onClick={() => onChange({ kind: 'LIST', branch_codes: selected.length ? selected : [branches[0].code] })}
        >
          <span className="choice__label">Specific branches</span>
          <span className="choice__meta">Choose which branches this applies to</span>
        </button>
      </div>

      {mode === 'list' && (
        <div className="choices choices--2" style={{ marginTop: 4 }}>
          {branches.map((b) => {
            const on = selected.includes(b.code)
            return (
              <button
                key={b.id}
                type="button"
                className={`choice ${on ? 'choice--on' : ''}`}
                style={{ justifyContent: 'space-between' }}
                onClick={() => {
                  const next = on ? selected.filter((c) => c !== b.code) : [...selected, b.code]
                  onChange({ kind: 'LIST', branch_codes: next })
                }}
              >
                <span className="choice__code">{b.code}</span>
                <span>{on ? '✓' : ''}</span>
              </button>
            )
          })}
        </div>
      )}
    </Field>
  )
}
