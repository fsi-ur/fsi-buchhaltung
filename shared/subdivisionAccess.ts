import type { PermissionKey } from '~/config/permissions'
import {
  ALL_SUBDIVISION_PERMISSION_KEYS,
  expandSubdivisionPermissions,
  SUBDIVISION_PERMISSIONS,
  type SubdivisionPermissionKey,
  type SubdivisionPermissionMap,
} from '~/config/subdivisionPermissions'

/**
 * What a user may do in one subdivision. Shared by the server checks and the client so both read
 * the rules the same way:
 * - scoped keys come from the user's current subdivision-bound positions in that subdivision;
 * - `subdivisions.leadership.edit` grants every scoped key in every subdivision;
 * - `subdivisions.leadership.view` only lets the user see every subdivision on the leadership page.
 * Other global permissions (settings.subdivisions.manage, events.edit, …) deliberately grant nothing
 * here — they keep working through their own pages.
 */
export interface SubdivisionAccess {
  canView: boolean
  permissions: SubdivisionPermissionKey[]
}

export function resolveSubdivisionAccess(
  globalPermissions: readonly PermissionKey[],
  scoped: SubdivisionPermissionMap | null | undefined,
  subdivisionId: number,
): SubdivisionAccess {
  if (globalPermissions.includes('subdivisions.leadership.edit')) {
    return { canView: true, permissions: [...ALL_SUBDIVISION_PERMISSION_KEYS] }
  }

  const permissions = expandSubdivisionPermissions(scoped?.[subdivisionId] ?? [])
  return {
    canView: permissions.length > 0 || globalPermissions.includes('subdivisions.leadership.view'),
    permissions,
  }
}

export function hasSubdivisionPermission(
  globalPermissions: readonly PermissionKey[],
  scoped: SubdivisionPermissionMap | null | undefined,
  key: SubdivisionPermissionKey,
  subdivisionId: number,
): boolean {
  return resolveSubdivisionAccess(globalPermissions, scoped, subdivisionId).permissions.includes(key)
}

/**
 * Scoped keys whose `coveredBy` global permissions the holder lacks, i.e. what handing them out
 * would add to the holder's own reach. `subdivisions.leadership.edit` covers every scoped key.
 */
export function subdivisionPermissionsBeyond(
  keys: Iterable<SubdivisionPermissionKey>,
  globalPermissions: readonly PermissionKey[],
  /** Scoped keys the holder already has in the subdivision concerned — these need no coverage. */
  heldHere: readonly SubdivisionPermissionKey[] = [],
): SubdivisionPermissionKey[] {
  if (globalPermissions.includes('subdivisions.leadership.edit')) return []
  // Implied keys are handed out along with the key itself, so they need coverage as well.
  return expandSubdivisionPermissions(keys).filter((key) => {
    if (heldHere.includes(key)) return false
    const definition = SUBDIVISION_PERMISSIONS.find(entry => entry.key === key)
    // Unknown keys are never treated as covered.
    return !definition || !definition.coveredBy.every(permission => globalPermissions.includes(permission))
  })
}

/** May see the member list (with contact data) of this subdivision. */
export function canViewSubdivisionMembers(globalPermissions: readonly PermissionKey[], access: SubdivisionAccess): boolean {
  return access.permissions.includes('subdivision.members.view') || globalPermissions.includes('subdivisions.leadership.view')
}

/** True when the leadership page has anything to show this user. */
export function canOpenLeadershipPage(
  globalPermissions: readonly PermissionKey[],
  scoped: SubdivisionPermissionMap | null | undefined,
): boolean {
  if (globalPermissions.includes('subdivisions.leadership.view')) return true
  return Object.values(scoped ?? {}).some(keys => keys.length > 0)
}
