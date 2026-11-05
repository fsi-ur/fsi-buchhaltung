import { defineEventHandler, readBody } from 'h3'
import { hasPermission, requireAuth } from '~/server/utils/api/guards'
import { getNumericRouteParam } from '~/server/utils/api/request'
import { withAuditTransaction } from '~/server/utils/db'
import { isEventOrganizer } from '~/server/utils/events'
import {
  eventExists,
  loadEventShiftSlots,
  normalizeEventShiftSlots,
  replaceEventShiftSlots,
} from '~/server/utils/eventShifts'
import type { EventShiftSlot } from '~/types/event'
import { internalError } from '~/server/utils/api/errors'

interface UpdateEventShiftsSuccess {
  ok: true
  shifts: EventShiftSlot[]
}

interface UpdateEventShiftsError {
  ok: false
  error: string
}

export type UpdateEventShiftsResponse = UpdateEventShiftsSuccess | UpdateEventShiftsError

export default defineEventHandler(async (event): Promise<UpdateEventShiftsResponse> => {
  const current = await requireAuth(event)
  if (!current.ok) return current

  const eventId = getNumericRouteParam(event)
  if (!eventId) return { ok: false, error: 'Invalid event id' }

  if (!hasPermission(current.user, 'events.edit') && !await isEventOrganizer(current.user.id, eventId)) {
    return { ok: false, error: 'Keine Berechtigung' }
  }

  const body = await readBody(event)
  const shifts = normalizeEventShiftSlots(Array.isArray(body) ? body : body?.shifts)
  if (!shifts) return { ok: false, error: 'Invalid shift data' }

  try {
    return await withAuditTransaction(current.user, async (conn) => {
      if (!await eventExists(eventId, conn)) return { ok: false, error: 'Event not found' }

      const validationError = await replaceEventShiftSlots({
        eventId,
        slots: shifts,
        conn,
        actingUserId: current.user.id,
      })
      if (validationError) return { ok: false, error: validationError }

      return {
        ok: true,
        shifts: await loadEventShiftSlots(eventId, conn),
      }
    })
  } catch (err: any) {
    return internalError('Failed to update event shifts', err)
  }
})
