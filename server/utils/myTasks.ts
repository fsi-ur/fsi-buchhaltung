import type mariadb from 'mariadb'
import { query } from '~/server/utils/db'
import { dropFutureReminders } from '~/server/utils/notifications/enqueue'
import type { EventTaskStatus, MyEventTask } from '~/types/event'

interface MyTaskRow {
  id: number
  event_id: number
  event_name: string
  title: string
  status: string
  deadline: string | null
  assigned_directly: number
  checklist_id: number | null
  checklist_done: number
  checklist_total: number
}

interface MyTaskSubdivisionRow {
  task_id: number
  subdivision_id: number
  code: string
  name: string
}

export function normalizeTaskStatus(value: unknown): EventTaskStatus | null {
  const str = String(value ?? '')
  return str === 'open' || str === 'in_progress' || str === 'done' ? str : null
}

/**
 * Every open / in-progress task assigned to the member — personally or through one of their
 * subdivisions (the same notion of "my task" the calendar uses). `canOpenEvent` is left `false`;
 * the caller decides it, because it depends on the acting user's permissions.
 */
export async function loadMyOpenTasks(memberId: number, conn?: mariadb.PoolConnection): Promise<MyEventTask[]> {
  const rows = await query<MyTaskRow[]>(
    `SELECT t.id, t.event_id, e.name AS event_name, t.title, t.status, t.deadline,
            EXISTS (SELECT 1 FROM event_task_members etm WHERE etm.task_id = t.id AND etm.member_id = ?) AS assigned_directly,
            c.id AS checklist_id,
            COALESCE(ci_agg.done, 0) AS checklist_done,
            COALESCE(ci_agg.total, 0) AS checklist_total
     FROM event_tasks t
     JOIN events e ON e.id = t.event_id
     LEFT JOIN event_checklists c ON c.task_id = t.id
     LEFT JOIN (
       SELECT checklist_id, SUM(is_done) AS done, COUNT(*) AS total
       FROM event_checklist_items
       GROUP BY checklist_id
     ) ci_agg ON ci_agg.checklist_id = c.id
     WHERE t.status IN ('open', 'in_progress')
       AND (
         t.id IN (SELECT task_id FROM event_task_members WHERE member_id = ?)
         OR t.id IN (
           SELECT ets.task_id FROM event_task_subdivisions ets
           JOIN subdivision_members sm ON sm.subdivision_id = ets.subdivision_id
           WHERE sm.member_id = ?
         )
       )`,
    [memberId, memberId, memberId],
    conn,
  )

  if (!rows.length) return []

  const taskIds = rows.map(row => Number(row.id))

  // Only the member's own subdivisions — they explain *why* a task shows up for them.
  const subdivisionRows = await query<MyTaskSubdivisionRow[]>(
    `SELECT ets.task_id, s.id AS subdivision_id, s.code, s.name
     FROM event_task_subdivisions ets
     JOIN subdivisions s ON s.id = ets.subdivision_id
     JOIN subdivision_members sm ON sm.subdivision_id = ets.subdivision_id AND sm.member_id = ?
     WHERE ets.task_id IN (${taskIds.map(() => '?').join(',')})
     ORDER BY s.code, s.name`,
    [memberId, ...taskIds],
    conn,
  )

  const subdivisionsByTask = new Map<number, MyEventTask['viaSubdivisions']>()
  for (const row of subdivisionRows) {
    const taskId = Number(row.task_id)
    const list = subdivisionsByTask.get(taskId) ?? []
    list.push({ id: Number(row.subdivision_id), code: String(row.code), name: String(row.name) })
    subdivisionsByTask.set(taskId, list)
  }

  return rows.map(row => ({
    id: Number(row.id),
    eventId: Number(row.event_id),
    eventName: String(row.event_name),
    title: String(row.title),
    status: String(row.status) as MyEventTask['status'],
    deadline: row.deadline ? String(row.deadline) : null,
    assignedDirectly: Boolean(Number(row.assigned_directly)),
    viaSubdivisions: subdivisionsByTask.get(Number(row.id)) ?? [],
    checklistProgress: row.checklist_id !== null && row.checklist_id !== undefined
      ? { done: Number(row.checklist_done), total: Number(row.checklist_total) }
      : null,
    canOpenEvent: false,
  }))
}

/** Whether the member is assigned to the task, personally or through one of their subdivisions. */
export async function isTaskAssignee(memberId: number, taskId: number, conn?: mariadb.PoolConnection): Promise<boolean> {
  const rows = await query<{ found: number }[]>(
    `SELECT 1 AS found FROM event_task_members WHERE task_id = ? AND member_id = ?
     UNION
     SELECT 1 AS found FROM event_task_subdivisions ets
     JOIN subdivision_members sm ON sm.subdivision_id = ets.subdivision_id
     WHERE ets.task_id = ? AND sm.member_id = ?
     LIMIT 1`,
    [taskId, memberId, taskId, memberId],
    conn,
  )
  return rows.length > 0
}

export async function getTaskEventId(taskId: number, conn?: mariadb.PoolConnection): Promise<number | null> {
  const rows = await query<{ event_id: number }[]>(
    `SELECT event_id FROM event_tasks WHERE id = ?`,
    [taskId],
    conn,
  )
  return rows[0] ? Number(rows[0].event_id) : null
}

/** Changes only the status column; a finished task also drops its still-pending deadline reminders. */
export async function setTaskStatus(taskId: number, status: EventTaskStatus, conn: mariadb.PoolConnection): Promise<void> {
  await query(`UPDATE event_tasks SET status = ? WHERE id = ?`, [status, taskId], conn)
  if (status === 'done') {
    await dropFutureReminders({ type: 'task.deadline_reminder', entityId: taskId }, conn)
  }
}
