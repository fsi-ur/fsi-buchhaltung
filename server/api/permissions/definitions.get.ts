import { defineEventHandler } from 'h3'
import { PERMISSIONS, type PermissionDefinition } from '~/config/permissions'
import { requirePermission } from '~/server/utils/api/guards'

interface DefinitionsSuccess {
  ok: true
  permissions: PermissionDefinition[]
}

interface DefinitionsError {
  ok: false
  error: string
}

type DefinitionsResponse = DefinitionsSuccess | DefinitionsError

export default defineEventHandler(async (event): Promise<DefinitionsResponse> => {
  const current = await requirePermission(event, ['permissions.manage', 'settings.viewAs'])
  if (!current.ok) return current

  return { ok: true, permissions: PERMISSIONS }
})
