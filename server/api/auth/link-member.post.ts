import { defineEventHandler, readBody } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import {
  assignMemberToUser,
  canManageUser,
  checkMemberPositionsWithinCaller,
  MemberAlreadyLinkedError,
  MemberNotFoundError,
} from '~/server/utils/userAccounts'
import { internalError } from '~/server/utils/api/errors'

interface LinkMemberBody {
  user_id: number
  member_id: number | null
}

interface LinkMemberSuccess {
  ok: true
}

interface LinkMemberError {
  ok: false
  error: string
}

type LinkMemberResponse = LinkMemberSuccess | LinkMemberError

export default defineEventHandler(async (event): Promise<LinkMemberResponse> => {
  const current = await requirePermission(event, 'users.manage', { touch: false })
  if (!current.ok) return current

  const body = await readBody<LinkMemberBody>(event)
  const userId = Number(body.user_id)
  const memberId = body.member_id === null || body.member_id === undefined ? null : Number(body.member_id)

  if (!userId) return { ok: false, error: 'Missing user id' }
  if (memberId !== null && !memberId) return { ok: false, error: 'Missing member id' }

  return withAuditTransaction(current.user, async (conn) => {
    const userRows = await query<{ id: number }[]>(`SELECT id FROM users WHERE id = ? LIMIT 1`, [userId], conn)
    if (!userRows[0]) return { ok: false, error: 'User not found' }

    // SEC-03: the account must be manageable, and the member's positions must not hand it more
    // than the caller holds.
    const manageError = await canManageUser(current.user.permissions, userId, conn)
    if (manageError) return { ok: false, error: manageError }
    if (memberId !== null) {
      const positionError = await checkMemberPositionsWithinCaller(memberId, current.user.permissions, conn)
      if (positionError) return { ok: false, error: positionError }
    }

    try {
      await assignMemberToUser(userId, memberId, current.user.id, conn)
    } catch (err: any) {
      if (err instanceof MemberAlreadyLinkedError) {
        return { ok: false, error: 'Member already linked to another user' }
      }
      if (err instanceof MemberNotFoundError) {
        return { ok: false, error: 'Member not found' }
      }
      return internalError('Failed to link member', err)
    }

    return { ok: true }
  })
})
