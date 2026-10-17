import { defineEventHandler, readBody } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { createApiKey, normalizeApiKeyName, validateApiKeyName } from '~/server/utils/apiKeys'
import { withAuditTransaction } from '~/server/utils/db'

interface CreateApiKeySuccess {
  ok: true
  id: number
  /** The plain-text key. It is not stored and can't be shown again. */
  key: string
}

interface CreateApiKeyError {
  ok: false
  error: string
}

export type CreateApiKeyResponse = CreateApiKeySuccess | CreateApiKeyError

export default defineEventHandler(async (event): Promise<CreateApiKeyResponse> => {
  const current = await requirePermission(event, 'settings.apiKeys.manage')
  if (!current.ok) return current

  const body = await readBody(event)
  const name = normalizeApiKeyName(body?.name)
  const validationError = validateApiKeyName(name)
  if (validationError) return { ok: false, error: validationError }

  try {
    return await withAuditTransaction(current.user, async (conn) => {
      const created = await createApiKey(name, current.user.id, conn)
      return { ok: true, ...created }
    })
  } catch (err: any) {
    return { ok: false, error: `Failed to create API key: ${err}` }
  }
})
