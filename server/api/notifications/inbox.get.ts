import { defineEventHandler, getQuery } from 'h3'
import { requireAuth } from '~/server/utils/api/guards'
import { query } from '~/server/utils/db'
import { getNotificationSettings } from '~/server/utils/notifications/settings'
import { NOTIFICATION_ENTITY_TYPE } from '~/server/utils/notifications/attachments'
import { loadAttachmentItems, loadAttachmentSelections, mergeAttachmentSelections } from '~/server/utils/attachments'
import type { NotificationTypeKey } from '~/config/notificationTypes'
import type { AttachmentItem, AttachmentSelection } from '~/types/attachment'
import type { NotificationInboxItem } from '~/types/notification'

interface GetInboxSuccess {
  ok: true
  items: NotificationInboxItem[]
  unreadCount: number
}

interface GetInboxError {
  ok: false
  error: string
}

export type GetNotificationInboxResponse = GetInboxSuccess | GetInboxError

export default defineEventHandler(async (event): Promise<GetNotificationInboxResponse> => {
  const current = await requireAuth(event)
  if (!current.ok) return current

  const q = getQuery(event)
  const limit = Math.min(Math.max(Number(q.limit) || 20, 1), 100)
  const unreadOnly = q.unreadOnly === 'true' || q.unreadOnly === '1'
  const before = q.before ? Number(q.before) : null

  const conditions = ['nd.user_id = ?', `nd.channel = 'in_app'`, `nd.status != 'skipped'`]
  const params: unknown[] = [current.user.id]

  if (unreadOnly) conditions.push('nd.read_at IS NULL')
  if (before) {
    conditions.push('nd.id < ?')
    params.push(before)
  }

  const rows = await query<Array<{
    id: number
    notification_id: number
    type_key: string
    subject: string
    body: string
    link_page: string | null
    link_meta: string | null
    created_at: string
    sent_at: string | null
    read_at: string | null
  }>>(
    // `sent_at` is when the delivery actually went out — that, not the enqueue time, is what "3 min
    // ago" should count from for a notification that sat in the queue or was scheduled ahead.
    `SELECT nd.id, nd.notification_id, n.type_key, nd.subject, nd.body, n.link_page, n.link_meta, n.created_at, nd.sent_at, nd.read_at
     FROM notification_deliveries nd
     JOIN notifications n ON n.id = nd.notification_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY nd.id DESC
     LIMIT ?`,
    [...params, limit],
  )

  const attachmentsByNotification = new Map<number, AttachmentItem[]>()
  if (rows.length) {
    const settings = await getNotificationSettings()
    const ownSelections = await loadAttachmentSelections(NOTIFICATION_ENTITY_TYPE, [...new Set(rows.map(row => row.notification_id))])

    const selections = new Map<number, AttachmentSelection>()
    for (const row of rows) {
      if (selections.has(row.notification_id)) continue
      selections.set(row.notification_id, mergeAttachmentSelections(
        ownSelections.get(row.notification_id),
        settings.template_attachments[row.type_key as NotificationTypeKey],
      ))
    }

    const items = await loadAttachmentItems(mergeAttachmentSelections(...selections.values()))
    const byKey = new Map(items.map(item => [item.key, item]))

    for (const [notificationId, selection] of selections) {
      const resolved = [
        ...selection.documentIds.map(id => byKey.get(`document:${id}`)),
        ...selection.fileIds.map(id => byKey.get(`file:${id}`)),
      ].filter((item): item is AttachmentItem => Boolean(item) && !item!.unavailable)
      if (resolved.length) attachmentsByNotification.set(notificationId, resolved)
    }
  }

  const unreadCountRows = await query<Array<{ unreadCount: number }>>(
    `SELECT COUNT(*) AS unreadCount
     FROM notification_deliveries
     WHERE user_id = ? AND channel = 'in_app' AND status != 'skipped' AND read_at IS NULL`,
    [current.user.id],
  )
  const unreadCount = unreadCountRows[0]?.unreadCount ?? 0

  return {
    ok: true,
    items: rows.map(row => ({
      deliveryId: row.id,
      notificationId: row.notification_id,
      typeKey: row.type_key as NotificationInboxItem['typeKey'],
      subject: row.subject,
      body: row.body,
      linkPage: row.link_page,
      linkMeta: row.link_meta ? JSON.parse(row.link_meta) : null,
      createdAt: row.created_at,
      sentAt: row.sent_at,
      readAt: row.read_at,
      attachments: attachmentsByNotification.get(row.notification_id) ?? [],
    })),
    unreadCount: Number(unreadCount),
  }
})
