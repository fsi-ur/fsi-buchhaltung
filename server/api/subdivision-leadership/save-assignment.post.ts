import { defineEventHandler, readBody } from 'h3'
import { withAuditTransaction } from '~/server/utils/db'
import { internalError } from '~/server/utils/api/errors'
import { withLastAdminGuard } from '~/server/utils/permissions'
import {
  requireSubdivisionPermission,
  saveLeadershipAssignment,
  type LeadershipAssignmentInput,
  type LeadershipResult,
} from '~/server/utils/subdivisionLeadership'

interface SaveAssignmentBody extends LeadershipAssignmentInput {
  subdivision_id: number
}

export default defineEventHandler(async (event): Promise<LeadershipResult> => {
  const body = await readBody<SaveAssignmentBody>(event)
  const subdivisionId = Number(body?.subdivision_id)

  const current = await requireSubdivisionPermission(event, 'subdivision.positions.assign', subdivisionId, { touch: false })
  if (!current.ok) return current

  const memberId = Number(body?.member_id)
  const positionId = Number(body?.position_id)
  const id = body?.id === undefined || body?.id === null ? null : Number(body.id)
  if (!Number.isInteger(memberId) || memberId <= 0 || !Number.isInteger(positionId) || positionId <= 0) {
    return { ok: false, error: 'Missing fields' }
  }
  if (id !== null && (!Number.isInteger(id) || id <= 0)) return { ok: false, error: 'Invalid assignment id' }

  try {
    return await withAuditTransaction(current.user, withLastAdminGuard(conn => saveLeadershipAssignment(
      current.user,
      current.access,
      subdivisionId,
      { id, member_id: memberId, position_id: positionId, since: body.since, until: body.until },
      conn,
    )))
  } catch (err: unknown) {
    return internalError('Failed to save the position assignment', err)
  }
})
