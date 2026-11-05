import { defineEventHandler, readBody } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { toDbBoolean } from '~/server/utils/api/request'
import { query, withAuditTransaction } from '~/server/utils/db'
import { getMemberLabels, syncSubdivisionAssignments } from '~/server/utils/subdivisions'
import type { ActivateResponse } from '~/types/activate'
import { internalError } from '~/server/utils/api/errors'

interface ActivateSubdivisionBody {
  id: number
  is_active: boolean
  remove_member_assignments?: boolean
}

interface SubdivisionRow {
  id: number
  is_active: number
}

export default defineEventHandler(async (event): Promise<ActivateResponse> => {
  const current = await requirePermission(event, 'settings.subdivisions.manage')
  if (!current.ok) return current

  const {
    id,
    is_active,
    remove_member_assignments,
  } = await readBody<ActivateSubdivisionBody>(event)

  if (id === undefined || id === null || is_active === undefined || is_active === null) {
    return { ok: false, error: 'Missing fields' }
  }

  try {
    return await withAuditTransaction(current.user, async (conn) => {
      const existingRows = await query<SubdivisionRow[]>(
        `SELECT id, is_active
         FROM subdivisions
         WHERE id = ?
         LIMIT 1`,
        [id],
        conn,
      )

      if (!existingRows.length) {
        return { ok: false, error: 'No matching subdivisions in database' }
      }

      const active = toDbBoolean(is_active)

      await query(
        `UPDATE subdivisions
         SET is_active = ?
         WHERE id = ?`,
        [active, id],
        conn,
      )

      if (is_active || !remove_member_assignments) {
        return { ok: true }
      }

      const memberRows = await query<{ member_id: number }[]>(
        `SELECT member_id
         FROM subdivision_members
         WHERE subdivision_id = ?`,
        [id],
        conn,
      )

      const memberIds = memberRows.map(row => Number(row.member_id))
      if (!memberIds.length) return { ok: true }

      const memberLabels = await getMemberLabels(memberIds, conn)

      await syncSubdivisionAssignments({
        existingIds: memberIds,
        nextIds: [],
        getAssignment: (memberId) => ({
          subdivisionId: Number(id),
          memberId,
          memberLabel: memberLabels.get(memberId) ?? String(memberId),
        }),
        userId: current.user.id,
        conn,
      })

      return { ok: true }
    })
  } catch (err: any) {
    return internalError('An error occured while activating/deactivating the subdivision', err)
  }
})
