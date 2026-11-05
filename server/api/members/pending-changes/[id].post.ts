import { defineEventHandler, readBody } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { withAuditTransaction } from '~/server/utils/db'
import { getNumericRouteParam } from '~/server/utils/api/request'
import { resolvePendingChange } from '~/server/utils/memberSelfEdit'
import { internalError } from '~/server/utils/api/errors'

interface ResolvePendingChangeSuccess {
  ok: true
}

interface ResolvePendingChangeError {
  ok: false
  error: string
}

type ResolvePendingChangeResponse = ResolvePendingChangeSuccess | ResolvePendingChangeError

export default defineEventHandler(async (event): Promise<ResolvePendingChangeResponse> => {
  const current = await requirePermission(event, 'members.approveChanges')
  if (!current.ok) return current

  const id = getNumericRouteParam(event)
  if (!id) return { ok: false, error: 'Missing pending change id' }

  const body = await readBody<{ action?: string }>(event)
  const action = body?.action
  if (action !== 'approve' && action !== 'reject') return { ok: false, error: 'Invalid action' }

  try {
    return await withAuditTransaction(current.user, async (conn) => {
      return await resolvePendingChange(id, action, conn)
    })
  } catch (err: any) {
    return internalError('Failed to resolve pending change', err)
  }
})
