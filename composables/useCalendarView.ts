import type { CalendarEntry, CalendarSource } from '~/types/appointment'

export type CalendarViewMode = 'month' | 'week' | 'list'

export interface CalendarDay {
  /** 'YYYY-MM-DD' */
  key: string
  date: Date
  dayOfMonth: number
  inCurrentMonth: boolean
  isToday: boolean
  isWeekend: boolean
}

export interface CalendarSourceFilter {
  sources: CalendarSource[]
  /** null = every type; otherwise the ids that stay visible. */
  typeIds: number[] | null
}

export const WEEKDAY_KEYS = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'] as const

const STORAGE_KEY = 'calendar-sources'
const ALL_SOURCES: CalendarSource[] = ['appointment', 'event', 'shift', 'task']

const BERLIN_TIME_ZONE = 'Europe/Berlin'
const BERLIN_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: BERLIN_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

function pad2(value: number) {
  return String(value).padStart(2, '0')
}

export function nowInBerlin(): Date {
  const parts = BERLIN_PARTS.formatToParts(new Date())
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? '00'
  const hour = get('hour') === '24' ? '00' : get('hour')
  return new Date(Date.UTC(
    Number(get('year')), Number(get('month')) - 1, Number(get('day')),
    Number(hour), Number(get('minute')), Number(get('second')),
  ))
}

export function dayKeyOf(value: string): string {
  return String(value).slice(0, 10)
}

