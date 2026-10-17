import { defineEventHandler } from 'h3'
import { hasPermission, requireAuth } from '~/server/utils/api/guards'
import { getNumericRouteParam } from '~/server/utils/api/request'
import { getMemberIdForUser } from '~/server/utils/appointments/visibility'
import { isEventOrganizer } from '~/server/utils/events'
import { eventExists } from '~/server/utils/eventShifts'
import { loadEventTasks } from '~/server/utils/eventTasks'
import { getAssignedTaskIds } from '~/server/utils/myTasks'
import type { EventTask } from '~/types/event'

interface GetEventTasksSuccess {
  ok: true
  tasks: EventTask[]
  canManageTasks: boolean
  /** Tasks the user is assigned to (personally or via a subdivision) — they may change these tasks' status. */
  assignedTaskIds: number[]
}

interface GetEventTasksError {
  ok: false
  error: string
}

export type GetEventTasksResponse = GetEventTasksSuccess | GetEventTasksError

export default defineEventHandler(async (event): Promise<GetEventTasksResponse> => {
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

    const memberId = await getMemberIdForUser(Number(current.user.id))

    return {
      ok: true,
      tasks: await loadEventTasks(eventId),
      canManageTasks: hasPermission(current.user, 'events.edit') || isOrganizer,
      assignedTaskIds: memberId ? await getAssignedTaskIds(memberId, eventId) : [],
    }
  } catch (err: any) {
    return { ok: false, error: `Failed to load event tasks: ${err}` }
  }
})
