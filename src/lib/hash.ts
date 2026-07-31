/**
 * Employee-code hashing.
 *
 * The rule this file exists to keep: a plaintext employee code is never stored
 * and never logged. The admin sees a generated code exactly once, at creation,
 * and after that only the hash survives.
 *
 * This build hashes with SHA-256 in the browser because there is no server yet.
 * That is NOT the production arrangement and must not ship to real staff as-is:
 * in production the code is bcrypt-hashed and verified inside the staff-login
 * Edge Function, so a hash never reaches the browser at all and an attacker with
 * the anon key cannot mount an offline guessing attack against it. The function
 * signatures below are already async so that swap needs no call-site changes.
 */

const SALT = 'hamsun-sop-portal-v1'

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function hashEmployeeCode(code: string): Promise<string> {
  return sha256Hex(`${SALT}:${code}`)
}

export async function verifyEmployeeCode(code: string, hash: string): Promise<boolean> {
  const candidate = await hashEmployeeCode(code)
  // Length-constant comparison; both sides are fixed-length hex here anyway.
  if (candidate.length !== hash.length) return false
  let diff = 0
  for (let i = 0; i < candidate.length; i++) diff |= candidate.charCodeAt(i) ^ hash.charCodeAt(i)
  return diff === 0
}

/**
 * Six-digit employee code drawn from the CSPRNG, never a sequence, so codes
 * cannot be guessed by counting up from a colleague's. Leading digit is never 0
 * so the code is always six characters when typed on a numeric keypad.
 */
export function generateEmployeeCode(): string {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return String(100000 + (buf[0] % 900000))
}
