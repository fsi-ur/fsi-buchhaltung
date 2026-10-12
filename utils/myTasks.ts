import type { MyEventTask } from '~/types/event'

export type TaskUrgency = 'overdue' | 'today' | 'soon' | 'later' | 'none'

const SOON_DAYS = 3

function pad2(value: number) {
  return String(value).padStart(2, '0')
}

function localDayKey(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

export function parseTaskDeadline(deadline: string | null): Date | null {
  if (!deadline) return null
  const normalized = deadline.length <= 10 ? `${deadline}T23:59:59` : deadline.replace(' ', 'T')
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

export function taskUrgency(deadline: string | null, now: Date = new Date()): TaskUrgency {
  const due = parseTaskDeadline(deadline)
  if (!due) return 'none'
  if (due.getTime() < now.getTime()) return 'overdue'
  if (localDayKey(due) === localDayKey(now)) return 'today'
  if (due.getTime() - now.getTime() <= SOON_DAYS * 86400000) return 'soon'
  return 'later'
}

/** Whole calendar days from today to the deadline's day (negative when overdue). */
export function daysUntilDeadline(deadline: string | null, now: Date = new Date()): number | null {
  if (!deadline) return null
  const dueDay = new Date(`${deadline.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(dueDay.getTime())) return null
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((dueDay.getTime() - today.getTime()) / 86400000)
}

/**
 * Earliest deadline first (so overdue tasks lead), tasks without a deadline last; ties put work
 * already in progress first, then sort by event and title for a stable order.
 */
export function sortMyTasks<T extends Pick<MyEventTask, 'id' | 'deadline' | 'status' | 'eventName' | 'title'>>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    const dueA = parseTaskDeadline(a.deadline)?.getTime() ?? Number.POSITIVE_INFINITY
    const dueB = parseTaskDeadline(b.deadline)?.getTime() ?? Number.POSITIVE_INFINITY
    if (dueA !== dueB) return dueA < dueB ? -1 : 1

    if (a.status !== b.status) return a.status === 'in_progress' ? -1 : 1

    return a.eventName.localeCompare(b.eventName)
      || a.title.localeCompare(b.title)
      || a.id - b.id
  })
}
