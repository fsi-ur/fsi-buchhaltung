import { query } from '~/server/utils/db'
import { normalizeDeadline } from '~/server/utils/eventTasks'
import { findCluster } from '~/server/utils/notifications/clusters'
import type { NotificationTypeKey } from '~/config/notificationTypes'
import type { DbConn, ResolvedRecipient, ShiftListEntry, TaskListEntry } from '~/server/utils/notifications/types'

/**
 * The entity id a reminder was planned for. Newer payloads carry it; rows planned before that only
 * have it in the dedupe key ("<type>:<entityId>:<leadMinutes>", see reminders.ts).
 */
export function reminderEntityId(payload: Record<string, any>, field: string, dedupeKey: string | null): number | null {
  const fromPayload = Number(payload[field])
  if (Number.isInteger(fromPayload) && fromPayload > 0) return fromPayload
  const fromKey = Number(String(dedupeKey ?? '').split(':')[1])
  return Number.isInteger(fromKey) && fromKey > 0 ? fromKey : null
}

/** The lead time a reminder was planned for — the last segment of its dedupe key as a fallback. */
export function reminderLeadMinutes(payload: Record<string, any>, dedupeKey: string | null): number | null {
  const fromPayload = Number(payload.lead_minutes)
  if (Number.isFinite(fromPayload) && fromPayload > 0) return fromPayload
  const fromKey = Number(String(dedupeKey ?? '').split(':').pop())
  return Number.isFinite(fromKey) && fromKey > 0 ? fromKey : null
}

function deadlineWallClock(deadline: string): string {
  return deadline.length === 10 ? `${deadline} 00:00:00` : deadline
}

async function personalShiftReminder(eventId: number, shiftId: number, memberId: number, lead: number, conn?: DbConn) {
  const rows = await query<Array<{ id: number, name: string, starts_at: string, ends_at: string }>>(
    `SELECT ess.id, ess.name, ess.starts_at, ess.ends_at
     FROM event_shift_slots ess
     JOIN event_shift_members esm ON esm.shift_id = ess.id
     WHERE ess.event_id = ? AND esm.member_id = ?`,
    [eventId, memberId],
    conn,
  )
  const shifts = rows.map(row => ({ ...row, id: Number(row.id) }))
  const cluster = findCluster(shifts.map(row => ({ id: row.id, start: row.starts_at, end: row.ends_at })), lead, 'span', shiftId)
  if (!cluster) return undefined
  if (cluster.leaderId !== shiftId) return null

  const ids = new Set(cluster.ids)
  const list: ShiftListEntry[] = shifts
    .filter(row => ids.has(row.id))
    .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)))
    .map(row => ({ shift_id: row.id, name: row.name, start: row.starts_at, end: row.ends_at }))
  return { shift_list: list }
}

async function personalTaskReminder(eventId: number, taskId: number, memberId: number, lead: number, conn?: DbConn) {
  const rows = await query<Array<{ id: number, title: string, deadline: string | null }>>(
    `SELECT DISTINCT et.id, et.title, et.deadline
     FROM event_tasks et
     LEFT JOIN event_task_members etm ON etm.task_id = et.id AND etm.member_id = ?
     LEFT JOIN event_task_subdivisions ets ON ets.task_id = et.id
     LEFT JOIN subdivision_members sm ON sm.subdivision_id = ets.subdivision_id AND sm.member_id = ?
     WHERE et.event_id = ? AND et.deadline IS NOT NULL AND et.status != 'done'
       AND (etm.member_id IS NOT NULL OR sm.member_id IS NOT NULL)`,
    [memberId, memberId, eventId],
    conn,
  )
  const tasks = rows.flatMap((row) => {
    const deadline = normalizeDeadline(row.deadline)
    return deadline ? [{ id: Number(row.id), title: row.title, deadline }] : []
  })
  const cluster = findCluster(
    tasks.map(task => ({ id: task.id, start: deadlineWallClock(task.deadline), end: deadlineWallClock(task.deadline) })),
    lead,
    'leader',
    taskId,
  )
  if (!cluster) return undefined
  if (cluster.leaderId !== taskId) return null

  const ids = new Set(cluster.ids)
  const list: TaskListEntry[] = tasks
    .filter(task => ids.has(task.id))
    .sort((a, b) => deadlineWallClock(a.deadline).localeCompare(deadlineWallClock(b.deadline)))
    .map(task => ({ task_id: task.id, title: task.title, deadline: task.deadline }))
  return { task_list: list }
}

/**
 * Folds a person's reminders together (see clusters.ts): returns the extra payload for the reminder
 * that leads the person's group, `null` when a different reminder of the group is the one that goes
 * out (skip this recipient), and `undefined` when there is nothing to fold (send as planned).
 */
export async function personalizeReminder(args: {
  type: NotificationTypeKey
  payload: Record<string, any>
  dedupeKey: string | null
  recipient: ResolvedRecipient
  conn?: DbConn
}): Promise<Record<string, any> | null | undefined> {
  const { type, payload, dedupeKey, recipient, conn } = args
  if (type !== 'shift.reminder' && type !== 'task.deadline_reminder') return undefined
  if (!recipient.memberId) return undefined

  const eventId = Number(payload.event_id)
  const lead = reminderLeadMinutes(payload, dedupeKey)
  if (!Number.isInteger(eventId) || !lead) return undefined

  if (type === 'shift.reminder') {
    const shiftId = reminderEntityId(payload, 'shift_id', dedupeKey)
    return shiftId ? personalShiftReminder(eventId, shiftId, recipient.memberId, lead, conn) : undefined
  }

  const taskId = reminderEntityId(payload, 'task_id', dedupeKey)
  return taskId ? personalTaskReminder(eventId, taskId, recipient.memberId, lead, conn) : undefined
}
