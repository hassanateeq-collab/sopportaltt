import { useState } from 'react'
import { api, read, ApiError } from '../../data/store'
import type { DraftQuestion } from '../../data/store'
import type { Actor } from '../../data/store'
import type { BranchScope, Difficulty, Language, Test } from '../../types'
import { LANGUAGE_NAMES } from '../../types'
import { Field, Notice, Spinner, Sheet, Badge } from '../../components/ui'
import { ScopePicker } from './ScopePicker'
import type { ManagerScope } from './scope'

/**
 * Creating a test: the details, then its questions — authored by hand or drafted
 * from an SOP by the Claude API. Generation never auto-publishes; it returns a
 * draft the manager reviews with each correct answer highlighted, edits, and
 * only then publishes. The manager stays the examiner.
 */
export function TestComposer({ actor, scope, onClose }: { actor: Actor; scope: ManagerScope; onClose: () => void }) {
  const [stage, setStage] = useState<'details' | 'questions'>('details')
  const [test, setTest] = useState<Test | null>(null)

  return (
    <Sheet title={stage === 'details' ? 'New test' : `Questions · ${test?.title ?? ''}`} onClose={onClose}>
      {stage === 'details' ? (
        <DetailsForm
          actor={actor}
          scope={scope}
          onCreated={(t) => {
            setTest(t)
            setStage('questions')
          }}
        />
      ) : (
        test && <QuestionStage actor={actor} test={test} onClose={onClose} />
      )}
    </Sheet>
  )
}

function DetailsForm({
  actor,
  scope,
  onCreated,
}: {
  actor: Actor
  scope: ManagerScope
  onCreated: (test: Test) => void
}) {
  const departments = read.departments()
  const [departmentId, setDepartmentId] = useState(scope.departmentId ?? departments[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [relatedSopId, setRelatedSopId] = useState<string>('')
  const [passMark, setPassMark] = useState(80)
  const [validity, setValidity] = useState(12)
  const [languages, setLanguages] = useState<Language[]>(['en'])
  const [branchScope, setBranchScope] = useState<BranchScope>(
    actor.kind === 'admin' ? { kind: 'ALL' } : { kind: 'LIST', branch_codes: [read.branch(scope.branchId!)!.code] },
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sopsForDept = read.sops().filter((s) => s.department_id === departmentId)

  function toggleLang(l: Language) {
    if (l === 'en') return
    setLanguages((prev) => (prev.includes(l) ? prev.filter((x) => x !== l) : [...prev, l]))
  }

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const t = await api.createTest(actor, {
        title,
        department_id: departmentId,
        branch_scope: branchScope,
        related_sop_id: relatedSopId || null,
        pass_mark: passMark,
        validity_months: validity,
        languages,
      })
      onCreated(t)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not create the test.')
      setBusy(false)
    }
  }

  return (
    <>
      {scope.isAdmin && (
        <Field label="Department">
          <select className="select" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} — {d.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label="Title">
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Food Safety Certification" />
      </Field>

      <Field label="Related SOP" hint="Optional. Staff can revise this SOP and its video before attempting.">
        <select className="select" value={relatedSopId} onChange={(e) => setRelatedSopId(e.target.value)}>
          <option value="">None</option>
          {sopsForDept.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} — {s.title}
            </option>
          ))}
        </select>
      </Field>

      <div className="row" style={{ gap: 10 }}>
        <Field label="Pass mark (%)">
          <input
            className="input"
            type="number"
            min={1}
            max={100}
            value={passMark}
            onChange={(e) => setPassMark(Number(e.target.value))}
          />
        </Field>
        <Field label="Valid for (months)">
          <input
            className="input"
            type="number"
            min={1}
            max={60}
            value={validity}
            onChange={(e) => setValidity(Number(e.target.value))}
          />
        </Field>
      </div>

      <Field label="Languages offered" hint="English is always the canonical record copy. Urdu and Pashto are generated as renderings of the English at publish time.">
        <div className="choices choices--2">
          {(['en', 'ur', 'ps'] as Language[]).map((l) => {
            const on = languages.includes(l)
            return (
              <button
                key={l}
                type="button"
                className={`choice ${on ? 'choice--on' : ''}`}
                style={{ justifyContent: 'space-between', opacity: l === 'en' ? 0.85 : 1 }}
                onClick={() => toggleLang(l)}
              >
                <span className="choice__label">{LANGUAGE_NAMES[l]}</span>
                <span>{l === 'en' ? 'Always' : on ? '✓' : ''}</span>
              </button>
            )
          })}
        </div>
      </Field>

      <ScopePicker actor={actor} value={branchScope} onChange={setBranchScope} />

      {error && <Notice tone="bad">{error}</Notice>}

      <button className="btn btn--block" style={{ marginTop: 12 }} disabled={busy || !title.trim()} onClick={submit}>
        {busy ? <Spinner /> : 'Next: questions'}
      </button>
    </>
  )
}

/* ----------------------------------------------------------- question stage - */

