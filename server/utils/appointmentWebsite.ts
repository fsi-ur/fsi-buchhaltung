import { query } from '~/server/utils/db'
import { loadOverrides, SERIES_COLUMNS, toAppointmentSeries } from '~/server/utils/appointments'
import {
  expandOccurrences,
  formatWallClock,
  parseWallClock,
  type AppointmentOccurrence,
} from '~/server/utils/appointments/recurrence'
import { parsePublicEventsQuery } from '~/server/utils/eventWebsite'
import type { DbConn } from '~/server/utils/notifications/types'
import {
  addDaysToLocalDate,
  diffLocalDates,
  localDateTimeToOffsetIso,
  normalizeLocalDateTime,
  type LocalDateTime,
} from '~/shared/time'
import type { AppointmentSeries, AppointmentWebsiteSettings, PublicAppointment } from '~/types/appointment'

/** Without `to`, occurrences up to this many days after today (or after `from`, if that is later) are returned. */
export const PUBLIC_APPOINTMENTS_DEFAULT_DAYS = 365
/** Recurring series are expanded date by date, so the window has to stay bounded. */
export const PUBLIC_APPOINTMENTS_MAX_DAYS = 3660
/** expandOccurrences caps its window at ~2 years; longer windows are expanded in chunks of this size. */
const EXPANSION_CHUNK_DAYS = 700

export function normalizeAppointmentWebsitePayload(value: unknown): AppointmentWebsiteSettings | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Record<string, unknown>

  const visibleFromRaw = String(input.visible_from ?? '').trim()
  const visibleFrom = visibleFromRaw ? normalizeLocalDateTime(visibleFromRaw) : null
  if (visibleFromRaw && !visibleFrom) return null

  return {
    published: input.published === true || input.published === 1 || input.published === '1',
    visible_from: visibleFrom,
  }
}

export async function loadAppointmentWebsiteSettings(appointmentId: number, conn?: DbConn): Promise<AppointmentWebsiteSettings | null> {
  const rows = await query<Array<{ website_published: number, website_visible_from: string | null }>>(
    `SELECT website_published, website_visible_from FROM appointments WHERE id = ? LIMIT 1`,
    [appointmentId],
    conn,
  )
  const row = rows[0]
  if (!row) return null
  return {
    published: Boolean(Number(row.website_published)),
    visible_from: row.website_visible_from != null ? String(row.website_visible_from) : null,
  }
}

export async function saveAppointmentWebsiteSettings(appointmentId: number, body: AppointmentWebsiteSettings, conn: DbConn) {
  await query(
    `UPDATE appointments SET website_published = ?, website_visible_from = ? WHERE id = ?`,
    [body.published ? 1 : 0, body.visible_from, appointmentId],
    conn,
  )
}

/**
 * A single date's deviation from the series: true = published even though the series isn't,
 * false = hidden although the series is, null = like the series.
 */
export function normalizeOccurrenceWebsitePayload(value: unknown): { occurrenceDate: string, published: boolean | null } | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Record<string, unknown>

  const occurrenceDate = normalizeOccurrenceDate(input.occurrenceDate)
  if (!occurrenceDate) return null

  const raw = input.published
  const published = raw === null ? null
    : raw === true || raw === 1 || raw === '1' ? true
      : raw === false || raw === 0 || raw === '0' ? false
        : undefined
  if (published === undefined) return null

  return { occurrenceDate, published }
}

export function normalizeOccurrenceDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const parsed = parseWallClock(value)
  return parsed ? formatWallClock(parsed) : null
}

/** Whether `occurrenceDate` is a date the series' rule actually produces (and not a single appointment). */
export async function isScheduledOccurrence(appointmentId: number, occurrenceDate: string, conn?: DbConn): Promise<boolean> {
  const rows = await query<Array<Record<string, any>>>(
    `SELECT ${SERIES_COLUMNS} FROM appointments WHERE id = ? LIMIT 1`,
    [appointmentId],
    conn,
  )
  const appointment = rows[0] ? toAppointmentSeries(rows[0]) : null
  if (!appointment?.recurrence_freq) return false
  // Without overrides every occurrence sits at its scheduled start, so a zero-length window finds it.
  return expandOccurrences(appointment, [], { from: occurrenceDate, to: occurrenceDate }, { includeCancelled: true })
    .some(occurrence => occurrence.occurrenceDate === occurrenceDate)
}

