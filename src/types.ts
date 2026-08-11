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

export interface Manager {
  id: Uuid
  name: string
  email: string
  /** A manager owns exactly one department at exactly one branch. */
  department_id: Uuid
  branch_id: Uuid
  active: boolean
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
   * Rendered HTML of an editor-authored SOP (header + body), shown natively in
   * the portal viewer. Null for legacy PDF SOPs, which embed the Drive preview.
   */
  document_html?: string | null
  updated_at: Iso
  published_by: string
}

export interface Acknowledgment {
  id: Uuid
  staff_id: Uuid
  sop_id: Uuid
  /** Pinned at sign time, so a version bump correctly reopens the obligation. */
  version: number
  signed_at: Iso
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
