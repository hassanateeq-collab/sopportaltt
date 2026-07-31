/**
 * Read-aloud for test questions, for staff who read slowly or not at all.
 *
 * Being honest about what this is: the browser's built-in speech synthesis has
 * Urdu voices on most devices, but Pashto voices are rare to non-existent. So
 * this module reports availability per language and the speaker button says so
 * when the device cannot speak, rather than silently doing nothing.
 *
 * The production-grade answer is to pre-generate audio server-side with a
 * service that actually has Pashto voices (Azure TTS does), store one file per
 * question per language, and have the speaker button just play it — identical on
 * every device. Question.audio already holds that field; playQuestion below
 * prefers a recorded file whenever one is present and only then falls back here.
 */

import type { Language } from '../types'

const LANG_TAGS: Record<Language, string[]> = {
  en: ['en-GB', 'en-US', 'en'],
  ur: ['ur-PK', 'ur-IN', 'ur'],
  ps: ['ps-AF', 'ps'],
}

export function supported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

export function getVoices(): SpeechSynthesisVoice[] {
  if (!supported()) return []
  return window.speechSynthesis.getVoices()
}

/**
 * Voices load asynchronously in most browsers — getVoices() is empty on first
 * call and fills in on the voiceschanged event. Callers subscribe rather than
 * poll, so the speaker button's availability state settles on its own.
 */
export function onVoicesChanged(cb: () => void): () => void {
  if (!supported()) return () => {}
  window.speechSynthesis.addEventListener('voiceschanged', cb)
  return () => window.speechSynthesis.removeEventListener('voiceschanged', cb)
}

export function voiceFor(lang: Language): SpeechSynthesisVoice | null {
  const voices = getVoices()
  for (const tag of LANG_TAGS[lang]) {
    const exact = voices.find((v) => v.lang.toLowerCase() === tag.toLowerCase())
    if (exact) return exact
    const loose = voices.find((v) => v.lang.toLowerCase().startsWith(tag.toLowerCase()))
    if (loose) return loose
  }
  return null
}

export function hasVoice(lang: Language): boolean {
  return voiceFor(lang) !== null
}

export function stop(): void {
  if (supported()) window.speechSynthesis.cancel()
}

export type SpeakResult = { ok: true } | { ok: false; reason: string }

export function speak(text: string, lang: Language): SpeakResult {
  if (!supported()) {
    return { ok: false, reason: 'This device does not support read-aloud.' }
  }
  const voice = voiceFor(lang)
  if (!voice) {
    const names: Record<Language, string> = { en: 'English', ur: 'Urdu', ps: 'Pashto' }
    return {
      ok: false,
      reason: `No ${names[lang]} voice is installed on this device, so this question cannot be read aloud here. Ask your manager for the recorded audio.`,
    }
  }
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.voice = voice
  utterance.lang = voice.lang
  // Line staff on a noisy floor do better with a slightly slower read.
  utterance.rate = 0.9
  window.speechSynthesis.speak(utterance)
  return { ok: true }
}

/**
 * Speak a question and its options as one pass, which is what a staff member
 * actually needs to hear. Prefers a pre-recorded file when one exists.
 */
export function playQuestion(
  question: { text: string; options: string[] },
  lang: Language,
  recordedUrl?: string,
): SpeakResult {
  if (recordedUrl) {
    void new Audio(recordedUrl).play()
    return { ok: true }
  }
  const letters = ['A', 'B', 'C', 'D']
  const body = question.options.map((opt, i) => `${letters[i]}. ${opt}`).join('. ')
  return speak(`${question.text}. ${body}`, lang)
}