export async function loadOccurrenceWebsitePublished(appointmentId: number, occurrenceDate: string, conn?: DbConn): Promise<boolean | null> {
  const rows = await query<Array<{ website_published: number | null }>>(
    `SELECT website_published FROM appointment_occurrence_overrides WHERE appointment_id = ? AND occurrence_date = ? LIMIT 1`,
    [appointmentId, occurrenceDate],
    conn,
  )
  const value = rows[0]?.website_published
  return value == null ? null : Boolean(Number(value))
}

export async function saveOccurrenceWebsitePublished(appointmentId: number, occurrenceDate: string, published: boolean | null, conn: DbConn) {
  if (published === null) {
    // Back to "like the series" — never creates an otherwise empty override row.
    await query(
      `UPDATE appointment_occurrence_overrides SET website_published = NULL WHERE appointment_id = ? AND occurrence_date = ?`,
      [appointmentId, occurrenceDate],
      conn,
    )
    return
  }
  await query(
    `INSERT INTO appointment_occurrence_overrides (appointment_id, occurrence_date, is_cancelled, website_published)
     VALUES (?, ?, 0, ?)
     ON DUPLICATE KEY UPDATE website_published = VALUES(website_published)`,
    [appointmentId, occurrenceDate, published ? 1 : 0],
    conn,
  )
}

/** "This and following" splits a series into a new appointment — it stays on the website like the original. */
export async function copyAppointmentWebsiteSettings(fromId: number, toId: number, conn: DbConn) {
  await query(
    `UPDATE appointments target
     JOIN appointments source ON source.id = ?
     SET target.website_published = source.website_published,
         target.website_visible_from = source.website_visible_from
     WHERE target.id = ?`,
    [fromId, toId],
    conn,
  )
}

export interface PublicAppointmentsQuery {
  /** Inclusive window (wall clocks); occurrences overlapping it are returned. */
  from: LocalDateTime
  to: LocalDateTime
  limit: number
  order: 'asc' | 'desc'
}

/**
 * Same parameters as the events feed. Without `to` the window reaches PUBLIC_APPOINTMENTS_DEFAULT_DAYS
 * past today — a `from` in the past widens the window backwards, it doesn't pull the end in. A longer
 * range than PUBLIC_APPOINTMENTS_MAX_DAYS is rejected rather than silently cut.
 */
export function parsePublicAppointmentsQuery(
  params: Record<string, unknown>,
  now: LocalDateTime,
): { ok: true, query: PublicAppointmentsQuery } | { ok: false, error: string } {
  const parsed = parsePublicEventsQuery(params, now)
  if (!parsed.ok) return parsed

  const { endsAfter, startsBefore, limit, order } = parsed.query
  const fromDay = endsAfter.slice(0, 10)
  const today = now.slice(0, 10)
  const toDay = startsBefore
    ? addDaysToLocalDate(startsBefore.slice(0, 10), -1)
    : addDaysToLocalDate(fromDay > today ? fromDay : today, PUBLIC_APPOINTMENTS_DEFAULT_DAYS)

  if (toDay < fromDay) return { ok: false, error: '"to" must not be before today when "from" is omitted' }
  if (diffLocalDates(fromDay, toDay) > PUBLIC_APPOINTMENTS_MAX_DAYS) {
    return { ok: false, error: `The range may span at most ${PUBLIC_APPOINTMENTS_MAX_DAYS} days` }
  }

  return { ok: true, query: { from: endsAfter, to: `${toDay} 23:59:59`, limit, order } }
}

/**
 * Every published occurrence of an already visible series that overlaps the window, cancelled ones
 * flagged. An occurrence is published when the series is, unless that one date is hidden — or when
 * just that date is published although the series isn't.
 */
