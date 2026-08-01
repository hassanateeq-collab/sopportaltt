/**
 * speak Edge Function — server-side read-aloud with Microsoft Azure Speech.
 *
 * Browsers can only speak a language the device has a voice for, and most have
 * neither Urdu nor Pashto. Azure Speech has neural voices for both (ur-PK and
 * ps-AF), so this synthesises the question text to an MP3 the browser just plays
 * — identical on every device. Gated by a valid staff session token.
 *
 * Secrets: AZURE_SPEECH_KEY, AZURE_SPEECH_REGION (e.g. "southeastasia").
 */

import { serviceClient, staffFromToken, bearer } from '../_shared/auth.ts'
import { cors } from '../_shared/http.ts'

const VOICES: Record<string, { locale: string; voice: string }> = {
  en: { locale: 'en-US', voice: 'en-US-JennyNeural' },
  ur: { locale: 'ur-PK', voice: 'ur-PK-UzmaNeural' },
  ps: { locale: 'ps-AF', voice: 'ps-AF-LatifaNeural' },
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function err(msg: string, status = 500): Response {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return err('POST only', 405)

  try {
    const KEY = Deno.env.get('AZURE_SPEECH_KEY')
    const REGION = Deno.env.get('AZURE_SPEECH_REGION')
    if (!KEY || !REGION) {
      return err('Read-aloud is not configured — set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION.', 500)
    }

    const admin = serviceClient()
    const body = await req.json().catch(() => ({}))
    const token = String(body.token ?? '') || bearer(req)
    const staff = await staffFromToken(admin, token)
    if (!staff) return err('Your session has ended. Please sign in again.', 401)

    const language = ['en', 'ur', 'ps'].includes(body.language) ? body.language : 'en'
    const text = String(body.text ?? '').slice(0, 1500).trim()
    if (!text) return err('Nothing to read.', 400)

    const v = VOICES[language]
    // A slightly slower read for line staff on a noisy floor.
    const ssml =
      `<speak version='1.0' xml:lang='${v.locale}'>` +
      `<voice xml:lang='${v.locale}' name='${v.voice}'><prosody rate='-8%'>${xmlEscape(text)}</prosody></voice></speak>`

    const res = await fetch(`https://${REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': KEY,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent': 'hamsun-sop-portal',
      },
      body: ssml,
    })
    if (!res.ok) {
      const t = await res.text()
      if (res.status === 401 || res.status === 403) return err('The Azure Speech key or region is wrong.', 502)
      return err(`Voice service error (${res.status}): ${t.slice(0, 200)}`, 502)
    }

    const audio = await res.arrayBuffer()
    return new Response(audio, {
      headers: { ...cors, 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' },
    })
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Read-aloud failed.', 500)
  }
})
