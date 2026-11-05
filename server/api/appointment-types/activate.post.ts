import { defineEventHandler, readBody } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { toggleActiveRecord } from '~/server/utils/api/toggle'
import type { ActivateBody, ActivateResponse } from '~/types/activate'
import { internalError } from '~/server/utils/api/errors'

export default defineEventHandler(async (event): Promise<ActivateResponse> => {
  const current = await requirePermission(event, 'calendar.manage')
  if (!current.ok) return current

  const { id, is_active } = await readBody<ActivateBody>(event)
  if (id === undefined || id === null || is_active === undefined || is_active === null) {
    return { ok: false, error: 'Missing fields' }
  }

  try {
    return await toggleActiveRecord({
      table: 'appointment_types',
      entityType: 'appointment_type',
      id,
      isActive: is_active,
      user: current.user,
      notFoundMessage: 'Die Terminart wurde nicht gefunden.',
    })
  } catch (err: any) {
    return internalError('Die Terminart konnte nicht aktiviert oder deaktiviert werden', err)
  }
})
