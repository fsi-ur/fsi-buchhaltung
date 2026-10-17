import { defineEventHandler, readBody } from 'h3'
import { hasPermission, requireAuth } from '~/server/utils/api/guards'
import { getNumericRouteParam } from '~/server/utils/api/request'
import { getMemberIdForUser } from '~/server/utils/appointments/visibility'
import { withAuditTransaction } from '~/server/utils/db'
import { getChecklistItemContext, setChecklistItemDone } from '~/server/utils/eventChecklists'
import { isEventOrganizer } from '~/server/utils/events'
import { isTaskAssignee } from '~/server/utils/myTasks'
import type { EventTaskStatus } from '~/types/event'

interface UpdateChecklistItemDoneSuccess {
  ok: true
  done: boolean
  /** The linked task's status after the change; null when the checklist has no task. */
  task: { id: number; status: EventTaskStatus } | null
}

interface UpdateChecklistItemDoneError {
  ok: false
  error: string
}

export type UpdateChecklistItemDoneResponse = UpdateChecklistItemDoneSuccess | UpdateChecklistItemDoneError

/**
 * Ticks or unticks a single event checklist item. Unlike PUT /api/events/:id/checklists
 * (organizers and events.edit only, replaces every checklist) this is also open to the assignees
 * of the task the checklist is linked to, and touches nothing but the item and that task's status.
 */
export default defineEventHandler(async (event): Promise<UpdateChecklistItemDoneResponse> => {
  const current = await requireAuth(event)
  if (!current.ok) return current

  const itemId = getNumericRouteParam(event)
  if (!itemId) return { ok: false, error: 'Invalid checklist item id' }

  const body = await readBody(event)
  if (typeof body?.done !== 'boolean') return { ok: false, error: 'Invalid done value' }
  const done: boolean = body.done

  try {
    return await withAuditTransaction(current.user, async (conn) => {
      const context = await getChecklistItemContext(itemId, conn)
      if (!context) return { ok: false, error: 'Checklist item not found' }

      let allowed = hasPermission(current.user, 'events.edit') || await isEventOrganizer(current.user.id, context.eventId, conn)
      if (!allowed && context.taskId !== null) {
        const memberId = await getMemberIdForUser(Number(current.user.id), conn)
        allowed = memberId !== null && await isTaskAssignee(memberId, context.taskId, conn)
      }
      if (!allowed) return { ok: false, error: 'Keine Berechtigung' }

      const task = await setChecklistItemDone(itemId, done, context, conn)
      return { ok: true, done, task }
    })
  } catch (err: any) {
    return { ok: false, error: `Failed to update checklist item: ${err}` }
  }
})
