import { defineEventHandler, readBody } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { isValidPermissionKey } from '~/server/utils/permissions'
import { syncScalarCollection } from '~/server/utils/syncScalarCollection'
import { requirePermission } from '~/server/utils/api/guards'
import { internalError } from '~/server/utils/api/errors'

interface UpdateUserAccessBody {
  user_id: number
  roles: number[]
  permissions: string[]
}

interface UpdateUserAccessSuccess {
  ok: true
}

interface UpdateUserAccessError {
  ok: false
  error: string
}

type UpdateUserAccessResponse = UpdateUserAccessSuccess | UpdateUserAccessError

export default defineEventHandler(async (event): Promise<UpdateUserAccessResponse> => {
  const current = await requirePermission(event, 'permissions.manage', { touch: false })
  if (!current.ok) return current

  const body = await readBody<UpdateUserAccessBody>(event)
  const userId = Number(body.user_id)
  if (!userId) return { ok: false, error: 'Missing user id' }

  const userRows = await query<{ id: number }[]>(
    `SELECT id FROM users WHERE id = ? LIMIT 1`,
    [userId]
  )
  if (!userRows.length) return { ok: false, error: 'User not found' }

  const newRoles = Array.isArray(body.roles) ? [...body.roles] : []
  const newPermissions = Array.isArray(body.permissions)
    ? body.permissions.filter(isValidPermissionKey)
    : []

  if (newRoles.length) {
    const validRoles = await query<{ id: number }[]>(
      `SELECT id
       FROM roles
       WHERE is_active = 1
         AND id IN (${newRoles.map(() => '?').join(',')})`,
      newRoles
    )
    const validRoleSet = new Set(validRoles.map(role => role.id))
    if (newRoles.some(role => !validRoleSet.has(role))) {
      return { ok: false, error: 'Inactive or unknown roles cannot be assigned' }
    }
  }

  try {
    await withAuditTransaction(current.user, async (conn) => {
      const existingRoleRows = await query<{ role_id: number }[]>(
        `SELECT role_id
         FROM user_roles
         WHERE user_id = ?`,
        [userId],
        conn
      )

      const existingRoles = existingRoleRows.map(row => row.role_id)

      await syncScalarCollection({
        existing: existingRoles,
        incoming: newRoles,
        onRemove: async (role) => {
          await query(
            `DELETE FROM user_roles
             WHERE user_id = ? AND role_id = ?`,
            [userId, role],
            conn
          )
        },
        onAdd: async (role) => {
          await query(
            `INSERT INTO user_roles (user_id, role_id)
             VALUES (?, ?)`,
            [userId, role],
            conn
          )
        },
      })

      const existingRows = await query<{ permission_key: string }[]>(
        `SELECT permission_key
         FROM user_permissions
         WHERE user_id = ?`,
        [userId],
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
            `DELETE FROM user_permissions
             WHERE user_id = ? AND permission_key = ?`,
            [userId, perm],
            conn
          )
        },
        onAdd: async (perm) => {
          await query(
            `INSERT INTO user_permissions (user_id, permission_key)
             VALUES (?, ?)`,
            [userId, perm],
            conn
          )
        },
      })
    })

    return { ok: true }
  } catch (err: any) {
    return internalError('Failed to update user access', err)
  }
})
