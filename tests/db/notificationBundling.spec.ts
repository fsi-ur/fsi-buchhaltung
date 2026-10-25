import { beforeEach, describe, expect, it } from 'vitest'
import { query, withAuditTransaction } from '~/server/utils/db'
import { loadEventShiftSlots, replaceEventShiftSlots } from '~/server/utils/eventShifts'
import { enqueueNotification } from '~/server/utils/notifications/enqueue'
import { runNotificationDispatch } from '~/server/utils/notifications/dispatch'
import { resetDatabase } from '../helpers/db'
import { createEvent, createMember, createUser, resetFixtureCounter } from '../helpers/fixtures'

async function enableNotifications(settings: Record<string, unknown> = {}) {
  const pairs: Array<[string, string]> = [
    ['notifications_enabled', 'true'],
    ...Object.entries(settings).map(([key, value]): [string, string] => [key, typeof value === 'string' ? value : JSON.stringify(value)]),
  ]
  await query(
    `INSERT INTO app_settings (setting_key, setting_value)
     VALUES ${pairs.map(() => '(?, ?)').join(', ')}
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    pairs.flat(),
  )
}

async function loadNotifications(where = '1', params: unknown[] = []) {
  const rows = await query<Array<{ id: number, type_key: string, status: string, scheduled_for: string, dedupe_key: string | null, payload: string | null }>>(
    `SELECT id, type_key, status, scheduled_for, dedupe_key, payload FROM notifications WHERE ${where} ORDER BY id ASC`,
    params,
  )
  return rows.map(row => ({ ...row, payload: row.payload ? JSON.parse(row.payload) : {} }))
}

async function inAppDeliveries(userId: number) {
  return query<Array<{ notification_id: number, subject: string, body: string }>>(
    `SELECT notification_id, subject, body FROM notification_deliveries WHERE user_id = ? AND channel = 'in_app' ORDER BY id ASC`,
    [userId],
  )
}

/** The notifications module's "now": the wall clock re-labelled as UTC (see notifications/time.ts). */
const at = (wallClock: string) => new Date(`${wallClock.replace(' ', 'T')}Z`)

function slot(overrides: Record<string, any> = {}) {
  return {
    name: 'Theke',
    description: '',
    starts_at: '2026-06-01 18:00:00',
    ends_at: '2026-06-01 20:00:00',
    required_people: 1,
    member_ids: [] as number[],
    ...overrides,
  }
}

describe('shift change summary', () => {
  let actorId: number
  let eventId: number
  let memberId: number

  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
    await enableNotifications()
    actorId = (await createUser()).id
    eventId = await createEvent({ name: 'Sommerfest' })
    memberId = await createMember()
  })

  async function replace(slots: any[]) {
    return withAuditTransaction({ id: actorId }, conn => replaceEventShiftSlots({ eventId, slots, conn, actingUserId: actorId }))
  }

  const pending = () => loadNotifications(`status = 'scheduled' AND dedupe_key LIKE ?`, [`shift.changes:%`])

  it('collects several saves into one pending message per person', async () => {
    await replace([slot({ member_ids: [memberId] }), slot({ name: 'Kasse', starts_at: '2026-06-01 20:00:00', ends_at: '2026-06-01 22:00:00' })])
    const [theke, kasse] = await loadEventShiftSlots(eventId)
    await replace([
      slot({ id: theke!.id, member_ids: [memberId] }),
      slot({ id: kasse!.id, name: 'Kasse', starts_at: '2026-06-01 20:00:00', ends_at: '2026-06-01 22:00:00', member_ids: [memberId] }),
    ])

    const rows = await pending()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.type_key).toBe('shift.assigned')
    expect(rows[0]!.payload.shift_list.map((entry: any) => [entry.name, entry.change])).toEqual([['Theke', 'added'], ['Kasse', 'added']])
  })

  it('withdraws the message when the assignment is undone inside the window', async () => {
    await replace([slot({ member_ids: [memberId] })])
    const [theke] = await loadEventShiftSlots(eventId)
    await replace([slot({ id: theke!.id, member_ids: [] })])

    expect(await pending()).toHaveLength(0)
  })

  it('tells the members of a deleted shift that it is gone', async () => {
    await replace([slot({ member_ids: [memberId] })])
    // The assignment notice already went out.
    await query(`UPDATE notifications SET status = 'sent' WHERE status = 'scheduled'`)

    await replace([])

    const rows = await pending()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.type_key).toBe('shift.removed')
    expect(rows[0]!.payload.shift_list[0]).toMatchObject({ name: 'Theke', change: 'removed' })
  })

  it('does not notify whoever made the change', async () => {
    const selfMemberId = await createMember({ accountId: actorId })
    await replace([slot({ member_ids: [selfMemberId] })])

    expect(await pending()).toHaveLength(0)
  })
})

describe('dispatch', () => {
  let userId: number
  let memberId: number
  let eventId: number

  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
    userId = (await createUser()).id
    memberId = await createMember({ accountId: userId })
    eventId = await createEvent({ name: 'Sommerfest' })
  })

  async function addShift(name: string, startsAt: string, endsAt: string, memberIds: number[], requiredPeople = 1) {
    const result = await query<{ insertId: number }>(
      `INSERT INTO event_shift_slots (event_id, name, description, starts_at, ends_at, required_people) VALUES (?, ?, '', ?, ?, ?)`,
      [eventId, name, startsAt, endsAt, requiredPeople],
    )
    const shiftId = Number(result.insertId)
    for (const id of memberIds) await query(`INSERT INTO event_shift_members (shift_id, member_id) VALUES (?, ?)`, [shiftId, id])
    return shiftId
  }

  it('sends one reminder for back-to-back shifts', async () => {
    await enableNotifications({ notifications_lead_times: { 'shift.reminder': [120] } })
    await addShift('Theke', '2026-06-01 18:00:00', '2026-06-01 20:00:00', [memberId])
    await addShift('Kasse', '2026-06-01 20:00:00', '2026-06-01 22:00:00', [memberId])

    await runNotificationDispatch({ now: at('2026-06-01 16:00:00') })
    await runNotificationDispatch({ now: at('2026-06-01 18:00:00') })

    const deliveries = await inAppDeliveries(userId)
    expect(deliveries).toHaveLength(1)
    expect(deliveries[0]!.body).toContain('Theke')
    expect(deliveries[0]!.body).toContain('Kasse')
  })

  it('warns the organizers once per event about all understaffed shifts', async () => {
    await enableNotifications({ notifications_lead_times: { 'shift.understaffed': [2880] } })
    await query(`INSERT INTO event_member_organizers (event_id, member_id) VALUES (?, ?)`, [eventId, memberId])
    await addShift('Theke', '2026-06-01 18:00:00', '2026-06-01 20:00:00', [], 2)
    await addShift('Kasse', '2026-06-01 20:00:00', '2026-06-01 22:00:00', [], 1)
    await addShift('Abbau', '2026-06-01 22:00:00', '2026-06-01 23:00:00', [memberId], 1)

    await runNotificationDispatch({ now: at('2026-05-30 18:00:00') })

    expect(await loadNotifications(`type_key = 'shift.understaffed'`)).toHaveLength(1)
    const deliveries = await inAppDeliveries(userId)
    expect(deliveries).toHaveLength(1)
    expect(deliveries[0]!.body).toContain('Theke')
    expect(deliveries[0]!.body).toContain('Kasse')
    expect(deliveries[0]!.body).not.toContain('Abbau')
  })

  it('holds e-mail and push back during quiet hours instead of dropping them', async () => {
    await enableNotifications({ notifications_quiet_hours: { enabled: true, start: '22:00', end: '07:00' } })
    const result = await enqueueNotification({
      type: 'custom.message',
      payload: {},
      recipients: { kind: 'users', userIds: [userId] },
      scheduledFor: '2026-06-01 22:30:00',
      channels: ['in_app', 'email'],
      subjectOverride: 'Hallo',
      bodyOverride: 'Text',
    })
    expect(result.ok).toBe(true)

    await runNotificationDispatch({ now: at('2026-06-01 23:00:00') })

    const [held] = await loadNotifications()
    expect(held).toMatchObject({ status: 'scheduled', scheduled_for: '2026-06-02 07:00:00' })
    expect(await inAppDeliveries(userId)).toHaveLength(1)

    await runNotificationDispatch({ now: at('2026-06-02 07:00:00') })

    const [done] = await loadNotifications()
    expect(done!.status).not.toBe('scheduled')
    expect(await inAppDeliveries(userId)).toHaveLength(1)
    const emailRows = await query<Array<{ count: number }>>(
      `SELECT COUNT(*) AS count FROM notification_deliveries WHERE notification_id = ? AND channel = 'email'`,
      [done!.id],
    )
    expect(Number(emailRows[0]!.count)).toBe(1)
  })

  it('bundles overdue tasks per event and backs off', async () => {
    await enableNotifications()
    await query(`INSERT INTO event_member_organizers (event_id, member_id) VALUES (?, ?)`, [eventId, memberId])
    await query(
      `INSERT INTO event_tasks (event_id, title, status, deadline, position) VALUES (?, 'Plakate', 'open', '2026-05-31', 0), (?, 'Getränke', 'open', '2026-05-28', 1)`,
      [eventId, eventId],
    )

    // Day 1 for "Plakate", day 4 for "Getränke" → one digest with both.
    await runNotificationDispatch({ now: at('2026-06-01 09:00:00') })
    // Day 2 / day 5 → nothing new.
    await runNotificationDispatch({ now: at('2026-06-02 09:00:00') })

    const rows = await loadNotifications(`type_key = 'task.overdue'`)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.payload.task_count).toBe(2)
  })
})
