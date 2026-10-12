import { defineEventHandler, readBody } from 'h3'
import type { ActivateResponse } from '~/types/activate'
import { requirePermission } from '~/server/utils/api/guards'
import { toggleActiveRecord } from '~/server/utils/api/toggle'
import { query, withAuditTransaction } from '~/server/utils/db'
import { appTodayLocalDate } from '~/server/utils/time'

interface PositionActivateBody {
  id: number
  is_active: boolean
  assignment_until?: string | null
  delete_future_assignments?: boolean
}

interface PositionRow {
  id: number
  code: string
  name: string
  is_active: number
}

interface PositionAssignmentRow {
  id: number
  member_id: number
  since: string
  until: string | null
}

function isValidDate(value: string | null | undefined) {
  if (!value) return false
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export default defineEventHandler(async (event): Promise<ActivateResponse> => {
  const current = await requirePermission(event, 'settings.positions.manage')
  if (!current.ok) return current

  const {
    id,
    is_active,
    assignment_until,
    delete_future_assignments,
  } = await readBody<PositionActivateBody>(event)

  if (id === undefined || id === null || is_active === undefined || is_active === null) {
    return { ok: false, error: 'Missing fields' }
  }

  if (assignment_until !== undefined && assignment_until !== null && assignment_until !== '' && !isValidDate(assignment_until)) {
    return { ok: false, error: 'Invalid assignment end date' }
  }

  try {
    if (is_active) {
      return await toggleActiveRecord({
        table: 'positions',
        entityType: 'position',
        id,
        isActive: is_active,
        user: current.user,
        notFoundMessage: 'No matching positions in database',
      })
    }

    return await withAuditTransaction(current.user, async (conn) => {
      const existingRows = await query<PositionRow[]>(
        `SELECT id, code, name, is_active
         FROM positions
         WHERE id = ?
         LIMIT 1`,
        [id],
        conn,
      )
      if (!existingRows[0]) return { ok: false as const, error: 'No matching positions in database' }

      await query(
        `UPDATE positions
         SET is_active = ?
         WHERE id = ?`,
        [0, id],
        conn,
      )

      const assignments = await query<PositionAssignmentRow[]>(
        `SELECT id, member_id, since, until
         FROM member_positions
         WHERE position_id = ?`,
        [id],
        conn,
      )

      if (!assignments.length) return { ok: true as const }

      const effectiveEndDate = assignment_until?.trim() || null
      const futureCutoff = effectiveEndDate || await appTodayLocalDate(conn)

      if (effectiveEndDate) {
        const assignmentsToClose = assignments.filter(assignment => (
          assignment.since <= effectiveEndDate
          && (!assignment.until || assignment.until > effectiveEndDate)
        ))

        for (const assignment of assignmentsToClose) {
          await query(
            `UPDATE member_positions
             SET until = ?
             WHERE id = ?`,
            [effectiveEndDate, assignment.id],
            conn,
          )
        }
      }

      if (delete_future_assignments === true) {
        const assignmentsToDelete = assignments.filter(assignment => assignment.since > futureCutoff)

        for (const assignment of assignmentsToDelete) {
          await query(
            `DELETE FROM member_positions
             WHERE id = ?`,
            [assignment.id],
            conn,
          )
        }
      }

      return { ok: true as const }
    })
  } catch (err: any) {
    return { ok: false, error: `An error occured while activating/deactivating the position: ${err}` }
  }
})
