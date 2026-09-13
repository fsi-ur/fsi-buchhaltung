import { localWallClockNow, shiftWallClock } from '~/server/utils/notifications/time'
import type { CustomNotificationDraft } from '~/types/notification'
import type { NotificationChannelKey } from '~/config/notificationChannels'
import { normalizeAttachmentSelection } from '~/server/utils/attachments'

const VALID_CHANNELS: NotificationChannelKey[] = ['in_app', 'email', 'push']

export interface ScheduleBounds {
  minAllowed: string
  maxAllowed: string
}

/**
 * Bounds for a user-picked send time. Derived from the association's local wall clock, not from
 * MySQL's `NOW()` — the pool runs in UTC (see notifications/time.ts), so NOW() would reject valid
 * times and accept ones already in the past by the UTC offset.
 */
export function getScheduleBounds(): ScheduleBounds {
  const now = localWallClockNow()
  return {
    minAllowed: shiftWallClock(now, -1),
    maxAllowed: shiftWallClock(now, 2 * 365 * 24 * 60),
  }
}

export function validateCustomNotification(input: Partial<CustomNotificationDraft>, bounds: ScheduleBounds): string | null {
  const subject = String(input.subject ?? '').trim()
  if (!subject || subject.length > 255) return 'Bitte einen Betreff (1–255 Zeichen) angeben.'

  const body = String(input.body ?? '').trim()
  if (!body) return 'Bitte eine Nachricht angeben.'

  const hasRecipients = input.allActiveMembers
    || (input.memberIds?.length ?? 0) > 0
    || (input.subdivisionIds?.length ?? 0) > 0
    || (input.userIds?.length ?? 0) > 0
  if (!hasRecipients) return 'Bitte mindestens einen Empfänger auswählen.'

  const channels = (input.channels ?? []).filter(channel => VALID_CHANNELS.includes(channel))
  if (!channels.length) return 'Bitte mindestens einen Kanal auswählen.'

  const attachments = normalizeAttachmentSelection(input.attachments, 'Nachricht')
  if (!attachments.ok) return attachments.error

  // `scheduledFor` and `bounds` are plain "YYYY-MM-DD HH:mm:ss" wall-clock strings in the
  // association's local time (see enqueue.ts) — compared lexically rather than via `new Date()` /
  // `Date.now()`, which would silently apply the Node process's own timezone instead.
  if (input.scheduledFor) {
    const scheduled = String(input.scheduledFor).trim().replace('T', ' ')
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(scheduled)) return 'Ungültiger Versandzeitpunkt.'
    const normalized = scheduled.length === 16 ? `${scheduled}:00` : scheduled
    if (normalized < bounds.minAllowed) return 'Der Versandzeitpunkt darf nicht in der Vergangenheit liegen.'
    if (normalized > bounds.maxAllowed) return 'Der Versandzeitpunkt darf höchstens 2 Jahre in der Zukunft liegen.'
  }

  return null
}
