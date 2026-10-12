import { useI18n } from '~/composables/useI18n'
import { useAppTimeZone } from '~/composables/useAppTimeZone'
import {
  localDateTimeToInstant,
  normalizeLocalDateTime,
  parseInstant,
  resolveWallClock,
  wallClockFrame,
  weekdayOfLocalDate,
} from '~/shared/time'

export function useLocaleFormatters() {
  const { locale } = useI18n()
  const { timeZone } = useAppTimeZone()

  function formatCurrency(value: number, options?: Intl.NumberFormatOptions) {
    return new Intl.NumberFormat(locale.value, {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      ...options,
    }).format(value)
  }

  function toAppWallClock(value?: string | null) {
    return resolveWallClock(value, timeZone.value)
  }

  function formatDate(value?: string | null) {
    const resolved = toAppWallClock(value)
    if (!resolved) return ''
    return wallClockFrame(resolved.wallClock).toLocaleDateString(locale.value, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'UTC',
    })
  }

  function formatDateTime(value?: string | null) {
    const resolved = toAppWallClock(value)
    if (!resolved) return ''
    if (!resolved.hasTime) return formatDate(value)
    return wallClockFrame(resolved.wallClock).toLocaleString(locale.value, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    })
  }

  function formatTime(value?: string | null) {
    const resolved = toAppWallClock(value)
    if (!resolved || !resolved.hasTime) return ''
    return wallClockFrame(resolved.wallClock).toLocaleTimeString(locale.value, {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    })
  }

  /**
   * "YYYY-MM-DD" of the value in the app time zone — for grouping by day. Grouping by a raw UTC slice
   * would put changes made shortly after midnight local time under the previous day's heading.
   */
  function localDayKey(value?: string | null) {
    return toAppWallClock(value)?.wallClock.slice(0, 10) ?? ''
  }

  /** "Montag, 23.08.2026" — for day headings in chronological lists. */
  function formatDayHeading(value?: string | null) {
    const day = localDayKey(value)
    if (!day) return ''
    const weekday = wallClockFrame(`${day} 00:00:00`).toLocaleDateString(locale.value, { weekday: 'long', timeZone: 'UTC' })
    return `${weekday}, ${formatDate(day)}`
  }

  /** 0 = Sunday … 6 = Saturday, of the value's day in the app time zone. */
  function weekdayOf(value?: string | null) {
    const day = localDayKey(value)
    return day ? weekdayOfLocalDate(day) : null
  }

  /** "vor 5 Minuten" / "jetzt" — locale-aware, no extra i18n keys needed. */
  function formatRelativeTime(value?: string | null) {
    if (!value) return ''
    const text = String(value).trim()
    const instant = parseInstant(text)
      ?? (normalizeLocalDateTime(text) ? localDateTimeToInstant(text, timeZone.value) : null)
    if (!instant) return ''
    const diffMs = instant.getTime() - Date.now()
    const rtf = new Intl.RelativeTimeFormat(locale.value, { numeric: 'auto' })
    const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
      ['year', 31536000000],
      ['month', 2592000000],
      ['week', 604800000],
      ['day', 86400000],
      ['hour', 3600000],
      ['minute', 60000],
    ]
    for (const [unit, ms] of units) {
      if (Math.abs(diffMs) >= ms) return rtf.format(Math.round(diffMs / ms), unit)
    }
    // numeric: 'auto' renders 0 seconds as "jetzt" / "now" rather than "in 0 seconds".
    return rtf.format(Math.round(diffMs / 1000), 'second')
  }

  return {
    formatCurrency,
    formatDate,
    formatDateTime,
    formatTime,
    localDayKey,
    formatDayHeading,
    weekdayOf,
    formatRelativeTime,
  }
}
