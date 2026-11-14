import { withLastAdminGuard } from '~/server/utils/permissions'
import { defineEventHandler, readBody } from 'h3'
import type { PositionRow, SavePositionBody } from '~/types/position'
import { query, withAuditTransaction } from '~/server/utils/db'
import { normalizeBigInt } from '~/server/utils/normalize'
import { requirePermission } from '~/server/utils/api/guards'
import { toDbBoolean } from '~/server/utils/api/request'
import { normalizePositionAssignments, POSITION_ASSIGNMENT_COLUMNS, syncPositionAssignments, type PositionAssignmentRow } from '~/server/utils/positions'
import { internalError } from '~/server/utils/api/errors'

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

const POSITION_BINDING_LOCKED = 'Die Bindung an eine Untergliederung kann nur geändert werden, solange die Position keine Zuweisungen hat.'

export default defineEventHandler(async (event): Promise<SavePositionResponse> => {
  const current = await requirePermission(event, 'settings.positions.manage', { touch: false })
  if (!current.ok) return current

  const body = await readBody<SavePositionBody>(event)
  if (!body.code || !body.name) return { ok: false, error: 'Missing fields' }
  const updated = body

  if (updated.is_active === undefined || updated.is_active === null) updated.is_active = true
  const active = toDbBoolean(updated.is_active)
  const subdivisionBound = updated.subdivision_bound === true
  // Only a subdivision-bound position can be handed out by subdivision leaders.
  const assignableByLeaders = subdivisionBound && updated.assignable_by_leaders === true

  try {
    return await withAuditTransaction(current.user, withLastAdminGuard(async (conn) => {
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

        const existingAssignmentRows = await query<PositionAssignmentRow[]>(
          `SELECT ${POSITION_ASSIGNMENT_COLUMNS}
           FROM member_positions
           WHERE position_id = ?`,
          [positionId],
          conn,
        )

        // Existing assignments either all carry a subdivision or none does, so the binding can only
        // change while the position has no assignments at all.
        if (Boolean(existingRows[0]!.subdivision_bound) !== subdivisionBound && existingAssignmentRows.length) {
          return { ok: false, error: POSITION_BINDING_LOCKED }
        }

        await query(
          `UPDATE positions
            SET code = ?, name = ?, description = ?, subdivision_bound = ?, assignable_by_leaders = ?
          WHERE id = ?`,
          [updated.code, updated.name, updated.description, subdivisionBound ? 1 : 0, assignableByLeaders ? 1 : 0, positionId],
          conn
        )

        // Scoped permissions only mean something on a subdivision-bound position.
        if (!subdivisionBound) {
          await query(
            `DELETE FROM position_permissions
             WHERE position_id = ? AND permission_key LIKE 'subdivision.%'`,
            [positionId],
            conn,
          )
        }

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
        `INSERT INTO positions (code, name, is_active, description, subdivision_bound, assignable_by_leaders)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [updated.code, updated.name, active, updated.description, subdivisionBound ? 1 : 0, assignableByLeaders ? 1 : 0],
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
    }))
  } catch (err: unknown) {
    const error = err as MysqlError
    return internalError('An error occured while saving the position', err)
  }
})
