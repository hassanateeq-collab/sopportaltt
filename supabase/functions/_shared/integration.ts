/**
 * Shared helpers for the public Integration API (`api` Edge Function).
 *
 * This is the one surface meant to be called by ANOTHER system (a second portal),
 * not by this app's own browser. It is therefore NOT gated by a Supabase JWT —
 * deploy the `api` function with `--no-verify-jwt`. Instead every request must
 * carry a shared secret in the `x-api-key` header, checked here in constant time
 * against the `INTEGRATION_API_KEY` function secret. The secret lives only in the
 * function environment, never in any browser.
 */

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-api-key, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

/** Length-safe constant-time string comparison. */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const ab = enc.encode(a)
  const bb = enc.encode(b)
  // Compare against a fixed-length digest so differing lengths don't leak via timing.
  if (ab.length !== bb.length) {
    let z = 0
    for (let i = 0; i < ab.length; i++) z |= ab[i]
    return z === -1 // always false, but still touches every byte
  }
  let diff = 0
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i]
  return diff === 0
}

/**
 * Validate the caller's API key. Returns an error Response to short-circuit on,
 * or null when the key is good.
 */
export function requireApiKey(req: Request): Response | null {
  const expected = (Deno.env.get('INTEGRATION_API_KEY') ?? '').trim()
  if (!expected) {
    return json({ error: 'Integration API is not configured on the portal (missing INTEGRATION_API_KEY).' }, 503)
  }
  const provided = (req.headers.get('x-api-key') ?? '').trim()
  if (!provided || !timingSafeEqual(provided, expected)) {
    return json({ error: 'Invalid or missing API key. Send it in the x-api-key header.' }, 401)
  }
  return null
}

/** A link anyone can open to view a Drive file (null when there is no file). */
export function driveUrl(fileId: string | null | undefined): string | null {
  return fileId ? `https://drive.google.com/file/d/${fileId}/view` : null
}
