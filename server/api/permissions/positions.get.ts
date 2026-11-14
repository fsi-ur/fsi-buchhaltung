import { defineEventHandler } from 'h3'
import { query } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { isValidPermissionKey } from '~/server/utils/permissions'
import { isSubdivisionPermissionKey } from '~/config/subdivisionPermissions'

interface PositionRow {
  id: number
  code: string
  name: string
  is_active: number
  subdivision_bound: number
}

interface PositionPermissionRow {
  position_id: number
  permission_key: string
}

interface GetPositionsSuccess {
  ok: true
  positions: Array<{
    id: number
    code: string
    name: string
    is_active: boolean
    subdivision_bound: boolean
    permissions: string[]
    /** Scoped keys, effective only inside the subdivision of each assignment. */
    subdivision_permissions: string[]
  }>
}

interface GetPositionsError {
  ok: false
  error: string
}

type GetPositionsResponse = GetPositionsSuccess | GetPositionsError

export default defineEventHandler(async (event): Promise<GetPositionsResponse> => {
  const current = await requirePermission(event, 'permissions.manage')
  if (!current.ok) return current

  const positions = await query<PositionRow[]>(
    `SELECT id, code, name, is_active, subdivision_bound
     FROM positions
     ORDER BY code ASC`
  )

  const positionPermissions = await query<PositionPermissionRow[]>(
    `SELECT position_id, permission_key
     FROM position_permissions`
  )

  const permissionsByPosition = new Map<number, string[]>()
  const scopedByPosition = new Map<number, string[]>()
  for (const pp of positionPermissions) {
    const id = Number(pp.position_id)
    const target = isValidPermissionKey(pp.permission_key)
      ? permissionsByPosition
      : isSubdivisionPermissionKey(pp.permission_key) ? scopedByPosition : null
    if (!target) continue
    if (!target.has(id)) target.set(id, [])
    target.get(id)!.push(pp.permission_key)
  }

  return {
    ok: true,
    positions: positions.map(position => ({
      id: Number(position.id),
      code: position.code,
      name: position.name,
      is_active: position.is_active === 1,
      subdivision_bound: Boolean(position.subdivision_bound),
      permissions: permissionsByPosition.get(Number(position.id)) ?? [],
      subdivision_permissions: scopedByPosition.get(Number(position.id)) ?? [],
    }))
  }
})
