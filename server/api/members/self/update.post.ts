import { defineEventHandler, readBody } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { withAuditTransaction } from '~/server/utils/db'
import { applySelfEdit, getMemberForUser } from '~/server/utils/memberSelfEdit'
import { isSelfEditFieldName, type SelfEditFieldName } from '~/config/memberSelfEdit'
import { internalError } from '~/server/utils/api/errors'

interface UpdateSelfSuccess {
  ok: true
  applied: SelfEditFieldName[]
  pending: SelfEditFieldName[]
}

interface UpdateSelfError {
  ok: false
  error: string
}

export type UpdateMemberSelfResponse = UpdateSelfSuccess | UpdateSelfError

export default defineEventHandler(async (event): Promise<UpdateMemberSelfResponse> => {
  const current = await requirePermission(event, 'members.editOwnData')
  if (!current.ok) return current

  const body = await readBody<Record<string, unknown>>(event)
  if (!body || typeof body !== 'object') return { ok: false, error: 'Invalid body' }

  const patch: Partial<Record<SelfEditFieldName, unknown>> = {}
  for (const [key, value] of Object.entries(body)) {
    if (!isSelfEditFieldName(key)) return { ok: false, error: `Unknown field: ${key}` }
    patch[key] = value
  }

  if (!Object.keys(patch).length) return { ok: false, error: 'No fields to update' }

  const member = await getMemberForUser(current.user.id)
  if (!member) return { ok: false, error: 'No linked member record' }

  try {
    return await withAuditTransaction(current.user, async (conn) => {
      const result = await applySelfEdit(member.id, patch, current.user.id, conn)
      return result
    })
  } catch (err: any) {
    return internalError('Failed to update member data', err)
  }
})
