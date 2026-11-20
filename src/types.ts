/**
 * Data model for the Hamsun SOP & Training Portal.
 *
 * Every interface here is shaped to become a Postgres table one-for-one when the
 * Supabase backend is wired up, so the swap is mechanical rather than a rewrite.
 * Field names are snake_case for that reason.
 */

export type Uuid = string
/** ISO-8601 timestamp. */
export type Iso = string

/* ------------------------------------------------------------------ org ---- */

export interface Branch {
  id: Uuid
  /** Short code used everywhere in the UI and in branch scopes: FSL, EXT, CLF, DHA. */
  code: string
  name: string
  /** DHA is pre-opening. Pre-opening branches still inherit every ALL-scope SOP. */
  status: 'open' | 'pre_opening'
}

export interface Department {
  id: Uuid
  /** Two-letter prefix for this department's document-control codes: FD, HK, KT, MT, QC. */
  code: string
  name: string
  /** Drive folder this department's SOPs upload to (admin-set in Settings). */
  drive_folder_id?: string | null
  /** Drive folder this department's Policies upload to, inside the Policies root. */
  policy_folder_id?: string | null
}

export interface Staff {
  id: Uuid
  name: string
  department_id: Uuid
  branch_id: Uuid
  job_title: string
  /**
   * Hash of the numeric employee code, verified server-side at sign-in.
   */
  employee_code_hash: string
  /**
   * The plaintext employee code, kept so a signed-in manager or admin can look it
   * up and re-tell it to staff (a hotel PIN, not a password). It is readable ONLY
   * by an admin, by the manager of that person's department+branch, and by the
   * person themselves — never by anon, and never through the staff sign-in
   * directory. Blank on staff created before this was added; re-issue a code to
   * fill it in.
   */
  employee_code?: string | null
  active: boolean
  created_at: Iso
}

/**
 * Sign-in role in the managers table.
 *  - 'manager'        — department manager: writes SOPs and runs tests for one
 *                       department across every branch; the admin reviews/approves.
 *  - 'branch_manager' — oversees one branch (no department). Read-only + comments:
 *                       sees every SOP and can suggest changes on it, and sees the
 *                       assessment results of the staff in their own branch. Never
 *                       edits, approves, or assigns.
 *  - 'hr'             — org-wide, Policies only (no department, no branch). Writes,
 *                       publishes and tracks company policies for every department;
 *                       the admin and the managers read & acknowledge them. HR does
 *                       not touch SOPs, tests, or staff.
 */
export type ManagerRole = 'manager' | 'branch_manager' | 'hr'

export const MANAGER_ROLE_LABELS: Record<ManagerRole, string> = {
  manager: 'Department Manager',
  branch_manager: 'Branch Manager',
  hr: 'HR',
}

export interface Manager {
  id: Uuid
  name: string
  email: string
  /**
   * A department manager owns exactly one department at exactly one branch. The
   * review roles carry less: a Branch Manager has a branch but no department;
   * HR and the CEO are org-wide (both null).
   */
  department_id: Uuid | null
  branch_id: Uuid | null
  active: boolean
  /** Review role. Defaults to 'manager' for rows created before this existed. */
  role: ManagerRole
}

export interface Admin {
  id: Uuid
  name: string
  email: string
}

/* --------------------------------------------------------------- scoping ---- */

/**
 * The branch scope of an SOP or a test.
 *
 * 'ALL' means every branch, including branches created after the record was
 * published — which is how a new branch inherits the group-wide library the
 * moment it is added. An explicit list names the branch codes it applies to.
 *
 * This is the whole point of the design: one record with a scope, never one
 * copy per branch. See lib/scope.ts for the derivation.
 */
export type BranchScope = { kind: 'ALL' } | { kind: 'LIST'; branch_codes: string[] }

/**
 * Where an SOP sits on the approval chain:
 *   draft → (submit) admin_review → (Admin approves) authorized
 *                                 → (Admin sends back) rejected → resubmit
 * Only 'authorized' is served to staff; pre-workflow SOPs default to it.
 */
