import { defineEventHandler } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { getNumericRouteParam } from '~/server/utils/api/request'
import { revokeApiKey } from '~/server/utils/apiKeys'
import { withAuditTransaction } from '~/server/utils/db'

interface RevokeApiKeySuccess {
  ok: true
}

interface RevokeApiKeyError {
  ok: false
  error: string
}

export type RevokeApiKeyResponse = RevokeApiKeySuccess | RevokeApiKeyError

export default defineEventHandler(async (event): Promise<RevokeApiKeyResponse> => {
  const current = await requirePermission(event, 'settings.apiKeys.manage')
  if (!current.ok) return current

  const id = getNumericRouteParam(event)
  if (!id) return { ok: false, error: 'Invalid API key id' }

  try {
    return await withAuditTransaction(current.user, async (conn) => {
      const revoked = await revokeApiKey(id, conn)
      return revoked ? { ok: true } : { ok: false, error: 'API key not found or already revoked' }
    })
  } catch (err: any) {
    return { ok: false, error: `Failed to revoke API key: ${err}` }
  }
})
