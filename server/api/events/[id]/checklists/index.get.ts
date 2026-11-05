import { defineEventHandler } from 'h3'
import { hasPermission, requireAuth } from '~/server/utils/api/guards'
import { getNumericRouteParam } from '~/server/utils/api/request'
import { isEventOrganizer } from '~/server/utils/events'
import { loadEventChecklists, loadEventChecklistTemplates } from '~/server/utils/eventChecklists'
import { eventExists } from '~/server/utils/eventShifts'
import type { EventChecklist, EventChecklistTemplate } from '~/types/event'
import { internalError } from '~/server/utils/api/errors'

interface GetEventChecklistsSuccess {
  ok: true
  checklists: EventChecklist[]
  templates: EventChecklistTemplate[]
  canManageChecklists: boolean
}

interface GetEventChecklistsError {
  ok: false
  error: string
}

export type GetEventChecklistsResponse = GetEventChecklistsSuccess | GetEventChecklistsError

export default defineEventHandler(async (event): Promise<GetEventChecklistsResponse> => {
  const current = await requireAuth(event)
  if (!current.ok) return current

  const eventId = getNumericRouteParam(event)
  if (!eventId) return { ok: false, error: 'Invalid event id' }

  try {
    if (!await eventExists(eventId)) return { ok: false, error: 'Event not found' }

    const isOrganizer = await isEventOrganizer(current.user.id, eventId)

    if (!hasPermission(current.user, 'events.view') && !isOrganizer) {
      return { ok: false, error: 'Not authorized' }
    }

    return {
      ok: true,
      checklists: await loadEventChecklists(eventId),
      templates: await loadEventChecklistTemplates(),
      canManageChecklists: hasPermission(current.user, 'events.edit') || isOrganizer,
    }
  } catch (err: any) {
    return internalError('Failed to load event checklists', err)
  }
})