export type ApprovalStatus =
  | 'draft'
  | 'admin_review'
  | 'authorized'
  | 'rejected'

/** One entry in an SOP's sign-off record for the current review round. */
export interface ApprovalEvent {
  /** Who acted: a review role, 'admin', or 'manager' (the submitter). */
  role: ManagerRole | 'admin'
  name: string
  action: 'submitted' | 'approved' | 'authorized' | 'rejected'
  note?: string | null
  at: Iso
}

export const APPROVAL_ACTION_LABELS: Record<ApprovalEvent['action'], string> = {
  submitted: 'Submitted',
  approved: 'Approved',
  authorized: 'Authorised',
  rejected: 'Sent back',
}

export const APPROVAL_STATUS_LABELS: Record<ApprovalStatus, string> = {
  draft: 'Draft',
  admin_review: 'With Admin',
  authorized: 'Authorised · live',
  rejected: 'Sent back',
}

/* ------------------------------------------------------------------ sops ---- */

export interface Sop {
  id: Uuid
  /** Document-control code, e.g. FD-002. Unique across the portal. */
  code: string
  title: string
  summary: string
  department_id: Uuid
  branch_scope: BranchScope
  /** Bumping this obliges every eligible staff member to re-acknowledge. */
  version: number
  /**
   * Google Drive file id for the procedure document. Staff are only ever served
   * the /preview embed built from this id, never a raw file URL.
   */
  document_file_id: string | null
  /** Google Drive file id for the training video that belongs to this same SOP. */
  video_file_id: string | null
  /**
   * Editable content of an editor-authored SOP — the body HTML plus the Purpose
   * and Who-This-Applies-To text. Lets the portal render the SOP natively AND
   * reopen it for editing. Null for legacy PDF SOPs, which embed the Drive
   * preview. (`document_html` is a superseded earlier field, kept for fallback.)
   */
  sop_doc?: SopDoc | null
  document_html?: string | null
  /** Where this SOP sits on the review chain. Only 'authorized' reaches staff. */
  approval_status: ApprovalStatus
  /** The most recent reviewer note — a rejection reason, or an approval remark. */
  approval_note?: string | null
  /** Name of the manager who last submitted this SOP for review. */
  submitted_by?: string | null
  /** Ordered sign-off record for the current review round (submit → … → authorise). */
  approval_trail?: ApprovalEvent[] | null
  updated_at: Iso
  published_by: string
}

export interface SopDoc {
  body: string
  purpose: string
  appliesTo: string
}

/**
 * A comment / change-suggestion left on an SOP. Branch managers raise these to
 * flag changes for the owning department manager; the department manager and the
 * admin can reply in the same thread. Authored by a manager/branch_manager/admin,
 * never by staff.
 */
export interface SopComment {
  id: Uuid
  sop_id: Uuid
  /** The managers-table id of the author, or null when the author is an admin. */
  author_manager_id: Uuid | null
  author_name: string
  author_role: ManagerRole | 'admin'
  body: string
  created_at: Iso
}

export interface Acknowledgment {
  id: Uuid
  staff_id: Uuid
  sop_id: Uuid
  /** Pinned at sign time, so a version bump correctly reopens the obligation. */
  version: number
  signed_at: Iso
}

/* -------------------------------------------------------------- policies ---- */

export type PolicyStatus = 'draft' | 'published'

export const POLICY_STATUS_LABELS: Record<PolicyStatus, string> = {
  draft: 'Draft',
  published: 'Published · live',
}

/**
 * A company policy, owned by HR. HR writes and publishes it (per department,
 * each in its own Drive folder); the admin and every manager read it and
 * acknowledge it. Staff do not see policies. The inline document reuses the SOP
 * document shape so the same editor and reader serve both.
 */
export interface Policy {
  id: Uuid
  /** Document-control code, e.g. POL-HK-001. */
  code: string
  title: string
  summary: string | null
  department_id: Uuid
  /** Inline document (reuses the SOP body/purpose/appliesTo shape). */
  policy_doc: SopDoc | null
  /** Optional uploaded file in the department's Policies Drive folder. */
  document_file_id: string | null
  version: number
  status: PolicyStatus
  published_by: string
  updated_at: Iso
  created_at: Iso
}

