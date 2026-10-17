import type mariadb from 'mariadb'
import { query } from '~/server/utils/db'
import { dropFutureReminders } from '~/server/utils/notifications/enqueue'
import type {
  EventChecklist,
  EventChecklistItem,
  EventChecklistTemplate,
  SaveEventChecklist,
  SaveEventChecklistItem,
  SaveEventChecklistTemplate,
} from '~/types/event'

interface EventChecklistRow {
  id: number
  task_id: number | null
  title: string
  description: string
}

interface ChecklistItemRow {
  id: number
  checklist_id: number
  label: string
  is_done: number
  position: number
}

interface ChecklistTemplateRow {
  id: number
  title: string
  description: string
}

interface ChecklistTemplateItemRow {
  id: number
  template_id: number
  label: string
  position: number
}

function normalizePositiveInteger(value: unknown) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function normalizeChecklistItems(value: unknown): SaveEventChecklistItem[] | null {
  if (!Array.isArray(value)) return null

  const items: SaveEventChecklistItem[] = []

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return null

    const raw = entry as Record<string, unknown>
    const id = raw.id === undefined || raw.id === null ? undefined : normalizePositiveInteger(raw.id)
    const label = String(raw.label ?? '').trim()

    if (raw.id !== undefined && raw.id !== null && !id) return null
    if (!label) return null

    items.push({
      ...(id ? { id } : {}),
      label,
      done: Boolean(raw.done),
    })
  }

  return items
}

export function normalizeEventChecklists(value: unknown): SaveEventChecklist[] | null {
  if (!Array.isArray(value)) return null

  const checklists: SaveEventChecklist[] = []

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return null

    const raw = entry as Record<string, unknown>
    const id = raw.id === undefined || raw.id === null ? undefined : normalizePositiveInteger(raw.id)
    const title = String(raw.title ?? '').trim()
    const description = String(raw.description ?? '').trim()
    const items = normalizeChecklistItems(raw.items)

    let taskId: number | null | undefined
    if (raw.taskId === undefined || raw.taskId === null) {
      taskId = null
    }
    else {
      const parsed = normalizePositiveInteger(raw.taskId)
      if (!parsed) return null
      taskId = parsed
    }

    if (raw.id !== undefined && raw.id !== null && !id) return null
    if (!title || !items?.length) return null

    checklists.push({
      ...(id ? { id } : {}),
      title,
      description,
      items,
      taskId,
    })
  }

  return checklists
}

export function normalizeEventChecklistTemplates(value: unknown): SaveEventChecklistTemplate[] | null {
  if (!Array.isArray(value)) return null

  const templates: SaveEventChecklistTemplate[] = []

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return null

    const raw = entry as Record<string, unknown>
    const id = raw.id === undefined || raw.id === null ? undefined : normalizePositiveInteger(raw.id)
    const title = String(raw.title ?? '').trim()
    const description = String(raw.description ?? '').trim()
    const items = normalizeChecklistItems(raw.items)

    if (raw.id !== undefined && raw.id !== null && !id) return null
    if (!title || !items?.length) return null

    templates.push({
      ...(id ? { id } : {}),
      title,
      description,
      items,
    })
  }

  return templates
}

function mapItemsByParent<T extends { id: number }>(
  rows: Array<{ checklist_id?: number, template_id?: number } & T>,
  parentKey: 'checklist_id' | 'template_id',
) {
  const itemsByParent = new Map<number, EventChecklistItem[]>()

  for (const row of rows) {
    const parentId = Number(row[parentKey])
    const items = itemsByParent.get(parentId) ?? []
    items.push({
      id: Number(row.id),
      label: String((row as any).label),
      done: Boolean(Number((row as any).is_done ?? 0)),
    })
    itemsByParent.set(parentId, items)
  }

  return itemsByParent
}

export async function loadEventChecklists(eventId: number, conn?: mariadb.PoolConnection): Promise<EventChecklist[]> {
  const checklistRows = await query<EventChecklistRow[]>(
    `SELECT id, task_id, title, description
     FROM event_checklists
     WHERE event_id = ?
     ORDER BY id`,
    [eventId],
    conn,
  )

  if (!checklistRows.length) return []

  const checklistIds = checklistRows.map(row => Number(row.id))
  const itemRows = await query<ChecklistItemRow[]>(
    `SELECT id, checklist_id, label, is_done, position
     FROM event_checklist_items
     WHERE checklist_id IN (${checklistIds.map(() => '?').join(',')})
     ORDER BY position, id`,
    checklistIds,
    conn,
  )
  const itemsByChecklist = mapItemsByParent(itemRows, 'checklist_id')

  return checklistRows.map(row => ({
    id: Number(row.id),
    taskId: row.task_id !== null && row.task_id !== undefined ? Number(row.task_id) : null,
    title: String(row.title),
    description: String(row.description),
    items: itemsByChecklist.get(Number(row.id)) ?? [],
  }))
}

