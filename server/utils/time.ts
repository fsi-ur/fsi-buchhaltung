import { query } from '~/server/utils/db'
import {
  DEFAULT_APP_TIME_ZONE,
  instantToSql,
  isValidTimeZone,
  nowLocalDateTime,
  todayLocalDate,
  type LocalDate,
  type LocalDateTime,
} from '~/shared/time'

export const APP_TIME_ZONE_SETTING_KEY = 'app_time_zone'

// A short TTL instead of a process-lifetime cache: a change saved in one process (or straight in the
// DB) is picked up everywhere within seconds, and the hot paths (permission checks) still don't hit
// the database on every call.
const CACHE_TTL_MS = 30_000
let cached: { value: string, loadedAt: number } | null = null
let pending: Promise<string> | null = null

export function normalizeAppTimeZone(value: unknown): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return isValidTimeZone(trimmed) ? trimmed : DEFAULT_APP_TIME_ZONE
}

async function loadAppTimeZone(conn?: any): Promise<string> {
  try {
    const rows = await query<Array<{ setting_value: string | null }>>(
      `SELECT setting_value FROM app_settings WHERE setting_key = ?`,
      [APP_TIME_ZONE_SETTING_KEY],
      conn,
    )
    return normalizeAppTimeZone(rows[0]?.setting_value)
  } catch (err: any) {
    if (err?.code !== 'ER_NO_SUCH_TABLE') throw err
    return DEFAULT_APP_TIME_ZONE
  }
}

/** The configured IANA zone of the association (`app_time_zone`), e.g. "Europe/Berlin". */
export async function getAppTimeZone(conn?: any): Promise<string> {
  // Inside a transaction read through it, so a just-saved value is seen by the same transaction.
  if (conn) return loadAppTimeZone(conn)
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) return cached.value
  if (!pending) {
    pending = loadAppTimeZone()
      .then((value) => {
        cached = { value, loadedAt: Date.now() }
        return value
      })
      .finally(() => { pending = null })
  }
  return pending
}

export async function saveAppTimeZone(value: string, conn?: any): Promise<string> {
  if (!isValidTimeZone(value)) throw new Error(`Invalid time zone: ${value}`)
  await query(
    `INSERT INTO app_settings (setting_key, setting_value)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [APP_TIME_ZONE_SETTING_KEY, value],
    conn,
  )
  cached = null
  return value
}

/** Drops the cached zone (tests, snapshot restore). */
export function resetAppTimeZoneCache() {
  cached = null
}

/** The association's current wall clock, for comparisons with `DATETIME` columns. */
export async function appNowLocalDateTime(conn?: any, now: Date = new Date()): Promise<LocalDateTime> {
  return nowLocalDateTime(await getAppTimeZone(conn), now)
}

/** The association's current calendar day, for comparisons with `DATE` columns. */
export async function appTodayLocalDate(conn?: any, now: Date = new Date()): Promise<LocalDate> {
  return todayLocalDate(await getAppTimeZone(conn), now)
}

/** The current instant as a `TIMESTAMP` literal (UTC), for writes and comparisons. */
export function utcNowSql(now: Date = new Date()): string {
  return instantToSql(now)
}
