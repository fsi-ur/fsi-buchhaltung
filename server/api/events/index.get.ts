import { defineEventHandler } from 'h3'
import { hasPermission, requireAuth } from '~/server/utils/api/guards'
import { query } from '~/server/utils/db'
import { getOrganizerEventIds, isAnyEventOrganizer, loadEventRelations } from '~/server/utils/events'
import type { Event, EventRow } from '~/types/event'
import { internalError } from '~/server/utils/api/errors'

interface GetEventsSuccess {
  ok: true
  events: Event[]
  canOpenAll: boolean
  organizerEventIds: number[]
}

interface GetEventsError {
  ok: false
  error: string
}

export type GetEventsResponse = GetEventsSuccess | GetEventsError

export default defineEventHandler(async (event): Promise<GetEventsResponse> => {
  const current = await requireAuth(event)
  if (!current.ok) return current

  if (!hasPermission(current.user, ['events.access', 'events.view', 'events.shifts.signup']) && !await isAnyEventOrganizer(current.user.id)) {
    return { ok: false, error: 'Not authorized' }
  }

  const canOpenAll = hasPermission(current.user, ['events.view', 'events.edit', 'events.shifts.signup'])

  try {
    const [rows, organizerEventIds] = await Promise.all([
      query<EventRow[]>(
        `SELECT id, name, starts_at, ends_at, location, expected_guests
         FROM events
         ORDER BY starts_at DESC, ends_at DESC, name ASC`,
      ),
      canOpenAll ? Promise.resolve([]) : getOrganizerEventIds(current.user.id),
    ])

    const eventIds = rows.map(row => Number(row.id))
    const relations = await loadEventRelations(eventIds)

    return {
      ok: true,
      canOpenAll,
      organizerEventIds,
      events: rows.map(row => ({
        id: Number(row.id),
        name: String(row.name),
        starts_at: String(row.starts_at),
        ends_at: String(row.ends_at),
        location: row.location != null ? String(row.location) : null,
        expected_guests: row.expected_guests != null ? Number(row.expected_guests) : null,
        member_organizers: relations.memberOrganizers.get(Number(row.id)) ?? [],
        subdivision_organizers: relations.subdivisionOrganizers.get(Number(row.id)) ?? [],
        cost_centre_splits: relations.costCentreSplits.get(Number(row.id)) ?? [],
      })),
    }
  } catch (err: any) {
    return internalError('Failed to load events', err)
  }
})
