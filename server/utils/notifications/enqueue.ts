import { query } from '~/server/utils/db'
import { NOTIFICATION_TYPE_MAP, type NotificationTypeKey } from '~/config/notificationTypes'
import type { NotificationChannelKey } from '~/config/notificationChannels'
import type { RecipientRule, DbConn } from '~/server/utils/notifications/types'
import { getNotificationSettings, isTypeEnabled } from '~/server/utils/notifications/settings'
import { localWallClockNow } from '~/server/utils/notifications/time'
import { requestImmediateDispatch } from '~/server/utils/notifications/dispatchTrigger'
import { saveNotificationAttachments } from '~/server/utils/notifications/attachments'
import type { AttachmentSelection } from '~/types/attachment'

export interface EnqueueNotificationArgs {
  type: NotificationTypeKey
  payload: Record<string, any>
  recipients: RecipientRule
  scheduledFor?: Date | string | null
  createdByUserId?: number | null
  dedupeKey?: string | null
  channels?: NotificationChannelKey[]
  subjectOverride?: string | null
  bodyOverride?: string | null
  attachments?: AttachmentSelection
  queueWhileDisabled?: boolean
}

export type EnqueueNotificationResult = { ok: true, id: number } | { ok: false, error: string }

/**
 * `scheduledFor` is either a Date already expressed in the notifications module's pretend-UTC
 * wall-clock frame (see dispatch.ts), or a plain "YYYY-MM-DD HH:mm[:ss]" string coming straight
 * from a client date/time picker. Both represent the association's local time with no timezone
 * conversion (matching every other DATETIME column in the app), so a string is passed through
 * unchanged rather than round-tripped through `new Date()` — that would apply whatever timezone
 * the Node process happens to run in and silently shift the value.
 */
function toMysqlDatetime(value: Date | string): string {
  if (typeof value === 'string') {
    const match = value.trim().replace('T', ' ').match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(:\d{2})?/)
    if (match) return `${match[1]} ${match[2]}${match[3] || ':00'}`
    return value.trim().slice(0, 19)
  }
  return value.toISOString().slice(0, 19).replace('T', ' ')
}

export async function enqueueNotification(args: EnqueueNotificationArgs, conn?: DbConn): Promise<EnqueueNotificationResult> {
  const definition = NOTIFICATION_TYPE_MAP[args.type]
  if (!definition) return { ok: false, error: `Unbekannter Benachrichtigungstyp: ${args.type}` }
  if (!args.payload || typeof args.payload !== 'object') return { ok: false, error: 'Ungültige Nutzdaten' }

  // Switched off association-wide: don't even create the row, so the outbox is not littered with
  // notifications that would reach nobody.
  const settings = await getNotificationSettings(conn)
  if (!settings.notifications_enabled && !args.queueWhileDisabled) return { ok: true, id: 0 }
  if (!isTypeEnabled(settings, args.type)) return { ok: true, id: 0 }

  // A missing scheduledFor means "as soon as the dispatcher runs", i.e. the current local wall
  // clock — NOT the database's NOW(), which is UTC (see time.ts) and would park an immediate
  // notification an hour or two in the future.
  const scheduledFor = args.scheduledFor ? toMysqlDatetime(args.scheduledFor) : localWallClockNow()
  const link = definition.link?.(args.payload) ?? null

  try {
    const result = await query<{ insertId: number }>(
      `INSERT INTO notifications
         (type_key, status, scheduled_for, created_at, created_by, recipient_rule, channels, payload,
          subject_override, body_override, link_page, link_meta, dedupe_key)
       VALUES (?, 'scheduled', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        args.type,
        scheduledFor,
        // Written explicitly rather than left to the column default: CURRENT_TIMESTAMP would be
        // UTC (the pool's session time zone) while every other notification timestamp is the
        // association's local wall clock.
        localWallClockNow(),
        args.createdByUserId ?? null,
        JSON.stringify(args.recipients),
        args.channels?.length ? args.channels.join(',') : null,
        JSON.stringify(args.payload),
        args.subjectOverride ?? null,
        args.bodyOverride ?? null,
        link?.page ?? null,
        link?.meta ? JSON.stringify(link.meta) : null,
        args.dedupeKey ?? null,
      ],
      conn,
    )
    const id = Number(result.insertId)
    if (args.attachments && (args.attachments.documentIds.length || args.attachments.fileIds.length)) {
      await saveNotificationAttachments(id, args.attachments, args.createdByUserId ?? null, conn)
    }

    // Due right away? Don't make it wait for the next periodic dispatch pass.
    if (scheduledFor <= localWallClockNow()) requestImmediateDispatch()

    return { ok: true, id }
  } catch (err: any) {
    if (err?.code === 'ER_DUP_ENTRY') return { ok: true, id: 0 }
    return { ok: false, error: `Benachrichtigung konnte nicht eingeplant werden: ${err}` }
  }
}

export async function cancelNotification(id: number, conn?: DbConn): Promise<{ ok: true } | { ok: false, error: string }> {
  const result = await query<{ affectedRows: number }>(
    `UPDATE notifications SET status = 'cancelled', cancelled_at = ? WHERE id = ? AND status = 'scheduled'`,
    [localWallClockNow(), id],
    conn,
  )
  if (!result.affectedRows) return { ok: false, error: 'Benachrichtigung ist bereits versendet oder existiert nicht.' }
  return { ok: true }
}

export async function dropFutureReminders(args: { type: NotificationTypeKey, entityId: number }, conn?: DbConn) {
  await query(
    `DELETE FROM notifications
     WHERE type_key = ? AND status = 'scheduled' AND dedupe_key LIKE ?`,
    [args.type, `${args.type}:${args.entityId}:%`],
    conn,
  )
}
