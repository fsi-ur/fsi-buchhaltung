import type { NotificationChannelKey } from '~/config/notificationChannels'
import type { NotificationTypeKey } from '~/config/notificationTypes'

/**
 * Global per-type switches. `enabled: false` silences the type for everyone; a `false` entry in
 * `channels` takes that one channel away from the type. Both outrank the personal preferences —
 * what the association switches off is off.
 */
export interface NotificationTypeSetting {
  enabled: boolean
  channels: Partial<Record<NotificationChannelKey, boolean>>
}

export interface NotificationSettings {
  notifications_enabled: boolean
  channels_enabled: Record<NotificationChannelKey, boolean>
  /** Only types the admin actually touched appear here; everything else follows its defaults. */
  type_settings: Partial<Record<NotificationTypeKey, NotificationTypeSetting>>
  default_channels: Partial<Record<NotificationTypeKey, Partial<Record<NotificationChannelKey, boolean>>>>
  lead_times: Partial<Record<NotificationTypeKey, number[]>>
  templates: Partial<Record<NotificationTypeKey, { subject: string, body: string }>>
  email_from_name: string
  email_subject_prefix: string
  email_footer: string
  quiet_hours: { enabled: boolean, start: string, end: string }
  /** How long the whole notification history (outbox + deliveries of every channel) is kept. */
  retention_days: number
  /** How long a message stays in the bell/inbox — usually much shorter than the history above. */
  inbox_retention_days: number
  /** When true, a member who responded "no" to an appointment occurrence is left out of reminders for it. */
  skip_declined_appointment_reminders: boolean
}

export interface NotificationInboxItem {
  deliveryId: number
  notificationId: number
  typeKey: NotificationTypeKey
  subject: string
  body: string
  linkPage: string | null
  linkMeta: Record<string, any> | null
  createdAt: string
  /** When the delivery actually went out; null while it is still pending. */
  sentAt: string | null
  readAt: string | null
}

export interface NotificationOutboxDeliveryCounts {
  sent: number
  failed: number
  pending: number
  skipped: number
}

export interface NotificationOutboxItem {
  id: number
  typeKey: NotificationTypeKey
  subject: string
  status: 'scheduled' | 'sent' | 'partially_failed' | 'cancelled'
  scheduledFor: string
  createdAt: string
  createdByUsername: string | null
  counts: NotificationOutboxDeliveryCounts
}

export interface NotificationDelivery {
  id: number
  channel: NotificationChannelKey
  status: 'pending' | 'sent' | 'failed' | 'skipped'
  recipientName: string
  address: string | null
  error: string | null
  sentAt: string | null
}

export interface NotificationOutboxDetail {
  id: number
  typeKey: NotificationTypeKey
  subject: string
  body: string
  status: 'scheduled' | 'sent' | 'partially_failed' | 'cancelled'
  scheduledFor: string
  /** The stored recipient rule, so a custom message can be duplicated with its audience intact. */
  recipientRule: Record<string, any> | null
  /** Explicit channel selection of a custom message; null means "follow the defaults". */
  channels: NotificationChannelKey[] | null
  deliveries: NotificationDelivery[]
}

export interface NotificationPreferenceEntry {
  typeKey: NotificationTypeKey
  channel: NotificationChannelKey
  effective: boolean
  isOverride: boolean
  /** Switched off globally in the association settings — the personal choice cannot re-enable it. */
  blocked: boolean
}

export interface CustomNotificationDraft {
  subject: string
  body: string
  memberIds: number[]
  subdivisionIds: number[]
  userIds: number[]
  allActiveMembers: boolean
  channels: NotificationChannelKey[]
  scheduledFor: string | null
}
