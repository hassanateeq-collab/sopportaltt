/**
 * generate-test Edge Function (Gemini).
 *
 * Drafts multiple-choice questions from an SOP using the Google Gemini API. It
 * downloads the SOP's PDF from Drive and sends it to Gemini so the questions are
 * grounded in the real document (falling back to the SOP title if there's no
 * PDF). Generation NEVER auto-publishes — it returns a draft the manager reviews
 * and edits. The returned JSON is validated strictly (four options, exactly one
 * correct index); anything invalid is dropped with a warning.
 *
 * Secrets: GEMINI_API_KEY, plus the GOOGLE_* OAuth secrets (to read the PDF).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getUserAccessToken, downloadFromDrive } from '../_shared/google.ts'

// Overridable via the GEMINI_MODEL secret so you can try another model without
// redeploying (e.g. if one model has no free-tier quota for your project).
const MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-2.5-flash'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

const LEVELS: Record<string, string> = {
  low: 'LOW difficulty — direct recall: ask what the SOP itself states. One clearly correct option.',
  medium: 'MEDIUM difficulty — application: put the rule inside a simple, realistic on-shift scenario.',
  high: 'HIGH difficulty — judgment: multi-step or exception scenarios; wrong options must be plausible near-miss mistakes staff actually make.',
}

const LANG_NAMES: Record<string, string> = { en: 'English', ur: 'Urdu (اردو)', ps: 'Pashto (پښتو)' }

// A strict response schema forces Gemini to emit valid, well-formed JSON even
// when the content is Urdu/Pashto (right-to-left) — without it the model
// sometimes returns broken JSON for non-Latin scripts. Gemini's schema dialect
// uses UPPERCASE type names.
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    questions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          q: { type: 'STRING' },
          opts: { type: 'ARRAY', items: { type: 'STRING' } },
          ans: { type: 'INTEGER' },
        },
        required: ['q', 'opts', 'ans'],
      },
    },
  },
  required: ['questions'],
}

/** How to instruct the model to write the questions in the chosen language. */
function languageDirective(language: string): string {
  if (language === 'en') return 'Write the questions and options in simple English hotel staff read easily.'
  const name = LANG_NAMES[language] ?? 'English'
  return (
    `Write EVERY question and ALL four options in ${name} — natural, simple ${name} that hotel staff in Karachi read easily. ` +
    `Do NOT add any English translation or transliteration. The JSON keys stay in English ("q", "opts", "ans"), but every value must be written in ${name} script.`
  )
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

interface Draft {
  text: string
  options: string[]
  correct_index: number
}

/** Strict validation — four non-empty distinct options, exactly one valid correct index. */
function validate(raw: unknown): { questions: Draft[]; warnings: string[] } {
  const warnings: string[] = []
  const arr = Array.isArray(raw) ? raw : []
  const questions: Draft[] = []
  arr.forEach((item, i) => {
    const n = i + 1
    const q = item as Record<string, unknown>
    const text = typeof q?.q === 'string' ? q.q.trim() : ''
    const opts = Array.isArray(q?.opts) ? q.opts.map((o) => (typeof o === 'string' ? o.trim() : '')) : []
    const ans = q?.ans
    if (!text) return warnings.push(`Question ${n} had no text and was dropped.`)
    if (opts.length !== 4 || opts.some((o) => !o)) return warnings.push(`Question ${n} did not have four full options and was dropped.`)
    if (new Set(opts.map((o) => o.toLowerCase())).size !== 4) return warnings.push(`Question ${n} repeated an option and was dropped.`)
    if (typeof ans !== 'number' || !Number.isInteger(ans) || ans < 0 || ans > 3) return warnings.push(`Question ${n} had no valid correct answer and was dropped.`)
    questions.push({ text, options: opts, correct_index: ans })
  })
  if (!questions.length && !warnings.length) warnings.push('The model returned nothing usable. Write the test by hand.')
  return { questions, warnings }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
  const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const GEMINI = Deno.env.get('GEMINI_API_KEY')
  const G_ID = Deno.env.get('GOOGLE_CLIENT_ID')
  const G_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')
  const G_REFRESH = Deno.env.get('GOOGLE_REFRESH_TOKEN')

  try {
    if (!GEMINI) return json({ error: 'AI generation is not configured — set the GEMINI_API_KEY secret.' }, 500)

    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    if (!jwt) return json({ error: 'Sign in first.' }, 401)
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: `Bearer ${jwt}` } } })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ error: 'Your session has expired — sign in again.' }, 401)

    const admin = createClient(SUPABASE_URL, SERVICE)
    const { data: adminRow } = await admin.from('admins').select('id').eq('auth_user_id', user.id).maybeSingle()
    const { data: mgrRow } = adminRow
      ? { data: null }
      : await admin.from('managers').select('department_id').eq('auth_user_id', user.id).eq('active', true).maybeSingle()
    if (!adminRow && !mgrRow) return json({ error: 'Not an admin or department manager.' }, 403)

    const body = await req.json()
    const sopId = String(body.sopId ?? '')
    const difficulty = ['low', 'medium', 'high'].includes(body.difficulty) ? body.difficulty : 'medium'
    const count = Math.min(6, Math.max(3, Number(body.count) || 5))
    const language = ['en', 'ur', 'ps'].includes(body.language) ? body.language : 'en'

    const { data: sop } = await admin
      .from('sops')
      .select('id, code, title, summary, department_id, document_file_id')
      .eq('id', sopId)
      .maybeSingle()
    if (!sop) return json({ error: 'That SOP no longer exists.' }, 404)
    if (!adminRow && sop.department_id !== mgrRow!.department_id) {
      return json({ error: 'You can only generate from your own department’s SOPs.' }, 403)
    }

    const rules =
      `Difficulty: ${LEVELS[difficulty]}\n` +
      `${languageDirective(language)}\n` +
      `Write exactly ${count} multiple-choice questions based ONLY on this SOP. Do not invent policies not in it. ` +
      'Each question: max 35 words. Exactly 4 options, max 12 words each, exactly one correct. Wrong options must be realistic mistakes staff actually make. Vary the position of the correct answer.\n' +
      'Respond with ONLY this JSON, no markdown fences: {"questions":[{"q":"...","opts":["...","...","...","..."],"ans":0}]}\n' +
      '"ans" is the 0-based index of the correct option.'

    // Build the Gemini request — prefer the real PDF; fall back to the title.
    const parts: unknown[] = []
    let usedPdf = false
    if (sop.document_file_id && !/^(https?:|data:|blob:)/.test(sop.document_file_id) && G_ID && G_SECRET && G_REFRESH) {
      try {
        const token = await getUserAccessToken(G_ID, G_SECRET, G_REFRESH)
        const pdf = await downloadFromDrive(token, sop.document_file_id)
        parts.push({ inlineData: { mimeType: 'application/pdf', data: toBase64(pdf) } })
        usedPdf = true
      } catch (_) {
        // couldn't fetch the PDF — fall back to text below
      }
    }
    const intro =
      `You write staff certification quiz questions for a boutique hotel group in Karachi, in ${LANG_NAMES[language]}.\n` +
      (usedPdf ? 'Read the attached SOP document.\n' : `SOP: ${sop.title} (${sop.code}). ${sop.summary || ''}\n`) +
      rules
    parts.push({ text: intro })

    const reqInit: RequestInit = {
      method: 'POST',
      // Header auth works for both the classic AIza… keys and the newer AQ.… keys.
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0.6,
          maxOutputTokens: 8192,
          // Newer flash models spend output tokens on internal "thinking", which
          // was truncating the JSON. We don't need reasoning to draft questions.
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`

    // Gemini flash models can briefly 503 under load; retry transient errors.
    let res = await fetch(url, reqInit)
    for (let attempt = 0; attempt < 3 && (res.status === 503 || res.status === 500 || res.status === 502); attempt++) {
      await new Promise((r) => setTimeout(r, 900 * (attempt + 1)))
      res = await fetch(url, reqInit)
    }
    if (!res.ok) {
      const errText = await res.text()
      if (res.status === 503) {
        return json({ error: 'Gemini is briefly overloaded — please click Generate again in a few seconds.' }, 503)
      }
      if (res.status === 429) {
        return json({
          error: `Gemini quota: the free tier gives your project no quota for "${MODEL}". Try another model (set the GEMINI_MODEL secret), or enable billing on the Google Cloud project. Details: ${errText.slice(0, 200)}`,
        }, 502)
      }
      return json({ error: `Gemini error (${res.status}): ${errText.slice(0, 300)}` }, 502)
    }
    const data = await res.json()
    const cand = data.candidates?.[0]
    // Exclude any internal "thought" parts; keep only the answer text.
    const text: string = (cand?.content?.parts ?? [])
      .filter((p: { thought?: boolean }) => !p.thought)
      .map((p: { text?: string }) => p.text ?? '')
      .join('')
    if (!text.trim()) {
      return json({ questions: [], warnings: [`The model returned no text (finishReason: ${cand?.finishReason ?? 'unknown'}). Try again.`] })
    }

    // Robust parse: the model may return a top-level array OR a { questions: [] }
    // (or { data: [] }) wrapper, possibly inside markdown fences.
    let obj: unknown = null
    const cleaned = text.replace(/```json|```/g, '').trim()
    try {
      obj = JSON.parse(cleaned)
    } catch {
      const m = cleaned.match(/[[{][\s\S]*[\]}]/)
      try {
        obj = m ? JSON.parse(m[0]) : null
      } catch {
        obj = null
      }
    }
    if (obj == null) {
      return json({ questions: [], warnings: [`Could not read the model output (finishReason: ${cand?.finishReason ?? '?'}). Raw start: ${cleaned.slice(0, 200)}`] })
    }
    const container = obj as { questions?: unknown; data?: unknown }
    const parsed = Array.isArray(obj)
      ? obj
      : Array.isArray(container.questions)
        ? container.questions
        : Array.isArray(container.data)
          ? container.data
          : []

    return json(validate(parsed))
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Generation failed.' }, 500)
  }
})
