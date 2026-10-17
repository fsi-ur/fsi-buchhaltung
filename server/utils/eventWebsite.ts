import type mariadb from 'mariadb'
import { query } from '~/server/utils/db'
import {
  addDaysToLocalDate,
  isLocalDate,
  localDateTimeToOffsetIso,
  normalizeLocalDateTime,
  type LocalDateTime,
} from '~/shared/time'
import type { EventWebsiteSettings, PublicEvent } from '~/types/event'

export const WEBSITE_TITLE_MAX_LENGTH = 255
export const WEBSITE_DESCRIPTION_MAX_LENGTH = 20000

export const PUBLIC_EVENTS_DEFAULT_LIMIT = 100
export const PUBLIC_EVENTS_MAX_LIMIT = 500

interface EventWebsiteRow {
  website_published: number
  website_visible_from: string | null
  website_title: string | null
  website_description: string | null
}

function optionalText(value: unknown): string | null {
  if (value == null) return null
  const text = String(value).trim()
  return text || null
}

export function normalizeEventWebsitePayload(value: unknown): EventWebsiteSettings | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Record<string, unknown>

  const visibleFromRaw = String(input.visible_from ?? '').trim()
  const visibleFrom = visibleFromRaw ? normalizeLocalDateTime(visibleFromRaw) : null
  if (visibleFromRaw && !visibleFrom) return null

  return {
    published: input.published === true || input.published === 1 || input.published === '1',
    visible_from: visibleFrom,
    title: optionalText(input.title),
    // Keep the author's line breaks/indentation (Markdown), only trim the outer whitespace.
    description: optionalText(input.description),
  }
}

export function validateEventWebsitePayload(body: EventWebsiteSettings): string | null {
  if (body.title && body.title.length > WEBSITE_TITLE_MAX_LENGTH) return `The public title may be at most ${WEBSITE_TITLE_MAX_LENGTH} characters long`
  if (body.description && body.description.length > WEBSITE_DESCRIPTION_MAX_LENGTH) return `The public description may be at most ${WEBSITE_DESCRIPTION_MAX_LENGTH} characters long`
  return null
}

export async function loadEventWebsiteSettings(eventId: number, conn?: mariadb.PoolConnection): Promise<EventWebsiteSettings | null> {
  const rows = await query<EventWebsiteRow[]>(
    `SELECT website_published, website_visible_from, website_title, website_description
     FROM events
     WHERE id = ?
     LIMIT 1`,
    [eventId],
    conn,
  )
  const row = rows[0]
  if (!row) return null

  return {
    published: Boolean(Number(row.website_published)),
    visible_from: row.website_visible_from != null ? String(row.website_visible_from) : null,
    title: row.website_title != null ? String(row.website_title) : null,
    description: row.website_description != null ? String(row.website_description) : null,
  }
}

export async function saveEventWebsiteSettings(eventId: number, body: EventWebsiteSettings, conn: mariadb.PoolConnection) {
  await query(
    `UPDATE events
     SET website_published = ?, website_visible_from = ?, website_title = ?, website_description = ?
     WHERE id = ?`,
    [body.published ? 1 : 0, body.visible_from, body.title, body.description, eventId],
    conn,
  )
}

export interface PublicEventsQuery {
  /** Lower bound on the event's end (wall clock); events that ended before it are left out. */
  endsAfter: LocalDateTime
  /** Exclusive upper bound on the event's start (wall clock), or no bound. */
  startsBefore: LocalDateTime | null
  limit: number
  order: 'asc' | 'desc'
}

/**
 * Turns the query string into the filter. `from`/`to` are calendar days (inclusive) in the app time
 * zone; without `from` only events that haven't ended yet are returned.
 */
