import { defineEventHandler, readBody } from 'h3'
import { hasPermission, requireAuth } from '~/server/utils/api/guards'
import { getNumericRouteParam } from '~/server/utils/api/request'
import { withAuditTransaction } from '~/server/utils/db'
import { isEventOrganizer } from '~/server/utils/events'
import {
  eventExists,
  loadEventShiftTypeDescriptions,
  normalizeEventShiftTypeDescriptions,
  replaceEventShiftTypeDescriptions,
} from '~/server/utils/eventShifts'
import type { EventShiftTypeDescriptions } from '~/types/event'
import { internalError } from '~/server/utils/api/errors'

interface UpdateEventShiftTypeDescriptionsSuccess {
  ok: true
  typeDescriptions: EventShiftTypeDescriptions
}

interface UpdateEventShiftTypeDescriptionsError {
  ok: false
  error: string
}

export type UpdateEventShiftTypeDescriptionsResponse = UpdateEventShiftTypeDescriptionsSuccess | UpdateEventShiftTypeDescriptionsError

export default defineEventHandler(async (event): Promise<UpdateEventShiftTypeDescriptionsResponse> => {
  const current = await requireAuth(event)
  if (!current.ok) return current

  const eventId = getNumericRouteParam(event)
  if (!eventId) return { ok: false, error: 'Invalid event id' }

  if (!hasPermission(current.user, 'events.edit') && !await isEventOrganizer(current.user.id, eventId)) {
    return { ok: false, error: 'Keine Berechtigung' }
  }

  const body = await readBody(event)
  const entries = normalizeEventShiftTypeDescriptions(body?.entries)
  if (!entries) return { ok: false, error: 'Invalid shift type description data' }

  try {
    return await withAuditTransaction(current.user, async (conn) => {
      if (!await eventExists(eventId, conn)) return { ok: false, error: 'Event not found' }

      await replaceEventShiftTypeDescriptions({
        eventId,
        entries,
        conn,
      })

      return {
        ok: true,
        typeDescriptions: await loadEventShiftTypeDescriptions(eventId, conn),
      }
    })
  } catch (err: any) {
    return internalError('Failed to update shift type descriptions', err)
  }
})
