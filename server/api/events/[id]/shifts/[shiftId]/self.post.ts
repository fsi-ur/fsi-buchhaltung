import { defineEventHandler } from 'h3'
import { hasPermission, requireAuth } from '~/server/utils/api/guards'
import { getNumericRouteParam } from '~/server/utils/api/request'
import { withAuditTransaction } from '~/server/utils/db'
import { isEventOrganizer } from '~/server/utils/events'
import {
  addSelfToShift,
  loadCurrentMemberIdForUser,
  loadEventShiftSlots,
} from '~/server/utils/eventShifts'
import type { EventShiftSlot } from '~/types/event'
import { internalError } from '~/server/utils/api/errors'

interface AddSelfToShiftSuccess {
  ok: true
  shifts: EventShiftSlot[]
}

interface AddSelfToShiftError {
  ok: false
  error: string
}

export type AddSelfToShiftResponse = AddSelfToShiftSuccess | AddSelfToShiftError

export default defineEventHandler(async (event): Promise<AddSelfToShiftResponse> => {
  const current = await requireAuth(event)
  if (!current.ok) return current

  const eventId = getNumericRouteParam(event, 'id')
  const shiftId = getNumericRouteParam(event, 'shiftId')
  if (!eventId) return { ok: false, error: 'Invalid event id' }
  if (!shiftId) return { ok: false, error: 'Invalid shift id' }

  if (!hasPermission(current.user, ['events.edit', 'events.shifts.signup']) && !await isEventOrganizer(current.user.id, eventId)) {
    return { ok: false, error: 'Keine Berechtigung' }
  }

  try {
    return await withAuditTransaction(current.user, async (conn) => {
      const memberId = await loadCurrentMemberIdForUser(current.user.id, conn)
      if (!memberId) return { ok: false, error: 'Current account is not linked to a member' }

      const error = await addSelfToShift({
        eventId,
        shiftId,
        memberId,
        conn,
      })
      if (error) return { ok: false, error }

      return {
        ok: true,
        shifts: await loadEventShiftSlots(eventId, conn),
      }
    })
  } catch (err: any) {
    return internalError('Failed to assign shift member', err)
  }
})
