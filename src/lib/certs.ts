/**
 * Certification validity.
 *
 * A pass issues a certificate whose expiry is the attempt date plus the test's
 * validity period. "Expiring soon" is the thirty-day window that puts an alert
 * on the staff member's own page with the retake right there.
 */

import type { CertStatus, Certification } from '../types'

export const EXPIRING_SOON_DAYS = 30

export function addMonths(from: Date, months: number): Date {
  const d = new Date(from.getTime())
  const targetMonth = d.getMonth() + months
  d.setMonth(targetMonth)
  // Clamp a day-of-month overflow (31 Jan + 1 month must not become 3 March).
  if (d.getMonth() !== ((targetMonth % 12) + 12) % 12) d.setDate(0)
  return d
}

export function daysUntil(iso: string, now: Date = new Date()): number {
  const ms = new Date(iso).getTime() - now.getTime()
  return Math.ceil(ms / 86_400_000)
}

export function certStatus(cert: Certification | null | undefined, now: Date = new Date()): CertStatus {
  if (!cert) return 'none'
  const days = daysUntil(cert.expires_at, now)
  if (days < 0) return 'expired'
  if (days <= EXPIRING_SOON_DAYS) return 'expiring_soon'
  return 'valid'
}

export function certStatusLabel(status: CertStatus): string {
  switch (status) {
    case 'valid':
      return 'Valid'
    case 'expiring_soon':
      return 'Expiring soon'
    case 'expired':
      return 'Expired'
    case 'none':
      return 'Not certified'
  }
}

/** Staff need an alert when a certificate is inside the window or already gone. */
export function needsAttention(status: CertStatus): boolean {
  return status === 'expiring_soon' || status === 'expired'
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
