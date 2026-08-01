/**
 * translate-question Edge Function.
 *
 * On-demand translation of a single quiz question + its four options into Urdu
 * or Pashto, for a staff member taking a test. The option ORDER is preserved, so
 * scoring (by position) is unaffected. Gated by a valid staff session token, and
 * uses the same Gemini key as generation. A strict response schema keeps the
 * JSON well-formed even for right-to-left scripts.
 */

import { serviceClient, staffFromToken, bearer } from '../_shared/auth.ts'
import { cors, json } from '../_shared/http.ts'

const MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-2.5-flash'
const LANG_NAMES: Record<string, string> = { en: 'English', ur: 'Urdu (اردو)', ps: 'Pashto (پښتو)' }

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    q: { type: 'STRING' },
    opts: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['q', 'opts'],
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  try {
    const GEMINI = Deno.env.get('GEMINI_API_KEY')
    if (!GEMINI) return json({ error: 'Translation is not configured — set GEMINI_API_KEY.' }, 500)

    const admin = serviceClient()
    const body = await req.json().catch(() => ({}))
    const token = String(body.token ?? '') || bearer(req)
    const staff = await staffFromToken(admin, token)
    if (!staff) return json({ error: 'Your session has ended. Please sign in again.' }, 401)

    const language = ['ur', 'ps', 'en'].includes(body.language) ? body.language : 'ur'
    const q = String(body.q ?? '').trim()
    const opts = Array.isArray(body.opts) ? body.opts.map((o: unknown) => String(o ?? '')) : []
    if (!q || opts.length !== 4) return json({ error: 'Nothing to translate.' }, 400)

    const name = LANG_NAMES[language]
    const prompt =
      `Translate this staff quiz question and its four options into ${name}. ` +
      `Keep the four options in the SAME order. Translate faithfully; do NOT answer or change the meaning. ` +
      `Use simple ${name} that hotel staff read easily.\n` +
      `Question: ${q}\nOptions (in order): ${JSON.stringify(opts)}`

    const reqInit: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: SCHEMA,
          temperature: 0.2,
          maxOutputTokens: 2048,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`

    let res = await fetch(url, reqInit)
    for (let attempt = 0; attempt < 3 && (res.status === 503 || res.status === 500 || res.status === 502); attempt++) {
      await new Promise((r) => setTimeout(r, 700 * (attempt + 1)))
      res = await fetch(url, reqInit)
    }
    if (!res.ok) {
      const errText = await res.text()
      if (res.status === 503) return json({ error: 'The translator is briefly busy — tap translate again.' }, 503)
      return json({ error: `Translation error (${res.status}): ${errText.slice(0, 200)}` }, 502)
    }

    const data = await res.json()
    const text: string = (data.candidates?.[0]?.content?.parts ?? [])
      .filter((p: { thought?: boolean }) => !p.thought)
      .map((p: { text?: string }) => p.text ?? '')
      .join('')
    let obj: unknown = null
    try {
      obj = JSON.parse(text.replace(/```json|```/g, '').trim())
    } catch {
      obj = null
    }
    const out = obj as { q?: unknown; opts?: unknown } | null
    const tq = typeof out?.q === 'string' ? out.q.trim() : ''
    const topts = Array.isArray(out?.opts) ? out!.opts.map((o) => String(o ?? '').trim()) : []
    if (!tq || topts.length !== 4 || topts.some((o) => !o)) {
      return json({ error: 'Could not translate this question — read it in the original language.' }, 502)
    }

    return json({ q: tq, opts: topts })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Translation failed.' }, 500)
  }
})
