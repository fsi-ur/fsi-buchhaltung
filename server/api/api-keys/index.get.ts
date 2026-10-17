import { defineEventHandler } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { listApiKeys } from '~/server/utils/apiKeys'
import type { ApiKey } from '~/types/apiKey'

interface GetApiKeysSuccess {
  ok: true
  apiKeys: ApiKey[]
}

interface GetApiKeysError {
  ok: false
  error: string
}

export type GetApiKeysResponse = GetApiKeysSuccess | GetApiKeysError

export default defineEventHandler(async (event): Promise<GetApiKeysResponse> => {
  const current = await requirePermission(event, 'settings.apiKeys.manage')
  if (!current.ok) return current

  try {
    return { ok: true, apiKeys: await listApiKeys() }
  } catch (err: any) {
    return { ok: false, error: `Failed to load API keys: ${err}` }
  }
})
