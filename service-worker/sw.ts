/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'

declare let self: ServiceWorkerGlobalScope

self.skipWaiting()
clientsClaim()

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

type ResponseValue = 'yes' | 'no' | 'maybe'

/** Answer buttons of an appointment notification (see server/utils/notifications/pushResponse.ts). */
interface PushResponseOptions {
  url: string
  token: string
  tag: string
  actions: Array<{ action: ResponseValue, title: string }>
  saved: Record<ResponseValue, string>
  failed: string
  failedBody: string
}

interface PushPayload {
  title: string
  body: string
  url?: string
  response?: PushResponseOptions
}

interface NotificationData {
  url?: string
  response?: PushResponseOptions
}

const ICON = '/logo-192x192.png'

/**
 * Browsers without notification actions (Firefox, Safari/iOS) are not handed any, so they keep
 * showing exactly the notification they showed before. Where only two buttons fit, the first two
 * (Zusage, Absage) are kept.
 */
function supportedActions(response: PushResponseOptions | undefined): Array<{ action: string, title: string }> {
  if (!response?.actions?.length) return []
  const NotificationCtor = (self as any).Notification
  if (!NotificationCtor || !('actions' in NotificationCtor.prototype)) return []
  const max = Number(NotificationCtor.maxActions)
  const limit = Number.isFinite(max) && max > 0 ? max : 2
  return response.actions.slice(0, limit).map(({ action, title }) => ({ action, title }))
}

self.addEventListener('push', (event) => {
  if (!event.data) return

  let payload: PushPayload
  try {
    payload = event.data.json()
  } catch {
    payload = { title: 'Benachrichtigung', body: event.data.text() }
  }

  const actions = supportedActions(payload.response)
  const data: NotificationData = { url: payload.url || '' }
  const options: NotificationOptions & { actions?: Array<{ action: string, title: string }> } = {
    body: payload.body,
    icon: ICON,
    badge: ICON,
    data,
  }
  if (actions.length && payload.response) {
    data.response = payload.response
    options.actions = actions
    options.tag = payload.response.tag
  }

  event.waitUntil(self.registration.showNotification(payload.title, options))
})

async function openApp(rawUrl: string) {
  const url = new URL(rawUrl, self.registration.scope).href
  const clientList = await self.clients.matchAll({ type: 'window' })
  const client = clientList.find(c => 'focus' in c)
  if (client) {
    try {
      const focused = await client.focus()
      if (await focused.navigate(url)) return
    } catch {
      // fall through to a fresh window
    }
  }
  await self.clients.openWindow?.(url)
}

/** Sends the answer without opening the app and replaces the notification with the outcome. */
async function answerInBackground(response: PushResponseOptions, value: ResponseValue, appUrl: string) {
  let saved = false
  try {
    const res = await fetch(new URL(response.url, self.registration.scope).href, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: response.token, response: value }),
    })
    const result = await res.json().catch(() => null)
    saved = res.ok && result?.ok === true
  } catch {
    saved = false
  }

  // Same tag as the original, so it is replaced instead of stacking up. Without actions — and on
  // failure, tapping it opens the app where the answer can be given normally.
  await self.registration.showNotification(saved ? response.saved[value] : response.failed, {
    body: saved ? '' : response.failedBody,
    icon: ICON,
    badge: ICON,
    tag: response.tag,
    data: { url: appUrl } satisfies NotificationData,
  })
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = (event.notification.data as NotificationData | undefined) ?? {}
  const action = event.action as ResponseValue | ''

  if (action && data.response && data.response.actions.some(a => a.action === action)) {
    event.waitUntil(answerInBackground(data.response, action, data.url || ''))
    return
  }

  event.waitUntil(openApp(data.url || ''))
})
