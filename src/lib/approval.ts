/**
 * The SOP approval chain, stated once.
 *
 *   draft → (manager submits) admin_review → (Admin approves) authorized
 *                                          → (Admin sends back) rejected
 * The author fixes a sent-back SOP and resubmits. A live SOP re-enters review
 * only by starting a new version (which drops it back to a draft).
 *
 * The Edge Function `sop-approval` enforces the same table server-side.
 */

import type { ApprovalStatus } from '../types'

/** Who reviews a given stage (only the admin, at admin_review). */
export function reviewerForStage(status: ApprovalStatus): 'admin' | null {
  return status === 'admin_review' ? 'admin' : null
}

/** The status an approve moves the SOP to (Admin's approval publishes it). */
export function approveNext(status: ApprovalStatus): ApprovalStatus | null {
  return status === 'admin_review' ? 'authorized' : null
}

/** Statuses the author may (re)submit for review from. */
export function canSubmit(status: ApprovalStatus): boolean {
  return status === 'draft' || status === 'rejected'
}

/** Is this SOP with the admin for review? */
export function isInReview(status: ApprovalStatus): boolean {
  return status === 'admin_review'
}
