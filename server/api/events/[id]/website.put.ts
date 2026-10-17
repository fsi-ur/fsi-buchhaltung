import { defineEventHandler, readBody } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { getNumericRouteParam } from '~/server/utils/api/request'
import { query, withAuditTransaction } from '~/server/utils/db'
import {
  normalizeEventWebsitePayload,
  saveEventWebsiteSettings,
  validateEventWebsitePayload,
} from '~/server/utils/eventWebsite'

interface UpdateEventWebsiteSuccess {
  ok: true
}

interface UpdateEventWebsiteError {
  ok: false
  error: string
}

export type UpdateEventWebsiteResponse = UpdateEventWebsiteSuccess | UpdateEventWebsiteError

export default defineEventHandler(async (event): Promise<UpdateEventWebsiteResponse> => {
  const current = await requirePermission(event, 'events.publish')
  if (!current.ok) return current

  const eventId = getNumericRouteParam(event)
  if (!eventId) return { ok: false, error: 'Invalid event id' }

  const body = normalizeEventWebsitePayload(await readBody(event))
  if (!body) return { ok: false, error: 'Invalid website data' }

  const validationError = validateEventWebsitePayload(body)
  if (validationError) return { ok: false, error: validationError }

  try {
    return await withAuditTransaction(current.user, async (conn) => {
      const rows = await query<{ id: number }[]>(`SELECT id FROM events WHERE id = ? LIMIT 1`, [eventId], conn)
      if (!rows[0]) return { ok: false, error: 'Event not found' }

      await saveEventWebsiteSettings(eventId, body, conn)
      return { ok: true }
    })
  } catch (err: any) {
    return { ok: false, error: `Failed to update website settings: ${err}` }
  }
})
