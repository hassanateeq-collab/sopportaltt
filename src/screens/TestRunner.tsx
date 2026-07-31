import { useEffect, useMemo, useState } from 'react'
import { api, read, ApiError } from '../data/store'
import type { Attempt, Certification, Language, Question, Test } from '../types'
import { LANGUAGE_NAMES, RTL_LANGUAGES } from '../types'
import { Spinner, Notice } from '../components/ui'
import * as tts from '../lib/tts'

/**
 * The test-taking flow. A staff member picks a language, the whole test renders
 * in it (right-to-left for Urdu and Pashto), and each question has a speaker
 * button that reads it aloud in the chosen language.
 *
 * Scoring is by option position, so a pass is a pass in any language — the
 * data layer scores against the English correct_index regardless of what was
 * displayed. The retest gate is enforced in api.submitAttempt, not here; this
 * screen simply cannot open the runner unless attemptPermission allowed it.
 */
export function TestRunner({
  test,
  token,
  onDone,
}: {
  test: Test
  token: string
  onDone: (result: { attempt: Attempt; certification: Certification | null } | null) => void
}) {
  const questions = useMemo(() => read.questionsFor(test.id), [test.id])
  const [lang, setLang] = useState<Language>('en')
  const [started, setStarted] = useState(false)
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Array<number | null>>(() => questions.map(() => null))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Voice availability settles asynchronously; re-render when it changes so the
  // speaker button can honestly say whether this device can read the language.
  const [, setVoiceTick] = useState(0)
  useEffect(() => tts.onVoicesChanged(() => setVoiceTick((n) => n + 1)), [])
  useEffect(() => () => tts.stop(), [])

  const rtl = RTL_LANGUAGES.includes(lang)

  if (!started) {
    return (
      <div className="viewer">
        <div className="viewer__head">
          <button className="topbar__back" onClick={() => onDone(null)} aria-label="Back">
            ‹
          </button>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="viewer__code">Test</div>
            <div className="viewer__title">{test.title}</div>
          </div>
        </div>
        <div className="viewer__stage">
          <div className="card">
            <h2>{test.title}</h2>
            <p className="muted" style={{ marginTop: 6 }}>
              {questions.length} question{questions.length === 1 ? '' : 's'} · pass mark {test.pass_mark}% ·
              certificate valid {test.validity_months} months
            </p>

            {test.languages.length > 1 && (
              <div style={{ marginTop: 16 }}>
                <div className="field__label">Language</div>
                <div className="choices choices--2">
                  {test.languages.map((l) => (
                    <button
                      key={l}
                      className={`choice ${lang === l ? 'choice--on' : ''}`}
                      style={{ justifyContent: 'center' }}
                      onClick={() => setLang(l)}
                    >
                      <span className="choice__label">{LANGUAGE_NAMES[l]}</span>
                    </button>
                  ))}
                </div>
                {RTL_LANGUAGES.includes(lang) && !tts.hasVoice(lang) && (
                  <div style={{ marginTop: 10 }}>
                    <Notice tone="warn">
                      This device has no {lang === 'ur' ? 'Urdu' : 'Pashto'} voice installed, so read-aloud
                      won’t speak in {LANGUAGE_NAMES[lang]}. The questions still show in {LANGUAGE_NAMES[lang]}.
                    </Notice>
                  </div>
                )}
              </div>
            )}

            <button className="btn btn--block" style={{ marginTop: 18 }} onClick={() => setStarted(true)}>
              Start test
            </button>
            <button className="btn btn--quiet btn--block" style={{ marginTop: 10 }} onClick={() => onDone(null)}>
              Not now
            </button>
          </div>
        </div>
      </div>
    )
  }

  const q = questions[index]
  const rendered = renderQuestion(q, lang)
  const answered = answers.filter((a) => a !== null).length
  const allAnswered = answered === questions.length

  function choose(optionIndex: number) {
    setAnswers((prev) => {
      const next = [...prev]
      next[index] = optionIndex
      return next
    })
  }

  async function submit() {
    setBusy(true)
    setError(null)
    tts.stop()
    try {
      const result = await api.submitAttempt(token, test.id, answers, lang)
      onDone(result)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not record your attempt. Try again.')
      setBusy(false)
    }
  }

  return (
    <div className="viewer">
      <div className="viewer__head">
        <button
          className="topbar__back"
          onClick={() => {
            tts.stop()
            onDone(null)
          }}
          aria-label="Leave test"
        >
          ‹
        </button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="viewer__code">
            Question {index + 1} of {questions.length}
          </div>
          <div className="viewer__title">{test.title}</div>
        </div>
        <span className="badge badge--brand">{LANGUAGE_NAMES[lang]}</span>
      </div>

      <div className="viewer__stage">
        <div className="progressbar" aria-hidden>
          <div className="progressbar__fill" style={{ width: `${(answered / questions.length) * 100}%` }} />
        </div>

        <div className={`question ${rtl ? 'rtl' : ''}`}>
          <div className="spread" style={{ marginBottom: 10, flexDirection: rtl ? 'row-reverse' : 'row' }}>
            <span className="tiny">Question {index + 1}</span>
            <button
              className="btn btn--quiet btn--sm"
              onClick={() => {
                const res = tts.playQuestion(rendered, lang, q.audio[lang])
                if (!res.ok) setError(res.reason)
              }}
              aria-label="Read question aloud"
            >
              🔊 Read aloud
            </button>
          </div>

          <div className="question__text">{rendered.text}</div>

          {rendered.options.map((opt, i) => {
            const letters = ['A', 'B', 'C', 'D']
            const on = answers[index] === i
            return (
              <button key={i} className={`option ${on ? 'option--on' : ''}`} onClick={() => choose(i)}>
                <span className="option__letter">{letters[i]}</span>
                <span>{opt}</span>
              </button>
            )
          })}
        </div>

        {error && (
          <div style={{ marginTop: 12 }}>
            <Notice tone="bad">{error}</Notice>
          </div>
        )}
      </div>

      <div className="viewer__foot">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <button
            className="btn btn--quiet"
            disabled={index === 0}
            onClick={() => {
              tts.stop()
              setIndex((i) => Math.max(0, i - 1))
            }}
          >
            ‹ Back
          </button>

          {index < questions.length - 1 ? (
            <button
              className="btn"
              onClick={() => {
                tts.stop()
                setIndex((i) => Math.min(questions.length - 1, i + 1))
              }}
            >
              Next ›
            </button>
          ) : (
            <button className="btn btn--accent" disabled={!allAnswered || busy} onClick={submit}>
              {busy ? <Spinner /> : 'Submit test'}
            </button>
          )}
        </div>
        {!allAnswered && index === questions.length - 1 && (
          <p className="tiny" style={{ marginTop: 8, textAlign: 'center' }}>
            Answer every question before submitting ({answered}/{questions.length} done).
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * Render a question in the chosen language. Translations are renderings of the
 * English original; if a translation is missing we fall back to English rather
 * than show a blank, and scoring is unaffected because it is by position.
 */
function renderQuestion(q: Question, lang: Language): { text: string; options: string[] } {
  if (lang === 'en') return { text: q.text, options: q.options }
  const t = q.translations[lang]
  if (t) return t
  return { text: q.text, options: q.options }
}