export function toDayKey(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`
}

export function parseDayKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1))
}

export function weekdayIndexOf(date: Date): number {
  return (date.getUTCDay() + 6) % 7
}

export function startOfWeek(date: Date): Date {
  return new Date(date.getTime() - weekdayIndexOf(date) * 86400000)
}

export function todayKey(): string {
  return toDayKey(nowInBerlin())
}

function buildDay(date: Date, currentMonth: number, today: string): CalendarDay {
  const key = toDayKey(date)
  const weekday = weekdayIndexOf(date)

  return {
    key,
    date,
    dayOfMonth: date.getUTCDate(),
    inCurrentMonth: date.getUTCMonth() === currentMonth,
    isToday: key === today,
    isWeekend: weekday >= 5,
  }
}

export function isoWeekNumber(date: Date): number {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const dayNum = weekdayIndexOf(day)
  day.setUTCDate(day.getUTCDate() - dayNum + 3)

  const firstThursday = new Date(Date.UTC(day.getUTCFullYear(), 0, 4))
  firstThursday.setUTCDate(firstThursday.getUTCDate() - weekdayIndexOf(firstThursday) + 3)

  return 1 + Math.round((day.getTime() - firstThursday.getTime()) / (7 * 86400000))
}

export function buildMonthMatrix(anchor: Date): CalendarDay[][] {
  const today = todayKey()
  const first = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1))
  const gridStart = startOfWeek(first)

  const weeks: CalendarDay[][] = []
  for (let week = 0; week < 6; week += 1) {
    const days: CalendarDay[] = []
    for (let day = 0; day < 7; day += 1) {
      days.push(buildDay(new Date(gridStart.getTime() + (week * 7 + day) * 86400000), anchor.getUTCMonth(), today))
    }
    weeks.push(days)
  }
  return weeks
}

export function buildWeekDays(anchor: Date): CalendarDay[] {
  const today = todayKey()
  const start = startOfWeek(anchor)

  return Array.from({ length: 7 }, (_, index) =>
    buildDay(new Date(start.getTime() + index * 86400000), anchor.getUTCMonth(), today))
}

export function windowForView(anchor: Date, mode: CalendarViewMode): { from: string, to: string } {
  if (mode === 'week') {
    const start = startOfWeek(anchor)
    return { from: `${toDayKey(start)} 00:00:00`, to: `${toDayKey(new Date(start.getTime() + 6 * 86400000))} 23:59:59` }
  }

  if (mode === 'list') {
    const start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1))
    const end = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0))
    return { from: `${toDayKey(start)} 00:00:00`, to: `${toDayKey(end)} 23:59:59` }
  }

  const matrix = buildMonthMatrix(anchor)
  const firstDay = matrix[0]?.[0]
  const lastWeek = matrix[matrix.length - 1]
  const lastDay = lastWeek?.[lastWeek.length - 1]

  return {
    from: `${firstDay?.key ?? toDayKey(anchor)} 00:00:00`,
    to: `${lastDay?.key ?? toDayKey(anchor)} 23:59:59`,
  }
}

export function shiftAnchor(anchor: Date, mode: CalendarViewMode, direction: -1 | 1): Date {
  if (mode === 'week') return new Date(anchor.getTime() + direction * 7 * 86400000)
  return new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + direction, 1))
}

function effectiveEndDayKey(entry: CalendarEntry): string {
  const start = dayKeyOf(entry.startsAt)
  const end = dayKeyOf(entry.endsAt) || start
  if (entry.allDay || end <= start || entry.endsAt.slice(11, 19) !== '00:00:00') return end
  return toDayKey(new Date(parseDayKey(end).getTime() - 86400000))
}

export function entryDayKeys(entry: CalendarEntry): string[] {
  const start = dayKeyOf(entry.startsAt)
  const end = effectiveEndDayKey(entry)
  if (end <= start) return [start]

  const keys: string[] = []
  let cursor = parseDayKey(start)
  const last = parseDayKey(end)

  while (cursor.getTime() <= last.getTime() && keys.length < 400) {
    keys.push(toDayKey(cursor))
    cursor = new Date(cursor.getTime() + 86400000)
  }

  return keys
}

export interface EntryDaySegment {
  isFirstDay: boolean
  isLastDay: boolean
  isMultiDay: boolean
}

export function entryDaySegment(entry: CalendarEntry, dayKey: string): EntryDaySegment {
  const keys = entryDayKeys(entry)
  return {
    isFirstDay: keys[0] === dayKey,
    isLastDay: keys[keys.length - 1] === dayKey,
    isMultiDay: keys.length > 1,
  }
}

export function groupEntriesByDay(entries: CalendarEntry[]): Map<string, CalendarEntry[]> {
  const byDay = new Map<string, CalendarEntry[]>()

  for (const entry of entries) {
    for (const key of entryDayKeys(entry)) {
      const list = byDay.get(key) ?? []
      list.push(entry)
      byDay.set(key, list)
    }
  }

  for (const list of byDay.values()) {
    list.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.startsAt.localeCompare(b.startsAt))
  }

  return byDay
}

export function applySourceFilter(entries: CalendarEntry[], filter: CalendarSourceFilter): CalendarEntry[] {
  return entries.filter((entry) => {
    if (!filter.sources.includes(entry.source)) return false
    if (entry.source !== 'appointment' || filter.typeIds === null) return true
    if (entry.typeId === null) return true
    return filter.typeIds.includes(entry.typeId)
  })
}

export function loadSourceFilter(): CalendarSourceFilter {
  const fallback: CalendarSourceFilter = { sources: [...ALL_SOURCES], typeIds: null }
  if (typeof window === 'undefined') return fallback

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback

    const parsed = JSON.parse(raw) as Partial<CalendarSourceFilter>
    const sources = Array.isArray(parsed.sources)
      ? parsed.sources.filter((source): source is CalendarSource => ALL_SOURCES.includes(source as CalendarSource))
      : fallback.sources

    const typeIds = Array.isArray(parsed.typeIds)
      ? parsed.typeIds.map(Number).filter(Number.isFinite)
      : null

    return { sources: sources.length ? sources : fallback.sources, typeIds }
  } catch {
    return fallback
  }
}

export function saveSourceFilter(filter: CalendarSourceFilter) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(filter))
  } catch {
    // A full or disabled storage must never break the calendar.
  }
}

export const CALENDAR_SOURCES = ALL_SOURCES
