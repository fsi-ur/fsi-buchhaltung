import { defineEventHandler, readBody } from 'h3'
import { withAuditTransaction } from '~/server/utils/db'
import { internalError } from '~/server/utils/api/errors'
import { addLeadershipMember, requireSubdivisionPermission, type LeadershipResult } from '~/server/utils/subdivisionLeadership'

interface AddMemberBody {
  subdivision_id: number
  member_id: number
}

export default defineEventHandler(async (event): Promise<LeadershipResult> => {
  const body = await readBody<AddMemberBody>(event)
  const subdivisionId = Number(body?.subdivision_id)
  const memberId = Number(body?.member_id)

  const current = await requireSubdivisionPermission(event, 'subdivision.members.manage', subdivisionId, { touch: false })
  if (!current.ok) return current
  if (!Number.isInteger(memberId) || memberId <= 0) return { ok: false, error: 'Missing member id' }

  try {
    return await withAuditTransaction(current.user, conn => addLeadershipMember(current.user, subdivisionId, memberId, conn))
  } catch (err: unknown) {
    return internalError('Failed to add the member to the subdivision', err)
  }
})
