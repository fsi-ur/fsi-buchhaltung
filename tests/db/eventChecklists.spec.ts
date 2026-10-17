import { beforeEach, describe, expect, it } from 'vitest'
import { query, withAuditTransaction } from '~/server/utils/db'
import { getChecklistItemContext, setChecklistItemDone } from '~/server/utils/eventChecklists'
import { resetDatabase } from '../helpers/db'
import { createEvent, createUser, resetFixtureCounter } from '../helpers/fixtures'

async function insertId(sql: string, params: unknown[]) {
  const result = await query<any>(sql, params)
  return Number(result.insertId)
}

describe('ticking a single checklist item', () => {
  let actorId: number
  let eventId: number

  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
    actorId = (await createUser()).id
    eventId = await createEvent({ name: 'Sommerfest' })
  })

  async function taskStatus(taskId: number) {
    return (await query<any[]>('SELECT status FROM event_tasks WHERE id = ?', [taskId]))[0].status
  }

  it('re-derives the linked task’s status from the checklist', async () => {
    const task = await insertId('INSERT INTO event_tasks (event_id, title, status) VALUES (?, ?, ?)', [eventId, 'Aufgabe', 'open'])
    const otherTask = await insertId('INSERT INTO event_tasks (event_id, title, status) VALUES (?, ?, ?)', [eventId, 'Andere', 'open'])
    const checklist = await insertId('INSERT INTO event_checklists (event_id, task_id, title, description) VALUES (?, ?, ?, ?)', [eventId, task, 'Liste', ''])
    const otherChecklist = await insertId('INSERT INTO event_checklists (event_id, task_id, title, description) VALUES (?, ?, ?, ?)', [eventId, otherTask, 'Andere Liste', ''])
    const first = await insertId('INSERT INTO event_checklist_items (checklist_id, label, is_done, position) VALUES (?, ?, 0, 0)', [checklist, 'a'])
    const second = await insertId('INSERT INTO event_checklist_items (checklist_id, label, is_done, position) VALUES (?, ?, 0, 1)', [checklist, 'b'])
    await query('INSERT INTO event_checklist_items (checklist_id, label, is_done, position) VALUES (?, ?, 1, 0)', [otherChecklist, 'x'])

    const context = (await getChecklistItemContext(first))!
    expect(context).toEqual({ checklistId: checklist, eventId, taskId: task })

    expect(await withAuditTransaction({ id: actorId }, conn => setChecklistItemDone(first, true, context, conn)))
      .toEqual({ id: task, status: 'in_progress' })
    expect(await withAuditTransaction({ id: actorId }, conn => setChecklistItemDone(second, true, context, conn)))
      .toEqual({ id: task, status: 'done' })
    expect(await taskStatus(task)).toBe('done')

    // Only the ticked checklist's task is re-synced.
    expect(await taskStatus(otherTask)).toBe('open')

    await withAuditTransaction({ id: actorId }, conn => setChecklistItemDone(first, false, context, conn))
    expect(await taskStatus(task)).toBe('in_progress')
  })

  it('drops the task’s pending deadline reminders once the checklist completes it', async () => {
    const task = await insertId('INSERT INTO event_tasks (event_id, title, status, deadline) VALUES (?, ?, ?, ?)', [eventId, 'Aufgabe', 'open', '2099-01-01'])
    const checklist = await insertId('INSERT INTO event_checklists (event_id, task_id, title, description) VALUES (?, ?, ?, ?)', [eventId, task, 'Liste', ''])
    const first = await insertId('INSERT INTO event_checklist_items (checklist_id, label, is_done, position) VALUES (?, ?, 0, 0)', [checklist, 'a'])
    const second = await insertId('INSERT INTO event_checklist_items (checklist_id, label, is_done, position) VALUES (?, ?, 0, 1)', [checklist, 'b'])
    await query(
      `INSERT INTO notifications (type_key, status, scheduled_for, created_at, recipient_rule, dedupe_key)
       VALUES ('task.deadline_reminder', 'scheduled', '2098-12-31 00:00:00', '2098-12-01 00:00:00', '{}', ?)`,
      [`task.deadline_reminder:${task}:2880`],
    )
    const reminders = () => query<any[]>('SELECT id FROM notifications WHERE dedupe_key LIKE ?', [`task.deadline_reminder:${task}:%`])
    const context = (await getChecklistItemContext(first))!

    await withAuditTransaction({ id: actorId }, conn => setChecklistItemDone(first, true, context, conn))
    expect(await reminders()).toHaveLength(1)

    await withAuditTransaction({ id: actorId }, conn => setChecklistItemDone(second, true, context, conn))
    expect(await reminders()).toHaveLength(0)
  })

  it('ticks items of a checklist without a task and reports no task', async () => {
    const checklist = await insertId('INSERT INTO event_checklists (event_id, task_id, title, description) VALUES (?, NULL, ?, ?)', [eventId, 'Liste', ''])
    const item = await insertId('INSERT INTO event_checklist_items (checklist_id, label, is_done, position) VALUES (?, ?, 0, 0)', [checklist, 'a'])

    const context = (await getChecklistItemContext(item))!
    expect(await withAuditTransaction({ id: actorId }, conn => setChecklistItemDone(item, true, context, conn))).toBeNull()
    expect((await query<any[]>('SELECT is_done FROM event_checklist_items WHERE id = ?', [item]))[0].is_done).toBe(1)
  })
})
