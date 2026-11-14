import { defineEventHandler } from 'h3'
import { PERMISSIONS, type PermissionDefinition } from '~/config/permissions'
import { ASSIGNABLE_SUBDIVISION_PERMISSIONS, type SubdivisionPermissionDefinition } from '~/config/subdivisionPermissions'
import { requirePermission } from '~/server/utils/api/guards'

interface DefinitionsSuccess {
  ok: true
  permissions: PermissionDefinition[]
  /** Scoped keys a subdivision-bound position can carry (planned ones are left out). */
  subdivision_permissions: SubdivisionPermissionDefinition[]
}

interface DefinitionsError {
  ok: false
  error: string
}

type DefinitionsResponse = DefinitionsSuccess | DefinitionsError

export default defineEventHandler(async (event): Promise<DefinitionsResponse> => {
  const current = await requirePermission(event, ['permissions.manage', 'settings.viewAs'])
  if (!current.ok) return current

  return { ok: true, permissions: PERMISSIONS, subdivision_permissions: ASSIGNABLE_SUBDIVISION_PERMISSIONS }
})
