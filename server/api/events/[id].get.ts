import { defineEventHandler } from 'h3'
import { hasPermission, requireAuth } from '~/server/utils/api/guards'
import { getNumericRouteParam } from '~/server/utils/api/request'
import { query } from '~/server/utils/db'
import { isEventOrganizer, loadEventRelations } from '~/server/utils/events'
import type { Event, EventRow } from '~/types/event'
import { internalError } from '~/server/utils/api/errors'

interface GetEventSuccess {
  ok: true
  event: Event
  isOrganizer: boolean
  canEditDetails: boolean
  canViewAll: boolean
}

interface GetEventError {
  ok: false
  error: string
}

export type GetEventResponse = GetEventSuccess | GetEventError

export default defineEventHandler(async (event): Promise<GetEventResponse> => {
  const current = await requireAuth(event)
  if (!current.ok) return current

  const eventId = getNumericRouteParam(event)
  if (!eventId) return { ok: false, error: 'Invalid event id' }

  try {
    const rows = await query<EventRow[]>(
      `SELECT id, name, starts_at, ends_at, location, expected_guests
       FROM events
       WHERE id = ?
       LIMIT 1`,
      [eventId],
    )

    const existing = rows[0]
    if (!existing) return { ok: false, error: 'Event not found' }

    const [relations, organizer] = await Promise.all([
      loadEventRelations([eventId]),
      isEventOrganizer(current.user.id, eventId),
    ])

    if (!hasPermission(current.user, ['events.access', 'events.view', 'events.shifts.signup']) && !organizer) {
      return { ok: false, error: 'Not authorized' }
    }

    return {
      ok: true,
      event: {
        id: Number(existing.id),
        name: String(existing.name),
        starts_at: String(existing.starts_at),
        ends_at: String(existing.ends_at),
        location: existing.location != null ? String(existing.location) : null,
        expected_guests: existing.expected_guests != null ? Number(existing.expected_guests) : null,
        member_organizers: relations.memberOrganizers.get(eventId) ?? [],
        subdivision_organizers: relations.subdivisionOrganizers.get(eventId) ?? [],
        cost_centre_splits: relations.costCentreSplits.get(eventId) ?? [],
      },
      isOrganizer: organizer,
      canEditDetails: hasPermission(current.user, 'events.edit'),
      canViewAll: hasPermission(current.user, 'events.view') || organizer,
    }
  } catch (err: any) {
    return internalError('Failed to load event', err)
  }
})