/**
 * An acknowledgment that a manager or the admin has read a published policy.
 * Pinned to the policy version so a re-publish reopens the obligation.
 */
export interface PolicyAcknowledgment {
  id: Uuid
  policy_id: Uuid
  /** The managers-table id of the acknowledger, or null when it's the admin. */
  manager_id: Uuid | null
  name: string
  role: ManagerRole | 'admin'
  version: number
  acknowledged_at: Iso
}

/* ----------------------------------------------------------------- tests ---- */

export type Language = 'en' | 'ur' | 'ps'

export const LANGUAGE_NAMES: Record<Language, string> = {
  en: 'English',
  ur: 'اردو',
  ps: 'پښتو',
}

export const RTL_LANGUAGES: Language[] = ['ur', 'ps']

export interface Test {
  id: Uuid
  title: string
  department_id: Uuid
  branch_scope: BranchScope
  /** Optional SOP the test examines, so staff can revise before attempting. */
  related_sop_id: Uuid | null
  /** Percentage needed to pass. */
  pass_mark: number
  /** Months a certification stays valid after issue. */
  validity_months: number
  /** English is always present and is the canonical record copy. */
  languages: Language[]
  status: 'draft' | 'published'
  created_at: Iso
}

export interface Question {
  id: Uuid
  test_id: Uuid
  position: number
  text: string
  /** Exactly four options. */
  options: string[]
  /** Index into options. Scoring is by position, so it is identical in every language. */
  correct_index: number
  /**
   * Renderings of the English original, regenerated whenever the English text
   * changes. Never edited independently — that is how you end up certifying
   * people against three subtly different tests.
   */
  translations: Partial<Record<Language, { text: string; options: string[] }>>
  /**
   * Pre-generated read-aloud audio, per language. Empty in this build: the
   * portal falls back to browser speech synthesis. The field exists so recorded
   * Azure-TTS audio can be added later without a schema change.
   */
  audio: Partial<Record<Language, string>>
}

export interface TestAssignment {
  id: Uuid
  test_id: Uuid
  staff_id: Uuid
  assigned_by: string
  assigned_at: Iso
}

export interface Attempt {
  id: Uuid
  staff_id: Uuid
  test_id: Uuid
  score: number
  total: number
  percentage: number
  passed: boolean
  language: Language
  attempted_at: Iso
}

export interface Certification {
  id: Uuid
  staff_id: Uuid
  test_id: Uuid
  issued_at: Iso
  expires_at: Iso
  source_attempt_id: Uuid
}

export interface RetestGrant {
  id: Uuid
  test_id: Uuid
  staff_id: Uuid
  granted_by: string
  granted_by_name: string
  granted_at: Iso
  /** Consumed by exactly one attempt. Failing again means asking again. */
  used: boolean
}

/* --------------------------------------------------------- notifications ---- */

export type NotificationKind =
  | 'retest_approved'
  | 'test_assigned'
  | 'sop_published'
  | 'score_recorded'

export interface Notification {
  id: Uuid
  staff_id: Uuid
  kind: NotificationKind
  text: string
  read: boolean
  created_at: Iso
  /**
   * Set when this notification should also be mirrored to WhatsApp by the
   * existing Hamsun pipeline. Nothing consumes it yet — the field is here so
   * that enhancement is a worker reading a queue, not a schema migration.
   */
  whatsapp_pending: boolean
}

/* -------------------------------------------------------------- sessions ---- */

/**
 * What the staff-login Edge Function will return: a short-lived token good for
 * roughly one shift, carried on every subsequent write.
 */
export interface StaffSession {
  staff_id: Uuid
  token: string
  expires_at: Iso
}

export type ManagerSession = { kind: 'manager'; manager_id: Uuid } | { kind: 'admin'; admin_id: Uuid }

/* ------------------------------------------------------------ derived UI ---- */

export type CertStatus = 'valid' | 'expiring_soon' | 'expired' | 'none'

export type Difficulty = 'low' | 'medium' | 'high'
