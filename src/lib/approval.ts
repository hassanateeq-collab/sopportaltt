/**
 * The SOP approval chain, stated once.
 *
 * A department manager writes an SOP (draft), then submits it. It climbs:
 *   branch_review → admin_review → (hr_review) → ceo_review → authorized
 * The admin decides at their step whether the optional HR review is needed.
 * Any reviewer can send it back (rejected); the author fixes and resubmits.
 *
 * The Edge Function `sop-approval` enforces the same table server-side — this
 * copy drives the demo store and the UI (which stage a given role acts on, and
 * what a button should say).
 */

import type { ApprovalStatus, ManagerRole } from '../types'

/** The review stage a reviewer is responsible for clearing (null = not a reviewer). */
export function stageForReviewer(who: ManagerRole | 'admin'): ApprovalStatus | null {
  switch (who) {
    case 'branch_manager': return 'branch_review'
    case 'admin': return 'admin_review'
    case 'hr': return 'hr_review'
    case 'ceo': return 'ceo_review'
    default: return null // a department 'manager' reviews nothing
  }
}

/** Does this role sit on the review chain (i.e. gets a review inbox)? */
export function isReviewerRole(role: ManagerRole): boolean {
  return role === 'branch_manager' || role === 'hr' || role === 'ceo'
}

/** Who reviews a given stage. */
export function reviewerForStage(status: ApprovalStatus): ManagerRole | 'admin' | null {
  switch (status) {
    case 'branch_review': return 'branch_manager'
    case 'admin_review': return 'admin'
    case 'hr_review': return 'hr'
    case 'ceo_review': return 'ceo'
    default: return null
  }
}

/**
 * The status an approval moves an SOP to. The admin step is the only fork: it
 * routes to HR when `target` is 'hr', otherwise straight to the CEO.
 */
export function nextStatusOnApprove(status: ApprovalStatus, target?: 'hr' | 'ceo'): ApprovalStatus | null {
  switch (status) {
    case 'branch_review': return 'admin_review'
    case 'admin_review': return target === 'hr' ? 'hr_review' : 'ceo_review'
    case 'hr_review': return 'ceo_review'
    case 'ceo_review': return 'authorized'
    default: return null
  }
}

/** Statuses the author may (re)submit from. */
export function canSubmit(status: ApprovalStatus): boolean {
  return status === 'draft' || status === 'rejected'
}

/** Is this SOP still moving through review (not live, not a fresh draft)? */
export function isInReview(status: ApprovalStatus): boolean {
  return status === 'branch_review' || status === 'admin_review' || status === 'hr_review' || status === 'ceo_review'
}