export async function loadEventChecklistTemplates(conn?: mariadb.PoolConnection): Promise<EventChecklistTemplate[]> {
  const templateRows = await query<ChecklistTemplateRow[]>(
    `SELECT id, title, description
     FROM event_checklist_templates
     ORDER BY title, id`,
    [],
    conn,
  )

  if (!templateRows.length) return []

  const templateIds = templateRows.map(row => Number(row.id))
  const itemRows = await query<ChecklistTemplateItemRow[]>(
    `SELECT id, template_id, label, position
     FROM event_checklist_template_items
     WHERE template_id IN (${templateIds.map(() => '?').join(',')})
     ORDER BY position, id`,
    templateIds,
    conn,
  )
  const itemsByTemplate = mapItemsByParent(itemRows, 'template_id')

  return templateRows.map(row => ({
    id: Number(row.id),
    title: String(row.title),
    description: String(row.description),
    items: itemsByTemplate.get(Number(row.id)) ?? [],
  }))
}

async function syncChecklistItems({
  checklistId,
  items,
  conn,
}: {
  checklistId: number
  items: SaveEventChecklistItem[]
  conn: mariadb.PoolConnection
}) {
  const existingRows = await query<ChecklistItemRow[]>(
    `SELECT id, checklist_id, label, is_done, position
     FROM event_checklist_items
     WHERE checklist_id = ?`,
    [checklistId],
    conn,
  )
  const existingById = new Map(existingRows.map(row => [Number(row.id), row]))
  const existingIds = new Set(existingById.keys())
  const incomingIds = items.flatMap(item => item.id ? [item.id] : [])

  if (incomingIds.some(id => !existingIds.has(id))) {
    return 'At least one checklist item does not belong to this checklist'
  }

  const incomingIdSet = new Set(incomingIds)
  for (const existingId of existingIds) {
    if (incomingIdSet.has(existingId)) continue
    await query(
      `DELETE FROM event_checklist_items
       WHERE id = ? AND checklist_id = ?`,
      [existingId, checklistId],
      conn,
    )
  }

  for (const [index, item] of items.entries()) {
    const position = index + 1
    const isDone = item.done ? 1 : 0

    if (item.id) {
      const existing = existingById.get(item.id)
      if (!existing) continue

      if (String(existing.label) === item.label && Number(existing.is_done) === isDone && Number(existing.position) === position) {
        continue
      }

      await query(
        `UPDATE event_checklist_items
         SET label = ?, is_done = ?, position = ?
         WHERE id = ? AND checklist_id = ?`,
        [item.label, isDone, position, item.id, checklistId],
        conn,
      )
      continue
    }

    await query(
      `INSERT INTO event_checklist_items (checklist_id, label, is_done, position)
       VALUES (?, ?, ?, ?)`,
      [checklistId, item.label, isDone, position],
      conn,
    )
  }

  return null
}

async function syncTemplateItems({
  templateId,
  items,
  conn,
}: {
  templateId: number
  items: SaveEventChecklistItem[]
  conn: mariadb.PoolConnection
}) {
  const existingRows = await query<ChecklistTemplateItemRow[]>(
    `SELECT id, template_id, label, position
     FROM event_checklist_template_items
     WHERE template_id = ?`,
    [templateId],
    conn,
  )
  const existingById = new Map(existingRows.map(row => [Number(row.id), row]))
  const existingIds = new Set(existingById.keys())
  const incomingIds = items.flatMap(item => item.id ? [item.id] : [])

  if (incomingIds.some(id => !existingIds.has(id))) {
    return 'At least one checklist template item does not belong to this template'
  }

  const incomingIdSet = new Set(incomingIds)
  for (const existingId of existingIds) {
    if (incomingIdSet.has(existingId)) continue
    await query(
      `DELETE FROM event_checklist_template_items
       WHERE id = ? AND template_id = ?`,
      [existingId, templateId],
      conn,
    )
  }

  for (const [index, item] of items.entries()) {
    const position = index + 1

    if (item.id) {
      const existing = existingById.get(item.id)
      if (!existing) continue

      if (String(existing.label) === item.label && Number(existing.position) === position) {
        continue
      }

      await query(
        `UPDATE event_checklist_template_items
         SET label = ?, position = ?
         WHERE id = ? AND template_id = ?`,
        [item.label, position, item.id, templateId],
        conn,
      )
      continue
    }

    await query(
      `INSERT INTO event_checklist_template_items (template_id, label, position)
       VALUES (?, ?, ?)`,
      [templateId, item.label, position],
      conn,
    )
  }

  return null
}