interface EditableQuestion extends DraftQuestion {
  key: string
}

function QuestionStage({ actor, test, onClose }: { actor: Actor; test: Test; onClose: () => void }) {
  const existing = read.questionsFor(test.id)
  const [questions, setQuestions] = useState<EditableQuestion[]>(
    existing.map((q, i) => ({ key: `x${i}`, text: q.text, options: q.options, correct_index: q.correct_index })),
  )
  const [genOpen, setGenOpen] = useState(false)
  const [warnings, setWarnings] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedNote, setSavedNote] = useState<string | null>(null)

  let keySeq = questions.length

  function addBlank() {
    setQuestions((prev) => [
      ...prev,
      { key: `n${keySeq++}${prev.length}`, text: '', options: ['', '', '', ''], correct_index: 0 },
    ])
  }

  function update(key: string, patch: Partial<DraftQuestion>) {
    setQuestions((prev) => prev.map((q) => (q.key === key ? { ...q, ...patch } : q)))
  }

  function remove(key: string) {
    setQuestions((prev) => prev.filter((q) => q.key !== key))
  }

  async function persist(): Promise<boolean> {
    const cleaned = questions
      .map((q) => ({ text: q.text.trim(), options: q.options.map((o) => o.trim()), correct_index: q.correct_index }))
      .filter((q) => q.text && q.options.every((o) => o))
    if (cleaned.length === 0) {
      setError('Add at least one complete question before saving.')
      return false
    }
    try {
      await api.replaceQuestions(actor, test.id, cleaned)
      return true
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save questions.')
      return false
    }
  }

  async function saveDraft() {
    setBusy(true)
    setError(null)
    const ok = await persist()
    setBusy(false)
    if (ok) setSavedNote('Draft saved. You can come back to publish it from the test list.')
  }

  async function publish() {
    setBusy(true)
    setError(null)
    const ok = await persist()
    if (!ok) {
      setBusy(false)
      return
    }
    try {
      // Translations are regenerated from the English at publish time, so they
      // always track the questions the manager just approved.
      const extra = test.languages.filter((l) => l !== 'en')
      if (extra.length > 0) await api.translateTest(actor, test.id, extra)
      await api.publishTest(actor, test.id)
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not publish.')
      setBusy(false)
    }
  }

  return (
    <>
      <div className="row row--wrap" style={{ gap: 8, marginBottom: 12 }}>
        <button className="btn btn--ghost btn--sm" onClick={() => setGenOpen(true)}>
          ✨ Generate from SOP
        </button>
        <button className="btn btn--quiet btn--sm" onClick={addBlank}>
          + Add question
        </button>
      </div>

      {genOpen && (
        <GenerateBlock
          actor={actor}
          test={test}
          onClose={() => setGenOpen(false)}
          onDraft={(drafted, warns) => {
            setQuestions((prev) => [
              ...prev,
              ...drafted.map((q, i) => ({ key: `g${Date.now()}${i}`, ...q })),
            ])
            setWarnings(warns)
            setGenOpen(false)
          }}
        />
      )}

      {warnings.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <Notice tone="warn">
            {warnings.length} generated question{warnings.length === 1 ? ' was' : 's were'} dropped in validation:
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {warnings.map((w, i) => (
                <li key={i} className="tiny">
                  {w}
                </li>
              ))}
            </ul>
          </Notice>
        </div>
      )}

      {questions.length === 0 ? (
        <Notice tone="info">
          No questions yet. Generate a draft from the related SOP, or add questions by hand. Generation only ever
          drafts — you review and edit every question before it goes live.
        </Notice>
      ) : (
        <div className="stack">
          {questions.map((q, qi) => (
            <QuestionEditor key={q.key} index={qi} question={q} onChange={(patch) => update(q.key, patch)} onRemove={() => remove(q.key)} />
          ))}
        </div>
      )}

      {error && (
        <div style={{ marginTop: 12 }}>
          <Notice tone="bad">{error}</Notice>
        </div>
      )}
      {savedNote && (
        <div style={{ marginTop: 12 }}>
          <Notice tone="ok">{savedNote}</Notice>
        </div>
      )}

      <div className="stack" style={{ marginTop: 16 }}>
        <button className="btn btn--block" disabled={busy} onClick={publish}>
          {busy ? <Spinner /> : test.languages.length > 1 ? 'Translate & publish' : 'Publish test'}
        </button>
        <button className="btn btn--quiet btn--block" disabled={busy} onClick={saveDraft}>
          Save as draft
        </button>
      </div>
    </>
  )
}

