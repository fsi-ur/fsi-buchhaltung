import { defineEventHandler, readBody } from 'h3'
import { withAuditTransaction } from '~/server/utils/db'
import { internalError } from '~/server/utils/api/errors'
import { withLastAdminGuard } from '~/server/utils/permissions'
import { endLeadershipAssignment, requireSubdivisionPermission, type LeadershipResult } from '~/server/utils/subdivisionLeadership'

interface EndAssignmentBody {
  subdivision_id: number
  id: number
}

export default defineEventHandler(async (event): Promise<LeadershipResult> => {
  const body = await readBody<EndAssignmentBody>(event)
  const subdivisionId = Number(body?.subdivision_id)
  const assignmentId = Number(body?.id)

  const current = await requireSubdivisionPermission(event, 'subdivision.positions.assign', subdivisionId, { touch: false })
  if (!current.ok) return current
  if (!Number.isInteger(assignmentId) || assignmentId <= 0) return { ok: false, error: 'Missing assignment id' }

  try {
    return await withAuditTransaction(current.user, withLastAdminGuard(
      conn => endLeadershipAssignment(current.user, subdivisionId, assignmentId, conn),
    ))
  } catch (err: unknown) {
    return internalError('Failed to end the position assignment', err)
  }
})
