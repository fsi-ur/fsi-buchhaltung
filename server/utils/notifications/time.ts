import { NOTIFICATION_TYPE_MAP, SCHEDULE_ANCHOR_VARIABLES, type NotificationTypeKey } from '~/config/notificationTypes'

/**
 * Every DATETIME the notification system reasons about — `notifications.scheduled_for`, plus the
 * shift/event/task timestamps the reminder sweep counts back from — is a timezone-naive wall-clock
 * value in the association's local time, exactly like the rest of the app (the client sends what
 * the date picker shows, see composables/useDateInput.ts, and formats it back with the same zone in
 * composables/useLocaleFormatters.ts).
 *
 * The DB pool runs with `timezone: 'UTC'` ([server/utils/db.ts]), so MySQL's `NOW()` is UTC and must
 * never be compared against those columns: in winter that is off by an hour, in summer by two, which
 * is exactly the amount a scheduled notification used to fire late. Every "now" in this module is
 * therefore built here instead.
 */
export const ASSOCIATION_TIME_ZONE = 'Europe/Berlin'

const WALL_CLOCK_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: ASSOCIATION_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

/** "YYYY-MM-DD HH:mm:ss" for the given instant, expressed in the association's local time. */
export function toLocalWallClock(instant: Date = new Date()): string {
  const parts = WALL_CLOCK_PARTS.formatToParts(instant)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? '00'
  // Some engines render midnight as hour "24" under hour12: false.
  const hour = get('hour') === '24' ? '00' : get('hour')
  return `${get('year')}-${get('month')}-${get('day')} ${hour}:${get('minute')}:${get('second')}`
}

/** The current local wall clock as a "YYYY-MM-DD HH:mm:ss" string for SQL comparisons. */
export function localWallClockNow(): string {
  return toLocalWallClock()
}

/**
 * The current local wall clock re-labelled as UTC — the pretend-UTC `Date` frame that dispatch.ts
 * and reminders.ts do all their arithmetic in, so `Date` maths never applies a second offset.
 */
export function localWallClockNowDate(): Date {
  return new Date(`${localWallClockNow().replace(' ', 'T')}Z`)
}

/** Adds minutes inside that same frame and returns the wall-clock string again. */
export function shiftWallClock(value: string, minutes: number): string {
  const base = new Date(`${value.replace(' ', 'T')}Z`)
  const shifted = new Date(base.getTime() + minutes * 60000)
  return shifted.toISOString().slice(0, 19).replace('T', ' ')
}


export function reminderMomentHasPassed(
  typeKey: NotificationTypeKey,
  payload: Record<string, any> | null,
  now: string,
): boolean {
  const anchor = NOTIFICATION_TYPE_MAP[typeKey]?.schedule?.anchor
  if (!anchor) return false

  const raw = payload?.[SCHEDULE_ANCHOR_VARIABLES[anchor]]
  const match = String(raw ?? '').match(/^(\d{4}-\d{2}-\d{2})[\sT](\d{2}:\d{2})(:\d{2})?/)
  if (!match) return false

  return `${match[1]} ${match[2]}${match[3] || ':00'}` < now
}