export function parsePublicEventsQuery(
  params: Record<string, unknown>,
  now: LocalDateTime,
): { ok: true, query: PublicEventsQuery } | { ok: false, error: string } {
  const single = (value: unknown) => (Array.isArray(value) ? value[0] : value)
  const from = single(params.from)
  const to = single(params.to)
  const limitRaw = single(params.limit)
  const orderRaw = single(params.order)

  if (from != null && from !== '' && !isLocalDate(from)) return { ok: false, error: 'Invalid "from" date, expected YYYY-MM-DD' }
  if (to != null && to !== '' && !isLocalDate(to)) return { ok: false, error: 'Invalid "to" date, expected YYYY-MM-DD' }
  if (isLocalDate(from) && isLocalDate(to) && from > to) return { ok: false, error: '"from" must be on or before "to"' }

  let limit = PUBLIC_EVENTS_DEFAULT_LIMIT
  if (limitRaw != null && limitRaw !== '') {
    const parsed = Number(limitRaw)
    if (!Number.isInteger(parsed) || parsed < 1) return { ok: false, error: 'Invalid "limit", expected a positive integer' }
    limit = Math.min(parsed, PUBLIC_EVENTS_MAX_LIMIT)
  }

  let order: 'asc' | 'desc' = 'asc'
  if (orderRaw != null && orderRaw !== '') {
    if (orderRaw !== 'asc' && orderRaw !== 'desc') return { ok: false, error: 'Invalid "order", expected "asc" or "desc"' }
    order = orderRaw
  }

  return {
    ok: true,
    query: {
      endsAfter: isLocalDate(from) ? `${from} 00:00:00` : now,
      startsBefore: isLocalDate(to) ? `${addDaysToLocalDate(to, 1)} 00:00:00` : null,
      limit,
      order,
    },
  }
}

interface PublicEventRow {
  id: number
  name: string
  website_title: string | null
  website_description: string | null
  starts_at: string
  ends_at: string
  location: string | null
}

/** Published events whose publish window has opened (`now` = app wall clock) and that match the filter. */
export async function loadPublicEvents(filter: PublicEventsQuery, now: LocalDateTime, timeZone: string): Promise<PublicEvent[]> {
  const conditions = [
    'e.website_published = 1',
    '(e.website_visible_from IS NULL OR e.website_visible_from <= ?)',
    'e.ends_at >= ?',
  ]
  const params: unknown[] = [now, filter.endsAfter]
  if (filter.startsBefore) {
    conditions.push('e.starts_at < ?')
    params.push(filter.startsBefore)
  }

  const direction = filter.order === 'desc' ? 'DESC' : 'ASC'
  const rows = await query<PublicEventRow[]>(
    `SELECT e.id, e.name, e.website_title, e.website_description, e.starts_at, e.ends_at, e.location
     FROM events e
     WHERE ${conditions.join(' AND ')}
     ORDER BY e.starts_at ${direction}, e.id ${direction}
     LIMIT ?`,
    [...params, filter.limit],
  )

  if (!rows.length) return []

  const eventIds = rows.map(row => Number(row.id))
  const subdivisionRows = await query<{ event_id: number, code: string, name: string }[]>(
    `SELECT eso.event_id, s.code, s.name
     FROM event_subdivision_organizers eso
     JOIN subdivisions s ON s.id = eso.subdivision_id
     WHERE eso.event_id IN (${eventIds.map(() => '?').join(',')})
     ORDER BY s.code ASC, s.name ASC`,
    eventIds,
  )

  const organizers = new Map<number, PublicEvent['organizers']>()
  for (const row of subdivisionRows) {
    const list = organizers.get(Number(row.event_id)) ?? []
    list.push({ code: String(row.code), name: String(row.name) })
    organizers.set(Number(row.event_id), list)
  }

  return rows.map(row => toPublicEvent(row, organizers.get(Number(row.id)) ?? [], timeZone))
}

export function toPublicEvent(row: PublicEventRow, organizers: PublicEvent['organizers'], timeZone: string): PublicEvent {
  const startsAt = String(row.starts_at)
  const endsAt = String(row.ends_at)
  return {
    id: Number(row.id),
    title: row.website_title?.trim() || String(row.name),
    description: row.website_description != null ? String(row.website_description) : null,
    startsAt: localDateTimeToOffsetIso(startsAt, timeZone),
    endsAt: localDateTimeToOffsetIso(endsAt, timeZone),
    startsAtLocal: startsAt,
    endsAtLocal: endsAt,
    location: row.location != null ? String(row.location) : null,
    organizers,
  }
}
