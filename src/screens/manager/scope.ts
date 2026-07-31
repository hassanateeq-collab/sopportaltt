import type { Actor } from '../../data/store'
import { read } from '../../data/store'
import type { BranchScope, Staff } from '../../types'

/**
 * The patch a signed-in actor is allowed to act on.
 *
 * A manager is pinned to exactly one department at one branch — the same
 * confinement the row-level security policy will enforce in Postgres, so her
 * queries physically cannot return another patch's rows. An admin has no pin and
 * may look across everything.
 */
export interface ManagerScope {
  isAdmin: boolean
  /** Fixed for a manager; null for an admin (meaning "any"). */
  departmentId: string | null
  branchId: string | null
}

export function scopeOf(actor: Actor): ManagerScope {
  if (actor.kind === 'admin') return { isAdmin: true, departmentId: null, branchId: null }
  return { isAdmin: false, departmentId: actor.manager.department_id, branchId: actor.manager.branch_id }
}

/** Staff this actor may see and act on, before any UI filter is applied. */
export function visibleStaff(scope: ManagerScope): Staff[] {
  return read
    .staff()
    .filter((s) => {
      if (scope.departmentId && s.department_id !== scope.departmentId) return false
      if (scope.branchId && s.branch_id !== scope.branchId) return false
      return true
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * The branch scope this actor would attach to something they publish. A manager
 * can only ever publish to her own branch; only an admin can choose all
 * branches or a custom list.
 */
export function defaultPublishScope(actor: Actor): BranchScope {
  if (actor.kind === 'admin') return { kind: 'ALL' }
  const branch = read.branch(actor.manager.branch_id)
  return { kind: 'LIST', branch_codes: branch ? [branch.code] : [] }
}
