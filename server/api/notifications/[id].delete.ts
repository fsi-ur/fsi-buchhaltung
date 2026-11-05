import { defineEventHandler } from 'h3'
import { hasPermission, requirePermission } from '~/server/utils/api/guards'
import { getNumericRouteParam } from '~/server/utils/api/request'
import { query, withAuditTransaction } from '~/server/utils/db'
import { cancelNotification } from '~/server/utils/notifications/enqueue'

interface CancelSuccess { ok: true }
interface CancelError { ok: false, error: string }
export type CancelNotificationResponse = CancelSuccess | CancelError

export default defineEventHandler(async (event): Promise<CancelNotificationResponse> => {
  const current = await requirePermission(event, 'notifications.send')
  if (!current.ok) return current

  const id = getNumericRouteParam(event)
  if (!id) return { ok: false, error: 'Invalid id' }

  // Senders cancel their own notifications; others' (incl. system ones) need
  // settings.notifications.manage (SEC-29, owner decision).
  if (!hasPermission(current.user, 'settings.notifications.manage')) {
    const [row] = await query<Array<{ created_by: number | null }>>('SELECT created_by FROM notifications WHERE id = ? LIMIT 1', [id])
    if (!row) return { ok: false, error: 'Benachrichtigung nicht gefunden.' }
    if (Number(row.created_by) !== Number(current.user.id)) {
      return { ok: false, error: 'Du kannst nur deine eigenen geplanten Benachrichtigungen abbrechen.' }
    }
  }

  return await withAuditTransaction(current.user, async conn => cancelNotification(id, conn))
})
