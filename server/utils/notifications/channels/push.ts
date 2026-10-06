import webpush from 'web-push'
import { query } from '~/server/utils/db'
import { localWallClockNow } from '~/server/utils/notifications/time'
import type { NotificationChannel } from '~/server/utils/notifications/types'
import { stripNotificationFormatting } from '~/utils/notificationFormatting'

let vapidConfigured = false

function ensureVapidConfigured() {
  if (vapidConfigured) return
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  if (!publicKey || !privateKey) return
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', publicKey, privateKey)
  vapidConfigured = true
}

function buildDeepLinkUrl(link: { page: string, meta?: Record<string, any> } | null): string | undefined {
  if (!link) return undefined
  const base = (process.env.APP_BASE_URL || '/').replace(/\/$/, '')
  const metaEntries = Object.entries(link.meta || {}).filter(([, value]) => value !== null && value !== undefined)
  const queryString = metaEntries.length
    ? `?${new URLSearchParams(metaEntries.map(([key, value]) => [key, String(value)])).toString()}`
    : ''
  return `${base}/#${link.page}${queryString}`
}

export const pushChannel: NotificationChannel = {
  key: 'push',
  isConfigured: settings => Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) && settings.channels_enabled.push,
  addressFor: recipient => (recipient.userId ? String(recipient.userId) : null),
  async send({ recipient, rendered }) {
    ensureVapidConfigured()
    if (!vapidConfigured) throw new Error('VAPID keys are not configured')
    if (!recipient.userId) throw new Error('Recipient has no account')

    const subscriptions = await query<Array<{ id: number, endpoint: string, p256dh: string, auth: string }>>(
      `SELECT id, endpoint, p256dh, auth FROM notification_push_subscriptions WHERE user_id = ?`,
      [recipient.userId],
    )
    if (!subscriptions.length) throw new Error('No push subscription for this recipient')

    const payload = JSON.stringify({
      title: rendered.subject,
      body: stripNotificationFormatting(rendered.body),
      url: buildDeepLinkUrl(rendered.link),
    })

    const results = await Promise.allSettled(subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload)
        await query(`UPDATE notification_push_subscriptions SET last_used_at = ? WHERE id = ?`, [localWallClockNow(), sub.id])
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await query(`DELETE FROM notification_push_subscriptions WHERE id = ?`, [sub.id])
        }
        throw err
      }
    }))

    if (results.every(result => result.status === 'rejected')) {
      const firstRejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      const reason = firstRejected?.reason
      throw new Error(reason instanceof Error ? reason.message : String(reason ?? 'Push delivery failed'))
    }
  },
}
