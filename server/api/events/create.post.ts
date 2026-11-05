import { defineEventHandler, readBody } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { query, withAuditTransaction } from '~/server/utils/db'
import {
  normalizeEventPayload,
  syncEventCostCentreSplits,
  syncEventMemberOrganizers,
  syncEventSubdivisionOrganizers,
  validateEventPayload,
  validateEventRelations,
} from '~/server/utils/events'
import { enqueueNotification } from '~/server/utils/notifications/enqueue'
import { internalError } from '~/server/utils/api/errors'

interface CreateEventSuccess {
  ok: true
  eventId: number
}

interface CreateEventError {
  ok: false
  error: string
}

export type CreateEventResponse = CreateEventSuccess | CreateEventError

export default defineEventHandler(async (event): Promise<CreateEventResponse> => {
  const current = await requirePermission(event, 'events.edit')
  if (!current.ok) return current

  const body = normalizeEventPayload(await readBody(event))
  if (!body) return { ok: false, error: 'Invalid event data' }

  const validationError = validateEventPayload(body)
  if (validationError) return { ok: false, error: validationError }

  try {
    return await withAuditTransaction(current.user, async (conn) => {
      const relationError = await validateEventRelations(body, conn)
      if (relationError) return { ok: false, error: relationError }

      const result: any = await query(
        `INSERT INTO events (name, starts_at, ends_at, location, expected_guests)
         VALUES (?, ?, ?, ?, ?)`,
        [
          body.name,
          body.starts_at,
          body.ends_at,
          body.location,
          body.expected_guests,
        ],
        conn,
      )

      const eventId = Number(result.insertId)

      await syncEventMemberOrganizers({
        eventId,
        existingIds: [],
        nextIds: body.member_organizer_ids,
        conn,
      })
      await syncEventSubdivisionOrganizers({
        eventId,
        existingIds: [],
        nextIds: body.subdivision_organizer_ids,
        conn,
      })
      await syncEventCostCentreSplits({
        eventId,
        existingRows: [],
        nextRows: body.cost_centre_splits,
        conn,
      })

      await enqueueNotification({
        type: 'event.created',
        payload: { event_id: eventId, event_name: body.name, event_start: body.starts_at, event_end: body.ends_at, location: body.location },
        recipients: { kind: 'eventOrganizers', eventId },
        createdByUserId: current.user.id,
      }, conn)

      return { ok: true, eventId }
    })
  } catch (err: any) {
    return internalError('Failed to create event', err)
  }
})
