/**
 * Branch-scope eligibility, mirrored from the frontend's scopeIncludes so the
 * staff-facing Edge Functions derive the same "does this apply to me" answer the
 * RLS policy scope_includes() does. An SOP/test is ONE row with a branch scope;
 * eligibility is derived, never copied per branch.
 */

export type BranchScope = { kind: 'ALL' } | { kind: 'LIST'; branch_codes: string[] }

export function scopeIncludes(scope: unknown, branchCode: string | null | undefined): boolean {
  if (!branchCode) return false
  const s = scope as BranchScope | null
  if (s?.kind === 'ALL') return true
  return Array.isArray((s as { branch_codes?: unknown })?.branch_codes)
    ? (s as { branch_codes: string[] }).branch_codes.includes(branchCode)
    : false
}
