import { defineEventHandler } from 'h3'
import { hasPermission, requireAuth } from '~/server/utils/api/guards'
import { getMemberIdForUser } from '~/server/utils/appointments/visibility'
import { getOrganizerEventIds } from '~/server/utils/events'
import { loadMyOpenTasks } from '~/server/utils/myTasks'
import type { MyEventTask } from '~/types/event'

interface GetMyTasksSuccess {
  ok: true
  tasks: MyEventTask[]
}

interface GetMyTasksError {
  ok: false
  error: string
}

export type GetMyTasksResponse = GetMyTasksSuccess | GetMyTasksError

/**
 * The signed-in user's own open tasks. Deliberately not permission-gated: being assigned to a
 * task is what grants seeing it, so a user without any events permission still gets their list.
 */
export default defineEventHandler(async (event): Promise<GetMyTasksResponse> => {
  const current = await requireAuth(event)
  if (!current.ok) return current

  try {
    const memberId = await getMemberIdForUser(Number(current.user.id))
    if (!memberId) return { ok: true, tasks: [] }

    const tasks = await loadMyOpenTasks(memberId)
    if (!tasks.length) return { ok: true, tasks }

    // The widget links into the event's task tab, which needs events.view or organizer status.
    const canViewAll = hasPermission(current.user, 'events.view')
    const organizerEventIds = canViewAll ? new Set<number>() : new Set(await getOrganizerEventIds(current.user.id))

    return {
      ok: true,
      tasks: tasks.map(task => ({ ...task, canOpenEvent: canViewAll || organizerEventIds.has(task.eventId) })),
    }
  } catch (err: any) {
    return { ok: false, error: `Failed to load tasks: ${err}` }
  }
})
