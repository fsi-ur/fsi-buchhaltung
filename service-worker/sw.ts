/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'

declare let self: ServiceWorkerGlobalScope

self.skipWaiting()
clientsClaim()

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

interface PushPayload {
  title: string
  body: string
  url?: string
}

self.addEventListener('push', (event) => {
  if (!event.data) return

  let payload: PushPayload
  try {
    payload = event.data.json()
  } catch {
    payload = { title: 'Benachrichtigung', body: event.data.text() }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/logo-192x192.png',
      badge: '/logo-192x192.png',
      data: { url: payload.url || '' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const rawUrl = (event.notification.data as { url?: string } | undefined)?.url || ''
  const url = new URL(rawUrl, self.registration.scope).href

  event.waitUntil((async () => {
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
  })())
})
