import type { NotificationChannelKey } from '~/config/notificationChannels'
import type { GetNotificationStatusResponse } from '~/server/api/notifications/status.get'

interface MailStatus {
  enabled: boolean
  smtpConfigured: boolean
  pushConfigured: boolean
  channelsEnabled: Record<NotificationChannelKey, boolean>
}

const status = ref<MailStatus | null>(null)
let inflight: Promise<void> | null = null
let loaded = false

async function fetchStatus() {
  try {
    const res = await $fetch<GetNotificationStatusResponse>('/api/notifications/status')
    status.value = res.ok
      ? {
          enabled: res.enabled,
          smtpConfigured: res.smtpConfigured,
          pushConfigured: res.pushConfigured,
          channelsEnabled: res.channelsEnabled,
        }
      : null
    loaded = true
  } catch {
    status.value = null
  } finally {
    inflight = null
  }
}

export function useNotificationMailStatus() {
  const { t } = useI18n()

  function ensureLoaded() {
    if (loaded) return Promise.resolve()
    inflight ??= fetchStatus()
    return inflight
  }

  function refresh() {
    loaded = false
    inflight = fetchStatus()
    return inflight
  }

  const notificationsDisabled = computed(() => status.value !== null && !status.value.enabled)

  function channelBlockedReason(channel: NotificationChannelKey): string | null {
    if (!status.value || channel === 'in_app') return null
    if (!status.value.enabled) return t('notifications.mailStatus.disabled')
    if (!status.value.channelsEnabled[channel]) return t('notifications.mailStatus.channelOff')
    if (channel === 'email' && !status.value.smtpConfigured) return t('notifications.mailStatus.smtpMissing')
    if (channel === 'push' && !status.value.pushConfigured) return t('notifications.mailStatus.pushMissing')
    return null
  }

  const mailBlockedReason = computed(() => channelBlockedReason('email'))

  return { status, ensureLoaded, refresh, notificationsDisabled, mailBlockedReason, channelBlockedReason }
}
