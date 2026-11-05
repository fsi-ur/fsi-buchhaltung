import { withLastAdminGuard } from '~/server/utils/permissions'
import { defineEventHandler, readBody } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { isValidPermissionKey } from '~/server/utils/permissions'
import { syncScalarCollection } from '~/server/utils/syncScalarCollection'
import { requirePermission } from '~/server/utils/api/guards'
import { internalError } from '~/server/utils/api/errors'

interface SetRolePermissionsBody {
  role_id: number
  permissions: string[]
}

interface SetRolePermissionsSuccess {
  ok: true
}

interface SetRolePermissionsError {
  ok: false
  error: string
}

type SetRolePermissionsResponse = SetRolePermissionsSuccess | SetRolePermissionsError

export default defineEventHandler(async (event): Promise<SetRolePermissionsResponse> => {
  const current = await requirePermission(event, 'permissions.manage', { touch: false })
  if (!current.ok) return current

  const body = await readBody<SetRolePermissionsBody>(event)
  const roleId = Number(body.role_id)
  if (!roleId) return { ok: false, error: 'Missing role id' }

  const roleRows = await query<{ id: number }[]>(
    `SELECT id FROM roles WHERE id = ? LIMIT 1`,
    [roleId]
  )
  if (!roleRows.length) return { ok: false, error: 'Role not found' }

  const newPermissions = Array.isArray(body.permissions)
    ? body.permissions.filter(isValidPermissionKey)
    : []

  try {
    const result = await withAuditTransaction(current.user, withLastAdminGuard(async (conn) => {
      const existingRows = await query<{ permission_key: string }[]>(
        `SELECT permission_key
         FROM role_permissions
         WHERE role_id = ?`,
        [roleId],
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
            `DELETE FROM role_permissions
             WHERE role_id = ? AND permission_key = ?`,
            [roleId, perm],
            conn
          )
        },
        onAdd: async (perm) => {
          await query(
            `INSERT INTO role_permissions (role_id, permission_key)
             VALUES (?, ?)`,
            [roleId, perm],
            conn
          )
        },
      })
      return { ok: true as const }
    }))

    return result
  } catch (err: any) {
    return internalError('Failed to update role permissions', err)
  }
})
