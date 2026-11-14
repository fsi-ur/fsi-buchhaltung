import { withLastAdminGuard } from '~/server/utils/permissions'
import { defineEventHandler, readBody } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { isValidPermissionKey } from '~/server/utils/permissions'
import { isAssignableSubdivisionPermissionKey, isSubdivisionPermissionKey } from '~/config/subdivisionPermissions'
import { syncScalarCollection } from '~/server/utils/syncScalarCollection'
import { requirePermission } from '~/server/utils/api/guards'
import { internalError } from '~/server/utils/api/errors'

interface SetPositionPermissionsBody {
  position_id: number
  permissions: string[]
  /** Scoped keys; omitted = leave them as they are. Only subdivision-bound positions can carry them. */
  subdivision_permissions?: string[]
}

interface SetPositionPermissionsSuccess {
  ok: true
}

interface SetPositionPermissionsError {
  ok: false
  error: string
}

type SetPositionPermissionsResponse = SetPositionPermissionsSuccess | SetPositionPermissionsError

export default defineEventHandler(async (event): Promise<SetPositionPermissionsResponse> => {
  const current = await requirePermission(event, 'permissions.manage', { touch: false })
  if (!current.ok) return current

  const body = await readBody<SetPositionPermissionsBody>(event)
  const positionId = Number(body.position_id)
  if (!positionId) return { ok: false, error: 'Missing position id' }

  const rows = await query<{ id: number, subdivision_bound: number }[]>(
    `SELECT id, subdivision_bound FROM positions WHERE id = ? LIMIT 1`,
    [positionId]
  )
  if (!rows.length) return { ok: false, error: 'Position not found' }

  const newPermissions = Array.isArray(body.permissions)
    ? body.permissions.filter(isValidPermissionKey)
    : []

  const scopedRequested = Array.isArray(body.subdivision_permissions)
  const newScopedPermissions = scopedRequested
    ? Array.from(new Set(body.subdivision_permissions!.filter(isAssignableSubdivisionPermissionKey)))
    : []
  if (newScopedPermissions.length && !rows[0]!.subdivision_bound) {
    return { ok: false, error: 'Nur an eine Untergliederung gebundene Positionen können Rechte in der Untergliederung erhalten.' }
  }

  try {
    const result = await withAuditTransaction(current.user, withLastAdminGuard(async (conn) => {
      const existingRows = await query<{ permission_key: string }[]>(
        `SELECT permission_key
         FROM position_permissions
         WHERE position_id = ?`,
        [positionId],
        conn
      )

      const existingPermissions = existingRows
        .map(row => row.permission_key)
        .filter(isValidPermissionKey)

      await syncScalarCollection({
        existing: existingPermissions,
        incoming: newPermissions,
        onRemove: async (perm) => {
          await query(
            `DELETE FROM position_permissions
             WHERE position_id = ? AND permission_key = ?`,
            [positionId, perm],
            conn
          )
        },
        onAdd: async (perm) => {
          await query(
            `INSERT INTO position_permissions (position_id, permission_key)
             VALUES (?, ?)`,
            [positionId, perm],
            conn
          )
        },
      })

      if (scopedRequested) {
        const existingScoped = existingRows
          .map(row => row.permission_key)
          .filter(isSubdivisionPermissionKey)
        await syncScalarCollection({
          existing: existingScoped,
          incoming: newScopedPermissions,
          onRemove: async (perm) => {
            await query(
              `DELETE FROM position_permissions
               WHERE position_id = ? AND permission_key = ?`,
              [positionId, perm],
              conn
            )
          },
          onAdd: async (perm) => {
            await query(
              `INSERT INTO position_permissions (position_id, permission_key)
               VALUES (?, ?)`,
              [positionId, perm],
              conn
            )
          },
        })
      }
      return { ok: true as const }
    }))

    return result
  } catch (err: any) {
    return internalError('Failed to update position permissions', err)
  }
})
