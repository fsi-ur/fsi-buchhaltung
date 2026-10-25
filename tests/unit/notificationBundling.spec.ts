import { describe, expect, it } from 'vitest'
import { clusterByLeadTime } from '~/server/utils/notifications/clusters'
import { mergeChangedFields, mergeShiftEntry, shiftSummaryType } from '~/server/utils/notifications/changeDigest'
import { isOverdueReminderDay, understaffedPayload, understaffedShiftsOfCluster, type StaffingShiftRow } from '~/server/utils/notifications/reminders'
import { reminderEntityId, reminderLeadMinutes } from '~/server/utils/notifications/personalize'
import { shiftPlanRequestFor } from '~/server/utils/notifications/shiftPlan'
import { renderNotification } from '~/server/utils/notifications/render'
import { DEFAULT_NOTIFICATION_SETTINGS, normalizeNotificationSettings, validateNotificationSettings } from '~/server/utils/notifications/settings'
import type { ShiftListEntry } from '~/server/utils/notifications/types'

const HOUR = 60
const DAY = 24 * HOUR

function shift(id: number, start: string, end: string) {
  return { id, start, end }
}

describe('clusterByLeadTime (span)', () => {
  it('folds an evening of back-to-back shifts into one reminder', () => {
    const clusters = clusterByLeadTime([
      shift(1, '2026-06-01 18:00:00', '2026-06-01 20:00:00'),
      shift(2, '2026-06-01 20:00:00', '2026-06-01 22:00:00'),
      shift(3, '2026-06-01 22:00:00', '2026-06-02 00:00:00'),
    ], 2 * HOUR, 'span')
    expect(clusters).toEqual([{ leaderId: 1, ids: [1, 2, 3] }])
  })

  it('keeps a separate short-notice reminder for a shift later the same day', () => {
    const items = [
      shift(1, '2026-06-01 10:00:00', '2026-06-01 12:00:00'),
      shift(2, '2026-06-01 18:00:00', '2026-06-01 20:00:00'),
    ]
    // 2 h before 18:00 is 16:00 — long after the first shift is over.
    expect(clusterByLeadTime(items, 2 * HOUR, 'span').map(cluster => cluster.ids)).toEqual([[1], [2]])
    // The day-before reminder for both fires before the first one has even started.
    expect(clusterByLeadTime(items, DAY, 'span').map(cluster => cluster.ids)).toEqual([[1, 2]])
  })

  it('does not remind someone about their next shift while they are still on one', () => {
    const clusters = clusterByLeadTime([
      shift(1, '2026-06-01 10:00:00', '2026-06-01 12:00:00'),
      shift(2, '2026-06-01 13:00:00', '2026-06-01 15:00:00'),
    ], 2 * HOUR, 'span')
    expect(clusters).toEqual([{ leaderId: 1, ids: [1, 2] }])
  })

  it('is independent of input order and breaks start ties by id', () => {
    const clusters = clusterByLeadTime([
      shift(9, '2026-06-02 10:00:00', '2026-06-02 12:00:00'),
      shift(4, '2026-06-01 10:00:00', '2026-06-01 12:00:00'),
      shift(3, '2026-06-01 10:00:00', '2026-06-01 11:00:00'),
    ], 2 * HOUR, 'span')
    expect(clusters).toEqual([{ leaderId: 3, ids: [3, 4] }, { leaderId: 9, ids: [9] }])
  })
})

describe('clusterByLeadTime (leader)', () => {
  it('does not chain a week of daily deadlines into one message', () => {
    const deadlines = [1, 2, 3, 4].map(day => shift(day, `2026-06-0${day} 00:00:00`, `2026-06-0${day} 00:00:00`))
    // 2-day lead: day 2 folds into day 1, day 3 starts a new group (its reminder fires on day 1).
    expect(clusterByLeadTime(deadlines, 2 * DAY, 'leader').map(cluster => cluster.ids)).toEqual([[1, 2], [3, 4]])
  })
})

