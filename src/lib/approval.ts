/**
 * The SOP approval chain, stated once.
 *
 * The Manager drives it. After each reviewer approves, the SOP returns to the
 * Manager, who forwards it to the next reviewer:
 *   draft → branch_review → branch_approved → admin_review → admin_approved
 *         → (HR or CEO) hr_review / ceo_review → authorized
 * Either HR or CEO — one approval publishes. Any reviewer can send it back
 * (rejected); the author fixes it and resubmits.
 *
 * The Edge Function `sop-approval` enforces the same table server-side — this
 * copy drives the demo store and the UI.
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

/** Who reviews a given stage (null if the stage is not with a reviewer). */
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
 * The status a reviewer's APPROVE moves the SOP to. A Branch Manager / Admin
 * approval hands it back to the Manager (an *_approved hold); an HR or CEO
 * approval publishes it.
 */
export function approveNext(status: ApprovalStatus): ApprovalStatus | null {
  switch (status) {
    case 'branch_review': return 'branch_approved'
    case 'admin_review': return 'admin_approved'
    case 'hr_review': return 'authorized'
    case 'ceo_review': return 'authorized'
    default: return null
  }
}

/**
 * The status the Manager's FORWARD moves the SOP to. From branch_approved it
 * always goes to the Admin; from admin_approved the Manager picks HR or CEO.
 */
export function forwardNext(status: ApprovalStatus, target?: 'hr' | 'ceo'): ApprovalStatus | null {
  if (status === 'branch_approved') return 'admin_review'
  if (status === 'admin_approved') return target === 'hr' ? 'hr_review' : target === 'ceo' ? 'ceo_review' : null
  return null
}

/** Statuses the author may (re)submit for review from. */
export function canSubmit(status: ApprovalStatus): boolean {
  // draft = never reviewed (a brand-new SOP or a fresh version); rejected = sent
  // back to fix. A live SOP re-enters review only by starting a new version.
  return status === 'draft' || status === 'rejected'
}

/** Statuses where the SOP is back with the Manager, awaiting a forward. */
export function awaitingManager(status: ApprovalStatus): boolean {
  return status === 'branch_approved' || status === 'admin_approved'
}

/** Is this SOP moving through the chain (not a draft, not live, not rejected)? */
export function isInReview(status: ApprovalStatus): boolean {
  return (
    status === 'branch_review' ||
    status === 'branch_approved' ||
    status === 'admin_review' ||
    status === 'admin_approved' ||
    status === 'hr_review' ||
    status === 'ceo_review'
  )
}
