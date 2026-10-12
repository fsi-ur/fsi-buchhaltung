import type { MyEventTask } from '~/types/event'
import { diffLocalDateTimeMinutes, diffLocalDates, isLocalDate, normalizeLocalDateTime, type LocalDateTime } from '~/shared/time'

export type TaskUrgency = 'overdue' | 'today' | 'soon' | 'later' | 'none'

const SOON_DAYS = 3

export function parseTaskDeadline(deadline: string | null): LocalDateTime | null {
  if (!deadline) return null
  const trimmed = deadline.trim()
  if (isLocalDate(trimmed)) return `${trimmed} 23:59:59`
  return normalizeLocalDateTime(trimmed)
}

export function taskUrgency(deadline: string | null, now: LocalDateTime): TaskUrgency {
  const due = parseTaskDeadline(deadline)
  if (!due) return 'none'
  if (due < now) return 'overdue'
  if (due.slice(0, 10) === now.slice(0, 10)) return 'today'
  if (diffLocalDateTimeMinutes(now, due) <= SOON_DAYS * 24 * 60) return 'soon'
  return 'later'
}

/** Whole calendar days from today to the deadline's day (negative when overdue). */
export function daysUntilDeadline(deadline: string | null, now: LocalDateTime): number | null {
  const due = parseTaskDeadline(deadline)
  if (!due) return null
  return diffLocalDates(now.slice(0, 10), due.slice(0, 10))
}

/**
 * Earliest deadline first (so overdue tasks lead), tasks without a deadline last; ties put work
 * already in progress first, then sort by event and title for a stable order.
 */
export function sortMyTasks<T extends Pick<MyEventTask, 'id' | 'deadline' | 'status' | 'eventName' | 'title'>>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    // Canonical wall-clock strings order like the times they are; no deadline sorts last.
    const dueA = parseTaskDeadline(a.deadline) ?? '￿'
    const dueB = parseTaskDeadline(b.deadline) ?? '￿'
    if (dueA !== dueB) return dueA < dueB ? -1 : 1

    if (a.status !== b.status) return a.status === 'in_progress' ? -1 : 1

    return a.eventName.localeCompare(b.eventName)
      || a.title.localeCompare(b.title)
      || a.id - b.id
  })
}
