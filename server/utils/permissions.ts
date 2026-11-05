import { PERMISSIONS, type PermissionKey, implied } from '~/config/permissions'
import type mariadb from 'mariadb'
import { query } from '~/server/utils/db'
import { appTodayLocalDate } from '~/server/utils/time'

interface RoleRow {
  role_id: number
}

interface PositionRow {
  position_id: number
}

interface PositionStateRow {
  id: number
}

interface PermissionRow {
  permission_key: PermissionKey
}

export function isValidPermissionKey(key: string): key is PermissionKey {
  return PERMISSIONS.some(p => p.key === key)
}

export async function getUserRoleIds(userId: number, conn?: mariadb.PoolConnection): Promise<number[]> {
  const rows = await query<RoleRow[]>(
    `SELECT ur.role_id
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = ?
       AND r.is_active = 1`,
    [userId],
    conn,
  )
  const roles = rows.map(r => r.role_id).filter(Boolean)
  return roles
}

export async function getUserPositionIds(userId: number, conn?: mariadb.PoolConnection): Promise<number[]> {
  const today = await appTodayLocalDate()
  const rows = await query<PositionRow[]>(
    `SELECT mp.position_id
     FROM members m
     JOIN member_positions mp ON mp.member_id = m.id
     JOIN positions p ON p.id = mp.position_id
     WHERE m.account = ?
       AND p.is_active = 1
       AND (mp.until IS NULL OR mp.until >= ?)
       AND mp.since <= ?`,
    [userId, today, today],
    conn,
  )
  const ids = rows.map(r => Number(r.position_id)).filter(id => Number.isFinite(id))
  return Array.from(new Set(ids))
}

export async function getUserPermissions(
  userId: number,
  roles: number[],
  positionIds: number[],
  conn?: mariadb.PoolConnection,
): Promise<PermissionKey[]> {
  const permissions = new Set<string>()

  if (roles.length) {
    const roleRows = await query<{ id: number }[]>(
      `SELECT id
       FROM roles
       WHERE is_active = 1
         AND id IN (${roles.map(() => '?').join(',')})`,
      roles,
      conn,
    )
    const roleIds = roleRows.map(r => r.id).filter(id => Number.isFinite(id))
    if (roleIds.length) {
      const rolePerms = await query<PermissionRow[]>(
        `SELECT permission_key
         FROM role_permissions
         WHERE role_id IN (${roleIds.map(() => '?').join(',')})`,
        roleIds,
        conn,
      )
      rolePerms.forEach(p => permissions.add(p.permission_key))
    }
  }

  if (positionIds.length) {
    const activePositionRows = await query<PositionStateRow[]>(
      `SELECT id
       FROM positions
       WHERE is_active = 1
         AND id IN (${positionIds.map(() => '?').join(',')})`,
      positionIds,
      conn,
    )
    const activePositionIds = activePositionRows
      .map(row => Number(row.id))
      .filter(id => Number.isFinite(id))

    if (activePositionIds.length) {
      const positionPerms = await query<PermissionRow[]>(
        `SELECT permission_key
         FROM position_permissions
         WHERE position_id IN (${activePositionIds.map(() => '?').join(',')})`,
        activePositionIds,
        conn,
      )
      positionPerms.forEach(p => permissions.add(p.permission_key))
    }
  }

  const userPerms = await query<PermissionRow[]>(
    'SELECT permission_key FROM user_permissions WHERE user_id = ?',
    [userId],
    conn,
  )
  userPerms.forEach(p => permissions.add(p.permission_key))

  return expandImpliedPermissions(Array.from(permissions).filter(isValidPermissionKey) as PermissionKey[])
}

/** Adds every permission implied (transitively) by the given keys. */
export function expandImpliedPermissions(keys: Iterable<PermissionKey>): PermissionKey[] {
  const validated = new Set<PermissionKey>(keys)

  let grew = true
  while (grew) {
    grew = false
    for (const key of Array.from(validated)) {
      const impliedKeys = implied[key]
      if (!impliedKeys) continue
      for (const impliedKey of impliedKeys) {
        if (validated.has(impliedKey)) continue
        validated.add(impliedKey)
        grew = true
      }
    }
  }

  return Array.from(validated)
}

/** Effective permissions of a user (roles ∪ positions ∪ direct grants, implications expanded). */
export async function getEffectivePermissions(userId: number, conn?: mariadb.PoolConnection): Promise<PermissionKey[]> {
  const [roles, positionIds] = await Promise.all([
    getUserRoleIds(userId, conn),
    getUserPositionIds(userId, conn),
  ])
  return getUserPermissions(userId, roles, positionIds, conn)
}

/** The raw permission keys attached to each of the given positions. */
export async function getPositionPermissionKeys(
  positionIds: number[],
  conn?: mariadb.PoolConnection,
): Promise<Map<number, PermissionKey[]>> {
  const result = new Map<number, PermissionKey[]>()
  const ids = Array.from(new Set(positionIds.filter(id => Number.isInteger(id) && id > 0)))
  if (!ids.length) return result

  const rows = await query<Array<{ position_id: number, permission_key: string }>>(
    `SELECT position_id, permission_key
     FROM position_permissions
     WHERE position_id IN (${ids.map(() => '?').join(',')})`,
    ids,
    conn,
  )
  for (const row of rows) {
    if (!isValidPermissionKey(row.permission_key)) continue
    const positionId = Number(row.position_id)
    const bucket = result.get(positionId) ?? []
    bucket.push(row.permission_key)
    result.set(positionId, bucket)
  }
  return result
}

/** Keys in `wanted` (implications expanded) that `held` does not contain. */
export function permissionsBeyond(wanted: Iterable<PermissionKey>, held: Iterable<PermissionKey>): PermissionKey[] {
  const heldSet = new Set(held)
  return expandImpliedPermissions(wanted).filter(key => !heldSet.has(key))
}
