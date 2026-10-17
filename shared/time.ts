/**
 * The app's time model — every time value is exactly one of three kinds:
 *
 * - `Instant` — a real moment, independent of any zone. Stored in `TIMESTAMP` columns (UTC; the DB
 *   session runs at `+00:00`, see server/utils/db.ts) and always carried as ISO 8601 with an explicit
 *   offset, e.g. "2026-10-12T14:00:00Z". server/utils/db.ts emits every TIMESTAMP that way, so an
 *   instant can't be mistaken for a wall clock on its way through the app.
 * - `LocalDateTime` — a wall clock as people type and read it ("the event starts at 19:00"),
 *   "YYYY-MM-DD HH:mm:ss" without offset. Stored in `DATETIME` columns and ALWAYS meant in the app
 *   time zone (the `app_time_zone` setting), never in the zone of the browser or Node process.
 * - `LocalDate` — a calendar day, "YYYY-MM-DD", stored in `DATE` columns, also in the app time zone.
 *
 * Every conversion between the kinds takes the time zone as an explicit argument. Nothing in here
 * reads the process' or browser's local zone (no `getHours()`, `setDate()`, `new Date(y, m, d)` or
 * `toISOString().slice(0, 10)` as "today").
 */

/** Fallback until an install has its `app_time_zone` setting, and the setting's initial value. */
export const DEFAULT_APP_TIME_ZONE = 'Europe/Berlin'

/** ISO 8601 with an explicit offset — a real moment. */
export type Instant = string
/** "YYYY-MM-DD HH:mm:ss" wall clock in the app time zone. */
export type LocalDateTime = string
/** "YYYY-MM-DD" calendar day in the app time zone. */
export type LocalDate = string

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const LOCAL_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/
const INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i
const SQL_TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(\.\d+)?$/

function pad2(value: number) {
  return String(value).padStart(2, '0')
}

// ---------------------------------------------------------------------------------------------
// Time zones
// ---------------------------------------------------------------------------------------------

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

/** All IANA zones the runtime knows, for the settings picker. */
export function listTimeZones(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf
  const zones = supported ? supported('timeZone') : []
  return zones.includes('UTC') ? zones : ['UTC', ...zones]
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>()

function partsFormatter(timeZone: string) {
  let formatter = partsFormatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
    partsFormatters.set(timeZone, formatter)
  }
  return formatter
}

interface WallClockParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function wallClockParts(instant: Date, timeZone: string): WallClockParts {
  const parts = partsFormatter(timeZone).formatToParts(instant)
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value ?? 0)
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    // Some engines render midnight as hour "24" under hour12: false.
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  }
}

/** Offset of `timeZone` from UTC at that instant, in minutes (Berlin summer: +120). */
export function timeZoneOffsetMinutes(instant: Date, timeZone: string): number {
  const p = wallClockParts(instant, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  const truncated = Math.floor(instant.getTime() / 1000) * 1000
  return Math.round((asUtc - truncated) / 60000)
}

// ---------------------------------------------------------------------------------------------
// Recognising and parsing the three kinds
// ---------------------------------------------------------------------------------------------

export function isInstant(value: unknown): value is Instant {
  return typeof value === 'string' && INSTANT_PATTERN.test(value.trim())
}

export function isLocalDateTime(value: unknown): value is LocalDateTime {
  return typeof value === 'string' && LOCAL_DATE_TIME_PATTERN.test(value.trim())
}

export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== 'string') return false
  const match = value.trim().match(LOCAL_DATE_PATTERN)
  if (!match) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const probe = new Date(Date.UTC(year, month - 1, day))
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day
}

