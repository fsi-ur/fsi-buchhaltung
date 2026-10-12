import { useI18n } from '~/composables/useI18n'
import { useLocaleFormatters } from '~/composables/useLocaleFormatters'
import { NOTIFICATION_TYPE_MAP, type NotificationTypeKey } from '~/config/notificationTypes'
import type { NotificationChannelKey } from '~/config/notificationChannels'
import { localDateTimeToInstant, normalizeLocalDateTime, parseInstant } from '~/shared/time'

type BadgeTone = 'base' | 'warning' | 'success' | 'dangerCancelled' | 'danger' | 'baseMuted'

/**
 * Anchor id of the personal preference matrix in the general settings tab, and the `section`
 * page-meta value that scrolls to it (there are no routes, so this is our fragment link).
 */
export const NOTIFICATION_PREFERENCES_SECTION = 'notification-preferences'

/** Icon per notification type — falls back to the bell for keys the registry does not know. */
const TYPE_ICONS: Record<NotificationTypeKey, string> = {
  'shift.assigned': 'material-symbols:person-add-rounded',
  'shift.removed': 'material-symbols:person-off-outline-rounded',
  'shift.changed': 'material-symbols:edit-calendar-rounded',
  'shift.reminder': 'material-symbols:alarm-rounded',
  'shift.understaffed': 'material-symbols:warning-rounded',
  'task.assigned': 'material-symbols:add-task-rounded',
  'task.deadline_reminder': 'material-symbols:hourglass-top-rounded',
  'task.overdue': 'material-symbols:error-outline-rounded',
  'event.created': 'material-symbols:event-rounded',
  'event.changed': 'material-symbols:edit-calendar-rounded',
  'event.reminder': 'material-symbols:event-upcoming-rounded',
  'appointment.invited': 'material-symbols:event-note-rounded',
  'appointment.changed': 'material-symbols:edit-calendar-rounded',
  'appointment.cancelled': 'material-symbols:event-busy-rounded',
  'appointment.reminder': 'material-symbols:alarm-rounded',
  'member.welcome_active': 'material-symbols:waving-hand-rounded',
  'member.welcome_passive': 'material-symbols:waving-hand-outline',
  'custom.message': 'material-symbols:campaign-rounded',
}

/** Colour per category so the bell and the inbox stay readable at a glance. */
const CATEGORY_COLORS: Record<string, string> = {
  'notifications.categories.shifts': 'bg-info-100 text-info-700',
  'notifications.categories.tasks': 'bg-warning-100 text-warning-700',
  'notifications.categories.events': 'bg-accent-100 text-accent-700',
  'notifications.categories.appointments': 'bg-secondary-100 text-secondary-700',
  'notifications.categories.members': 'bg-success-100 text-success-700',
  'notifications.categories.custom': 'bg-base-200 text-base-700',
}

const CHANNEL_ICONS: Record<NotificationChannelKey, string> = {
  in_app: 'material-symbols:notifications-rounded',
  email: 'material-symbols:mail-rounded',
  push: 'material-symbols:phonelink-ring-rounded',
}

const NOTIFICATION_STATUS_TONES: Record<string, BadgeTone> = {
  scheduled: 'warning',
  sent: 'success',
  partially_failed: 'danger',
  cancelled: 'baseMuted',
  pending: 'warning',
  failed: 'danger',
  skipped: 'baseMuted',
}

export function useNotificationDisplay() {
  const { t } = useI18n()
  const { formatDateTime } = useLocaleFormatters()
  const { timeZone } = useAppTimeZone()

  function toInstant(value: string): Date | null {
    const instant = parseInstant(value)
    if (instant) return instant
    const local = normalizeLocalDateTime(value)
    return local ? localDateTimeToInstant(local, timeZone.value) : null
  }

  function typeIcon(typeKey: NotificationTypeKey) {
    return TYPE_ICONS[typeKey] || 'material-symbols:notifications-rounded'
  }

  function typeColorClass(typeKey: NotificationTypeKey) {
    const categoryKey = NOTIFICATION_TYPE_MAP[typeKey]?.categoryKey
    return (categoryKey && CATEGORY_COLORS[categoryKey]) || 'bg-base-200 text-base-700'
  }

  function typeLabel(typeKey: NotificationTypeKey) {
    const definition = NOTIFICATION_TYPE_MAP[typeKey]
    return definition ? t(definition.labelKey) : typeKey
  }

  function typeDescription(typeKey: NotificationTypeKey) {
    const definition = NOTIFICATION_TYPE_MAP[typeKey]
    return definition ? t(definition.descriptionKey) : ''
  }

  function categoryLabel(typeKey: NotificationTypeKey) {
    const categoryKey = NOTIFICATION_TYPE_MAP[typeKey]?.categoryKey
    return categoryKey ? t(categoryKey) : ''
  }

  function channelIcon(channel: NotificationChannelKey) {
    return CHANNEL_ICONS[channel] || 'material-symbols:notifications-rounded'
  }

  function channelLabel(channel: NotificationChannelKey) {
    return t(`notifications.channels.${channel}`)
  }

  /** What a `{variable}` placeholder is filled in with — shown as a tooltip wherever a variable chip is offered. */
  function variableDescription(variable: string) {
    return t(`notifications.compose.variableDescriptions.${variable}`)
  }

  /** `scheduled` | `sent` | … — accepts both the snake_case DB values and camelCase. */
  function statusLabel(status: string) {
    return t(`notifications.status.${status.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())}`)
  }

  function statusTone(status: string): BadgeTone {
    return NOTIFICATION_STATUS_TONES[status] || 'baseMuted'
  }

  function relativeTime(value: string) {
    const date = toInstant(value)
    if (!date) return ''
    const minutes = Math.floor((Date.now() - date.getTime()) / 60000)
    if (minutes < 1) return t('notifications.relativeTime.now')
    if (minutes < 60) return t('notifications.relativeTime.minutes', { count: minutes })
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return t('notifications.relativeTime.hours', { count: hours })
    const days = Math.floor(hours / 24)
    if (days < 7) return t('notifications.relativeTime.days', { count: days })
    return formatDateTime(value)
  }

  /** Absolute timestamp for tooltips — plain string reformat, no timezone shift. */
  function absoluteTime(value: string) {
    return formatDateTime(value)
  }

  /**
   * When the recipient actually got it: the delivery's `sent_at`. A notification can be enqueued
   * days earlier (reminders) or sit in the queue, so neither `created_at` nor `scheduled_for` is
   * the right basis for "x minutes ago" — they only stand in while the delivery is still pending.
   */
  function receivedAt(item: { sentAt: string | null, createdAt: string }) {
    return item.sentAt || item.createdAt
  }

  /** `scheduled_for` is stored as association-local wall clock, so no timezone shift. */
  function scheduledTime(value: string) {
    return formatDateTime(value)
  }

  function formatLeadMinutes(minutes: number) {
    if (minutes % 1440 === 0) return t('settings.notifications.leadDays', { count: minutes / 1440 })
    if (minutes % 60 === 0) return t('settings.notifications.leadHours', { count: minutes / 60 })
    return t('settings.notifications.leadMinutes', { count: minutes })
  }

  return {
    typeIcon,
    typeColorClass,
    typeLabel,
    typeDescription,
    categoryLabel,
    channelIcon,
    channelLabel,
    variableDescription,
    statusLabel,
    statusTone,
    relativeTime,
    absoluteTime,
    receivedAt,
    scheduledTime,
    formatLeadMinutes,
  }
}