describe('mergeShiftEntry', () => {
  const base = { shift_id: 1, name: 'Theke', start: '2026-06-01 18:00:00', end: '2026-06-01 20:00:00' }

  it('drops a shift that was added and removed again inside the window', () => {
    expect(mergeShiftEntry({ ...base, change: 'added' }, { ...base, change: 'removed' })).toBeNull()
    expect(mergeShiftEntry({ ...base, change: 'removed' }, { ...base, change: 'added' })).toBeNull()
  })

  it('keeps a newly added shift as "added" with its latest times', () => {
    const merged = mergeShiftEntry({ ...base, change: 'added' }, {
      ...base,
      start: '2026-06-01 19:00:00',
      change: 'changed',
      changes: [{ field: 'start', from: 'a', to: 'b' }],
    })
    expect(merged).toEqual({ ...base, start: '2026-06-01 19:00:00', change: 'added' })
  })

  it('merges successive edits and forgets one that was reverted', () => {
    const first = mergeShiftEntry(undefined, { ...base, change: 'changed', changes: [{ field: 'start', from: '18:00', to: '19:00' }] })
    const reverted = mergeShiftEntry(first!, { ...base, change: 'changed', changes: [{ field: 'start', from: '19:00', to: '18:00' }] })
    expect(reverted).toBeNull()
  })

  it('reports removal of a shift that had been changed', () => {
    const changed = { ...base, change: 'changed' as const, changes: [{ field: 'start' as const, from: '1', to: '2' }] }
    expect(mergeShiftEntry(changed, { ...base, change: 'removed' })?.change).toBe('removed')
  })
})

describe('mergeChangedFields', () => {
  it('keeps the earliest "from" and the latest "to" per field', () => {
    expect(mergeChangedFields(
      [{ field: 'start', from: '18:00', to: '19:00' }],
      [{ field: 'start', from: '19:00', to: '20:00' }, { field: 'name', from: 'A', to: 'B' }],
    )).toEqual([{ field: 'start', from: '18:00', to: '20:00' }, { field: 'name', from: 'A', to: 'B' }])
  })
})

describe('shiftSummaryType', () => {
  const entry = (change: ShiftListEntry['change']): ShiftListEntry => ({ shift_id: 1, name: 'x', start: '', end: '', change })

  it('lets the most relevant change decide the type', () => {
    expect(shiftSummaryType([entry('removed'), entry('added')])).toBe('shift.assigned')
    expect(shiftSummaryType([entry('removed'), entry('changed')])).toBe('shift.changed')
    expect(shiftSummaryType([entry('removed')])).toBe('shift.removed')
  })
})

describe('isOverdueReminderDay', () => {
  it('reports on day 1, 3 and 7, then weekly', () => {
    const days = Array.from({ length: 30 }, (_, index) => index).filter(isOverdueReminderDay)
    expect(days).toEqual([1, 3, 7, 14, 21, 28])
  })
})

describe('understaffed grouping', () => {
  const row = (id: number, start: string, end: string, assigned: number, required: number): StaffingShiftRow => ({
    id, event_id: 1, name: `S${id}`, starts_at: start, ends_at: end, assigned_count: assigned, required_people: required,
  })
  const shifts = [
    row(1, '2026-06-05 18:00:00', '2026-06-05 22:00:00', 2, 2),
    row(2, '2026-06-06 18:00:00', '2026-06-06 22:00:00', 1, 3),
    row(3, '2026-06-07 18:00:00', '2026-06-07 22:00:00', 0, 2),
  ]

  it('lists every short shift of the group in the warning of its first shift', () => {
    const entries = understaffedShiftsOfCluster(shifts, 2 * DAY, 1)
    expect(entries?.map(entry => entry.shift_id)).toEqual([2, 3])
    expect(understaffedPayload(entries!)).toMatchObject({ missing_people: 4, assigned_people: 1, required_people: 5, shift_name: 'S2' })
  })

  it('leaves the warning of a shift that does not lead its group empty-handed', () => {
    expect(understaffedShiftsOfCluster(shifts, 2 * DAY, 2)).toBeNull()
  })
})

