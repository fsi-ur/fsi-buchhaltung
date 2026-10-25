import { defineEventHandler, getQuery, setHeader } from 'h3'
import { hasPermission, requireAuth } from '~/server/utils/api/guards'
import { getNumericRouteParam } from '~/server/utils/api/request'
import { isEventOrganizer } from '~/server/utils/events'
import { loadCurrentMemberIdForUser } from '~/server/utils/eventShifts'
import { createShiftPlanRenderer } from '~/server/utils/notifications/shiftPlan'

export default defineEventHandler(async (event) => {
  const current = await requireAuth(event)
  if (!current.ok) return current

  const eventId = getNumericRouteParam(event)
  if (!eventId) return { ok: false, error: 'Invalid event id' }

  const organizer = await isEventOrganizer(current.user.id, eventId)
  if (!hasPermission(current.user, ['events.access', 'events.view', 'events.shifts.signup']) && !organizer) {
    return { ok: false, error: 'Not authorized' }
  }

  const includeDescriptions = String(getQuery(event).descriptions ?? '') === '1'
  const highlightOwn = String(getQuery(event).own ?? '') === '1'

  const renderer = await createShiftPlanRenderer({ eventId, includeDescriptions })
  if (!renderer) return { ok: false, error: 'Event not found' }

  const highlightMemberId = highlightOwn ? await loadCurrentMemberIdForUser(current.user.id) : null
  const pdf = renderer.render(highlightMemberId)

  setHeader(event, 'Content-Type', 'application/pdf')
  setHeader(event, 'Content-Disposition', `attachment; filename="${renderer.fileName}"`)
  return pdf
})
