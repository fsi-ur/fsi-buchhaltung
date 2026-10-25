import type mariadb from 'mariadb'
import { query } from '~/server/utils/db'
import type { EventTask, EventTaskMember, EventTaskSubdivision, SaveEventTask } from '~/types/event'
import { dropFutureReminders } from '~/server/utils/notifications/enqueue'
import { queueTaskChanges, type TaskChangeInput } from '~/server/utils/notifications/changeDigest'

interface EventTaskRow {
  id: number
  title: string
  status: string
  deadline: string | null
  position: number
  linked_checklist_id: number | null
  checklist_done: number
  checklist_total: number
}

interface EventTaskMemberRow {
  task_id: number
  member_id: number
  full_name: string
}

interface EventTaskSubdivisionRow {
  task_id: number
  subdivision_id: number
  code: string
  name: string
}

function normalizePositiveInteger(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function normalizeIds(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null

  const ids: number[] = []
  const seen = new Set<number>()

  for (const entry of value) {
    const parsed = Number(entry)
    if (!Number.isInteger(parsed) || parsed <= 0 || seen.has(parsed)) return null
    seen.add(parsed)
    ids.push(parsed)
  }

  return ids
}

export function normalizeDeadline(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  const str = String(value).trim()
  if (!str) return null
  return /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/.test(str) ? str : null
}

function normalizeStatus(value: unknown): 'open' | 'in_progress' | 'done' | null {
  const str = String(value ?? '')
  if (str === 'open' || str === 'in_progress' || str === 'done') return str
  return null
}

export function normalizeEventTasks(value: unknown): SaveEventTask[] | null {
  if (!Array.isArray(value)) return null

  const tasks: SaveEventTask[] = []

  for (let i = 0; i < (value as unknown[]).length; i++) {
    const entry = (value as unknown[])[i]
    if (!entry || typeof entry !== 'object') return null

    const raw = entry as Record<string, unknown>
    const id = raw.id === undefined || raw.id === null ? undefined : normalizePositiveInteger(raw.id)
    const title = String(raw.title ?? '').trim()
    const status = normalizeStatus(raw.status)
    const deadline = normalizeDeadline(raw.deadline)
    const memberIds = normalizeIds(raw.member_ids ?? raw.memberIds ?? [])
    const subdivisionIds = normalizeIds(raw.subdivision_ids ?? raw.subdivisionIds ?? [])

    if (raw.id !== undefined && raw.id !== null && !id) return null
    if (!title || !status || !memberIds || !subdivisionIds) return null

    tasks.push({
      ...(id ? { id } : {}),
      title,
      status,
      deadline,
      position: i,
      member_ids: memberIds,
      subdivision_ids: subdivisionIds,
    })
  }

  return tasks
}

export async function loadEventTasks(eventId: number, conn?: mariadb.PoolConnection): Promise<EventTask[]> {
  const taskRows = await query<EventTaskRow[]>(
    `SELECT t.id, t.title, t.status, t.deadline, t.position,
            c.id AS linked_checklist_id,
            COALESCE(ci_agg.done, 0) AS checklist_done,
            COALESCE(ci_agg.total, 0) AS checklist_total
     FROM event_tasks t
     LEFT JOIN event_checklists c ON c.task_id = t.id AND c.event_id = ?
     LEFT JOIN (
       SELECT checklist_id,
              SUM(is_done) AS done,
              COUNT(*) AS total
       FROM event_checklist_items
       GROUP BY checklist_id
     ) ci_agg ON ci_agg.checklist_id = c.id
     WHERE t.event_id = ?
     ORDER BY t.position, t.id`,
    [eventId, eventId],
    conn,
  )

  if (!taskRows.length) return []

  const taskIds = taskRows.map(row => Number(row.id))

  const memberRows = await query<EventTaskMemberRow[]>(
    `SELECT etm.task_id,
            etm.member_id,
            CONCAT(m.first_name, ' ', m.last_name) AS full_name
     FROM event_task_members etm
     JOIN members m ON m.id = etm.member_id
     WHERE etm.task_id IN (${taskIds.map(() => '?').join(',')})
     ORDER BY m.first_name, m.last_name, etm.member_id`,
    taskIds,
    conn,
  )

  const subdivisionRows = await query<EventTaskSubdivisionRow[]>(
    `SELECT ets.task_id,
            ets.subdivision_id,
            s.code,
            s.name
     FROM event_task_subdivisions ets
     JOIN subdivisions s ON s.id = ets.subdivision_id
     WHERE ets.task_id IN (${taskIds.map(() => '?').join(',')})
     ORDER BY s.code, s.name, ets.subdivision_id`,
    taskIds,
    conn,
  )

  const membersByTask = new Map<number, EventTaskMember[]>()
  for (const row of memberRows) {
    const taskId = Number(row.task_id)
    const members = membersByTask.get(taskId) ?? []
    members.push({ id: Number(row.member_id), full_name: String(row.full_name) })
    membersByTask.set(taskId, members)
  }

  const subdivisionsByTask = new Map<number, EventTaskSubdivision[]>()
  for (const row of subdivisionRows) {
    const taskId = Number(row.task_id)
    const subdivisions = subdivisionsByTask.get(taskId) ?? []
    subdivisions.push({ id: Number(row.subdivision_id), code: String(row.code), name: String(row.name) })
    subdivisionsByTask.set(taskId, subdivisions)
  }

  return taskRows.map(row => ({
    id: Number(row.id),
    title: String(row.title),
    status: String(row.status) as 'open' | 'in_progress' | 'done',
    deadline: row.deadline ? String(row.deadline) : null,
    position: Number(row.position),
    members: membersByTask.get(Number(row.id)) ?? [],
    subdivisions: subdivisionsByTask.get(Number(row.id)) ?? [],
    linkedChecklistId: row.linked_checklist_id !== null && row.linked_checklist_id !== undefined
      ? Number(row.linked_checklist_id)
      : null,
    linkedChecklistProgress: row.linked_checklist_id !== null && row.linked_checklist_id !== undefined
      ? { done: Number(row.checklist_done), total: Number(row.checklist_total) }
      : null,
  }))
}

async function validateRelatedIds(
  memberIds: number[],
  subdivisionIds: number[],
  conn: mariadb.PoolConnection,
): Promise<string | null> {
  if (memberIds.length) {
    const rows = await query<{ id: number }[]>(
      `SELECT id FROM members WHERE id IN (${memberIds.map(() => '?').join(',')})`,
      memberIds,
      conn,
    )
    if (rows.length !== memberIds.length) return 'At least one selected task member does not exist'
  }

  if (subdivisionIds.length) {
    const rows = await query<{ id: number }[]>(
      `SELECT id FROM subdivisions WHERE id IN (${subdivisionIds.map(() => '?').join(',')})`,
      subdivisionIds,
      conn,
    )
    if (rows.length !== subdivisionIds.length) return 'At least one selected task subdivision does not exist'
  }

  return null
}

async function syncTaskMembers(
  taskId: number,
  existingIds: number[],
  nextIds: number[],
  conn: mariadb.PoolConnection,
) {
  const nextSet = new Set(nextIds)
  const existingSet = new Set(existingIds)

  for (const memberId of existingIds) {
    if (nextSet.has(memberId)) continue
    await query(
      `DELETE FROM event_task_members WHERE task_id = ? AND member_id = ?`,
      [taskId, memberId],
      conn,
    )
  }

  for (const memberId of nextIds) {
    if (existingSet.has(memberId)) continue
    await query(
      `INSERT INTO event_task_members (task_id, member_id) VALUES (?, ?)`,
      [taskId, memberId],
      conn,
    )
  }
}

async function syncTaskSubdivisions(
  taskId: number,
  existingIds: number[],
  nextIds: number[],
  conn: mariadb.PoolConnection,
) {
  const nextSet = new Set(nextIds)
  const existingSet = new Set(existingIds)

  for (const subdivisionId of existingIds) {
    if (nextSet.has(subdivisionId)) continue
    await query(
      `DELETE FROM event_task_subdivisions WHERE task_id = ? AND subdivision_id = ?`,
      [taskId, subdivisionId],
      conn,
    )
  }

  for (const subdivisionId of nextIds) {
    if (existingSet.has(subdivisionId)) continue
    await query(
      `INSERT INTO event_task_subdivisions (task_id, subdivision_id) VALUES (?, ?)`,
      [taskId, subdivisionId],
      conn,
    )
  }
}

/**
 * Everyone a task reaches — named directly or through one of its subdivisions — so an assignment
 * notice goes to each person once, however many ways they are on the task.
 */
async function effectiveTaskMemberIds(memberIds: number[], subdivisionIds: number[], conn: mariadb.PoolConnection): Promise<Set<number>> {
  const result = new Set(memberIds)
  if (subdivisionIds.length) {
    const rows = await query<{ member_id: number }[]>(
      `SELECT DISTINCT sm.member_id
       FROM subdivision_members sm
       JOIN members m ON m.id = sm.member_id
       WHERE sm.subdivision_id IN (${subdivisionIds.map(() => '?').join(',')}) AND m.status != 'left'`,
      subdivisionIds,
      conn,
    )
    for (const row of rows) result.add(Number(row.member_id))
  }
  return result
}

async function loadTaskAssignment(taskId: number, conn: mariadb.PoolConnection) {
  const memberRows = await query<{ member_id: number }[]>(
    `SELECT member_id FROM event_task_members WHERE task_id = ?`,
    [taskId],
    conn,
  )
  const subdivisionRows = await query<{ subdivision_id: number }[]>(
    `SELECT subdivision_id FROM event_task_subdivisions WHERE task_id = ?`,
    [taskId],
    conn,
  )
  return {
    memberIds: memberRows.map(r => Number(r.member_id)),
    subdivisionIds: subdivisionRows.map(r => Number(r.subdivision_id)),
  }
}

/** Ids of the event's tasks that are linked to a checklist and therefore take their status from it. */
export async function getChecklistControlledTaskIds(eventId: number, conn?: mariadb.PoolConnection): Promise<number[]> {
  const rows = await query<{ task_id: number }[]>(
    `SELECT c.task_id FROM event_checklists c
     JOIN event_tasks t ON t.id = c.task_id
     WHERE t.event_id = ?`,
    [eventId],
    conn,
  )
  return rows.map(row => Number(row.task_id))
}

export async function replaceEventTasks({
  eventId,
  tasks,
  conn,
  actingUserId,
}: {
  eventId: number
  tasks: SaveEventTask[]
  conn: mariadb.PoolConnection
  actingUserId?: number | null
}): Promise<string | null> {
  const [eventRow] = await query<Array<{ name: string }>>(
    `SELECT name FROM events WHERE id = ?`,
    [eventId],
    conn,
  )

  const existingRows = await query<EventTaskRow[]>(
    `SELECT id, title, status, deadline, position FROM event_tasks WHERE event_id = ?`,
    [eventId],
    conn,
  )
  const existingIds = existingRows.map(row => Number(row.id))
  const existingIdSet = new Set(existingIds)
  const existingById = new Map(existingRows.map(row => [Number(row.id), row]))
  const checklistControlledIds = new Set(await getChecklistControlledTaskIds(eventId, conn))
  const incomingIds = tasks.flatMap(task => task.id ? [task.id] : [])

  if (incomingIds.some(id => !existingIdSet.has(id))) {
    return 'At least one task does not belong to this event'
  }

  const allMemberIds = Array.from(new Set(tasks.flatMap(t => t.member_ids)))
  const allSubdivisionIds = Array.from(new Set(tasks.flatMap(t => t.subdivision_ids)))
  const relationError = await validateRelatedIds(allMemberIds, allSubdivisionIds, conn)
  if (relationError) return relationError

  const taskChanges: TaskChangeInput[] = []
  const taskEntry = (id: number, task: { title: string, deadline: string | null }) => ({
    task_id: id,
    title: String(task.title),
    deadline: task.deadline ?? null,
  })

  const incomingIdSet = new Set(incomingIds)
  for (const id of existingIds) {
    if (incomingIdSet.has(id)) continue

    // Withdraws a not-yet-sent "new task" mention for a task that no longer exists.
    const assignment = await loadTaskAssignment(id, conn)
    for (const memberId of await effectiveTaskMemberIds(assignment.memberIds, assignment.subdivisionIds, conn)) {
      taskChanges.push({ memberId, change: 'removed', entry: taskEntry(id, existingById.get(id)!) })
    }

    await query(`DELETE FROM event_tasks WHERE id = ? AND event_id = ?`, [id, eventId], conn)
  }

  for (const incoming of tasks) {
    let taskId = incoming.id ?? null

    // A checklist-linked task's status follows the checklist's items — a list save (possibly from
    // a stale copy) never overrides it, so keep the stored status and apply the other edits.
    const linkedExisting = taskId && checklistControlledIds.has(taskId) ? existingById.get(taskId) : undefined
    const task = linkedExisting
      ? { ...incoming, status: String(linkedExisting.status) as SaveEventTask['status'] }
      : incoming

    let deadlineChanged = false

    if (taskId) {
      const existing = existingById.get(taskId)
      if (
        existing
        && (
          String(existing.title) !== task.title
          || String(existing.status) !== task.status
          || (existing.deadline ?? null) !== task.deadline
          || Number(existing.position) !== task.position
        )
      ) {
        deadlineChanged = (existing.deadline ?? null) !== task.deadline

        await query(
          `UPDATE event_tasks
           SET title = ?, status = ?, deadline = ?, position = ?
           WHERE id = ? AND event_id = ?`,
          [task.title, task.status, task.deadline, task.position, taskId, eventId],
          conn,
        )
      }
    } else {
      const result: any = await query(
        `INSERT INTO event_tasks (event_id, title, status, deadline, position)
         VALUES (?, ?, ?, ?, ?)`,
        [eventId, task.title, task.status, task.deadline, task.position],
        conn,
      )
      taskId = Number(result.insertId)
    }

    const { memberIds: existingMemberIds, subdivisionIds: existingSubdivisionIds } = await loadTaskAssignment(taskId, conn)

    const before = await effectiveTaskMemberIds(existingMemberIds, existingSubdivisionIds, conn)
    const after = await effectiveTaskMemberIds(task.member_ids, task.subdivision_ids, conn)
    const entry = taskEntry(taskId, task)
    for (const memberId of after) {
      if (!before.has(memberId)) taskChanges.push({ memberId, change: 'added', entry })
    }
    for (const memberId of before) {
      if (!after.has(memberId)) taskChanges.push({ memberId, change: 'removed', entry })
    }
    if (deadlineChanged) {
      await dropFutureReminders({ type: 'task.deadline_reminder', entityId: taskId }, conn)
    }

    await syncTaskMembers(taskId, existingMemberIds, task.member_ids, conn)
    await syncTaskSubdivisions(taskId, existingSubdivisionIds, task.subdivision_ids, conn)
  }

  await queueTaskChanges({
    event: { id: eventId, name: eventRow?.name ?? '' },
    changes: taskChanges,
    actingUserId: actingUserId ?? null,
    conn,
  })

  return null
}
