import { defineEventHandler, readBody } from 'h3'
import { hasPermission, requireAuth } from '~/server/utils/api/guards'
import { getNumericRouteParam } from '~/server/utils/api/request'
import { getMemberIdForUser } from '~/server/utils/appointments/visibility'
import { withAuditTransaction } from '~/server/utils/db'
import { isEventOrganizer } from '~/server/utils/events'
import { getTaskEventId, isTaskAssignee, normalizeTaskStatus, setTaskStatus } from '~/server/utils/myTasks'
import type { EventTaskStatus } from '~/types/event'

interface UpdateTaskStatusSuccess {
  ok: true
  status: EventTaskStatus
}

interface UpdateTaskStatusError {
  ok: false
  error: string
}

export type UpdateTaskStatusResponse = UpdateTaskStatusSuccess | UpdateTaskStatusError

/**
 * Status-only update for a single task. Unlike PUT /api/events/:id/tasks (organizers and
 * events.edit only, replaces the whole list) this is open to the task's assignees — personally
 * or through a subdivision — and touches nothing but the status.
 */
export default defineEventHandler(async (event): Promise<UpdateTaskStatusResponse> => {
  const current = await requireAuth(event)
  if (!current.ok) return current

  const taskId = getNumericRouteParam(event)
  if (!taskId) return { ok: false, error: 'Invalid task id' }

  const body = await readBody(event)
  const status = normalizeTaskStatus(body?.status)
  if (!status) return { ok: false, error: 'Invalid status' }

  try {
    return await withAuditTransaction(current.user, async (conn) => {
      const eventId = await getTaskEventId(taskId, conn)
      if (!eventId) return { ok: false, error: 'Task not found' }

      const memberId = await getMemberIdForUser(Number(current.user.id), conn)
      const allowed = (memberId !== null && await isTaskAssignee(memberId, taskId, conn))
        || hasPermission(current.user, 'events.edit')
        || await isEventOrganizer(current.user.id, eventId, conn)
      if (!allowed) return { ok: false, error: 'Keine Berechtigung' }

      await setTaskStatus(taskId, status, conn)
      return { ok: true, status }
    })
  } catch (err: any) {
    return { ok: false, error: `Failed to update task status: ${err}` }
  }
})
