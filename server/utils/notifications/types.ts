import type mariadb from 'mariadb'
import type { NotificationChannelKey } from '~/config/notificationChannels'
import type { NotificationSettings } from '~/types/notification'
import type { MailAttachment } from '~/server/utils/attachments'

export type RecipientRule =
  | { kind: 'members', memberIds: number[] }
  | { kind: 'users', userIds: number[] }
  | { kind: 'subdivisions', subdivisionIds: number[] }
  | { kind: 'shiftAssignees', shiftId: number }
  | { kind: 'taskAssignees', taskId: number }
  | { kind: 'eventOrganizers', eventId: number }
  | { kind: 'eventParticipants', eventId: number }
  | { kind: 'appointmentParticipants', appointmentId: number, occurrenceDate?: string }
  | { kind: 'permission', permission: string }
  | { kind: 'allActiveMembers' }
  | { kind: 'composite', rules: Exclude<RecipientRule, { kind: 'composite' }>[] }

export interface ResolvedRecipient {
  memberId: number | null
  userId: number | null
  email: string | null
  displayName: string
  firstName: string | null
  locale: 'de' | 'en'
}

export interface RenderedNotification {
  subject: string
  body: string
  link: { page: string, meta?: Record<string, any> } | null
}

export interface NotificationChannel {
  key: NotificationChannelKey
  isConfigured(settings: NotificationSettings): boolean
  addressFor(recipient: ResolvedRecipient): string | null
  send(args: {
    recipient: ResolvedRecipient
    rendered: RenderedNotification
    deliveryId: number
    settings: NotificationSettings
    unsubscribeToken?: string | null
    attachments?: MailAttachment[]
  }): Promise<void>
}

export type DbConn = mariadb.PoolConnection
