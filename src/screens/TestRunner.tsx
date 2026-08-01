import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api, read, translateQuestion, speakText, ApiError } from '../data/store'
import type { Attempt, Certification, Language, Question, Test } from '../types'
import { LANGUAGE_NAMES, RTL_LANGUAGES } from '../types'
import { fmtD } from '../lib/format'
import { toast } from '../lib/toast'
import { isSupabaseEnabled } from '../lib/supabase'
import { SpeakerIcon } from '../components/icons'
import * as tts from '../lib/tts'

/**
 * The test-taking flow, in the prototype's style: pick a language, answer each
 * question (right-to-left for Urdu/Pashto, with a speaker button that reads it
 * aloud), then a wax-stamp CERTIFIED result or a NOT PASSED box. Scoring is by
 * option position, so the result is identical in every language. The retest gate
 * is enforced in api.submitAttempt.
 */
export function TestRunner({
  test,
  token,
  onDone,
  crumbs,
}: {
  test: Test
  token: string
  onDone: () => void
  crumbs?: ReactNode
}) {
  const questions = useMemo(() => read.questionsFor(test.id), [test.id])
  const [lang, setLang] = useState<Language>('en')
  const [started, setStarted] = useState(test.languages.length <= 1)
  const [qi, setQi] = useState(0)
  const [answers, setAnswers] = useState<Array<number | null>>(() => questions.map(() => null))
  const [result, setResult] = useState<{ attempt: Attempt; certification: Certification | null } | null>(null)
  const [busy, setBusy] = useState(false)
  // Per-question on-demand translation the staff member can toggle while taking
  // the test — the option order is preserved, so scoring is unaffected.
  const [xlate, setXlate] = useState<Record<number, { lang: Language; text: string; options: string[] }>>({})
  const [xbusy, setXbusy] = useState<number | null>(null)
  const [xpend, setXpend] = useState<Language | null>(null)
  const [speaking, setSpeaking] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  function stopSpeaking() {
    tts.stop()
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
  }

  useEffect(() => () => stopSpeaking(), [])

  // Language chooser (only when the test offers more than English)
  if (!started) {
    return (
      <>
        {crumbs}
        <div className="kcard">
          <div className="kmeta">
            <span>{test.title}</span>
            <span className="mono">pass {test.pass_mark}% · {questions.length} Qs</span>
          </div>
          <div className="field">
            <label>Test language · زبان · ژبه</label>
            <div className="vseg" role="group" aria-label="Language" style={{ display: 'inline-flex' }}>
              {test.languages.map((l) => (
                <button key={l} aria-pressed={lang === l} onClick={() => setLang(l)}>{LANGUAGE_NAMES[l]}</button>
              ))}
            </div>
            {RTL_LANGUAGES.includes(lang) && !tts.hasVoice(lang) && (
              <div className="demo-hint">
                No {LANGUAGE_NAMES[lang]} voice on this device — the questions still show in {LANGUAGE_NAMES[lang]};
                production serves recorded audio.
              </div>
            )}
          </div>
          <div className="backlink">
            <button className="btn primary" onClick={() => setStarted(true)}>Start test</button>
            <button className="btn" onClick={onDone}>Back</button>
          </div>
        </div>
      </>
    )
  }

  // Result
  if (result) {
    const r = result.attempt
    return (
      <>
        {crumbs}
        <div className="kcard">
          <div className="kmeta"><span>{test.title}</span></div>
          {r.passed && result.certification ? (
            <div className="stampbox">
              <span className="stamp animate">CERTIFIED</span>
              <div className="stampmeta">
                <strong>{test.title}</strong>
                <br />
                <span className="mono">Score {r.score}/{r.total} · valid until {fmtD(result.certification.expires_at)}</span>
              </div>
            </div>
          ) : (
            <div className="failbox">
              <div className="fh">NOT PASSED</div>
              <div className="score">Score {r.score}/{r.total} — pass mark is {test.pass_mark}%</div>
              <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
                Only your manager can approve a retest. Review the SOP — you'll get a notification when your retest is
                approved.
              </div>
            </div>
          )}
          <div className="backlink">
            <button className="btn primary" onClick={onDone}>Back to my scores</button>
          </div>
        </div>
      </>
    )
  }

  const q = questions[qi]
  const active = xlate[qi]
  const shown = active ? { text: active.text, options: active.options } : renderQuestion(q, lang)
  const activeLang: Language = active?.lang ?? lang
  const rtlNow = RTL_LANGUAGES.includes(activeLang)

  async function translateTo(l: Language) {
    if (xlate[qi]?.lang === l) return
    tts.stop()
    setXbusy(qi)
    setXpend(l)
    try {
      const t = await translateQuestion(token, q.text, q.options, l)
      setXlate((m) => ({ ...m, [qi]: { lang: l, text: t.q, options: t.opts } }))
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not translate this question.')
    } finally {
      setXbusy(null)
      setXpend(null)
    }
  }

  async function playAudio() {
    stopSpeaking()
    const letters = ['A', 'B', 'C', 'D']
    const spoken =
      activeLang === 'en'
        ? `${shown.text}. ${shown.options.map((o, i) => `${letters[i]}. ${o}`).join('. ')}`
        : `${shown.text}. ${shown.options.join('. ')}`
    // Urdu/Pashto read aloud through the server voice (Azure), so it works on any
    // device; English uses the browser's own voice (instant, offline).
    if (isSupabaseEnabled && (activeLang === 'ur' || activeLang === 'ps')) {
      setSpeaking(true)
      try {
        const blob = await speakText(token, spoken, activeLang)
        const url = URL.createObjectURL(blob)
        const audio = new Audio(url)
        audioRef.current = audio
        audio.onended = () => URL.revokeObjectURL(url)
        await audio.play()
      } catch (e) {
        // If the voice service isn't set up, fall back to the browser voice.
        const res = tts.playQuestion(shown, activeLang, undefined)
        if (!res.ok) toast(e instanceof ApiError ? e.message : res.reason)
      } finally {
        setSpeaking(false)
      }
      return
    }
    const res = tts.playQuestion(shown, activeLang, q.audio[activeLang])
    if (!res.ok) toast(res.reason)
  }

  function choose(i: number) {
    stopSpeaking()
    const next = [...answers]
    next[qi] = i
    setAnswers(next)
    if (qi < questions.length - 1) {
      setQi(qi + 1)
    } else {
      void submit(next)
    }
  }

  async function submit(finalAnswers: Array<number | null>) {
    setBusy(true)
    stopSpeaking()
    try {
      const res = await api.submitAttempt(token, test.id, finalAnswers, lang)
      if (res.attempt.passed) toast(`Certified — ${test.title}`)
      setResult(res)
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not record your attempt.')
      setBusy(false)
    }
  }

  return (
    <>
      {crumbs}
      <div className="kcard">
        <div className="kmeta">
          <span>{test.title}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <button
              className="spk"
              aria-label="Listen to this question"
              disabled={speaking}
              onClick={() => void playAudio()}
            >
              {speaking ? <span className="spinner" /> : <SpeakerIcon />}
            </button>
            <span className="mono">Question {qi + 1} / {questions.length}</span>
          </span>
        </div>
        <div className="kbar"><i style={{ width: `${Math.round((qi / questions.length) * 100)}%` }} /></div>
        <div className="xlate-row">
          <span className="xlate-label">Read in</span>
          {(['ur', 'ps'] as const).map((l) => (
            <button
              key={l}
              type="button"
              className={`xbtn ${activeLang === l ? 'on' : ''}`}
              disabled={xbusy !== null}
              onClick={() => void translateTo(l)}
            >
              {xbusy === qi && xpend === l ? '…' : LANGUAGE_NAMES[l]}
            </button>
          ))}
          {active && (
            <button
              type="button"
              className="xbtn"
              disabled={xbusy !== null}
              onClick={() => setXlate((m) => { const n = { ...m }; delete n[qi]; return n })}
            >
              Original
            </button>
          )}
        </div>
        <div className="qtext" dir={rtlNow ? 'rtl' : 'ltr'}>{shown.text}</div>
        {shown.options.map((o, i) => (
          <button key={i} className="opt" dir={rtlNow ? 'rtl' : 'ltr'} disabled={busy} onClick={() => choose(i)}>
            {o}
          </button>
        ))}
        <div className="backlink">
          <button className="btn" onClick={() => { stopSpeaking(); onDone() }}>Cancel test</button>
        </div>
      </div>
    </>
  )
}

function renderQuestion(q: Question, lang: Language): { text: string; options: string[] } {
  if (lang === 'en') return { text: q.text, options: q.options }
  const t = q.translations[lang]
  return t ?? { text: q.text, options: q.options }
}