export interface AffectedTaskStatus {
  id: number
  status: 'open' | 'in_progress' | 'done'
}

/** Derives each linked task's status from its checklist; `onlyTaskId` limits this to one task. */
export async function syncLinkedTaskStatuses(
  eventId: number,
  conn: mariadb.PoolConnection,
  onlyTaskId?: number,
): Promise<AffectedTaskStatus[]> {
  const rows = await query<{ task_id: number; total: number; done: number }[]>(
    `SELECT c.task_id,
            COUNT(ci.id) AS total,
            COALESCE(SUM(ci.is_done), 0) AS done
     FROM event_checklists c
     LEFT JOIN event_checklist_items ci ON ci.checklist_id = c.id
     WHERE c.event_id = ? AND c.task_id IS NOT NULL${onlyTaskId ? ' AND c.task_id = ?' : ''}
     GROUP BY c.task_id`,
    onlyTaskId ? [eventId, onlyTaskId] : [eventId],
    conn,
  )

  const affected: AffectedTaskStatus[] = []

  for (const row of rows) {
    const total = Number(row.total)
    const done = Number(row.done)
    const status: 'open' | 'in_progress' | 'done'
      = total > 0 && done === total ? 'done'
        : done > 0 ? 'in_progress'
          : 'open'

    await query(
      `UPDATE event_tasks SET status = ? WHERE id = ? AND event_id = ?`,
      [status, Number(row.task_id), eventId],
      conn,
    )
    // Same as a direct status change: a finished task must not remind anyone of its deadline.
    if (status === 'done') {
      await dropFutureReminders({ type: 'task.deadline_reminder', entityId: Number(row.task_id) }, conn)
    }

    affected.push({ id: Number(row.task_id), status })
  }

  return affected
}

export interface ChecklistItemContext {
  checklistId: number
  eventId: number
  /** The task the checklist is linked to, if any. */
  taskId: number | null
}

export async function getChecklistItemContext(itemId: number, conn?: mariadb.PoolConnection): Promise<ChecklistItemContext | null> {
  const rows = await query<{ checklist_id: number; event_id: number; task_id: number | null }[]>(
    `SELECT ci.checklist_id, c.event_id, c.task_id
     FROM event_checklist_items ci
     JOIN event_checklists c ON c.id = ci.checklist_id
     WHERE ci.id = ?`,
    [itemId],
    conn,
  )
  const row = rows[0]
  if (!row) return null
  return {
    checklistId: Number(row.checklist_id),
    eventId: Number(row.event_id),
    taskId: row.task_id !== null && row.task_id !== undefined ? Number(row.task_id) : null,
  }
}

/**
 * Ticks or unticks one item and re-derives the linked task's status from the checklist, exactly
 * like a full checklist save does. Returns the task's new status (null without a linked task).
 */
export async function setChecklistItemDone(
  itemId: number,
  done: boolean,
  context: ChecklistItemContext,
  conn: mariadb.PoolConnection,
): Promise<AffectedTaskStatus | null> {
  await query(`UPDATE event_checklist_items SET is_done = ? WHERE id = ?`, [done ? 1 : 0, itemId], conn)
  if (context.taskId === null) return null

  const [affected] = await syncLinkedTaskStatuses(context.eventId, conn, context.taskId)
  return affected ?? null
}

