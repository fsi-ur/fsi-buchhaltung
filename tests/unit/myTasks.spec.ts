import { describe, expect, it } from 'vitest'
import { daysUntilDeadline, parseTaskDeadline, sortMyTasks, taskUrgency } from '~/utils/myTasks'

// Wednesday, 14 Oct 2026, 10:00 local time.
const NOW = new Date(2026, 9, 14, 10, 0, 0)

describe('parseTaskDeadline', () => {
  it('reads a date-only deadline as the end of that day', () => {
    expect(parseTaskDeadline('2026-10-14')).toEqual(new Date(2026, 9, 14, 23, 59, 59))
  })

  it('reads a datetime deadline as local wall-clock time', () => {
    expect(parseTaskDeadline('2026-10-14 08:30')).toEqual(new Date(2026, 9, 14, 8, 30))
  })

  it('returns null for missing or malformed values', () => {
    expect(parseTaskDeadline(null)).toBeNull()
    expect(parseTaskDeadline('soon')).toBeNull()
  })
})

describe('taskUrgency', () => {
  it.each([
    [null, 'none'],
    ['2026-10-13', 'overdue'],
    ['2026-10-14 08:00', 'overdue'],
    ['2026-10-14', 'today'],
    ['2026-10-14 18:00', 'today'],
    ['2026-10-16', 'soon'],
    ['2026-10-30', 'later'],
  ])('%s → %s', (deadline, expected) => {
    expect(taskUrgency(deadline, NOW)).toBe(expected)
  })
})

describe('daysUntilDeadline', () => {
  it('counts calendar days regardless of the time of day', () => {
    expect(daysUntilDeadline('2026-10-14 23:00', NOW)).toBe(0)
    expect(daysUntilDeadline('2026-10-15', NOW)).toBe(1)
    expect(daysUntilDeadline('2026-10-11', NOW)).toBe(-3)
    expect(daysUntilDeadline(null, NOW)).toBeNull()
  })
})

describe('sortMyTasks', () => {
  const task = (id: number, deadline: string | null, extra: Partial<{ status: 'open' | 'in_progress', eventName: string, title: string }> = {}) => ({
    id,
    deadline,
    status: extra.status ?? 'open' as const,
    eventName: extra.eventName ?? 'Event',
    title: extra.title ?? `Task ${id}`,
  })

  it('puts the earliest deadline first and tasks without one last', () => {
    const sorted = sortMyTasks([task(1, null), task(2, '2026-10-20'), task(3, '2026-10-01'), task(4, '2026-10-20 09:00')])
    expect(sorted.map(entry => entry.id)).toEqual([3, 4, 2, 1])
  })

  it('prefers tasks in progress on equal deadlines, then event and title', () => {
    const sorted = sortMyTasks([
      task(1, '2026-10-20', { eventName: 'B' }),
      task(2, '2026-10-20', { eventName: 'A', title: 'Z' }),
      task(3, '2026-10-20', { eventName: 'A', title: 'A' }),
      task(4, '2026-10-20', { eventName: 'C', status: 'in_progress' }),
    ])
    expect(sorted.map(entry => entry.id)).toEqual([4, 3, 2, 1])
  })

  it('does not mutate its input', () => {
    const input = [task(1, null), task(2, '2026-10-01')]
    sortMyTasks(input)
    expect(input.map(entry => entry.id)).toEqual([1, 2])
  })
})
