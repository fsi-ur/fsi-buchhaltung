import { defineEventHandler, readBody } from 'h3'
import type { PositionRow, SavePositionBody } from '~/types/position'
import { query, withAuditTransaction } from '~/server/utils/db'
import { normalizeBigInt } from '~/server/utils/normalize'
import { requirePermission } from '~/server/utils/api/guards'
import { toDbBoolean } from '~/server/utils/api/request'
import { normalizePositionAssignments, syncPositionAssignments, type PositionAssignmentRow } from '~/server/utils/positions'

interface SavePositionSuccess {
  ok: true
  id: number
}

interface SavePositionError {
  ok: false
  error: string
}

type SavePositionResponse = SavePositionSuccess | SavePositionError

interface MysqlError extends Error {
  code?: string
}

export default defineEventHandler(async (event): Promise<SavePositionResponse> => {
  const current = await requirePermission(event, 'settings.positions.manage', { touch: false })
  if (!current.ok) return current

  const body = await readBody<SavePositionBody>(event)
  if (!body.code || !body.name) return { ok: false, error: 'Missing fields' }
  const updated = body

  if (updated.is_active === undefined || updated.is_active === null) updated.is_active = true
  const active = toDbBoolean(updated.is_active)

  try {
    return await withAuditTransaction(current.user, async (conn) => {
      if (updated.id && updated.id > 0) {
        const positionId = updated.id
        const normalizedAssignments = normalizePositionAssignments(updated.assignments, { position_id: positionId })
        if (normalizedAssignments === null) return { ok: false, error: 'Invalid member assignments' }
        const existingRows: PositionRow[] = await query(
          `SELECT * FROM positions WHERE id = ? LIMIT 1`,
          [positionId],
          conn
        )

        if (!existingRows.length) return { ok: false, error: 'No matching positions in database' }
        await query(
          `UPDATE positions
            SET code = ?, name = ?, description = ?
          WHERE id = ?`,
          [updated.code, updated.name, updated.description, positionId],
          conn
        )

        const existingAssignmentRows = await query<PositionAssignmentRow[]>(
          `SELECT id, member_id, position_id, since, until
           FROM member_positions
           WHERE position_id = ?`,
          [positionId],
          conn,
        )

        const syncedAssignments = await syncPositionAssignments({
          scope: 'position',
          ownerId: positionId,
          existingAssignments: existingAssignmentRows,
          incomingAssignments: normalizedAssignments,
          userId: current.user.id,
          actorPermissions: current.user.permissions,
          conn,
        })
        if (!syncedAssignments.ok) return { ok: false, error: syncedAssignments.error }

        return { ok: true, id: positionId }
      }

      const res = await query(
        `INSERT INTO positions (code, name, is_active, description)
         VALUES (?, ?, ?, ?)`,
        [updated.code, updated.name, active, updated.description],
        conn
      )

      const id = normalizeBigInt(res.insertId)
      const positionId = Number(id)
      const normalizedAssignments = normalizePositionAssignments(updated.assignments, { position_id: positionId })
      if (normalizedAssignments === null) return { ok: false, error: 'Invalid member assignments' }
      const syncedAssignments = await syncPositionAssignments({
        scope: 'position',
        ownerId: positionId,
        existingAssignments: [],
        incomingAssignments: normalizedAssignments,
        userId: current.user.id,
        actorPermissions: current.user.permissions,
        conn,
      })
      if (!syncedAssignments.ok) return { ok: false, error: syncedAssignments.error }

      return { ok: true, id }
    })
  } catch (err: unknown) {
    const error = err as MysqlError
    return { ok: false, error: `An error occured while saving the position: ${error.code ?? 'DB_ERROR'}` }
  }
})