export async function replaceEventChecklists({
  eventId,
  checklists,
  conn,
}: {
  eventId: number
  checklists: SaveEventChecklist[]
  conn: mariadb.PoolConnection
}): Promise<{ error: string } | { affectedTaskStatuses: AffectedTaskStatus[] }> {
  const existingRows = await query<EventChecklistRow[]>(
    `SELECT id, task_id, title, description
     FROM event_checklists
     WHERE event_id = ?`,
    [eventId],
    conn,
  )
  const existingIds = existingRows.map(row => Number(row.id))
  const existingIdSet = new Set(existingIds)
  const incomingIds = checklists.flatMap(checklist => checklist.id ? [checklist.id] : [])

  if (incomingIds.some(id => !existingIdSet.has(id))) {
    return { error: 'At least one checklist does not belong to this event' }
  }

  // Validate task_id values — all must belong to this event
  const incomingTaskIds = checklists.flatMap(c => c.taskId ? [c.taskId] : [])
  if (incomingTaskIds.length > 0) {
    const validTaskRows = await query<{ id: number }[]>(
      `SELECT id FROM event_tasks WHERE event_id = ? AND id IN (${incomingTaskIds.map(() => '?').join(',')})`,
      [eventId, ...incomingTaskIds],
      conn,
    )
    const validTaskIdSet = new Set(validTaskRows.map(r => Number(r.id)))
    if (incomingTaskIds.some(id => !validTaskIdSet.has(id))) {
      return { error: 'At least one linked task does not belong to this event' }
    }
  }

  // Validate no two checklists share the same task_id
  const taskIdsSeen = new Set<number>()
  for (const checklist of checklists) {
    if (checklist.taskId == null) continue
    if (taskIdsSeen.has(checklist.taskId)) {
      return { error: 'A task can only be linked to one checklist at a time' }
    }
    taskIdsSeen.add(checklist.taskId)
  }

  const incomingIdSet = new Set(incomingIds)
  for (const id of existingIds) {
    if (incomingIdSet.has(id)) continue
    await query(
      `DELETE FROM event_checklists
       WHERE id = ? AND event_id = ?`,
      [id, eventId],
      conn,
    )
  }

  for (const checklist of checklists) {
    let checklistId = checklist.id ?? null
    const taskId = checklist.taskId ?? null

    if (checklistId) {
      const existing = existingRows.find(row => Number(row.id) === checklistId)
      const existingTaskId = existing?.task_id !== null && existing?.task_id !== undefined ? Number(existing.task_id) : null
      if (
        existing
        && (
          String(existing.title) !== checklist.title
          || String(existing.description) !== checklist.description
          || existingTaskId !== taskId
        )
      ) {
        await query(
          `UPDATE event_checklists
           SET title = ?, description = ?, task_id = ?
           WHERE id = ? AND event_id = ?`,
          [checklist.title, checklist.description, taskId, checklistId, eventId],
          conn,
        )
      }
    }
    else {
      const result: any = await query(
        `INSERT INTO event_checklists (event_id, task_id, title, description)
         VALUES (?, ?, ?, ?)`,
        [eventId, taskId, checklist.title, checklist.description],
        conn,
      )
      checklistId = Number(result.insertId)
    }

    const itemValidationError = await syncChecklistItems({
      checklistId,
      items: checklist.items,
      conn,
    })
    if (itemValidationError) return { error: itemValidationError }
  }

  const affectedTaskStatuses = await syncLinkedTaskStatuses(eventId, conn)
  return { affectedTaskStatuses }
}

export async function replaceEventChecklistTemplates({
  templates,
  conn,
}: {
  templates: SaveEventChecklistTemplate[]
  conn: mariadb.PoolConnection
}) {
  const existingRows = await query<ChecklistTemplateRow[]>(
    `SELECT id, title, description
     FROM event_checklist_templates`,
    [],
    conn,
  )
  const existingIds = existingRows.map(row => Number(row.id))
  const existingIdSet = new Set(existingIds)
  const incomingIds = templates.flatMap(template => template.id ? [template.id] : [])

  if (incomingIds.some(id => !existingIdSet.has(id))) {
    return 'At least one checklist template does not exist'
  }

  const incomingIdSet = new Set(incomingIds)
  for (const id of existingIds) {
    if (incomingIdSet.has(id)) continue
    await query(
      `DELETE FROM event_checklist_templates
       WHERE id = ?`,
      [id],
      conn,
    )
  }

  for (const template of templates) {
    let templateId = template.id ?? null

    if (templateId) {
      const existing = existingRows.find(row => Number(row.id) === templateId)
      if (existing && (String(existing.title) !== template.title || String(existing.description) !== template.description)) {
        await query(
          `UPDATE event_checklist_templates
           SET title = ?, description = ?
           WHERE id = ?`,
          [template.title, template.description, templateId],
          conn,
        )
      }
    }
    else {
      const result: any = await query(
        `INSERT INTO event_checklist_templates (title, description)
         VALUES (?, ?)`,
        [template.title, template.description],
        conn,
      )
      templateId = Number(result.insertId)
    }

    const itemValidationError = await syncTemplateItems({
      templateId,
      items: template.items,
      conn,
    })
    if (itemValidationError) return itemValidationError
  }

  return null
}
