import { beforeEach, describe, expect, it } from 'vitest'
import { query, withAuditTransaction } from '~/server/utils/db'
import { getChecklistControlledTaskIds, replaceEventTasks } from '~/server/utils/eventTasks'
import { resetDatabase } from '../helpers/db'
import { createEvent, createUser, resetFixtureCounter } from '../helpers/fixtures'

async function insertId(sql: string, params: unknown[]) {
  const result = await query<any>(sql, params)
  return Number(result.insertId)
}

describe('replacing an event’s tasks', () => {
  let actorId: number
  let eventId: number

  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
    actorId = (await createUser()).id
    eventId = await createEvent({ name: 'Sommerfest' })
  })

  it('keeps the stored status of checklist-linked tasks but applies their other edits', async () => {
    const linked = await insertId('INSERT INTO event_tasks (event_id, title, status, position) VALUES (?, ?, ?, 0)', [eventId, 'Mit Checkliste', 'in_progress'])
    const free = await insertId('INSERT INTO event_tasks (event_id, title, status, position) VALUES (?, ?, ?, 1)', [eventId, 'Ohne Checkliste', 'open'])
    await query('INSERT INTO event_checklists (event_id, task_id, title, description) VALUES (?, ?, ?, ?)', [eventId, linked, 'Liste', ''])

    expect(await getChecklistControlledTaskIds(eventId)).toEqual([linked])

    const error = await withAuditTransaction({ id: actorId }, conn => replaceEventTasks({
      eventId,
      conn,
      actingUserId: actorId,
      tasks: [
        { id: linked, title: 'Umbenannt', status: 'done', deadline: null, position: 0, member_ids: [], subdivision_ids: [] },
        { id: free, title: 'Ohne Checkliste', status: 'done', deadline: null, position: 1, member_ids: [], subdivision_ids: [] },
      ],
    }))
    expect(error).toBeNull()

    const rows = await query<any[]>('SELECT id, title, status FROM event_tasks WHERE event_id = ? ORDER BY position', [eventId])
    expect(rows.map(row => ({ id: Number(row.id), title: row.title, status: row.status }))).toEqual([
      { id: linked, title: 'Umbenannt', status: 'in_progress' },
      { id: free, title: 'Ohne Checkliste', status: 'done' },
    ])
  })
})
