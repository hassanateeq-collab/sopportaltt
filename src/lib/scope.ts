/**
 * Branch-scope derivation — the single most important rule in this system.
 *
 * An SOP or test that applies across several branches is ONE record carrying a
 * scope, never one copy per branch. Whether a given staff member owes a sign-off
 * is derived here at query time: department must match, and the scope must
 * include their branch.
 *
 * Two consequences fall out of this and both are the point:
 *   - a version update is a single edit, not four;
 *   - a branch added tomorrow inherits every ALL-scope record immediately,
 *     with nobody assigning anything.
 */

import type { Branch, BranchScope, Sop, Staff, Test } from '../types'

export function scopeIncludes(scope: BranchScope, branchCode: string): boolean {
  if (scope.kind === 'ALL') return true
  return scope.branch_codes.includes(branchCode)
}

/** Human-readable scope for tiles and management boards. */
export function scopeLabel(scope: BranchScope): string {
  if (scope.kind === 'ALL') return 'All branches'
  if (scope.branch_codes.length === 0) return 'No branches'
  return scope.branch_codes.join(' · ')
}

/** The branches a scope currently resolves to. Recomputed as branches change. */
export function resolveScope(scope: BranchScope, branches: Branch[]): Branch[] {
  if (scope.kind === 'ALL') return branches
  return branches.filter((b) => scope.branch_codes.includes(b.code))
}

interface Scoped {
  department_id: string
  branch_scope: BranchScope
}

/**
 * Does this record apply to this person? Department match plus branch-in-scope.
 * Nothing is manually assigned and nothing is duplicated.
 */
export function appliesToStaff(record: Scoped, staff: Staff, branchCode: string): boolean {
  if (record.department_id !== staff.department_id) return false
  return scopeIncludes(record.branch_scope, branchCode)
}

export function sopsForStaff(sops: Sop[], staff: Staff, branchCode: string): Sop[] {
  return sops
    .filter((s) => appliesToStaff(s, staff, branchCode))
    .sort((a, b) => a.code.localeCompare(b.code))
}

/**
 * Tests a staff member is *eligible* for. Eligibility is derived exactly like
 * SOPs — but unlike SOPs, eligibility alone does not put a test in front of
 * someone. A manager still has to assign it by name; see store.testsForStaff.
 */
export function testsForStaff(tests: Test[], staff: Staff, branchCode: string): Test[] {
  return tests.filter((t) => t.status === 'published' && appliesToStaff(t, staff, branchCode))
}

/** Staff a manager or admin may see, given the patch they are confined to. */
export function staffInScope(
  staff: Staff[],
  scope: { department_id?: string; branch_id?: string },
): Staff[] {
  return staff.filter((s) => {
    if (scope.department_id && s.department_id !== scope.department_id) return false
    if (scope.branch_id && s.branch_id !== scope.branch_id) return false
    return true
  })
}
