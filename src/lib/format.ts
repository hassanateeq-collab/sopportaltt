/** Date formatting in the prototype's style: "02 Jul 2026 · 14:05" and "02 Jul 2026". */

const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Date + time. Accepts an ISO string or Date. */
export function fmt(input: string | Date): string {
  const d = typeof input === 'string' ? new Date(input) : input
  return `${pad(d.getDate())} ${MO[d.getMonth()]} ${d.getFullYear()} · ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Date only. */
export function fmtD(input: string | Date): string {
  const d = typeof input === 'string' ? new Date(input) : input
  return `${pad(d.getDate())} ${MO[d.getMonth()]} ${d.getFullYear()}`
}
