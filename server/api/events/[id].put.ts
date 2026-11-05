import { defineEventHandler, readBody } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { getNumericRouteParam } from '~/server/utils/api/request'
import { query, withAuditTransaction } from '~/server/utils/db'
import {
  normalizeEventPayload,
  syncEventCostCentreSplits,
  syncEventMemberOrganizers,
  syncEventSubdivisionOrganizers,
  validateEventPayload,
  validateEventRelations,
} from '~/server/utils/events'
import type { EventRow } from '~/types/event'
import { enqueueNotification, dropFutureReminders } from '~/server/utils/notifications/enqueue'
import { pickChangedFields } from '~/server/utils/notifications/changeDescription'
import { formatLocalDateTime } from '~/server/utils/notifications/render'
import { internalError } from '~/server/utils/api/errors'

interface UpdateEventSuccess {
  ok: true
}

interface UpdateEventError {
  ok: false
  error: string
}

export type UpdateEventResponse = UpdateEventSuccess | UpdateEventError

export default defineEventHandler(async (event): Promise<UpdateEventResponse> => {
  const current = await requirePermission(event, 'events.edit')
  if (!current.ok) return current

  const eventId = getNumericRouteParam(event)
  if (!eventId) return { ok: false, error: 'Invalid event id' }

  const body = normalizeEventPayload(await readBody(event))
  if (!body) return { ok: false, error: 'Invalid event data' }

  const validationError = validateEventPayload(body)
  if (validationError) return { ok: false, error: validationError }

  try {
    return await withAuditTransaction(current.user, async (conn) => {
      const existingRows = await query<EventRow[]>(
        `SELECT id, name, starts_at, ends_at, location, expected_guests
         FROM events
         WHERE id = ?
         LIMIT 1`,
        [eventId],
        conn,
      )

      const existing = existingRows[0]
      if (!existing) return { ok: false, error: 'Event not found' }

      const existingSplitRows = await query<{ id: number, sphere_id: number, cost_centre_id: number, allocation_percentage: number }[]>(
        `SELECT id, sphere_id, cost_centre_id, allocation_percentage
         FROM event_cost_centre_splits
         WHERE event_id = ?`,
        [eventId],
        conn,
      )

      const [memberRows, subdivisionRows] = await Promise.all([
        query<{ member_id: number }[]>(
          `SELECT member_id
           FROM event_member_organizers
           WHERE event_id = ?`,
          [eventId],
          conn,
        ),
        query<{ subdivision_id: number }[]>(
          `SELECT subdivision_id
           FROM event_subdivision_organizers
           WHERE event_id = ?`,
          [eventId],
          conn,
        ),
      ])

      const relationError = await validateEventRelations(
        body,
        conn,
        subdivisionRows.map(row => Number(row.subdivision_id)),
        existingSplitRows.map(row => ({
          itemId: Number(row.id),
          sphereId: Number(row.sphere_id),
          costCentreId: Number(row.cost_centre_id),
        })),
      )
      if (relationError) return { ok: false, error: relationError }

      await query(
        `UPDATE events
         SET name = ?, starts_at = ?, ends_at = ?, location = ?, expected_guests = ?
         WHERE id = ?`,
        [
          body.name,
          body.starts_at,
          body.ends_at,
          body.location,
          body.expected_guests,
          eventId,
        ],
        conn,
      )

      await syncEventMemberOrganizers({
        eventId,
        existingIds: memberRows.map(row => Number(row.member_id)),
        nextIds: body.member_organizer_ids,
        conn,
      })
      await syncEventSubdivisionOrganizers({
        eventId,
        existingIds: subdivisionRows.map(row => Number(row.subdivision_id)),
        nextIds: body.subdivision_organizer_ids,
        conn,
      })
      await syncEventCostCentreSplits({
        eventId,
        existingRows: existingSplitRows.map(row => ({
          id: Number(row.id),
          sphere_id: Number(row.sphere_id),
          cost_centre_id: Number(row.cost_centre_id),
          allocation_percentage: Number(row.allocation_percentage),
        })),
        nextRows: body.cost_centre_splits,
        conn,
      })

      const timingChanged = String(existing.starts_at) !== body.starts_at
        || String(existing.ends_at) !== body.ends_at
        || String(existing.location ?? '') !== String(body.location ?? '')

      if (timingChanged) {
        const changes = pickChangedFields([
          { field: 'start', from: formatLocalDateTime(existing.starts_at), to: formatLocalDateTime(body.starts_at) },
          { field: 'end', from: formatLocalDateTime(existing.ends_at), to: formatLocalDateTime(body.ends_at) },
          { field: 'location', from: existing.location, to: body.location },
        ])

        await enqueueNotification({
          type: 'event.changed',
          payload: {
            event_id: eventId,
            event_name: body.name,
            event_start: body.starts_at,
            event_end: body.ends_at,
            location: body.location,
            changes,
          },
          recipients: { kind: 'eventParticipants', eventId },
          createdByUserId: current.user.id,
        }, conn)
        await dropFutureReminders({ type: 'event.reminder', entityId: eventId }, conn)
      }

      return { ok: true }
    })
  } catch (err: any) {
    return internalError('Failed to update event', err)
  }
})