function QuestionEditor({
  index,
  question,
  onChange,
  onRemove,
}: {
  index: number
  question: DraftQuestion
  onChange: (patch: Partial<DraftQuestion>) => void
  onRemove: () => void
}) {
  const letters = ['A', 'B', 'C', 'D']
  return (
    <div className="card">
      <div className="spread" style={{ marginBottom: 8 }}>
        <span className="eyebrow">Question {index + 1}</span>
        <button className="linkbtn" style={{ color: 'var(--bad)' }} onClick={onRemove}>
          Remove
        </button>
      </div>

      <textarea
        className="textarea"
        style={{ minHeight: 60, marginBottom: 10 }}
        value={question.text}
        onChange={(e) => onChange({ text: e.target.value })}
        placeholder="Question text"
      />

      <div className="stack" style={{ gap: 8 }}>
        {question.options.map((opt, i) => {
          const correct = question.correct_index === i
          return (
            <div key={i} className={`option ${correct ? 'option--correct' : ''}`} style={{ cursor: 'default' }}>
              <button
                className="option__letter"
                style={{ cursor: 'pointer', border: 0 }}
                onClick={() => onChange({ correct_index: i })}
                title="Mark as the correct answer"
                aria-label={`Mark option ${letters[i]} correct`}
              >
                {letters[i]}
              </button>
              <input
                className="input"
                style={{ border: 0, background: 'transparent', minHeight: 'auto', padding: '4px 0' }}
                value={opt}
                onChange={(e) => {
                  const options = [...question.options]
                  options[i] = e.target.value
                  onChange({ options })
                }}
                placeholder={`Option ${letters[i]}`}
              />
              {correct && <Badge tone="ok">Correct</Badge>}
            </div>
          )
        })}
      </div>
      <p className="tiny" style={{ marginTop: 8 }}>
        Tap a letter to mark the correct answer. The highlighted option is what staff must choose.
      </p>
    </div>
  )
}

/**
 * The AI generation block. In production this Edge Function fetches the SOP
 * document straight from Drive; here the manager just picks the SOP. The upload
 * affordance is shown to mirror the production flow, where a PDF is pushed to
 * Drive first.
 */
function GenerateBlock({
  actor,
  test,
  onClose,
  onDraft,
}: {
  actor: Actor
  test: Test
  onClose: () => void
  onDraft: (questions: DraftQuestion[], warnings: string[]) => void
}) {
  const departmentSops = read.sops().filter((s) => s.department_id === test.department_id)
  const [sopId, setSopId] = useState(test.related_sop_id ?? departmentSops[0]?.id ?? '')
  const [difficulty, setDifficulty] = useState<Difficulty>('medium')
  const [count, setCount] = useState(5)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generate() {
    setBusy(true)
    setError(null)
    try {
      const { questions, warnings } = await api.generateTestDraft(actor, { sopId, difficulty, count })
      if (questions.length === 0) {
        setError('The generator returned nothing usable. Write the questions by hand.')
        setBusy(false)
        return
      }
      onDraft(questions, warnings)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Generation failed. Write the questions by hand.')
      setBusy(false)
    }
  }

  const levels: Array<{ id: Difficulty; label: string; blurb: string }> = [
    { id: 'low', label: 'Low', blurb: 'Direct recall of what the SOP states' },
    { id: 'medium', label: 'Medium', blurb: 'Applying the rule in a simple on-shift scenario' },
    { id: 'high', label: 'High', blurb: 'Multi-step or exception scenarios with near-miss wrong options' },
  ]

  return (
    <div className="card" style={{ marginBottom: 14, borderColor: 'var(--brand)' }}>
      <div className="spread" style={{ marginBottom: 10 }}>
        <span className="eyebrow">Generate from SOP</span>
        <button className="linkbtn" onClick={onClose}>
          Cancel
        </button>
      </div>

      <Field label="Source SOP" hint="In production the Edge Function reads this document straight from Drive as a PDF.">
        <select className="select" value={sopId} onChange={(e) => setSopId(e.target.value)}>
          {departmentSops.length === 0 && <option value="">No SOPs in this department</option>}
          {departmentSops.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} — {s.title}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Difficulty">
        <div className="stack" style={{ gap: 8 }}>
          {levels.map((l) => (
            <button
              key={l.id}
              type="button"
              className={`choice ${difficulty === l.id ? 'choice--on' : ''}`}
              onClick={() => setDifficulty(l.id)}
            >
              <span>
                <span className="choice__label">{l.label}</span>
                <span className="choice__meta" style={{ display: 'block' }}>
                  {l.blurb}
                </span>
              </span>
              <span>{difficulty === l.id ? '✓' : ''}</span>
            </button>
          ))}
        </div>
      </Field>

      <Field label="Number of questions">
        <input className="input" type="number" min={1} max={20} value={count} onChange={(e) => setCount(Number(e.target.value))} />
      </Field>

      <Notice tone="info">
        Questions are drawn only from the SOP — the model invents no policy that isn’t in it, so a thin SOP yields
        thin questions. Every question comes back as a draft for you to review and edit.
      </Notice>

      {error && (
        <div style={{ marginTop: 10 }}>
          <Notice tone="bad">{error}</Notice>
        </div>
      )}

      <button className="btn btn--block" style={{ marginTop: 12 }} disabled={busy || !sopId} onClick={generate}>
        {busy ? (
          <>
            <Spinner /> Generating draft…
          </>
        ) : (
          'Generate draft'
        )}
      </button>
    </div>
  )
}
