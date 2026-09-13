import { defineEventHandler } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { getNotificationSettings } from '~/server/utils/notifications/settings'
import type { NotificationChannelKey } from '~/config/notificationChannels'

interface NotificationStatusSuccess {
  ok: true
  enabled: boolean
  smtpConfigured: boolean
  pushConfigured: boolean
  channelsEnabled: Record<NotificationChannelKey, boolean>
}

interface NotificationStatusError { ok: false, error: string }

export type GetNotificationStatusResponse = NotificationStatusSuccess | NotificationStatusError

export default defineEventHandler(async (event): Promise<GetNotificationStatusResponse> => {
  const current = await requirePermission(event, ['notifications.send', 'settings.notifications.manage', 'members.edit'], { touch: false })
  if (!current.ok) return current

  const settings = await getNotificationSettings()

  return {
    ok: true,
    enabled: settings.notifications_enabled,
    smtpConfigured: Boolean(process.env.SMTP_HOST),
    pushConfigured: Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
    channelsEnabled: settings.channels_enabled,
  }
})
