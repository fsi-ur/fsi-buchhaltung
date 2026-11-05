import { withLastAdminGuard } from '~/server/utils/permissions'
import { defineEventHandler, readBody } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { toDbBoolean } from '~/server/utils/api/request'
import { internalError } from '~/server/utils/api/errors'

interface SaveRoleBody {
  id?: number
  code: string
  name: string
  description?: string | null
  is_active?: boolean
  is_default?: boolean
}

interface SaveRoleSuccess {
  ok: true
}

interface SaveRoleError {
  ok: false
  error: string
}

type SaveRoleResponse = SaveRoleSuccess | SaveRoleError

export default defineEventHandler(async (event): Promise<SaveRoleResponse> => {
  const current = await requirePermission(event, 'permissions.manage', { touch: false })
  if (!current.ok) return current

  const body = await readBody<SaveRoleBody>(event)
  if (!body.code?.trim() || !body.name?.trim()) return { ok: false, error: 'Missing fields' }

  const updated = {
    id: body.id || null,
    code: body.code.trim(),
    name: body.name.trim(),
    description: body.description?.trim() || null,
    is_active: body.is_active !== false,
    is_default: body.is_default === true,
  }
  const nextIsDefault = updated.is_active ? updated.is_default : false

  try {
    return await withAuditTransaction(current.user, withLastAdminGuard(async (conn) => {
      if (updated.id && updated.id > 0) {
        const existingRows = await query<any[]>(
          `SELECT id, code, name, description, is_active, is_default FROM roles WHERE id = ? LIMIT 1`,
          [updated.id],
          conn
        )

        if (!existingRows.length) return { ok: false, error: 'No matching role in database' }
        if (nextIsDefault) {
          await query(
            `UPDATE roles
             SET is_default = 0
             WHERE id <> ? AND is_default = 1`,
            [updated.id],
            conn
          )
        }

        await query(
          `UPDATE roles
          SET code = ?, name = ?, description = ?, is_active = ?, is_default = ?
          WHERE id = ?`,
          [updated.code, updated.name, updated.description, toDbBoolean(updated.is_active), toDbBoolean(nextIsDefault), updated.id],
          conn
        )

        return { ok: true }
      }

      const insertResult = await query<any>(
        `INSERT INTO roles (code, name, is_active, is_default, description)
        VALUES (?, ?, ?, ?, ?)`,
        [updated.code, updated.name, toDbBoolean(updated.is_active), toDbBoolean(nextIsDefault), updated.description],
        conn
      )

      if (nextIsDefault) {
        await query(
          `UPDATE roles
           SET is_default = 0
           WHERE id <> ? AND is_default = 1`,
          [Number(insertResult.insertId)],
          conn
        )
      }

      return { ok: true }
    }))
  } catch (err: any) {
    return internalError('An error occured while saving the role', err)
  }
})
