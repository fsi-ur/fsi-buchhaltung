import { defineEventHandler } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { getNumericRouteParam } from '~/server/utils/api/request'
import { query } from '~/server/utils/db'
import { getNotificationAttachments } from '~/server/utils/notifications/attachments'
import { loadAttachmentItems } from '~/server/utils/attachments'
import type { NotificationOutboxDetail } from '~/types/notification'

interface GetDetailSuccess { ok: true, notification: NotificationOutboxDetail }
interface GetDetailError { ok: false, error: string }
export type GetNotificationDetailResponse = GetDetailSuccess | GetDetailError

function parseRecipientRule(value: string): NotificationOutboxDetail['recipientRule'] {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

export default defineEventHandler(async (event): Promise<GetNotificationDetailResponse> => {
  const current = await requirePermission(event, 'notifications.view')
  if (!current.ok) return current

  const id = getNumericRouteParam(event)
  if (!id) return { ok: false, error: 'Invalid id' }

  const [notificationRow] = await query<Array<{ id: number, type_key: string, subject_override: string | null, body_override: string | null, status: string, scheduled_for: string, recipient_rule: string, channels: string | null }>>(
    `SELECT id, type_key, subject_override, body_override, status, scheduled_for, recipient_rule, channels
     FROM notifications WHERE id = ? LIMIT 1`,
    [id],
  )
  if (!notificationRow) return { ok: false, error: 'Nicht gefunden' }

  const deliveryRows = await query<Array<{ id: number, channel: string, status: string, address: string | null, error: string | null, sent_at: string | null, member_id: number | null, user_id: number | null, first_name: string | null, last_name: string | null, username: string | null }>>(
    `SELECT nd.id, nd.channel, nd.status, nd.address, nd.error, nd.sent_at, nd.member_id, nd.user_id, m.first_name, m.last_name, u.username
     FROM notification_deliveries nd
     LEFT JOIN members m ON m.id = nd.member_id
     LEFT JOIN users u ON u.id = nd.user_id
     WHERE nd.notification_id = ?
     ORDER BY nd.id ASC`,
    [id],
  )

  const attachments = await loadAttachmentItems(await getNotificationAttachments(id))

  return {
    ok: true,
    notification: {
      id: notificationRow.id,
      typeKey: notificationRow.type_key as NotificationOutboxDetail['typeKey'],
      subject: notificationRow.subject_override || '',
      body: notificationRow.body_override || '',
      status: notificationRow.status as NotificationOutboxDetail['status'],
      scheduledFor: notificationRow.scheduled_for,
      // Carried so "duplicate" can restore the recipients and channels the message was sent with,
      // not just its text.
      recipientRule: parseRecipientRule(notificationRow.recipient_rule),
      channels: notificationRow.channels ? notificationRow.channels.split(',') as NotificationOutboxDetail['channels'] : null,
      deliveries: deliveryRows.map(row => ({
        id: row.id,
        channel: row.channel as any,
        status: row.status as any,
        recipientName: row.first_name ? `${row.first_name} ${row.last_name}` : (row.username || '—'),
        address: row.address,
        error: row.error,
        sentAt: row.sent_at,
      })),
      attachments,
    },
  }
})