describe('reminder ids from older rows', () => {
  it('falls back to the dedupe key when the payload predates the ids', () => {
    expect(reminderEntityId({}, 'shift_id', 'shift.reminder:42:1440')).toBe(42)
    expect(reminderEntityId({ shift_id: 7 }, 'shift_id', 'shift.reminder:42:1440')).toBe(7)
    expect(reminderLeadMinutes({}, 'shift.understaffed:42:2880')).toBe(2880)
    expect(reminderLeadMinutes({}, null)).toBeNull()
  })
})

describe('shiftPlanRequestFor', () => {
  const settings = normalizeNotificationSettings({ ...DEFAULT_NOTIFICATION_SETTINGS, shift_plan_pdf: { 'shift.reminder': { include_descriptions: true } } })

  it('follows the per-type switch', () => {
    expect(shiftPlanRequestFor('shift.reminder', { event_id: 5 }, settings)).toEqual({ eventId: 5, includeDescriptions: true })
    expect(shiftPlanRequestFor('shift.assigned', { event_id: 5 }, settings)).toBeNull()
  })

  it('uses the event a custom message picked', () => {
    expect(shiftPlanRequestFor('custom.message', { shift_plan_event_id: 9 }, settings)).toEqual({ eventId: 9, includeDescriptions: false })
    expect(shiftPlanRequestFor('custom.message', {}, settings)).toBeNull()
  })
})

describe('notification settings', () => {
  it('only keeps the shift plan option for types that can carry it', () => {
    const settings = normalizeNotificationSettings({ shift_plan_pdf: { 'task.assigned': { include_descriptions: true }, 'shift.assigned': { include_descriptions: false } } as any })
    expect(settings.shift_plan_pdf).toEqual({ 'shift.assigned': { include_descriptions: false } })
  })

  it('bounds the bundling window', () => {
    expect(validateNotificationSettings({ change_bundle_minutes: 121 })).toMatch(/Bündelungsfenster/)
    expect(validateNotificationSettings({ change_bundle_minutes: 0 })).toBeNull()
    expect(normalizeNotificationSettings({}).change_bundle_minutes).toBe(10)
  })
})

describe('list variables', () => {
  it('renders the change summary in the recipient\'s language', () => {
    const payload = {
      event_name: 'Sommerfest',
      shift_list: [
        { shift_id: 1, name: 'Theke', start: '2026-06-01 18:00:00', end: '2026-06-01 20:00:00', change: 'added' },
        { shift_id: 2, name: 'Kasse', start: '2026-06-01 20:00:00', end: '2026-06-02 01:00:00', change: 'removed' },
      ],
    }
    const de = renderNotification({ type: 'shift.assigned', payload, locale: 'de', settings: DEFAULT_NOTIFICATION_SETTINGS })
    expect(de.body).toContain('- Neu: Theke · 01.06.2026, 18:00 – 20:00')
    expect(de.body).toContain('- Entfernt: Kasse · 01.06.2026, 20:00 – 02.06.2026, 01:00')

    const en = renderNotification({ type: 'shift.assigned', payload, locale: 'en', settings: DEFAULT_NOTIFICATION_SETTINGS })
    expect(en.body).toContain('- New: Theke')
  })

  it('renders overdue tasks with their deadline and age', () => {
    const rendered = renderNotification({
      type: 'task.overdue',
      payload: { event_name: 'Sommerfest', task_count: 1, task_list: [{ task_id: 1, title: 'Plakate', deadline: '2026-05-20', days_overdue: 3 }] },
      locale: 'de',
      settings: DEFAULT_NOTIFICATION_SETTINGS,
    })
    expect(rendered.body).toContain('- Plakate (Frist: 20.05.2026) – seit 3 Tag(en) überfällig')
  })
})
