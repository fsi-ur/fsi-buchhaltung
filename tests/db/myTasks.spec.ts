import { beforeEach, describe, expect, it } from 'vitest'
import { query, withAuditTransaction } from '~/server/utils/db'
import { isTaskAssignee, loadMyOpenTasks, setTaskStatus } from '~/server/utils/myTasks'
import { resetDatabase } from '../helpers/db'
import { createEvent, createMember, createUser, resetFixtureCounter } from '../helpers/fixtures'

async function insertId(sql: string, params: unknown[]) {
  const result = await query<any>(sql, params)
  return Number(result.insertId)
}

function createTask(eventId: number, title: string, options: { status?: string, deadline?: string | null } = {}) {
  return insertId(
    'INSERT INTO event_tasks (event_id, title, status, deadline) VALUES (?, ?, ?, ?)',
    [eventId, title, options.status ?? 'open', options.deadline ?? null],
  )
}

describe('my open tasks', () => {
  let actorId: number
  let memberId: number
  let otherMemberId: number
  let subdivisionId: number
  let otherSubdivisionId: number
  let eventId: number

  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
    actorId = (await createUser()).id
    memberId = await createMember({ accountId: actorId })
    otherMemberId = await createMember()
    subdivisionId = await insertId('INSERT INTO subdivisions (code, name) VALUES (?, ?)', ['FIN', 'Finanzen'])
    otherSubdivisionId = await insertId('INSERT INTO subdivisions (code, name) VALUES (?, ?)', ['PR', 'Öffentlichkeit'])
    await query('INSERT INTO subdivision_members (subdivision_id, member_id) VALUES (?, ?)', [subdivisionId, memberId])
    eventId = await createEvent({ name: 'Sommerfest' })
  })

  it('returns open and in-progress tasks assigned directly or through a subdivision', async () => {
    const direct = await createTask(eventId, 'Direkt', { deadline: '2026-06-01' })
    const viaGroup = await createTask(eventId, 'Gruppe', { status: 'in_progress' })
    const done = await createTask(eventId, 'Erledigt', { status: 'done' })
    const foreign = await createTask(eventId, 'Fremd')
    const foreignGroup = await createTask(eventId, 'Fremde Gruppe')

    await query('INSERT INTO event_task_members (task_id, member_id) VALUES (?, ?), (?, ?), (?, ?)', [direct, memberId, done, memberId, foreign, otherMemberId])
    await query('INSERT INTO event_task_subdivisions (task_id, subdivision_id) VALUES (?, ?), (?, ?)', [viaGroup, subdivisionId, foreignGroup, otherSubdivisionId])

    const tasks = await loadMyOpenTasks(memberId)
    expect(tasks.map(task => task.title).sort()).toEqual(['Direkt', 'Gruppe'])

    const directTask = tasks.find(task => task.id === direct)!
    expect(directTask).toMatchObject({ eventId, eventName: 'Sommerfest', assignedDirectly: true, viaSubdivisions: [], deadline: '2026-06-01' })

    const groupTask = tasks.find(task => task.id === viaGroup)!
    expect(groupTask).toMatchObject({ status: 'in_progress', assignedDirectly: false })
    expect(groupTask.viaSubdivisions).toEqual([{ id: subdivisionId, code: 'FIN', name: 'Finanzen' }])
  })

  it('lists a task once even when it is assigned both ways, and only names the member’s own subdivisions', async () => {
    const task = await createTask(eventId, 'Doppelt')
    await query('INSERT INTO event_task_members (task_id, member_id) VALUES (?, ?)', [task, memberId])
    await query('INSERT INTO event_task_subdivisions (task_id, subdivision_id) VALUES (?, ?), (?, ?)', [task, subdivisionId, task, otherSubdivisionId])

    const tasks = await loadMyOpenTasks(memberId)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.assignedDirectly).toBe(true)
    expect(tasks[0]!.viaSubdivisions.map(entry => entry.code)).toEqual(['FIN'])
  })

  it('reports the linked checklist progress', async () => {
    const task = await createTask(eventId, 'Mit Checkliste')
    await query('INSERT INTO event_task_members (task_id, member_id) VALUES (?, ?)', [task, memberId])
    const checklist = await insertId('INSERT INTO event_checklists (event_id, task_id, title, description) VALUES (?, ?, ?, ?)', [eventId, task, 'Liste', ''])
    await query('INSERT INTO event_checklist_items (checklist_id, label, is_done, position) VALUES (?, ?, 1, 0), (?, ?, 0, 1), (?, ?, 0, 2)', [checklist, 'a', checklist, 'b', checklist, 'c'])

    const [loaded] = await loadMyOpenTasks(memberId)
    expect(loaded!.checklistProgress).toEqual({ done: 1, total: 3 })
  })

  it('recognises assignees personally and through subdivisions only', async () => {
    const direct = await createTask(eventId, 'Direkt')
    const viaGroup = await createTask(eventId, 'Gruppe')
    const foreign = await createTask(eventId, 'Fremd')
    await query('INSERT INTO event_task_members (task_id, member_id) VALUES (?, ?), (?, ?)', [direct, memberId, foreign, otherMemberId])
    await query('INSERT INTO event_task_subdivisions (task_id, subdivision_id) VALUES (?, ?)', [viaGroup, subdivisionId])

    expect(await isTaskAssignee(memberId, direct)).toBe(true)
    expect(await isTaskAssignee(memberId, viaGroup)).toBe(true)
    expect(await isTaskAssignee(memberId, foreign)).toBe(false)
  })

  it('sets the status and drops pending deadline reminders once done', async () => {
    const task = await createTask(eventId, 'Fertig machen', { deadline: '2099-01-01' })
    await query(
      `INSERT INTO notifications (type_key, status, scheduled_for, created_at, recipient_rule, dedupe_key)
       VALUES ('task.deadline_reminder', 'scheduled', '2098-12-31 00:00:00', '2098-12-01 00:00:00', '{}', ?)`,
      [`task.deadline_reminder:${task}:2880`],
    )

    await withAuditTransaction({ id: actorId }, conn => setTaskStatus(task, 'in_progress', conn))
    expect((await query<any[]>('SELECT status FROM event_tasks WHERE id = ?', [task]))[0].status).toBe('in_progress')
    expect(await query<any[]>('SELECT id FROM notifications WHERE dedupe_key LIKE ?', [`task.deadline_reminder:${task}:%`])).toHaveLength(1)

    await withAuditTransaction({ id: actorId }, conn => setTaskStatus(task, 'done', conn))
    expect((await query<any[]>('SELECT status FROM event_tasks WHERE id = ?', [task]))[0].status).toBe('done')
    expect(await query<any[]>('SELECT id FROM notifications WHERE dedupe_key LIKE ?', [`task.deadline_reminder:${task}:%`])).toHaveLength(0)
  })
})