/** Parses an instant. A string without an explicit offset is rejected, never guessed. */
export function parseInstant(value: Date | string | null | undefined): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (!isInstant(value)) return null
  const date = new Date(value.trim().replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Canonical "YYYY-MM-DD HH:mm:ss" for a wall-clock string ("…T19:00", "… 19:00", with or without
 * seconds), or null when it isn't one. A string with an offset is an instant, not a wall clock.
 */
export function normalizeLocalDateTime(value: unknown): LocalDateTime | null {
  if (typeof value !== 'string') return null
  const match = value.trim().match(LOCAL_DATE_TIME_PATTERN)
  if (!match) return null
  const [, y, mo, d, h, mi, s] = match
  if (!isLocalDate(`${y}-${mo}-${d}`)) return null
  if (Number(h) > 23 || Number(mi) > 59 || Number(s ?? 0) > 59) return null
  return `${y}-${mo}-${d} ${h}:${mi}:${s ?? '00'}`
}

// ---------------------------------------------------------------------------------------------
// Conversions — every one names its zone
// ---------------------------------------------------------------------------------------------

/** The wall clock in `timeZone` at that instant. */
export function instantToLocalDateTime(instant: Date | Instant, timeZone: string): LocalDateTime {
  const date = parseInstant(instant)
  if (!date) throw new Error(`Not an instant with explicit offset: ${String(instant)}`)
  const p = wallClockParts(date, timeZone)
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)} ${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}`
}

/** The calendar day in `timeZone` at that instant. */
export function instantToLocalDate(instant: Date | Instant, timeZone: string): LocalDate {
  return instantToLocalDateTime(instant, timeZone).slice(0, 10)
}

/**
 * The instant a wall clock in `timeZone` denotes. In the spring-forward gap the wall clock is read
 * with the offset from before the switch (02:30 → 03:30 CEST); in the fall-back hour the earlier of
 * the two moments wins.
 */
export function localDateTimeToInstant(value: LocalDateTime, timeZone: string): Date {
  const normalized = normalizeLocalDateTime(value)
  if (!normalized) throw new Error(`Not a local date-time: ${String(value)}`)
  const naiveUtc = new Date(`${normalized.replace(' ', 'T')}Z`).getTime()
  const firstGuess = naiveUtc - timeZoneOffsetMinutes(new Date(naiveUtc), timeZone) * 60000
  const firstOffset = timeZoneOffsetMinutes(new Date(firstGuess), timeZone)
  const candidate = naiveUtc - firstOffset * 60000
  // Fall-back hour: the same wall clock also exists one offset-step earlier — prefer that one.
  const earlierOffset = timeZoneOffsetMinutes(new Date(candidate - 3600000), timeZone)
  if (earlierOffset !== firstOffset) {
    const earlier = naiveUtc - earlierOffset * 60000
    if (instantToLocalDateTime(new Date(earlier), timeZone) === normalized) return new Date(earlier)
  }
  return new Date(candidate)
}

/**
 * A wall clock in `timeZone` as ISO 8601 with its UTC offset ("2026-11-03T19:00:00+01:00"), for
 * consumers outside the app that cannot know the zone. Follows `localDateTimeToInstant` in the DST
 * gap, so the result always names a moment that exists.
 */
export function localDateTimeToOffsetIso(value: LocalDateTime, timeZone: string): string {
  const instant = localDateTimeToInstant(value, timeZone)
  const offset = timeZoneOffsetMinutes(instant, timeZone)
  const sign = offset < 0 ? '-' : '+'
  const abs = Math.abs(offset)
  return `${instantToLocalDateTime(instant, timeZone).replace(' ', 'T')}${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`
}

/** Midnight of that calendar day in `timeZone`, as an instant. */
export function startOfLocalDate(value: LocalDate, timeZone: string): Date {
  return localDateTimeToInstant(`${value} 00:00:00`, timeZone)
}

/** The current wall clock in `timeZone`. */
export function nowLocalDateTime(timeZone: string, now: Date = new Date()): LocalDateTime {
  return instantToLocalDateTime(now, timeZone)
}

/** Today's calendar day in `timeZone`. */
export function todayLocalDate(timeZone: string, now: Date = new Date()): LocalDate {
  return instantToLocalDate(now, timeZone)
}

/**
 * Any time value as the wall clock it shows in `timeZone` — the value says itself which kind it is:
 * - an instant carries an offset ("…Z", TIMESTAMP columns) and is converted into `timeZone`;
 * - a bare "YYYY-MM-DD HH:mm[:ss]" (DATETIME) already IS that wall clock and is kept;
 * - a bare "YYYY-MM-DD" (DATE) is a calendar day (midnight, `hasTime: false`).
 * Null when the value is none of these.
 */
export function resolveWallClock(value: unknown, timeZone: string): { wallClock: LocalDateTime, hasTime: boolean } | null {
  if (value === null || value === undefined || value === '') return null
  const text = String(value).trim()
  if (isInstant(text)) return { wallClock: instantToLocalDateTime(text, timeZone), hasTime: true }
  const local = normalizeLocalDateTime(text)
  if (local) return { wallClock: local, hasTime: true }
  if (isLocalDate(text)) return { wallClock: `${text} 00:00:00`, hasTime: false }
  return null
}

/**
 * A wall clock re-labelled as UTC. Formatting it with `timeZone: 'UTC'` (or reading its getUTC*
 * fields) yields exactly the wall-clock digits — neither the runtime's zone nor DST can shift them.
 * It is a calculation frame, NOT the real moment.
 */
export function wallClockFrame(value: LocalDateTime): Date {
  return new Date(`${value.trim().replace(' ', 'T').slice(0, 19)}Z`)
}

// ---------------------------------------------------------------------------------------------
// Calendar arithmetic on wall clocks — zone-free by construction (the values are labels, not moments)
// ---------------------------------------------------------------------------------------------

function wallClockToFrame(value: LocalDateTime): Date {
  const normalized = normalizeLocalDateTime(value)
  if (!normalized) throw new Error(`Not a local date-time: ${String(value)}`)
  return wallClockFrame(normalized)
}

function frameToWallClock(frame: Date): LocalDateTime {
  return frame.toISOString().slice(0, 19).replace('T', ' ')
}

/** Moves a wall clock by whole minutes on the calendar (19:00 + 90 → 20:30, regardless of DST). */
export function addMinutesToLocalDateTime(value: LocalDateTime, minutes: number): LocalDateTime {
  return frameToWallClock(new Date(wallClockToFrame(value).getTime() + minutes * 60000))
}

export function addDaysToLocalDate(value: LocalDate, days: number): LocalDate {
  if (!isLocalDate(value)) throw new Error(`Not a local date: ${String(value)}`)
  const frame = new Date(`${value}T00:00:00Z`)
  frame.setUTCDate(frame.getUTCDate() + days)
  return frame.toISOString().slice(0, 10)
}

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export function diffLocalDates(from: LocalDate, to: LocalDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000)
}

/** Minutes between two wall clocks, as read on the calendar. */
export function diffLocalDateTimeMinutes(from: LocalDateTime, to: LocalDateTime): number {
  return Math.round((wallClockToFrame(to).getTime() - wallClockToFrame(from).getTime()) / 60000)
}

/** 0 = Sunday … 6 = Saturday, for that calendar day. */
export function weekdayOfLocalDate(value: LocalDate): number {
  return new Date(`${value.slice(0, 10)}T00:00:00Z`).getUTCDay()
}

// ---------------------------------------------------------------------------------------------
// SQL boundary for instants (TIMESTAMP columns, session time zone +00:00)
// ---------------------------------------------------------------------------------------------

/** "YYYY-MM-DD HH:mm:ss[.ffffff]" (UTC) as MariaDB returns a TIMESTAMP → "YYYY-MM-DDTHH:mm:ss[.ffffff]Z". */
export function sqlTimestampToInstant(value: string): Instant {
  const match = value.match(SQL_TIMESTAMP_PATTERN)
  if (!match) return value
  return `${match[1]}T${match[2]}${match[3] ?? ''}Z`
}

/**
 * An instant as the UTC literal a TIMESTAMP column expects ("YYYY-MM-DD HH:mm:ss[.ffffff]").
 * Sub-millisecond digits of an ISO string are kept so an audit `changed_at` read back matches.
 */
export function instantToSql(value: Date | Instant): string {
  if (typeof value === 'string') {
    const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?Z$/i)
    if (match) return `${match[1]} ${match[2]}${match[3] ?? ''}`
  }
  const date = parseInstant(value)
  if (!date) throw new Error(`Not an instant with explicit offset: ${String(value)}`)
  const iso = date.toISOString()
  const millis = iso.slice(20, 23)
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}${millis === '000' ? '' : `.${millis}`}`
}

/** mariadb `typeCast`: every TIMESTAMP leaves the driver as an ISO instant with "Z". */
export function castTimestampColumn<T>(column: { type: string }, next: () => T): T | string {
  const value = next()
  if ((column.type === 'TIMESTAMP' || column.type === 'TIMESTAMP2') && typeof value === 'string') {
    return sqlTimestampToInstant(value)
  }
  return value
}

/** Instants passed as query params ("…Z" / "…+02:00") become the UTC literal a TIMESTAMP expects. */
export function normalizeQueryParams<T>(params: T): T {
  if (!Array.isArray(params)) return params
  return params.map(param => (isInstant(param) ? instantToSql(param) : param)) as T
}
