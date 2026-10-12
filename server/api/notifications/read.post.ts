import { defineEventHandler, readBody } from 'h3'
import { requireAuth } from '~/server/utils/api/guards'
import { query } from '~/server/utils/db'
import { localWallClockNow } from '~/server/utils/notifications/time'

interface MarkReadSuccess { ok: true }
interface MarkReadError { ok: false, error: string }
export type MarkNotificationsReadResponse = MarkReadSuccess | MarkReadError

export default defineEventHandler(async (event): Promise<MarkNotificationsReadResponse> => {
  const current = await requireAuth(event, { touch: false })
  if (!current.ok) return current

  const body = await readBody<{ ids?: number[], all?: boolean }>(event)

  // Local wall clock, like every other notification timestamp (see server/utils/notifications/time.ts).
  const readAt = await localWallClockNow()

  if (body?.all) {
    await query(
      `UPDATE notification_deliveries SET read_at = ? WHERE user_id = ? AND channel = 'in_app' AND read_at IS NULL`,
      [readAt, current.user.id],
    )
    return { ok: true }
  }

  const ids = Array.isArray(body?.ids) ? body.ids.map(Number).filter(id => Number.isInteger(id)) : []
  if (!ids.length) return { ok: false, error: 'Keine Benachrichtigungen ausgewählt' }

  await query(
    `UPDATE notification_deliveries
     SET read_at = ?
     WHERE user_id = ? AND channel = 'in_app' AND id IN (${ids.map(() => '?').join(',')})`,
    [readAt, current.user.id, ...ids],
  )

  return { ok: true }
})
