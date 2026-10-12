import { NOTIFICATION_TYPE_MAP, SCHEDULE_ANCHOR_VARIABLES, type NotificationTypeKey } from '~/config/notificationTypes'
import { getAppTimeZone } from '~/server/utils/time'
import { addMinutesToLocalDateTime, nowLocalDateTime, type LocalDateTime } from '~/shared/time'

/**
 * Every DATETIME the notification system reasons about — `notifications.scheduled_for`/`created_at`/
 * `sent_at`/`cancelled_at`, the delivery and push-subscription timestamps, plus the shift/event/task
 * timestamps the reminder sweep counts back from — is a `LocalDateTime` (shared/time.ts): a wall clock
 * in the app time zone (`app_time_zone` setting).
 *
 * The DB session runs in UTC ([server/utils/db.ts]), so MySQL's `NOW()` must never be compared
 * against those columns: in Berlin that is off by an hour in winter and two in summer. Every "now" in
 * this module is therefore built here, from the configured zone.
 */

/** The current wall clock in the app time zone, "YYYY-MM-DD HH:mm:ss", for SQL comparisons and writes. */
export async function localWallClockNow(now: Date = new Date()): Promise<LocalDateTime> {
  return nowLocalDateTime(await getAppTimeZone(), now)
}

/**
 * The current wall clock re-labelled as UTC — the pretend-UTC `Date` frame that dispatch.ts and
 * reminders.ts do all their arithmetic in, so `Date` maths never applies a second offset.
 */
export async function localWallClockNowDate(now: Date = new Date()): Promise<Date> {
  return new Date(`${(await localWallClockNow(now)).replace(' ', 'T')}Z`)
}

/** Adds minutes on the wall clock and returns the wall-clock string again. */
export function shiftWallClock(value: LocalDateTime, minutes: number): LocalDateTime {
  return addMinutesToLocalDateTime(value, minutes)
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
