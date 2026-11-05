import { defineEventHandler, readBody } from 'h3'
import { hasPermission, requireAuth } from '~/server/utils/api/guards'
import { getNumericRouteParam } from '~/server/utils/api/request'
import { withAuditTransaction } from '~/server/utils/db'
import { isEventOrganizer } from '~/server/utils/events'
import { eventExists } from '~/server/utils/eventShifts'
import { loadEventTasks, normalizeEventTasks, replaceEventTasks } from '~/server/utils/eventTasks'
import type { EventTask } from '~/types/event'
import { internalError } from '~/server/utils/api/errors'

interface UpdateEventTasksSuccess {
  ok: true
  tasks: EventTask[]
}

interface UpdateEventTasksError {
  ok: false
  error: string
}

export type UpdateEventTasksResponse = UpdateEventTasksSuccess | UpdateEventTasksError

export default defineEventHandler(async (event): Promise<UpdateEventTasksResponse> => {
  const current = await requireAuth(event)
  if (!current.ok) return current

  const eventId = getNumericRouteParam(event)
  if (!eventId) return { ok: false, error: 'Invalid event id' }

  if (!hasPermission(current.user, 'events.edit') && !await isEventOrganizer(current.user.id, eventId)) {
    return { ok: false, error: 'Keine Berechtigung' }
  }

  const body = await readBody(event)
  const tasks = normalizeEventTasks(Array.isArray(body) ? body : body?.tasks)
  if (!tasks) return { ok: false, error: 'Invalid task data' }

  try {
    return await withAuditTransaction(current.user, async (conn) => {
      if (!await eventExists(eventId, conn)) return { ok: false, error: 'Event not found' }

      const validationError = await replaceEventTasks({ eventId, tasks, conn, actingUserId: current.user.id })
      if (validationError) return { ok: false, error: validationError }

      return {
        ok: true,
        tasks: await loadEventTasks(eventId, conn),
      }
    })
  } catch (err: any) {
    return internalError('Failed to update event tasks', err)
  }
})
