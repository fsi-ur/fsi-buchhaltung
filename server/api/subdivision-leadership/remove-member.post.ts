import { defineEventHandler, readBody } from 'h3'
import { withAuditTransaction } from '~/server/utils/db'
import { internalError } from '~/server/utils/api/errors'
import { withLastAdminGuard } from '~/server/utils/permissions'
import { removeLeadershipMember, requireSubdivisionPermission, type LeadershipResult } from '~/server/utils/subdivisionLeadership'

interface RemoveMemberBody {
  subdivision_id: number
  member_id: number
}

export default defineEventHandler(async (event): Promise<LeadershipResult> => {
  const body = await readBody<RemoveMemberBody>(event)
  const subdivisionId = Number(body?.subdivision_id)
  const memberId = Number(body?.member_id)

  const current = await requireSubdivisionPermission(event, 'subdivision.members.manage', subdivisionId, { touch: false })
  if (!current.ok) return current
  if (!Number.isInteger(memberId) || memberId <= 0) return { ok: false, error: 'Missing member id' }

  try {
    // Leaving ends the member's positions in the subdivision, which may carry permissions.
    return await withAuditTransaction(current.user, withLastAdminGuard(
      conn => removeLeadershipMember(current.user, subdivisionId, memberId, conn),
    ))
  } catch (err: unknown) {
    return internalError('Failed to remove the member from the subdivision', err)
  }
})