export async function loadPublicAppointments(filter: PublicAppointmentsQuery, now: LocalDateTime, timeZone: string): Promise<PublicAppointment[]> {
  // Coarse prefilter only; the exact overlap (including moved occurrences) is expandOccurrences' job.
  const rows = await query<Array<Record<string, any>>>(
    `SELECT ${SERIES_COLUMNS}, website_published
     FROM appointments a
     WHERE (a.website_published = 1 OR EXISTS (
         SELECT 1 FROM appointment_occurrence_overrides o
         WHERE o.appointment_id = a.id AND o.website_published = 1
       ))
       AND (a.website_visible_from IS NULL OR a.website_visible_from <= ?)
       AND a.starts_at <= ?
       AND (a.recurrence_freq IS NOT NULL OR a.ends_at >= ?)`,
    [now, filter.to, filter.from],
  )
  if (!rows.length) return []

  const series = rows.map(row => ({ appointment: toAppointmentSeries(row), published: Boolean(Number(row.website_published)) }))
  const overrides = await loadOverrides(series.map(row => row.appointment.id))

  const occurrences: Array<{ series: AppointmentSeries, occurrence: AppointmentOccurrence }> = []
  for (const { appointment, published } of series) {
    const seriesOverrides = overrides.get(appointment.id) ?? []
    const publishedByDate = new Map<string, boolean>()
    for (const override of seriesOverrides) {
      const date = normalizeOccurrenceDate(override.occurrence_date)
      if (date && override.website_published != null) publishedByDate.set(date, override.website_published)
    }

    for (const occurrence of expandInChunks(appointment, seriesOverrides, filter)) {
      // A single appointment has no per-date setting; its series flag is all there is.
      const isPublished = appointment.recurrence_freq
        ? publishedByDate.get(occurrence.occurrenceDate) ?? published
        : published
      if (isPublished) occurrences.push({ series: appointment, occurrence })
    }
  }

  const direction = filter.order === 'desc' ? -1 : 1
  occurrences.sort((a, b) =>
    direction * (a.occurrence.startsAt.localeCompare(b.occurrence.startsAt) || a.series.id - b.series.id))

  return occurrences.slice(0, filter.limit).map(({ series: appointment, occurrence }) =>
    toPublicAppointment(appointment, occurrence, timeZone))
}

/**
 * expandOccurrences over a window of any length. Chunks overlap-match at their edges, so an
 * occurrence straddling one is returned by both and deduplicated by its scheduled start.
 */
function expandInChunks(
  appointment: AppointmentSeries,
  overrides: Parameters<typeof expandOccurrences>[1],
  window: { from: LocalDateTime, to: LocalDateTime },
): AppointmentOccurrence[] {
  const seen = new Set<string>()
  const result: AppointmentOccurrence[] = []
  const lastDay = window.to.slice(0, 10)

  let chunkFrom = window.from
  while (chunkFrom <= window.to) {
    const chunkLastDay = addDaysToLocalDate(chunkFrom.slice(0, 10), EXPANSION_CHUNK_DAYS - 1)
    const chunkTo = chunkLastDay >= lastDay ? window.to : `${chunkLastDay} 23:59:59`

    // At most one occurrence per day and series, so this never truncates a chunk.
    const chunk = expandOccurrences(appointment, overrides, { from: chunkFrom, to: chunkTo }, {
      includeCancelled: true,
      maxOccurrences: EXPANSION_CHUNK_DAYS + 2,
    })
    for (const occurrence of chunk) {
      if (seen.has(occurrence.occurrenceDate)) continue
      seen.add(occurrence.occurrenceDate)
      result.push(occurrence)
    }

    if (chunkTo === window.to) break
    chunkFrom = `${addDaysToLocalDate(chunkLastDay, 1)} 00:00:00`
  }

  return result
}

export function toPublicAppointment(
  appointment: Pick<AppointmentSeries, 'id' | 'all_day' | 'recurrence_freq'>,
  occurrence: AppointmentOccurrence,
  timeZone: string,
): PublicAppointment {
  return {
    id: `${appointment.id}-${occurrence.occurrenceDate.replace(/\D/g, '').slice(0, 12)}`,
    appointmentId: Number(appointment.id),
    recurring: appointment.recurrence_freq != null,
    title: occurrence.title,
    startsAt: localDateTimeToOffsetIso(occurrence.startsAt, timeZone),
    endsAt: localDateTimeToOffsetIso(occurrence.endsAt, timeZone),
    startsAtLocal: occurrence.startsAt,
    endsAtLocal: occurrence.endsAt,
    allDay: Boolean(appointment.all_day),
    location: occurrence.location,
    cancelled: occurrence.isCancelled,
  }
}
