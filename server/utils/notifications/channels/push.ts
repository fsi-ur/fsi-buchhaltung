import { isAllowedPushEndpoint } from '~/server/utils/notifications/pushEndpoints'
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

    // Safety net: never push to a deactivated account (its subscriptions are removed on deactivation).
    const [account] = await query<Array<{ is_active: number }>>(`SELECT is_active FROM users WHERE id = ? LIMIT 1`, [recipient.userId])
    if (!account || !Number(account.is_active)) throw new Error('Recipient account is inactive')

    const storedSubscriptions = await query<Array<{ id: number, endpoint: string, p256dh: string, auth: string }>>(
      `SELECT id, endpoint, p256dh, auth FROM notification_push_subscriptions WHERE user_id = ?`,
      [recipient.userId],
    )
    // Rows from before the endpoint allowlist are kept (owner decision) but never contacted.
    const subscriptions = storedSubscriptions.filter((sub) => {
      if (isAllowedPushEndpoint(sub.endpoint)) return true
      console.warn(`push: subscription ${sub.id} skipped — endpoint host not allowed`)
      return false
    })
    if (!subscriptions.length) throw new Error('No push subscription for this recipient')

    const payload = JSON.stringify({
      title: rendered.subject,
      body: stripNotificationFormatting(rendered.body),
      url: buildDeepLinkUrl(rendered.link),
    })

    const results = await Promise.allSettled(subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload)
        await query(`UPDATE notification_push_subscriptions SET last_used_at = ? WHERE id = ?`, [await localWallClockNow(), sub.id])
      } catch (err: any) {
        // Subscriptions are only removed when their user is deactivated — not on send failures, even
        // 404/410 (owner decision: getting people to enable push is hard).
        console.warn(`push: delivery to subscription ${sub.id} failed`, err?.statusCode ?? err?.message ?? err)
        throw err
      }
    }))

    if (results.every(result => result.status === 'rejected')) {
      const firstRejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      const statusCode = Number(firstRejected?.reason?.statusCode) || null
      // Stored in notification_deliveries.error — only a generic text, never the raw network error (SEC-20).
      throw new Error(statusCode ? `Push delivery failed (HTTP ${statusCode})` : 'Push delivery failed')
    }
  },
}
