import { defineEventHandler, readBody } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { toggleActiveRecord } from '~/server/utils/api/toggle'
import type { ActivateBody, ActivateResponse } from '~/types/activate'
import { canManageUser } from '~/server/utils/userAccounts'

export default defineEventHandler(async (event): Promise<ActivateResponse> => {
  const current = await requirePermission(event, 'users.manage')
  if (!current.ok) return current

  const { id, is_active } = await readBody<ActivateBody>(event)
  if (id === undefined || id === null || is_active === undefined || is_active === null) {
    return { ok: false, error: 'Missing fields' }
  }

  const manageError = await canManageUser(current.user.permissions, Number(id))
  if (manageError) return { ok: false, error: manageError }

  try {
    return await toggleActiveRecord({
      table: 'users',
      entityType: 'user',
      id,
      isActive: is_active,
      user: current.user,
      notFoundMessage: 'No matching user in database',
    })
  } catch (err: any) {
    return { ok: false, error: `An error occured while activating/deactivating the user: ${err}` }
  }
})
