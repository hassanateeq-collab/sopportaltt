/**
 * Document-control codes.
 *
 * Each department has its own sequence — FD-001, FD-002 for Front Desk, HK-001
 * for Housekeeping, and so on. The code is generated as the next free number in
 * that department's sequence when an SOP is published; a manager may override
 * it, and duplicates are rejected.
 *
 * The code is what makes an incident report able to cite "breach of FD-002"
 * precisely, so it shows on the tile, in the viewer header, and on the boards.
 */

const CODE_PATTERN = /^([A-Z]{2,4})-(\d{3,})$/

export function parseDocCode(code: string): { prefix: string; number: number } | null {
  const m = CODE_PATTERN.exec(code.trim().toUpperCase())
  if (!m) return null
  return { prefix: m[1], number: Number(m[2]) }
}

export function isValidDocCode(code: string): boolean {
  return parseDocCode(code) !== null
}

/** Next free number in a department's sequence, e.g. nextDocCode('FD', [...]) -> 'FD-003'. */
export function nextDocCode(departmentCode: string, existingCodes: string[]): string {
  const prefix = departmentCode.toUpperCase()
  let highest = 0
  for (const code of existingCodes) {
    const parsed = parseDocCode(code)
    if (parsed && parsed.prefix === prefix && parsed.number > highest) highest = parsed.number
  }
  return `${prefix}-${String(highest + 1).padStart(3, '0')}`
}

/** Duplicates are rejected — the code has to identify one procedure or it is worthless. */
export function isDocCodeTaken(code: string, existingCodes: string[], ignoreCode?: string): boolean {
  const normalised = code.trim().toUpperCase()
  return existingCodes.some((c) => c.toUpperCase() === normalised && c.toUpperCase() !== ignoreCode?.toUpperCase())
}
