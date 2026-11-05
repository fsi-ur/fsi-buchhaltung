import { defineEventHandler, readBody } from 'h3'
import { withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { passwordPolicyError } from '~/config/validation'
import {
  assignMemberToUser,
  checkMemberPositionsWithinCaller,
  createUserAccount,
  DuplicateUsernameError,
  MemberAlreadyLinkedError,
  MemberNotFoundError,
} from '~/server/utils/userAccounts'
import { internalError } from '~/server/utils/api/errors'

interface RegisterBody {
  username: string
  password: string
  is_active?: boolean
  must_change_password?: boolean
  member_id?: number | null
}

interface RegisterSuccess {
  ok: true
}

interface RegisterError {
  ok: false
  error: string
}

type RegisterResponse = RegisterSuccess | RegisterError

export default defineEventHandler(async (event): Promise<RegisterResponse> => {
  const current = await requirePermission(event, 'users.manage', { touch: false })
  if (!current.ok) return current

  const body = await readBody<RegisterBody>(event)
  if (!body.username || !body.password) return { ok: false, error: 'Missing fields' }
  const policyError = passwordPolicyError(String(body.password))
  if (policyError) return { ok: false, error: policyError }

  try {
    const result = await withAuditTransaction(current.user, async (conn) => {
      if (body.member_id !== undefined && body.member_id !== null) {
        const positionError = await checkMemberPositionsWithinCaller(Number(body.member_id), current.user.permissions, conn)
        if (positionError) return { ok: false as const, error: positionError }
      }
      const userId = await createUserAccount(body, conn)
      if (body.member_id !== undefined) {
        await assignMemberToUser(userId, body.member_id ?? null, current.user.id, conn)
      }
      return { ok: true as const }
    })
    if (!result.ok) return result
  } catch (err: any) {
    if (err instanceof DuplicateUsernameError) {
      return { ok: false, error: 'Username already exists' }
    }
    if (err instanceof MemberAlreadyLinkedError) {
      return { ok: false, error: 'Member already linked to another user' }
    }
    if (err instanceof MemberNotFoundError) {
      return { ok: false, error: 'Member not found' }
    }
    return internalError('Failed to create user', err)
  }

  return { ok: true }
})
